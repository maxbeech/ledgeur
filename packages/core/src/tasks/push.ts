// Pushing an action item to the place somebody actually keeps their tasks.
//
// ── Why this exists ─────────────────────────────────────────────────────────
// A meeting that produces four action items and leaves them in the meeting is a
// meeting that produced nothing. Ledgeur has always extracted them; until now
// the only way out of the app was a signed webhook, which is the right answer
// for a team with an integration platform and the wrong answer for one person
// who keeps their work in Linear.
//
// ── What this module is, and is not ─────────────────────────────────────────
// It is the *contract*: which endpoint, which headers, what the body looks like
// and how to read the reply. It is pure, so every destination is unit-tested
// without a network, an account or a key. The sending belongs to the app, which
// owns credentials and knows whether it has a native side to POST from (see
// apps/desktop/src/lib/taskPush.ts, and the note about CORS in
// src-tauri/net.rs).
//
// ── Deliberately one-way ────────────────────────────────────────────────────
// Ledgeur creates the task and records the id and URL it got back. It does not
// poll, and closing the task in Linear does not close it here. Two-way sync is
// a genuinely different piece of work with its own failure modes, and claiming
// it because a create call succeeded would be the kind of thing lib/plans.ts
// exists to prevent. /what-we-dont-have says so out loud.
//
// ── Endpoints, checked against the live docs on 2026-09-09 ──────────────────
//   Linear    POST https://api.linear.app/graphql
//             Authorization: <key>          (raw, NOT "Bearer" — personal API
//                                            keys differ from OAuth tokens here,
//                                            and a Bearer prefix 400s)
//   Todoist   POST https://api.todoist.com/api/v1/tasks
//             Authorization: Bearer <token> (v1; the old /rest/v2 path is the
//                                            previous generation of this API)
//   Asana     POST https://app.asana.com/api/1.0/tasks
//             Authorization: Bearer <pat>   (body wrapped in a `data` object,
//                                            which is Asana's house style and
//                                            the single easiest thing to get
//                                            wrong)

/** Where a task can be sent. */
export type TaskTargetId = "linear" | "todoist" | "asana";

/** What one destination needs configuring, beyond a token. */
export interface TaskTargetField {
  key: "token" | "container" | "workspace";
  label: string;
  /** Shown under the field. Says where to find the value, not what it is. */
  hint: string;
  required: boolean;
  secret: boolean;
}

export interface TaskTarget {
  id: TaskTargetId;
  name: string;
  /** Where somebody goes to create the credential. */
  credentialsUrl: string;
  fields: readonly TaskTargetField[];
}

/** A configured destination. Values come from the app's settings store. */
export interface TaskTargetConfig {
  target: TaskTargetId;
  token: string;
  /** Linear team id, Todoist project id, or Asana project gid. */
  container?: string;
  /** Asana only, and required there unless a project is given. */
  workspace?: string;
}

/** The action item being sent, plus enough of its meeting to be findable. */
export interface PushableTask {
  title: string;
  /** Who it was assigned to in the meeting, when anybody was. */
  owner?: string;
  /** ISO date, when the meeting gave one. */
  due?: string;
  meetingTitle: string;
  /** A deep link back into Ledgeur, so the task can be traced to its meeting. */
  meetingUrl?: string;
}

/** A request the app can hand straight to its HTTP primitive. */
export interface TaskRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
}

/** What came back, read into one shape whatever the API's own is. */
export interface TaskPushResult {
  ok: boolean;
  /** The created task's id in the far system, when it told us. */
  id?: string;
  /** A link a person can open, when the API returns one. */
  url?: string;
  /** Present when it failed. The far end's own words, where there are any. */
  error?: string;
}

export const TASK_TARGETS: readonly TaskTarget[] = [
  {
    id: "linear",
    name: "Linear",
    credentialsUrl: "https://linear.app/settings/account/security",
    fields: [
      {
        key: "token", label: "Personal API key", required: true, secret: true,
        hint: "Linear → Settings → Security & access → Personal API keys. Starts with lin_api_.",
      },
      {
        key: "container", label: "Team ID", required: true, secret: false,
        hint: "The UUID of the team issues should land in, not the three-letter key.",
      },
    ],
  },
  {
    id: "todoist",
    name: "Todoist",
    credentialsUrl: "https://app.todoist.com/app/settings/integrations/developer",
    fields: [
      {
        key: "token", label: "API token", required: true, secret: true,
        hint: "Todoist → Settings → Integrations → Developer → API token.",
      },
      {
        key: "container", label: "Project ID", required: false, secret: false,
        hint: "Leave empty and tasks go to your Inbox.",
      },
    ],
  },
  {
    id: "asana",
    name: "Asana",
    credentialsUrl: "https://app.asana.com/0/my-apps",
    fields: [
      {
        key: "token", label: "Personal access token", required: true, secret: true,
        hint: "Asana → My settings → Apps → Manage developer apps → Personal access tokens.",
      },
      {
        key: "workspace", label: "Workspace GID", required: true, secret: false,
        hint: "Every Asana task has to be created in a workspace.",
      },
      {
        key: "container", label: "Project GID", required: false, secret: false,
        hint: "Leave empty and the task lands in My Tasks for the workspace.",
      },
    ],
  },
];

export const taskTargetById = (id: string): TaskTarget | undefined =>
  TASK_TARGETS.find((t) => t.id === id);

/**
 * Why a config cannot be used, in words for the person who wrote it.
 *
 * Returns null when it is usable. Checked before anything is sent, because a
 * missing team id fails at Linear with a GraphQL error about an input object,
 * which tells the user nothing they can act on.
 */
