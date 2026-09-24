import type { Block, Post, PostCategory, SchemaType, Source } from "./post-types";

// This is deliberately a data module, not a second publishing path. The
// aggregator in ../posts.ts remains the sole source for the blog, routes,
// sitemap, metadata and structured data.

const PIPEDREAM_IMAGE_STATUS =
  "Pipedream image publishing was unavailable in this workspace on 25 September 2026. These posts use the existing route-level social image; do not represent it as a newly commissioned featured photograph.";

const SOURCES = {
  screen: { label: "MDN: Screen Capture API", href: "https://developer.mozilla.org/en-US/docs/Web/API/Screen_Capture_API/Using_Screen_Capture" },
  webgpu: { label: "MDN: WebGPU API", href: "https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API" },
  audio: { label: "MDN: Web Audio API", href: "https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API" },
  whisper: { label: "OpenAI: Introducing Whisper", href: "https://openai.com/index/whisper/" },
  ico: { label: "ICO: recording online meetings", href: "https://ico.org.uk/for-organisations/advice-for-small-organisations/information-security/data-sharing-advice/" },
  nist: { label: "NIST: AI Risk Management Framework", href: "https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-ai-rmf-10" },
  mcp: { label: "Model Context Protocol specification", href: "https://modelcontextprotocol.io/specification/2025-06-18/architecture/overview" },
} as const satisfies Record<string, Source>;

type CampaignSpec = {
  slug: string;
  title: string;
  description: string;
  keyword: string;
  category: PostCategory;
  date: string;
  supporting: string[];
  longTail: string[];
  angle: string;
  workflow: string[];
  decisions: string[];
  pitfalls: string[];
  sourceKeys: (keyof typeof SOURCES)[];
  internal: Source[];
  schema: SchemaType[];
};

const INTERNAL = {
  assistant: { label: "how to choose an AI meeting assistant", href: "/blog/best-ai-meeting-assistant-2026" },
  noBot: { label: "get AI meeting notes without a bot", href: "/blog/ai-meeting-notes-without-a-bot" },
  private: { label: "understand private on-device meeting transcription", href: "/blog/private-on-device-meeting-transcription" },
  whisper: { label: "see how Whisper runs in the browser", href: "/blog/whisper-in-the-browser-explained" },
  security: { label: "read Ledgeur’s security position", href: "/security" },
  agents: { label: "connect meeting records to agents", href: "/agents" },
  memory: { label: "build a company memory from records you control", href: "/company-memory" },
  templates: { label: "start with a meeting-notes template", href: "/templates" },
} as const satisfies Record<string, Source>;

