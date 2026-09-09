// Sending an action item to Linear, Todoist or Asana.
//
// The contract (which endpoint, which headers, what the body looks like, how to
// read the reply) lives in @ledgeur/core (tasks/push.ts) and is unit-tested
// without a network. This is the delivery: credentials, retries, remembering
// what already went, and never letting a failed push affect the task itself.
//
// ── Why the POST goes through Rust ──────────────────────────────────────────
// Same reason as webhooks.ts: Ledgeur runs in a webview, and a cross-origin
// POST carrying an Authorization header triggers a CORS preflight. Linear,
// Todoist and Asana all answer preflights (they are called from browsers), so
// this would mostly work with fetch, but "mostly" is not a property worth
// depending on for somebody's task list, and their allowed-origin lists do not
// include a Tauri app. So it takes the same native path the webhook takes.
//
// ── Sent once ───────────────────────────────────────────────────────────────
// Every push records the task's key, so the button can say "already in Linear"
// rather than quietly creating a second copy. That record is per device and per
// destination: pointing the app at a different Linear team is a different
// destination and the tasks are legitimately not there yet.

import {
  buildTaskRequest, readTaskReply, taskConfigError, taskPushRetryable, taskTargetById,
  type PushableTask, type TaskPushResult, type TaskTargetConfig, type TaskTargetId,
} from "@ledgeur/core";
import { getSettings } from "./settings.ts";
import { isTauri } from "./runtime.ts";
import { createLogger } from "./logger.ts";

const log = createLogger("task-push");

const ATTEMPTS = 3;
const BACKOFF_MS = [0, 1_000, 4_000];
const REQUEST_TIMEOUT_MS = 15_000;

/** What was sent where, so nothing is sent twice. Keyed by task, valued by
 *  destination plus whatever link the far end gave back. */
export interface PushRecord {
  target: TaskTargetId;
  /** The container it went into, so re-pointing the app is not "already sent". */
  container: string;
  id?: string;
  url?: string;
  at: string;
}

const SENT_KEY = "ledgeur.tasks.pushed";

function loadSent(): Record<string, PushRecord> {
  try {
    const raw = localStorage.getItem(SENT_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, PushRecord>) : {};
  } catch {
    return {};
  }
}

let sent = loadSent();
const listeners = new Set<() => void>();

function commit(next: Record<string, PushRecord>): void {
  sent = next;
  try {
    localStorage.setItem(SENT_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — the in-memory record still stops a double send in
       this session, which is the case that actually happens */
  }
  for (const l of listeners) l();
}

export function subscribePushed(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const getPushed = (): Record<string, PushRecord> => sent;

/** Where a task already went, if it did and to where the app currently points. */
export function pushedTo(key: string): PushRecord | null {
  const config = currentConfig();
  const record = sent[key];
  if (!config || !record) return null;
  if (record.target !== config.target) return null;
  if (record.container !== (config.container ?? "")) return null;
  return record;
}

/** The configured destination, or null when nothing is set up. */
export function currentConfig(): TaskTargetConfig | null {
  const s = getSettings();
  const target = taskTargetById(s.taskTarget);
  if (!target) return null;
  return {
    target: target.id,
    token: s.taskToken.trim(),
    container: s.taskContainer.trim() || undefined,
    workspace: s.taskWorkspace.trim() || undefined,
  };
}

/** Why the configured destination cannot be used yet, in the user's words. */
export function configError(): string | null {
  const config = currentConfig();
  if (!config) return null;
  return taskConfigError(config);
}

export const taskPushReady = (): boolean => currentConfig() !== null && configError() === null;

/** One POST, native where there is a native side. See the header. */
async function sendOnce(
  url: string, headers: Record<string, string>, body: string,
): Promise<{ status: number; text: string }> {
  if (isTauri()) {
    const { invoke } = await import("@tauri-apps/api/core");
    const reply = await invoke<{ status: number; body: string }>("http_post", {
      url, headers, body, timeoutMs: REQUEST_TIMEOUT_MS,
    });
    return { status: reply.status, text: reply.body };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "POST", headers, body, signal: controller.signal });
    return { status: res.status, text: await res.text().catch(() => "") };
  } catch (e) {
    if (controller.signal.aborted) throw new Error("Timed out.");
    throw new Error(
      e instanceof TypeError
        ? "The browser blocked the request. This works in the desktop app, which sends it natively."
        : e instanceof Error ? e.message : String(e),
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send one action item. Never throws.
 *
 * `key` is the task's key from useTasks, and is what stops a second copy being
 * created. Passing a key that has already gone is not an error: it returns the
 * original result, because the user's intent ("this should be in Linear") is
 * already satisfied.
 */
export async function pushTask(key: string, task: PushableTask): Promise<TaskPushResult> {
  const already = pushedTo(key);
  if (already) return { ok: true, id: already.id, url: already.url };

  const config = currentConfig();
  if (!config) return { ok: false, error: "No task destination is set up yet. Settings has one." };
  const bad = taskConfigError(config);
  if (bad) return { ok: false, error: bad };

  const request = buildTaskRequest(task, config);
  let last: TaskPushResult = { ok: false, error: "Not attempted." };
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    if (BACKOFF_MS[attempt]) await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt]));
    try {
      const { status, text } = await sendOnce(request.url, request.headers, request.body);
      const result = readTaskReply(config.target, status, text);
      if (result.ok) {
        commit({
          ...sent,
          [key]: {
            target: config.target, container: config.container ?? "",
            id: result.id, url: result.url, at: new Date().toISOString(),
          },
        });
        log.info("task pushed", { target: config.target, id: result.id });
        return result;
      }
      last = result;
      if (!taskPushRetryable(status)) return last;
    } catch (e) {
      last = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  log.error("task push failed", last.error);
  return last;
}

/**
 * Push every action item a finished meeting produced.
 *
 * Only when the user asked for it (`taskAutoPush`), and never fatal: a task
 * manager that is down must not affect a meeting that is already recorded. The
 * per-task record means a retry after a partial failure sends only what is
 * missing.
 */
export async function pushMeetingTasks(meeting: {
  id: string; title: string; actionItems: readonly string[];
}): Promise<void> {
  const s = getSettings();
  if (!s.taskAutoPush || !taskPushReady()) return;
  for (const text of meeting.actionItems) {
    const key = `${meeting.id}::${text}`;
    const result = await pushTask(key, { title: text, meetingTitle: meeting.title });
    if (!result.ok) {
      // Stop at the first real failure rather than sending twenty more of the
      // same. A wrong token fails identically for every item, and the log would
      // be twenty copies of one problem.
      log.error("stopping the auto-push after a failure", result.error);
      return;
    }
  }
}