export function taskConfigError(config: TaskTargetConfig): string | null {
  const target = taskTargetById(config.target);
  if (!target) return `There is no task destination called "${config.target}".`;
  for (const field of target.fields) {
    if (!field.required) continue;
    const value = (config[field.key] ?? "").trim();
    // The label is used verbatim rather than lower-cased: "personal api key"
    // is not what the field above it says, and a message that renames the thing
    // it is asking for is a message somebody has to translate.
    if (!value) return `${target.name} cannot take a task without a ${field.label}.`;
  }
  return null;
}

/**
 * The description that travels with the task.
 *
 * Kept deliberately short: the meeting it came from, who owns it, and a link
 * back. A task manager is not where somebody reads a transcript, and pasting
 * one in makes every task unreadable in a list view.
 */
export function taskBody(task: PushableTask): string {
  const lines = [`From the meeting: ${task.meetingTitle}`];
  if (task.owner) lines.push(`Owner as discussed: ${task.owner}`);
  if (task.meetingUrl) lines.push(task.meetingUrl);
  return lines.join("\n");
}

/**
 * GraphQL string escaping for Linear.
 *
 * Linear takes a query document rather than variables here, so an action item
 * containing a quote or a newline would otherwise produce a syntactically
 * invalid document and a 400 that looks like an auth problem. JSON.stringify
 * produces exactly a GraphQL string literal for these cases: both grammars
 * agree on \" \\ \n \r \t and \uXXXX.
 */
const gql = (s: string): string => JSON.stringify(s);

/** Build the request for one task. Pure. */
export function buildTaskRequest(task: PushableTask, config: TaskTargetConfig): TaskRequest {
  const description = taskBody(task);
  switch (config.target) {
    case "linear": {
      const query = `mutation { issueCreate(input: { title: ${gql(task.title)}, description: ${gql(description)}, teamId: ${gql(config.container ?? "")}${task.due ? `, dueDate: ${gql(task.due)}` : ""} }) { success issue { id identifier url } } }`;
      return {
        url: "https://api.linear.app/graphql",
        // Raw key, no Bearer. See the header note.
        headers: { "Content-Type": "application/json", Authorization: config.token },
        body: JSON.stringify({ query }),
      };
    }
    case "todoist": {
      const payload: Record<string, string> = { content: task.title, description };
      if (config.container) payload.project_id = config.container;
      if (task.due) payload.due_date = task.due;
      return {
        url: "https://api.todoist.com/api/v1/tasks",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.token}` },
        body: JSON.stringify(payload),
      };
    }
    case "asana": {
      const data: Record<string, unknown> = { name: task.title, notes: description };
      if (config.workspace) data.workspace = config.workspace;
      if (config.container) data.projects = [config.container];
      if (task.due) data.due_on = task.due;
      return {
        url: "https://app.asana.com/api/1.0/tasks",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.token}` },
        body: JSON.stringify({ data }),
      };
    }
  }
}

/** Parse whatever came back into one shape. Never throws. */
export function readTaskReply(
  target: TaskTargetId, status: number, text: string,
): TaskPushResult {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    /* a proxy's HTML error page, or an empty body — handled below */
  }
  const obj = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;

  // Linear answers 200 with an `errors` array when the mutation itself failed,
  // so the status code alone is not the answer for it.
  if (target === "linear") {
    const errors = obj.errors;
    if (Array.isArray(errors) && errors.length) {
      const first = errors[0] as { message?: unknown };
      return { ok: false, error: typeof first?.message === "string" ? first.message : "Linear refused the issue." };
    }
    const created = ((obj.data as Record<string, unknown> | undefined)?.issueCreate ?? {}) as Record<string, unknown>;
    const issue = (created.issue ?? {}) as Record<string, unknown>;
    if (created.success === true && typeof issue.id === "string") {
      return {
        ok: true,
        id: issue.id,
        url: typeof issue.url === "string" ? issue.url : undefined,
      };
    }
    return { ok: false, error: failureText(status, text) };
  }

  if (status < 200 || status >= 300) return { ok: false, error: failureText(status, text) };

  if (target === "todoist") {
    const id = typeof obj.id === "string" ? obj.id : undefined;
    return { ok: true, id, url: typeof obj.url === "string" ? obj.url : undefined };
  }

  // Asana wraps the created object the same way it wants the request wrapped.
  const data = (obj.data ?? {}) as Record<string, unknown>;
  const gid = typeof data.gid === "string" ? data.gid : undefined;
  return {
    ok: true,
    id: gid,
    url: gid ? `https://app.asana.com/0/0/${gid}` : undefined,
  };
}

/**
 * A failure a person can act on.
 *
 * The two statuses worth naming are the two that are somebody's fault rather
 * than the network's: a rejected credential and a rejected id. Everything else
 * is passed through, truncated, because the far end's wording is usually better
 * than anything invented here.
 */
function failureText(status: number, text: string): string {
  const detail = text.trim().slice(0, 300);
  if (status === 401 || status === 403) {
    return `That token was refused (${status}). Check it has not been revoked, and that it is a personal token rather than an OAuth client secret.`;
  }
  if (status === 404) {
    return "Nothing was found at that project or team id. Check the id, not the token.";
  }
  if (status === 429) return "Rate-limited. Wait a moment and send it again.";
  return detail ? `${status} ${detail}` : `The request failed with status ${status}.`;
}

/** Statuses worth trying again. Mirrors the webhook's rule, for the same
 *  reason: a 4xx means the request is wrong, and repeating it is noise in
 *  somebody else's logs. */
export const taskPushRetryable = (status: number): boolean =>
  status >= 500 || status === 408 || status === 429;
