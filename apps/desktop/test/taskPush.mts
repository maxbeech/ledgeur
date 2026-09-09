// The device side of sending an action item somewhere.
//
// The contract (endpoints, headers, bodies, replies) is tested in
// @ledgeur/core without a network. What is pinned here is the part that only
// exists on a device, and it is driven through the real `pushTask` with a
// stubbed `fetch` rather than by writing the bookkeeping by hand: a test that
// fakes the record proves the assertion and not the code.
//
// The case that matters most is the double-send. A task created twice is not a
// visible error anywhere. It is two issues in somebody's backlog, and they will
// assume they double-clicked.
import {
  configError, currentConfig, getPushed, pushTask, pushedTo, subscribePushed, taskPushReady,
} from "../src/lib/taskPush.ts";
import { setSetting } from "../src/lib/settings.ts";
import type { PushableTask } from "@ledgeur/core";

type Ok = (name: string, cond: boolean, detail?: string) => void;

const TASK: PushableTask = { title: "Send Priya the pricing", meetingTitle: "Acme renewal" };

function configure(target: string, token = "tok", container = "", workspace = ""): void {
  setSetting("taskTarget", target);
  setSetting("taskToken", token);
  setSetting("taskContainer", container);
  setSetting("taskWorkspace", workspace);
}

/** Replace fetch with something that answers, and record what it was asked. */
interface Call { url: string; headers: Record<string, string>; body: string }
function stubFetch(reply: (call: Call) => { status: number; body: string }): {
  calls: Call[]; restore: () => void;
} {
  const calls: Call[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const call = {
      url: String(url),
      headers: (init.headers ?? {}) as Record<string, string>,
      body: String(init.body ?? ""),
    };
    calls.push(call);
    const { status, body } = reply(call);
    return { status, text: async () => body } as Response;
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const linearOk = JSON.stringify({
  data: { issueCreate: { success: true, issue: { id: "i-1", url: "https://linear.app/x/ENG-1" } } },
});

export async function runTaskPushTests(ok: Ok): Promise<void> {
  // ── nothing configured ────────────────────────────────────────────────────
  configure("", "");
  ok("no destination means nothing to send to", currentConfig() === null);
  ok("no destination is not an error", configError() === null);
  ok("no destination is not ready", !taskPushReady());
  // The row's button reads this. A button that appears and then explains it
  // cannot do anything is worse than no button.
  ok("nothing is marked as sent when nothing is configured", pushedTo("k1") === null);
  const refused = await pushTask("k1", TASK);
  ok("sending with no destination fails politely rather than throwing",
    !refused.ok && (refused.error ?? "").includes("Settings"), refused.error);

  // ── half configured ───────────────────────────────────────────────────────
  configure("linear", "lin_api_x", "");
  ok("Linear without a team is not ready", !taskPushReady());
  ok("Linear without a team names the missing detail",
    (configError() ?? "").includes("Team ID"), configError() ?? "");
  // Caught here rather than at Linear, whose own error is a GraphQL complaint
  // about an input object.
  const half = stubFetch(() => ({ status: 200, body: linearOk }));
  const incomplete = await pushTask("k2", TASK);
  ok("a half-configured destination is not contacted at all",
    !incomplete.ok && half.calls.length === 0, `${half.calls.length} calls`);
  half.restore();

  configure("linear", "", "team-1");
  ok("Linear without a token is not ready", !taskPushReady());
  configure("linear", "   ", "team-1");
  ok("whitespace is not a token", !taskPushReady());

  configure("todoist", "tok", "");
  ok("Todoist with no project is ready", taskPushReady());
  ok("an empty project is absent rather than empty", currentConfig()?.container === undefined);
  configure("asana", "pat", "", "");
  ok("Asana without a workspace is not ready", !taskPushReady());
  configure("asana", "pat", "", "w-1");
  ok("Asana with a workspace is ready", taskPushReady());

  // ── a real send ───────────────────────────────────────────────────────────
  configure("linear", "lin_api_x", "team-1");
  ok("a complete Linear config is ready", taskPushReady());
  ok("a complete config has no problem to report", configError() === null);

  let notified = 0;
  const stopWatching = subscribePushed(() => { notified++; });

  const sent = stubFetch(() => ({ status: 200, body: linearOk }));
  const first = await pushTask("task:a", TASK);
  ok("a task goes", first.ok && first.id === "i-1", first.error);
  ok("the link it came back with is kept", first.url === "https://linear.app/x/ENG-1");
  ok("it went to Linear", sent.calls[0]?.url === "https://api.linear.app/graphql");
  ok("the key went raw, with no Bearer prefix", sent.calls[0]?.headers.Authorization === "lin_api_x");
  ok("a successful send notifies the rows", notified === 1, String(notified));

  // The one that matters: pressing the button twice, or an auto-push running
  // over a meeting somebody already sent by hand.
  const second = await pushTask("task:a", TASK);
  ok("sending the same task again does not create a second issue", sent.calls.length === 1,
    `${sent.calls.length} calls`);
  ok("the repeat still reports success, because the intent is satisfied", second.ok);
  ok("the repeat returns the original link", second.url === "https://linear.app/x/ENG-1");
  sent.restore();
  stopWatching();

  ok("the task is remembered", pushedTo("task:a")?.id === "i-1");
  ok("a task that never went is not remembered", pushedTo("task:b") === null);
  ok("the record is readable in full", Object.keys(getPushed()).includes("task:a"));

  // Pointing the app at a different team is a different destination, and the
  // task genuinely is not there. Claiming otherwise leaves somebody unable to
  // send it where they now want it.
  configure("linear", "lin_api_x", "team-2");
  ok("a different team means it has not been sent there", pushedTo("task:a") === null);
  configure("todoist", "tok", "");
  ok("a different product means it has not been sent there", pushedTo("task:a") === null);
  configure("linear", "lin_api_x", "team-1");
  ok("going back to the original destination finds it again", pushedTo("task:a")?.id === "i-1");

  // ── failure ───────────────────────────────────────────────────────────────
  // Linear reports a failed mutation inside an HTTP 200. Trusting the status
  // would mark the task as sent and hide it from the button forever.
  const rejected = stubFetch(() => ({
    status: 200, body: JSON.stringify({ errors: [{ message: "Team not found." }] }),
  }));
  const bad = await pushTask("task:c", TASK);
  ok("a Linear error inside a 200 is a failure", !bad.ok, JSON.stringify(bad));
  ok("Linear's own words reach the user", bad.error === "Team not found.");
  ok("a failed task is not recorded as sent", pushedTo("task:c") === null);
  ok("a rejected request is not retried", rejected.calls.length === 1, `${rejected.calls.length}`);
  rejected.restore();

  // A server error is retried, because the common cause is a receiver that is
  // briefly down rather than a request that is wrong.
  let attempts = 0;
  const flaky = stubFetch(() => {
    attempts++;
    return attempts < 3 ? { status: 503, body: "down" } : { status: 200, body: linearOk };
  });
  const eventual = await pushTask("task:d", TASK);
  ok("a server error is retried until it works", eventual.ok, eventual.error);
  ok("it took the retries to get there", flaky.calls.length === 3, `${flaky.calls.length}`);
  flaky.restore();

  configure("", "");
}