const SPECS: CampaignSpec[] = [
  {
    slug: "browser-tab-audio-for-meeting-notes", title: "Browser Tab Audio for Meeting Notes", description: "Capture browser-tab audio responsibly for private meeting notes. Follow a practical setup, QA and consent checklist.", keyword: "browser tab audio capture", category: "Academy", date: "2026-09-25",
    supporting: ["tab audio recording", "browser meeting recorder", "capture meeting audio", "share tab audio", "local meeting notes", "screen capture audio"], longTail: ["how to capture browser tab audio for a meeting", "record meeting audio without a bot"],
    angle: "The useful bit is not pressing Share. It is knowing which tab is selected, whether the browser returned an audio track, and what record you intend to keep when the meeting ends.",
    workflow: ["Open the meeting in a supported browser tab and close unrelated tabs before opening a capture picker.", "Start recording from a visible control, choose the meeting tab, then confirm that the browser offers tab audio.", "Speak for ten seconds and check the input meter before the discussion begins; an empty waveform is cheaper to fix now.", "At the end, stop capture, name the record clearly, and review the transcript before sharing it."],
    decisions: ["Prefer one meeting tab to a whole-screen share when that is enough for the stated purpose.", "Treat an absent audio track as a stop-and-fix signal, not a reason to reconstruct a meeting from memory.", "Keep the transcript, summary and export destination explicit before people start discussing sensitive work."], pitfalls: ["Assuming every browser includes tab audio in every capture flow.", "Selecting a whole display and accidentally exposing notifications or unrelated tabs.", "Equating local capture with permission to retain or distribute a recording."], sourceKeys: ["screen", "audio", "ico"], internal: [INTERNAL.noBot, INTERNAL.private, INTERNAL.whisper, INTERNAL.security], schema: ["HowTo", "FAQPage"],
  },
  {
    slug: "meeting-recording-consent-checklist", title: "Meeting Recording Consent Checklist", description: "Use this practical meeting-recording consent checklist to explain purpose, retention and sharing before you press record.", keyword: "meeting recording consent checklist", category: "Academy", date: "2026-09-24",
    supporting: ["recording meeting consent", "meeting recording notice", "meeting privacy notice", "recording retention policy", "online meeting privacy", "meeting transcript consent"], longTail: ["what to say before recording a meeting", "how long to keep meeting recordings"],
    angle: "A spoken notice is only the start. A sound process lets people understand the purpose, make a choice where one is available, and find out what will happen to the recording afterwards.",
    workflow: ["Decide whether a recording is necessary for the meeting’s stated purpose before invitations go out.", "Tell attendees in advance and again at the beginning what is being recorded, why, who will see it and how long it will be retained.", "Offer the practical alternative your policy permits: minutes, a non-recorded session, or an opportunity to raise concerns.", "Record the decision, apply the retention rule, and do not repurpose the transcript without a fresh assessment."],
    decisions: ["Use the narrowest practical capture method and retention period.", "Make the notice understandable to external guests as well as employees.", "Escalate sector-specific, employment, cross-border and legal questions to the relevant adviser."], pitfalls: ["Treating a calendar invite as a permanent all-purpose consent record.", "Publishing a recording because access was technically easy.", "Copying a generic policy without matching it to the actual tool and data flow."], sourceKeys: ["ico", "nist"], internal: [INTERNAL.security, INTERNAL.private, INTERNAL.templates, INTERNAL.noBot], schema: ["HowTo", "FAQPage"],
  },
  {
    slug: "meeting-transcript-quality-checklist", title: "Meeting Transcript Quality Checklist", description: "Improve meeting transcript quality with a repeatable pre-call, live-call and post-call review checklist for names and decisions.", keyword: "meeting transcript quality checklist", category: "Academy", date: "2026-09-23",
    supporting: ["transcript accuracy", "speech to text quality", "meeting transcription review", "transcript QA", "speaker labels", "audio transcription checklist"], longTail: ["how to check a meeting transcript for errors", "meeting transcription quality assurance"],
    angle: "Most transcript failures are not mysterious model failures. They are predictable: bad input, missing context, unclear speakers, and a summary sent before anyone checks names, numbers or commitments.",
    workflow: ["Ask people to say their name when it matters, and keep important numbers or codes visible in the meeting materials.", "Check the recording level during the opening minutes rather than waiting for the final export.", "Review proper nouns, dates, amounts, negations and named owners against the original audio or notes.", "Mark uncertainty instead of silently correcting it; the reviewer should be able to explain what was changed and why."],
    decisions: ["Use verbatim transcripts as evidence and summaries as navigational aids, not interchangeable records.", "Assign review ownership for consequential meetings.", "Measure actual corrections from sampled work before changing the workflow or model."], pitfalls: ["Reporting an accuracy percentage without a defined sample or review method.", "Letting a fluent summary conceal an incorrect name or deadline.", "Assuming speaker labels are identities without human confirmation."], sourceKeys: ["whisper", "audio", "nist"], internal: [INTERNAL.whisper, INTERNAL.templates, INTERNAL.private, INTERNAL.security], schema: ["HowTo", "FAQPage"],
  },
  {
    slug: "private-board-meeting-notes", title: "Private Board Meeting Notes: A Safer Workflow", description: "Create private board meeting notes with clear recording boundaries, review ownership and a minimal distribution workflow.", keyword: "private board meeting notes", category: "Academy", date: "2026-09-22",
    supporting: ["board meeting minutes", "confidential meeting notes", "board transcript security", "board meeting recording", "meeting note retention", "private minutes"], longTail: ["how to take private board meeting notes", "should board meetings be transcribed"],
    angle: "Board notes are not improved by collecting everything forever. They are improved by a clear decision about what must be recorded, who reviews it, and how the approved record is separated from working material.",
    workflow: ["Agree the note-taking and recording approach with the chair before the agenda is circulated.", "Keep a decision log during the meeting, with owners and dates, even if a transcript is also produced.", "Send the draft only to the agreed review group and resolve factual corrections against the source record.", "Publish the approved minutes through the board’s normal channel and dispose of temporary working material under the policy."],
    decisions: ["Separate draft transcript access from the authoritative minutes.", "Document any decision to record, including the intended audience and retention period.", "Use professional legal and governance advice for jurisdiction-specific duties."], pitfalls: ["Giving every attendee a permanent raw recording by default.", "Writing minutes from memory after deleting the only evidence.", "Calling an AI summary the approved board record without human review."], sourceKeys: ["ico", "nist"], internal: [INTERNAL.security, INTERNAL.templates, INTERNAL.private, INTERNAL.noBot], schema: ["FAQPage"],
  },
  {
    slug: "customer-interview-transcription-workflow", title: "Customer Interview Transcription Workflow", description: "Turn customer interviews into a reliable research record with consent, tagging and evidence-led synthesis steps.", keyword: "customer interview transcription", category: "Academy", date: "2026-09-21",
    supporting: ["user interview transcription", "customer research notes", "interview transcript analysis", "research interview recording", "qualitative research workflow", "customer discovery notes"], longTail: ["how to transcribe customer interviews privately", "how to analyse customer interview transcripts"],
    angle: "A customer interview is evidence, not a quote mine. The workflow needs a trace from a finding back to a real recording or note, with enough context to keep a vivid line from becoming a false generalisation.",
    workflow: ["State the purpose and recording approach before the interview, especially when a participant is outside your organisation.", "Use a discussion guide, but keep the live notes focused on follow-up questions, emotion and context rather than transcribing by hand.", "Review names, product terms and moments of ambiguity while the conversation is still fresh.", "Tag observations by theme and link each synthesis claim back to a timestamped source before sharing it."],
    decisions: ["Keep participant-identifying details separate from broadly shared research findings where possible.", "Use more than one interview before presenting a pattern as a decision-ready insight.", "Retain raw material only as long as the research purpose requires."], pitfalls: ["Mistaking a strong anecdote for market evidence.", "Uploading confidential interview media to an unassessed service.", "Removing context when clipping a quote for a product decision."], sourceKeys: ["ico", "nist", "whisper"], internal: [INTERNAL.private, INTERNAL.templates, INTERNAL.security, INTERNAL.whisper], schema: ["HowTo", "FAQPage"],
  },
  {
    slug: "sales-call-notes-privacy-workflow", title: "Sales Call Notes: A Privacy-First Workflow", description: "Build a privacy-first sales-call notes workflow that preserves customer context without spraying raw transcripts across systems.", keyword: "sales call notes privacy", category: "Reviews", date: "2026-09-20",
    supporting: ["private sales call notes", "sales call transcription", "CRM meeting notes", "customer call privacy", "sales recording policy", "call note retention"], longTail: ["how to keep sales call notes private", "should sales calls be transcribed"],
    angle: "Sales teams need context for a useful follow-up, not an uncontrolled copy of every commercial conversation. The design question is what belongs in the CRM, what remains in the source record, and who can see either.",
    workflow: ["Confirm the recording notice and the permitted use before capture begins.", "Create a concise follow-up record containing agreed needs, next steps, owners and dates; avoid pasting every spoken detail into a broad system.", "Link to the controlled source record when a reviewer genuinely needs context, rather than duplicating it into several tools.", "Review access when a deal changes owner, a contact leaves, or the retention period ends."],
    decisions: ["Store only the information needed to progress the opportunity.", "Make account-level access and export behaviour visible to sales leadership.", "Treat automated summaries as drafts that a deal owner checks before sending."], pitfalls: ["Using a private transcript as a reason to skip a customer-facing recording notice.", "Syncing the same raw note to every connected tool.", "Using sensitive personal detail as a sales tactic because it appeared in a transcript."], sourceKeys: ["ico", "nist"], internal: [INTERNAL.security, INTERNAL.private, INTERNAL.agents, INTERNAL.assistant], schema: ["Review", "FAQPage"],
  },
  {
    slug: "product-team-decision-log-from-meetings", title: "Build a Product Decision Log From Meetings", description: "Turn product meeting notes into a usable decision log with owners, evidence links and review dates that do not rot.", keyword: "product decision log from meetings", category: "Academy", date: "2026-09-19",
    supporting: ["product decision log", "meeting decisions", "product meeting notes", "decision record", "product discovery notes", "decision ownership"], longTail: ["how to create a decision log from meeting notes", "product decision record template"],
    angle: "The transcript is not the decision log. A decision log is the smaller, maintained record that says what was chosen, why, who owns the outcome and when it should be revisited.",
    workflow: ["Write the decision in plain language before the meeting ends, including whether it is a decision, an experiment or an open question.", "Link the decision to the supporting discussion, research or transcript so a future reader can inspect the rationale.", "Name an owner and review date; without both, a decision quietly turns into folklore.", "Review old entries during planning and mark them superseded rather than rewriting history."],
    decisions: ["Use a single home for decision records, not one copy per team channel.", "Separate reversible experiments from commitments with wider consequences.", "Record dissent or material uncertainty when it changes the interpretation of the outcome."], pitfalls: ["Treating every summary bullet as a decision.", "Losing the evidence trail when a ticket is closed.", "Leaving stale decisions visible without a review date."], sourceKeys: ["nist", "whisper"], internal: [INTERNAL.templates, INTERNAL.memory, INTERNAL.agents, INTERNAL.whisper], schema: ["HowTo", "FAQPage"],
  },
  {
    slug: "meeting-notes-for-ai-agents", title: "Prepare Meeting Notes for AI Agents", description: "Prepare meeting notes for AI agents with ownership, scope and evidence links, so assistants retrieve useful context safely.", keyword: "meeting notes for AI agents", category: "Academy", date: "2026-09-18",
    supporting: ["agent-ready meeting notes", "AI agent context", "meeting data for agents", "agent permissions", "MCP meeting notes", "meeting knowledge base"], longTail: ["how to prepare meeting notes for an AI agent", "what meeting context should agents access"],
    angle: "An agent can only be as trustworthy as the record it is allowed to retrieve. The useful unit is a scoped note with ownership and links to evidence, not an undifferentiated archive with no permission boundary.",
    workflow: ["Classify the meeting record by audience and sensitivity before making it available to any retrieval layer.", "Keep the summary, decisions, action items and source link together so a response can be checked.", "Pass the smallest useful scope to an agent and test that the agent cannot retrieve records outside the caller’s entitlement.", "Log corrections to agent-generated answers and improve the source record instead of hiding recurring ambiguity in prompts."],
    decisions: ["Define who grants access and how revocation works before connecting a new agent.", "Keep primary records distinct from generated summaries and answers.", "Test retrieval with real permission boundaries, not an administrator-only happy path."], pitfalls: ["Treating model context as a data warehouse with no ownership.", "Giving an agent broad access because filters are inconvenient.", "Making an agent answer sound certain when the linked record is tentative."], sourceKeys: ["mcp", "nist"], internal: [INTERNAL.agents, INTERNAL.memory, INTERNAL.security, INTERNAL.templates], schema: ["HowTo", "FAQPage"],
  },
  {
    slug: "mcp-meeting-records-explained", title: "MCP Meeting Records: A Practical Guide", description: "Understand MCP meeting records, permissions and tool boundaries before connecting a meeting archive to an AI assistant.", keyword: "MCP meeting records", category: "News", date: "2026-09-19",
    supporting: ["model context protocol meetings", "MCP meeting notes", "meeting record tools", "AI assistant meeting context", "MCP permissions", "agent data access"], longTail: ["how MCP works with meeting records", "connect meeting notes to an MCP client"],
    angle: "MCP is a way for an AI client to discover and call tools. It does not remove the need to decide what a tool can return, which identity is calling it, or whether the caller should see a particular meeting.",
    workflow: ["Start with one useful question, such as finding a decision from meetings a caller is already entitled to read.", "Define the tool input and output so it returns a cited, bounded answer rather than an entire archive.", "Authenticate the caller and apply the same workspace and record permissions as the primary product.", "Exercise error paths: no access, no result, partial result and an unavailable source should be explicit."],
    decisions: ["Use narrow tools that are easy to audit and revoke.", "Return source identifiers or links so a human can verify an agent answer.", "Keep the tool contract versioned as records and permissions evolve."], pitfalls: ["Calling an open protocol a blanket permission model.", "Returning raw transcripts when a relevant decision excerpt would do.", "Testing only with privileged accounts."], sourceKeys: ["mcp", "nist"], internal: [INTERNAL.agents, INTERNAL.memory, INTERNAL.security, INTERNAL.templates], schema: ["FAQPage"],
  },
  {
    slug: "meeting-transcripts-as-company-context", title: "Use Meeting Transcripts as Company Context", description: "Make meeting transcripts useful company context with a source trail, retention rules and access controls—not a sprawling archive.", keyword: "meeting transcripts company context", category: "Academy", date: "2026-09-20",
    supporting: ["company memory meetings", "meeting knowledge base", "meeting transcript search", "organisational context", "AI context layer", "meeting record management"], longTail: ["how to use meeting transcripts as company context", "build a company memory from meeting notes"],
    angle: "Meeting records are unusually rich context: the alternatives were discussed, trade-offs were aired and owners were named. That value disappears if the record cannot be found, trusted or accessed by the right person.",
    workflow: ["Agree a stable title, date, participants and meeting purpose while the record is created.", "Extract a small set of decisions and action items, each linked to its supporting discussion.", "Index only records that have an explicit owner, audience and retention treatment.", "Review retrieval results with people who know the work; a plausible answer is not proof of a complete answer."],
    decisions: ["Do not optimise for the largest archive; optimise for records people can inspect and trust.", "Attach provenance to every high-consequence answer.", "Make deletion and access changes flow through all derived views."], pitfalls: ["Turning a transcript repository into an implicit personnel file.", "Searching across teams without checking audience boundaries.", "Confusing a meeting summary with the source of truth when the details matter."], sourceKeys: ["nist", "mcp"], internal: [INTERNAL.memory, INTERNAL.agents, INTERNAL.security, INTERNAL.templates], schema: ["FAQPage"],
  },
  {
    slug: "ai-agent-meeting-search-permissions", title: "AI Agent Meeting Search Permissions", description: "Design AI agent meeting-search permissions with clear scopes, source links and revocation tests before giving assistants access.", keyword: "AI agent meeting search permissions", category: "Academy", date: "2026-09-21",
    supporting: ["agent permissions", "meeting search access", "AI data permissions", "meeting record access control", "agent retrieval security", "AI assistant governance"], longTail: ["how to control AI agent access to meeting notes", "meeting search permission model for agents"],
    angle: "Search feels harmless until it turns an old, private discussion into a confident answer for someone who should never have seen it. Permission design must be part of retrieval, not a check applied after the answer is written.",
    workflow: ["List the identities that can call the agent and the groups of records each identity may search.", "Apply permissions before ranking or summarising results, so inaccessible records cannot influence an answer.", "Return an explicit no-access or no-result state rather than silently broadening the query.", "Test revocation with a real user scenario and record the expected behaviour in the tool contract."],
    decisions: ["Use the primary system’s permissions as the source of truth.", "Keep tool scopes narrow enough to explain in a security review.", "Audit access failures and unexpected result patterns without retaining more sensitive content than needed."], pitfalls: ["Filtering results after an LLM already saw the content.", "Letting a service account stand in for the human who asked.", "Treating an empty result as evidence that no meeting exists."], sourceKeys: ["nist", "mcp"], internal: [INTERNAL.agents, INTERNAL.security, INTERNAL.memory, INTERNAL.private], schema: ["HowTo", "FAQPage"],
  },
  {
    slug: "speaker-label-review-for-meetings", title: "Review Speaker Labels in Meeting Notes", description: "Review speaker labels in meeting notes with evidence-led checks that avoid turning uncertain diarisation into false attribution.", keyword: "speaker label review", category: "Academy", date: "2026-09-22",
    supporting: ["speaker diarisation review", "speaker identification", "meeting speaker labels", "transcript attribution", "diarisation accuracy", "speaker verification"], longTail: ["how to verify speaker labels in a transcript", "meeting diarisation quality checks"],
    angle: "A label such as Speaker 1 can be useful. A person’s name is a stronger claim. The last step needs evidence, because a polished transcript with one false attribution can be worse than an honest unknown.",
    workflow: ["Keep provisional speaker labels until a reviewer has evidence for a name.", "Check representative turns from each labelled speaker, especially around interruptions and hand-overs.", "Confirm names against the meeting’s own introductions or an approved participant list; do not infer identity from writing style.", "Correct the source record and note the confidence boundary when a label remains uncertain."],
    decisions: ["Prefer an explicit unknown label to a plausible but unproven name.", "Treat voice information as sensitive and limit who can enrol or match it.", "Review speaker corrections where they affect decisions, quotations or performance records."], pitfalls: ["Assuming a diarisation cluster is an identity.", "Using a name mentioned in the meeting as proof that the person spoke.", "Hiding the uncertainty of an automated label from a reader."], sourceKeys: ["whisper", "nist", "audio"], internal: [INTERNAL.private, INTERNAL.whisper, INTERNAL.security, INTERNAL.templates], schema: ["HowTo", "FAQPage"],
  },
  {
    slug: "webgpu-local-transcription-readiness", title: "WebGPU Local Transcription Readiness", description: "Assess WebGPU local-transcription readiness with a clear browser fallback, device test and expectation-setting checklist.", keyword: "WebGPU local transcription", category: "News", date: "2026-09-23",
    supporting: ["browser transcription performance", "WebGPU speech to text", "local Whisper browser", "WebAssembly transcription", "on-device speech recognition", "browser GPU support"], longTail: ["does my browser support local transcription", "how WebGPU improves browser speech to text"],
    angle: "WebGPU can make local computation faster, but availability and performance vary. A dependable product checks capability, offers a fallback and tells people what it is doing instead of promising one speed to every device.",
    workflow: ["Use a secure context and detect the capabilities that the browser exposes on the device in front of you.", "Offer a lightweight first-run check before a long meeting, including model download and an audio test.", "Use a compatible fallback where one exists, and state when a device cannot meet the workload.", "Measure performance from actual sessions with consent rather than inventing a universal minutes-per-minute claim."],
    decisions: ["Present acceleration as a capability, not a guarantee.", "Keep model size, battery impact and warm-up time visible in product guidance.", "Test browsers and hardware that your customers genuinely use."], pitfalls: ["Claiming WebGPU works everywhere.", "Conflating a model download with audio being uploaded.", "Hiding an unsupported-device failure behind a stuck progress indicator."], sourceKeys: ["webgpu", "audio", "whisper"], internal: [INTERNAL.whisper, INTERNAL.private, INTERNAL.assistant, INTERNAL.security], schema: ["FAQPage"],
  },
  {
    slug: "consultant-meeting-notes-workflow", title: "A Consultant’s Meeting Notes Workflow", description: "A practical consultant meeting-notes workflow for clear client follow-ups, accountable actions and controlled source records.", keyword: "consultant meeting notes workflow", category: "Reviews", date: "2026-09-24",
    supporting: ["consulting meeting notes", "client meeting follow-up", "consultant call notes", "meeting action tracker", "client meeting summary", "private meeting transcription"], longTail: ["how consultants should take meeting notes", "consultant client meeting follow-up template"],
    angle: "Consultants often have to be present in the conversation and precise in the follow-up. The trick is to separate a private working record from the short, agreed client note that keeps the engagement moving.",
    workflow: ["Agree the meeting’s objective and whether a record will be created before the client conversation starts.", "Capture the minimum working context needed to produce accurate notes, then draft a concise follow-up around decisions, actions and dates.", "Check commitments and names against the source before sending; do not let an elegant summary invent certainty.", "File the approved follow-up with the engagement record and restrict raw material to the people who need it."],
    decisions: ["Make the client-facing version short enough to read and specific enough to act on.", "Do not turn personal observations into a shared client record.", "Set a review point for open actions rather than relying on inbox memory."], pitfalls: ["Sending a raw transcript as a substitute for a follow-up.", "Mixing internal commercial analysis with client-agreed actions.", "Leaving action owners or dates implied rather than stated."], sourceKeys: ["ico", "whisper"], internal: [INTERNAL.templates, INTERNAL.private, INTERNAL.security, INTERNAL.assistant], schema: ["Review", "FAQPage"],
  },
  {
    slug: "meeting-note-retention-policy", title: "Set a Meeting Notes Retention Policy", description: "Set a meeting-notes retention policy that matches purpose, access and review needs without keeping sensitive recordings forever.", keyword: "meeting notes retention policy", category: "Academy", date: "2026-09-25",
    supporting: ["meeting recording retention", "transcript retention policy", "meeting note governance", "recording deletion policy", "meeting data lifecycle", "meeting notes access"], longTail: ["how long should meeting transcripts be kept", "meeting recording retention policy template"],
    angle: "Retention is not a storage setting added at the end. It is part of the promise made when a meeting is recorded: what will be kept, for what purpose, who can use it, and when it will go away.",
    workflow: ["Inventory the records your workflow creates: audio, transcript, summary, minutes, exports and connected-system copies.", "Define a purpose and retention period for each class, with a named policy owner and review cadence.", "Configure deletion or review processes that cover derived copies as well as the original record.", "Test the process on a completed meeting and document any lawful hold or exception path separately."],
    decisions: ["Keep approved minutes where governance requires them, but do not assume the raw audio needs the same lifetime.", "Make retention visible to the people creating records.", "Review third-party integrations because they may retain copies under their own rules."], pitfalls: ["Using ‘forever’ as a default because storage is cheap.", "Deleting a source record while an uncontrolled export remains elsewhere.", "Promising automatic deletion without testing it end to end."], sourceKeys: ["ico", "nist"], internal: [INTERNAL.security, INTERNAL.private, INTERNAL.memory, INTERNAL.agents], schema: ["HowTo", "FAQPage"],
  },
];

