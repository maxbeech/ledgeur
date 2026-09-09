// Pushing an action item to Linear, Todoist or Asana.
//
// Three APIs, three different opinions about how a request should look, and the
// three ways to get it wrong are all silent-ish: a Bearer prefix Linear does
// not want, an Asana body that is not wrapped in `data`, and a Linear reply
// that arrives as HTTP 200 while saying the mutation failed. Each of those has
// a test here, because none of them can be caught by reading the code and all
// of them cost a real user a lost action item.
import {
  TASK_TARGETS, buildTaskRequest, readTaskReply, taskBody, taskConfigError,
  taskPushRetryable, taskTargetById,
  type PushableTask, type TaskTargetConfig,
} from "../src/tasks/push.ts";

const TASK: PushableTask = {
  title: "Send Priya the revised pricing",
  owner: "Max",
  due: "2026-09-15",
  meetingTitle: "Acme renewal call",
  meetingUrl: "ledgeur://meeting/m-1",
};

const cfg = (over: Partial<TaskTargetConfig> = {}): TaskTargetConfig => ({
  target: "linear", token: "lin_api_x", container: "team-uuid", ...over,
});

export function runTaskPushTests(ok: (name: string, cond: boolean, detail?: string) => void): void {
  // --- the catalogue ---
  ok("every destination has a unique id",
    new Set(TASK_TARGETS.map((t) => t.id)).size === TASK_TARGETS.length);
  ok("every destination requires a token",
    TASK_TARGETS.every((t) => t.fields.some((f) => f.key === "token" && f.required && f.secret)));
  ok("every destination says where to get the credential",
    TASK_TARGETS.every((t) => t.credentialsUrl.startsWith("https://")));
  ok("an unknown destination is not invented", taskTargetById("jira") === undefined);

  // --- configuration is checked before anything is sent ---
  // Linear's own error for a missing teamId is a GraphQL complaint about an
  // input object, which tells the user nothing they can act on.
  ok("a missing Linear team id is caught here, not by Linear",
    (taskConfigError(cfg({ container: "" })) ?? "").includes("Team ID"));
  ok("a missing token is caught", (taskConfigError(cfg({ token: "  " })) ?? "").includes("API key"));
  ok("a complete Linear config passes", taskConfigError(cfg()) === null);
  // Todoist's project is optional: no project means the Inbox, which is a fine
  // answer and must not be treated as an error.
  ok("Todoist needs no project", taskConfigError({ target: "todoist", token: "t" }) === null);
  ok("Asana needs a workspace",
    (taskConfigError({ target: "asana", token: "t" }) ?? "").includes("Workspace"));
  ok("Asana with a workspace passes",
    taskConfigError({ target: "asana", token: "t", workspace: "1234" }) === null);
  ok("a destination that does not exist is refused",
    taskConfigError({ target: "trello" as never, token: "t" }) !== null);

  // --- the description ---
  const body = taskBody(TASK);
  ok("the description names the meeting", body.includes("Acme renewal call"));
  ok("the description carries the owner discussed", body.includes("Max"));
  ok("the description links back", body.includes("ledgeur://meeting/m-1"));
  ok("a task with no owner or link says only what it knows",
    taskBody({ title: "x", meetingTitle: "Standup" }).split("\n").length === 1);

  // --- Linear ---
  {
    const req = buildTaskRequest(TASK, cfg());
    ok("Linear goes to the GraphQL endpoint", req.url === "https://api.linear.app/graphql");
    // The single most likely mistake: a personal API key is sent raw. A Bearer
    // prefix is rejected, and the rejection looks like a bad key.
    ok("Linear gets the raw key, with no Bearer prefix", req.headers.Authorization === "lin_api_x");
    ok("Linear is sent a query document", JSON.parse(req.body).query.includes("issueCreate"));
    ok("Linear is told the team", req.body.includes("team-uuid"));
    ok("Linear is given the due date", req.body.includes("2026-09-15"));

    // A title containing a quote would otherwise close the GraphQL string
    // literal early and produce a 400 that reads like an auth failure.
    const quoted = buildTaskRequest(
      { ...TASK, title: 'Ask "why" about the 40% figure\nand follow up' }, cfg());
    const query = JSON.parse(quoted.body).query as string;
    ok("a quote in the title is escaped, not emitted raw", query.includes('\\"why\\"'));
    ok("a newline in the title is escaped", query.includes("\\n") && !/title: "[^"]*\n/.test(query));
    // The document must still be well-formed after escaping: count the string
    // literals rather than trusting the escape by eye.
    ok("the escaped document is still balanced",
      (query.match(/(?<!\\)"/g) ?? []).length % 2 === 0);
  }

  // --- Todoist ---
  {
    const req = buildTaskRequest(TASK, { target: "todoist", token: "tok", container: "p-9" });
    ok("Todoist uses the v1 tasks endpoint", req.url === "https://api.todoist.com/api/v1/tasks");
    ok("Todoist gets a Bearer token", req.headers.Authorization === "Bearer tok");
    const payload = JSON.parse(req.body);
    ok("Todoist's title field is `content`", payload.content === TASK.title);
    ok("Todoist is given the project", payload.project_id === "p-9");
    ok("Todoist is given the due date", payload.due_date === "2026-09-15");
    // An empty project_id is not the same as no project: Todoist rejects it.
    const inbox = JSON.parse(buildTaskRequest(TASK, { target: "todoist", token: "t" }).body);
    ok("no project means the key is absent, not empty", !("project_id" in inbox));
  }

  // --- Asana ---
  {
    const req = buildTaskRequest(TASK, {
      target: "asana", token: "pat", workspace: "w-1", container: "proj-2",
    });
    ok("Asana uses the 1.0 tasks endpoint", req.url === "https://app.asana.com/api/1.0/tasks");
    ok("Asana gets a Bearer token", req.headers.Authorization === "Bearer pat");
    const payload = JSON.parse(req.body);
    // Asana's house style, and the easiest thing to get wrong: an unwrapped
    // body is a 400 with a message about a missing name.
    ok("Asana's body is wrapped in `data`", typeof payload.data === "object" && !("name" in payload));
    ok("Asana's title field is `name`", payload.data.name === TASK.title);
    ok("Asana is told the workspace", payload.data.workspace === "w-1");
    ok("Asana takes projects as a list", Array.isArray(payload.data.projects) && payload.data.projects[0] === "proj-2");
    ok("Asana's due field is `due_on`", payload.data.due_on === "2026-09-15");
    const noProject = JSON.parse(
      buildTaskRequest(TASK, { target: "asana", token: "p", workspace: "w-1" }).body);
    ok("no Asana project means no empty list", !("projects" in noProject.data));
  }

  // --- reading the reply ---
  {
    // Linear answers 200 even when the mutation failed. Trusting the status
    // code here would report every rejected issue as created.
    const refused = readTaskReply("linear", 200, JSON.stringify({
      errors: [{ message: "Team not found." }],
    }));
    ok("a Linear error inside a 200 is a failure", refused.ok === false);
    ok("Linear's own words are kept", refused.error === "Team not found.");

    const made = readTaskReply("linear", 200, JSON.stringify({
      data: { issueCreate: { success: true, issue: { id: "i-1", identifier: "ENG-4", url: "https://linear.app/x/issue/ENG-4" } } },
    }));
    ok("a created Linear issue is read", made.ok && made.id === "i-1");
    ok("the Linear issue's link is kept", made.url === "https://linear.app/x/issue/ENG-4");
    // success:false with no errors array is a shape the API can legally return.
    ok("Linear success:false is a failure",
      readTaskReply("linear", 200, JSON.stringify({ data: { issueCreate: { success: false } } })).ok === false);

    ok("a created Todoist task is read",
      readTaskReply("todoist", 200, JSON.stringify({ id: "7", url: "https://todoist.com/showTask?id=7" }).toString()).id === "7");
    const asana = readTaskReply("asana", 201, JSON.stringify({ data: { gid: "gid-3" } }));
    ok("a created Asana task is read", asana.ok && asana.id === "gid-3");
    ok("Asana gets a link built from its gid", (asana.url ?? "").includes("gid-3"));

    // Failure wording has to name the thing the person can change.
    const badToken = readTaskReply("todoist", 401, "unauthorized");
    ok("a 401 blames the token", (badToken.error ?? "").toLowerCase().includes("token"));
    ok("a 404 blames the id, not the token",
      (readTaskReply("asana", 404, "").error ?? "").toLowerCase().includes("id"));
    ok("a 429 says to wait", (readTaskReply("todoist", 429, "").error ?? "").includes("Rate-limited"));
    // An HTML error page from a proxy must not crash the parser.
    ok("a non-JSON body is survivable",
      readTaskReply("asana", 502, "<html>Bad Gateway</html>").ok === false);
    ok("an empty body still explains itself",
      (readTaskReply("todoist", 500, "").error ?? "").includes("500"));
  }

  // --- retries: same rule as the webhook ---
  ok("a server error is retried", taskPushRetryable(503));
  ok("a rate limit is retried", taskPushRetryable(429));
  ok("a timeout is retried", taskPushRetryable(408));
  ok("a rejected request is not retried", !taskPushRetryable(400) && !taskPushRetryable(401));
}
