// Note provenance, follow-up email drafting, custom templates ("recipes"),
// outbound webhooks and calendar auto-start — the features whose whole value
// depends on them never inventing anything, which is what these assert.

import {
  attributeNotes, attributeMeetingNotes, type AttributableLine,
} from "../src/notes/provenance.ts";
import {
  buildFollowUpPrompt, parseFollowUp, localFollowUp, mailtoUrl,
} from "../src/notes/followup.ts";
import {
  NOTE_TEMPLATES, DEFAULT_TEMPLATE_ID, newTemplateId, validateTemplate, toTemplate,
  resolveTemplate, allTemplates, isCustomTemplateId, templateInstruction,
} from "../src/notes/templates.ts";
import {
  buildWebhookPayload, signingString, signWebhook, webhookHeaders, webhookUrlError,
} from "../src/notes/webhook.ts";
import { eventToAutoStart } from "../src/calendar/schedule.ts";
import type { CalendarEvent } from "../src/domain/entities.ts";
import type { MeetingNotes } from "../src/notes/summarize.ts";

export async function runGranolaTests(ok: (name: string, cond: boolean, detail?: string) => void): Promise<void> {
  // ── provenance ────────────────────────────────────────────────────────────
  const line = (id: string, sec: number, speakerLabel: string, text: string): AttributableLine =>
    ({ id, startMs: sec * 1000, speakerLabel, text });

  const transcript: AttributableLine[] = [
    line("l1", 0, "Sarah", "morning everyone thanks for making the time"),
    line("l2", 8, "Ravi", "so the enterprise pricing tier lands at forty thousand a year"),
    line("l3", 16, "Sarah", "we agreed to go with forty thousand and revisit in the new year"),
    line("l4", 24, "Ravi", "I will send the updated deck to legal by Friday"),
    line("l5", 32, "Sarah", "anyway did anyone watch the football at the weekend"),
  ];

  const attributed = attributeNotes([
    "Enterprise pricing was set at forty thousand a year.",
    "Ravi will send the updated deck to legal by Friday.",
    "The team completed the SOC 2 audit.",
  ], transcript);

  ok("a supported note line is cited", Boolean(attributed[0].citation));
  ok("the citation points at the right part of the meeting",
    attributed[0].citation!.lineIds.includes("l2") || attributed[0].citation!.lineIds.includes("l3"),
    JSON.stringify(attributed[0].citation));
  ok("the citation carries a timestamp to jump to", attributed[0].citation!.startMs > 0);
  ok("an action item is cited to the turn that made it",
    attributed[1].citation?.lineIds.includes("l4") === true, JSON.stringify(attributed[1].citation));
  ok("an unsupported line gets NO citation rather than the least-bad guess",
    attributed[2].citation === undefined,
    "a wrong citation is worse than none — it looks verified");
  ok("confidence is reported so a weak match looks weak",
    attributed[0].citation!.confidence > 0 && attributed[0].citation!.confidence <= 1);
  ok("a citation never spans more than three lines",
    attributed.every((a) => (a.citation?.lineIds.length ?? 0) <= 3));

  ok("an empty transcript attributes nothing rather than throwing",
    attributeNotes(["anything at all"], []).every((a) => !a.citation));
  ok("a note line of only stopwords is not cited",
    attributeNotes(["and then it was so"], transcript)[0].citation === undefined);
  ok("every note line comes back, cited or not", attributeNotes(["a", "b", "c"], transcript).length === 3);
  ok("the note text is never altered", attributeNotes(["Exact  text  kept."], transcript)[0].text === "Exact  text  kept.");

  const whole = attributeMeetingNotes(
    { summary: ["Enterprise pricing was set at forty thousand a year."], decisions: [], questions: [], actionItems: ["Ravi will send the deck to legal by Friday."] },
    transcript,
  );
  ok("whole-notes attribution covers every section",
    whole.summary.length === 1 && whole.actionItems.length === 1 && whole.decisions.length === 0);
  ok("unsupported lines are counted so an invented summary is visible", whole.unsupported === 0);
  ok("an invented bullet is counted as unsupported",
    attributeMeetingNotes({ summary: ["We acquired a competitor in Berlin."], decisions: [], questions: [], actionItems: [] }, transcript).unsupported === 1);

  // ── follow-up email ───────────────────────────────────────────────────────
  const notes: MeetingNotes = {
    summary: ["Pricing was agreed at 40k."],
    decisions: ["Go with 40k, revisit in January."],
    questions: ["Does legal need to review the deck?"],
    actionItems: ["Ravi to send the deck to legal by Friday."],
    wordCount: 120,
  };

  const prompt = buildFollowUpPrompt("Q3 pricing", notes, "raw transcript text", { senderName: "Max", tone: "warm" });
  ok("the follow-up prompt forbids inventing owners and dates",
    prompt[0].content.includes("Never invent an owner"));
  ok("the follow-up prompt asks for a subject line", prompt[0].content.includes("Subject: "));
  ok("the follow-up prompt signs off as the named sender", prompt[0].content.includes("Sign off as Max"));
  ok("with no sender it explicitly refuses to invent one",
    buildFollowUpPrompt("t", notes, "x")[0].content.includes("Do not sign off with a name"));
  ok("the tone reaches the prompt", prompt[0].content.includes("Friendly"));
  ok("the real decisions reach the prompt", prompt[1].content.includes("revisit in January"));
  ok("the real action items reach the prompt", prompt[1].content.includes("send the deck to legal"));
  ok("the transcript reaches the prompt", prompt[1].content.includes("raw transcript text"));
  ok("a huge transcript is clipped, not sent whole",
    buildFollowUpPrompt("t", notes, "x".repeat(50_000))[1].content.includes("(truncated)"));
  ok("an empty section is omitted rather than sent as a blank heading",
    !buildFollowUpPrompt("t", { ...notes, questions: [] }, "x")[1].content.includes("Open questions"));

  const parsed = parseFollowUp("Subject: Q3 pricing — recap\n\nHi all,\n\nWe agreed 40k.", "Q3 pricing");
  ok("a reply's subject is parsed", parsed.subject === "Q3 pricing — recap");
  ok("a reply's body is parsed", parsed.body.startsWith("Hi all,"));
  ok("a reply with no Subject: still yields a usable draft", (() => {
    const p = parseFollowUp("Hi all, we agreed 40k.", "Q3 pricing");
    return p.subject === "Follow-up: Q3 pricing" && p.body.includes("40k");
  })());
  ok("a model draft is marked as model-written", parsed.source === "model");

  const local = localFollowUp("Q3 pricing", notes, { senderName: "Max" });
  ok("the local draft is marked as locally assembled", local.source === "local");
  ok("the local draft uses the real decisions", local.body.includes("revisit in January"));
  ok("the local draft uses the real action items", local.body.includes("send the deck to legal"));
  ok("the local draft signs off when a name is known", local.body.trimEnd().endsWith("Max"));
  ok("the local draft omits sections the meeting did not produce",
    !localFollowUp("t", { ...notes, decisions: [] }).body.includes("What we decided"));
  ok("a meeting with nothing in it says so rather than sending an empty recap", (() => {
    const empty = localFollowUp("t", { summary: [], decisions: [], questions: [], actionItems: [], wordCount: 0 });
    return empty.body.includes("no summary");
  })());

  ok("mailto encodes spaces as %20, not +", (() => {
    const url = mailtoUrl({ subject: "a b", body: "c d", source: "local" });
    return url.includes("subject=a%20b") && !url.includes("+");
  })());
  ok("mailto includes the recipient when known", mailtoUrl(local, "team@example.com").startsWith("mailto:team%40example.com?"));

  // ── recipes (custom templates) ────────────────────────────────────────────
  ok("a custom id can never shadow a built-in", (() => {
    const id = newTemplateId("General meeting");
    return isCustomTemplateId(id) && !NOTE_TEMPLATES.some((t) => t.id === id);
  })());
  ok("ids are made unique against what exists", (() => {
    const first = newTemplateId("QBR");
    return newTemplateId("QBR", [first]) !== first;
  })());
  ok("a nameless id still generates", newTemplateId("!!!").length > "custom:".length);

  ok("a template with no name is refused", validateTemplate({ focus: "x" }).length > 0);
  ok("a template that does nothing is refused",
    validateTemplate({ name: "Empty" }).some((e) => e.includes("does nothing")));
  ok("a template with only things to look for is fine",
    validateTemplate({ name: "Triage", looksFor: ["every reported bug"] }).length === 0);
  ok("a template with only a focus is fine",
    validateTemplate({ name: "Crit", focus: "This is a design critique." }).length === 0);
  ok("an over-long name is refused", validateTemplate({ name: "x".repeat(61), focus: "y" }).length > 0);

  const custom = toTemplate({ id: newTemplateId("Support triage"), name: "  Support triage  ", looksFor: ["every reported bug", "  ", "who is affected"] });
  ok("normalising trims the name", custom.name === "Support triage");
  ok("normalising drops empty looksFor entries", custom.looksFor.length === 2);
  ok("a custom template with no description still gets one", custom.description.length > 0);

  ok("a custom template resolves by id", resolveTemplate(custom.id, [custom]).id === custom.id);
  ok("a built-in still resolves when custom templates exist", resolveTemplate("sales", [custom]).id === "sales");
  ok("an id for a template this device does not have falls back to general",
    resolveTemplate(custom.id, []).id === DEFAULT_TEMPLATE_ID,
    "a meeting saved with a custom template must still open on another machine");
  ok("allTemplates lists built-ins first", allTemplates([custom])[0].id === DEFAULT_TEMPLATE_ID);
  ok("allTemplates includes the custom one", allTemplates([custom]).some((t) => t.id === custom.id));
  ok("a custom template steers the prompt", templateInstruction(custom).includes("every reported bug"));

  // ── webhooks ──────────────────────────────────────────────────────────────
  const meeting = {
    id: "m1", title: "Q3 pricing", createdAt: "2026-09-05T10:00:00.000Z",
    startedAt: "2026-09-05T10:00:00.000Z", endedAt: "2026-09-05T10:30:00.000Z",
    lang: "en-hq", wordCount: 120, summary: notes.summary, decisions: notes.decisions,
    questions: notes.questions, actionItems: notes.actionItems, noteMarkdown: "# Q3 pricing",
    speakers: [{ label: "Sarah", speakingSeconds: 400, embedding: [0.1, 0.2, 0.3] }],
    segments: [{ speakerLabel: "Sarah", startMs: 0, endMs: 4000, text: "hello" }],
  };

  const payload = buildWebhookPayload(meeting, "2026-09-05T10:30:01.000Z");
  ok("the payload is versioned from the first delivery", payload.version === 1);
  ok("the payload names the event", payload.event === "meeting.completed");
  ok("the payload carries the real notes", payload.meeting.decisions[0].includes("revisit in January"));
  ok("the transcript is NOT sent by default", payload.meeting.segments === undefined);
  ok("the transcript is sent when asked for",
    buildWebhookPayload(meeting, "t", { includeTranscript: true }).meeting.segments?.length === 1);
  ok("speaker labels are sent", payload.meeting.speakers?.[0].label === "Sarah");
  ok("a voice embedding is NEVER sent, under any option", (() => {
    const withAll = JSON.stringify(buildWebhookPayload(meeting, "t", { includeTranscript: true }));
    return !withAll.includes("embedding") && !withAll.includes("0.2");
  })(), "an embedding identifies a person biometrically");

  const body = JSON.stringify(payload);
  const sig = await signWebhook("shhh", "1757067001", body);
  ok("the signature is prefixed sha256=", sig.startsWith("sha256="));
  ok("the signature is 64 hex characters", /^sha256=[0-9a-f]{64}$/.test(sig));
  ok("the signature covers the timestamp", sig !== (await signWebhook("shhh", "1757067002", body)),
    "otherwise a captured delivery replays forever");
  ok("the signature covers the body", sig !== (await signWebhook("shhh", "1757067001", `${body} `)));
  ok("a different secret gives a different signature", sig !== (await signWebhook("other", "1757067001", body)));
  ok("the signing string is timestamp.body", signingString("123", "{}") === "123.{}");

  const signed = await webhookHeaders(body, "1757067001", "shhh");
  ok("headers carry the signature", signed["X-Ledgeur-Signature"] === sig);
  ok("headers carry the timestamp", signed["X-Ledgeur-Timestamp"] === "1757067001");
  const unsigned = await webhookHeaders(body, "1757067001");
  ok("an unsigned delivery omits the header rather than sending an empty one",
    !("X-Ledgeur-Signature" in unsigned));

  ok("https is accepted", webhookUrlError("https://hooks.example.com/x") === null);
  ok("plain http to the internet is refused", webhookUrlError("http://hooks.example.com/x") !== null);
  ok("localhost over http is allowed for testing", webhookUrlError("http://localhost:3000/hook") === null);
  ok("127.0.0.1 over http is allowed for testing", webhookUrlError("http://127.0.0.1:3000/hook") === null);
  ok("a non-URL is refused", webhookUrlError("not a url") !== null);
  ok("a non-http scheme is refused", webhookUrlError("file:///etc/passwd") !== null);

  // ── calendar auto-start ───────────────────────────────────────────────────
  const at = (iso: string) => new Date(iso);
  const event = (id: string, startsAt: string, endsAt: string, isOnline: boolean): CalendarEvent =>
    ({ id, provider: "google", title: id, startsAt, endsAt, isOnline, meetingUrl: isOnline ? "https://meet.example/x" : null });

  const online = event("standup", "2026-09-05T10:00:00.000Z", "2026-09-05T10:30:00.000Z", true);
  const offline = event("lunch", "2026-09-05T10:00:00.000Z", "2026-09-05T11:00:00.000Z", false);
  const GRACE = 120_000;

  ok("an online meeting that just started auto-starts",
    eventToAutoStart([online], at("2026-09-05T10:00:30.000Z"), GRACE, new Set())?.id === "standup");
  ok("a calendar block with no join link NEVER auto-starts",
    eventToAutoStart([offline], at("2026-09-05T10:00:30.000Z"), GRACE, new Set()) === null,
    "recording your kitchen because the calendar said 'Lunch' is how a recorder gets uninstalled");
  ok("a meeting that has not started yet does not auto-start",
    eventToAutoStart([online], at("2026-09-05T09:58:00.000Z"), GRACE, new Set()) === null);
  ok("a meeting well underway does not retroactively auto-start",
    eventToAutoStart([online], at("2026-09-05T10:20:00.000Z"), GRACE, new Set()) === null,
    "waking the laptop mid-morning must not start recordings for meetings nearly over");
  ok("a finished meeting does not auto-start",
    eventToAutoStart([online], at("2026-09-05T11:00:00.000Z"), GRACE, new Set()) === null);
  ok("a meeting already started once is not restarted",
    eventToAutoStart([online], at("2026-09-05T10:00:30.000Z"), GRACE, new Set(["standup"])) === null,
    "otherwise stopping a take restarts it seconds later");
  ok("only one meeting is ever returned", (() => {
    const second = event("other", "2026-09-05T10:00:10.000Z", "2026-09-05T10:30:00.000Z", true);
    const picked = eventToAutoStart([second, online], at("2026-09-05T10:00:30.000Z"), GRACE, new Set());
    return picked?.id === "standup";
  })(), "two recordings at once is never right; the earliest start is the only defensible tie-break");
  ok("an empty calendar is not an error", eventToAutoStart([], new Date(), GRACE, new Set()) === null);
}