const sentence = (spec: CampaignSpec, flavour: number) => {
  const variants = [
    `For ${spec.keyword}, the most reliable approach is a small, visible routine rather than a heroic clean-up job at the end. That routine should leave a reader able to see what happened, what was decided, and what remains uncertain.`,
    `The point of ${spec.keyword} is not to create more text. It is to make the next decision easier to audit without forcing everyone to replay an hour of conversation.`,
    `A polished interface helps, but the operational detail matters more: where the record lives, which person reviews it, and what a colleague sees when access is not permitted.`,
  ];
  return variants[flavour % variants.length];
};

function faqs(spec: CampaignSpec) {
  return [
    { question: `What is the first step for ${spec.keyword}?`, answer: `Start by defining the meeting purpose, audience and record you genuinely need. Then test the workflow before a consequential call, including its permission and review path.` },
    { question: `Can an automated summary be the final record?`, answer: "Use it as a draft. A person who understands the meeting should check names, numbers, decisions and omissions before it becomes a shared or official record." },
    { question: "Does local processing remove every privacy obligation?", answer: "No. It can reduce a data flow, but notice, purpose, access, sharing and retention obligations still depend on the context and applicable policy or law." },
    { question: "What should a good failure state look like?", answer: "Clear and actionable: say whether capture, access, transcription or retrieval failed; preserve no false success state; and give the person a safe next step." },
  ];
}

function body(spec: CampaignSpec): Block[] {
  const qaRows = spec.pitfalls.map((pitfall, index) => [pitfall, ["Check the input, permission and scope before proceeding.", "Record the decision and retain only what the purpose needs.", "Review against the source before sharing."][index]]);
  return [
    { type: "p", text: `${spec.angle} ${sentence(spec, 0)} This guide gives a practical route from preparation to a reviewable outcome, without pretending that a recording tool can make a legal, governance or human judgement for you.` },
    { type: "callout", title: "TL;DR", text: `Use ${spec.keyword} to create a bounded record: state the purpose, capture only what is needed, verify consequential details, control access and apply a real retention decision.` },
    { type: "h2", text: `Why ${spec.keyword} matters now` },
    { type: "p", text: `${sentence(spec, 1)} Meeting data tends to spread because it is easy to copy: a transcript becomes a summary, a summary lands in a project tool, and an assistant may later be asked about both. A good workflow begins by deciding which of those copies are useful and which introduce avoidable risk.` },
    { type: "p", text: `There is a human benefit too. When people can see the purpose and boundary of a record, they can correct a misunderstanding early. That makes the result more useful than a silent capture followed by a surprisingly confident summary.` },
    { type: "quote", text: "The ICO says people should be told why an online meeting is being recorded, what it will be used for and how long it will be kept.", attribution: "Information Commissioner’s Office guidance", href: SOURCES.ico.href },
    { type: "h2", text: "Choose the right record" },
    { type: "p", text: `Start with the outcome, not the tool. A project handover may need decisions and action owners. A research interview may need a timestamped source for a finding. A routine catch-up may need no recording at all. Selecting the narrowest useful record makes access, review and deletion much easier to explain.` },
    { type: "p", text: `Then separate source material from the shared result. The source may be an audio file or detailed transcript; the shared result may be approved minutes or a short follow-up. These are different artefacts with different audiences, and treating them as identical is a common source of accidental oversharing.` },
    { type: "table", caption: "A practical decision table: choose the smallest record that still supports the work.", headers: ["Need", "Useful record", "Review before sharing"], rows: [["A confirmed decision", "Decision log with source link", "Owner, wording and review date"], ["A client follow-up", "Concise action summary", "Commitments, names and deadlines"], ["Research evidence", "Timestamped transcript extract", "Context, consent and interpretation"]] },
    { type: "h2", text: "A four-step working routine" },
    { type: "ol", items: spec.workflow },
    { type: "p", text: `Do the first run on an ordinary meeting, not the most sensitive one of the quarter. You are checking reality: whether the selected browser or device has the required capability, whether the person using it understands the controls, and whether the resulting record is clear enough for another colleague to act on.` },
    { type: "h2", text: "Decisions worth making explicit" },
    { type: "ul", items: spec.decisions },
    { type: "p", text: `${sentence(spec, 2)} Put these choices somewhere people can find them later: the meeting template, the product’s own help text, or a short policy owned by someone who can change it. A private convention in one person’s head is brittle, especially when a tool is connected to another system.` },
    { type: "h2", text: "Quality checks before the record travels" },
    { type: "p", text: `Review the parts that change a decision: names, figures, dates, negations, owners and direct quotations. The more fluent a generated summary sounds, the easier it is to miss a quiet but material error. Keep a path from a high-stakes claim back to the original discussion or a clearly labelled unknown.` },
    { type: "p", text: `If your process uses local transcription, describe that precisely. It may mean audio is processed on the device, while a model download, a note export or an optional AI summary has a different data path. Precision earns more trust than a blanket privacy slogan.` },
    { type: "h2", text: "Common pitfalls and the practical fix" },
    { type: "table", caption: "Use this as a pre-flight check, not as a substitute for your organisation’s policy or specialist advice.", headers: ["Pitfall", "Practical fix"], rows: qaRows },
    { type: "p", text: `The right answer may be to stop. If the purpose is unclear, a participant raises a concern, the browser did not return an audio track, or the access model cannot be explained, do not manufacture a successful-looking record. Note the failure state and use an agreed alternative such as manual minutes.` },
    { type: "h2", text: "Where Ledgeur fits" },
    { type: "p", text: `Ledgeur is designed around an on-device first record: transcription and speaker separation run locally, and the product is open source. It does not make decisions about consent, retention or appropriate sharing for you. Those remain team and context decisions, which is why the workflow above starts with the record you need rather than a feature list.` },
    { type: "p", text: `For an awareness-stage reader, the useful next move is a low-risk trial on a non-sensitive meeting. For a team assessing the product, use the same trial to inspect capture controls, the record produced, access settings and the way a missing capability is reported.` },
    { type: "h2", text: "Sources and next steps" },
    { type: "p", text: `Read the authoritative references below before adapting this workflow. They explain the underlying browser, speech-recognition, recording or agent-access constraints; your organisation’s policy should add the context that a general guide cannot know.` },
    { type: "links", label: "Continue reading on Ledgeur", links: spec.internal },
  ];
}

export const SEPTEMBER_2026_CAMPAIGN: Post[] = SPECS.map((spec) => ({
  slug: spec.slug,
  title: spec.title,
  description: spec.description,
  keyword: spec.keyword,
  date: spec.date,
  readMins: 8,
  category: spec.category,
  supportingKeywords: spec.supporting,
  longTailKeywords: spec.longTail,
  faqs: faqs(spec),
  sources: [...new Map([...spec.sourceKeys.map((key) => SOURCES[key]), SOURCES.ico].map((source) => [source.href, source])).values()],
  internalLinks: spec.internal,
  schemaTypes: spec.schema,
  campaign: "september-2026-seo-geo",
  featuredImageAlt: `${spec.keyword}: a Ledgeur on-device meeting-record workflow`,
  expertReviewNote: "Editorially reviewed against the cited first-party sources; confirm organisation-specific legal and policy requirements before adopting the workflow.",
  body: body(spec),
}));

export { PIPEDREAM_IMAGE_STATUS };
