// What Ledgeur does not have, defined once.
//
// ── Why this file exists ────────────────────────────────────────────────────
// /security and /pricing both published a list of missing capabilities, written
// independently, and they contradicted each other. /security said "No SSO, SAML
// or SCIM. Sign-in is email and password." /pricing said the app supports SAML
// but the hosted backend has not switched it on. A security-literate buyer
// reads both pages in one sitting, and one of them was wrong: SAML sign-in is
// real code (apps/desktop/src/lib/session.ts, packages/core/src/auth/messages.ts
// reading the project's `saml_enabled` flag), and the button appears when a
// workspace has it configured.
//
// So the list lives here, once, and both pages render it. Adding a page that
// discusses what is missing means importing from here, not writing a fourth
// version of the same paragraph.
//
// ── The rule for this file ──────────────────────────────────────────────────
// A gap is stated in terms of what a buyer would actually try to do, and it
// says what exists as well as what does not. "No SSO" is a claim that turned
// out to be false. "SAML works in the app; it is not switched on for our hosted
// backend, so in practice you cannot use it with us yet" is the truth, and it
// is more useful.
//
// The mirror image of this file is lib/plans.ts, which carries the rule that
// nothing is listed as included unless it ships. Together they are the whole
// honesty policy: that file may not overstate, this one may not omit.

/** Which part of a buyer's evaluation a gap belongs to. */
export type GapArea = "security" | "admin" | "product" | "platform";

export interface Gap {
  /** The capability, named the way somebody searching for it would name it. */
  title: string;
  /** What is true. Includes whatever partial thing does exist. */
  body: string;
  area: GapArea;
  /** Where in the repository the reader could check, when there is something
   *  to check. Rendered as a hint on the dedicated page only. */
  evidence?: string;
}

export const GAPS: readonly Gap[] = [
  {
    title: "SOC 2 and ISO 27001",
    area: "security",
    body:
      "We have not been audited against either. If your procurement process requires a report, we cannot pass it today. What we can offer instead is the source code and a design in which the meeting audio never reaches us at all.",
  },
  {
    title: "Single sign-on on our hosted backend",
    area: "security",
    body:
      "The app itself signs in with SAML, and the single sign-on button appears whenever a workspace has it configured, so an organisation running its own backend can use it now. It is not switched on for Ledgeur's own hosted backend, so in practice you cannot use it with us yet.",
    evidence: "apps/desktop/src/lib/session.ts",
  },
  {
    title: "SCIM provisioning",
    area: "admin",
    body:
      "Not built at all. Adding and removing people is done by hand. If your security review requires automated deprovisioning, we are not the right fit yet, and we would rather say so now than during onboarding.",
  },
  {
    title: "An admin console and an audit log",
    area: "admin",
    body:
      "Not built. Workspace administration today is one owner and a member list. Access tokens record when they were last used, and that is the extent of the audit trail.",
  },
  {
    title: "A signed BAA for HIPAA workloads",
    area: "security",
    body:
      "We do not sign business associate agreements. The on-device design means protected health information in a recording never reaches a server we run, which is a strong position, but it is not the same thing as a BAA and we will not let it be mistaken for one. If your compliance programme needs the paperwork, you need a vendor who signs it.",
  },
  {
    title: "A penetration test report",
    area: "security",
    body: "None has been commissioned. Nobody independent has tried to break this.",
  },
  {
    title: "A bug bounty programme",
    area: "security",
    body:
      "We will thank you properly and credit you for anything you report, but we cannot pay for it yet.",
  },
  {
    title: "A packaged self-host bundle",
    area: "platform",
    body:
      "There is no Docker image and no Helm chart. Self-hosting is genuinely possible, because the source is MIT and the whole schema is in the repository, but it is a manual job today. Enterprise means we help you do it rather than handing you a one-line install.",
    evidence: "supabase/migrations",
  },
  {
    title: "The mobile apps in the App Store and Google Play",
    area: "platform",
    body:
      "The iOS and Android apps are the same code as the desktop app and sync with it under the same meeting ids, and both build to a store-ready, signed binary. Neither has a store listing yet, so today they are installed from source.",
    evidence: "docs/MOBILE.md",
  },
  {
    title: "Real-time collaborative editing",
    area: "product",
    body:
      "Two people editing the same meeting notes at the same moment will overwrite each other. Sync resolves by last writer, which is right for one person on two devices and wrong for two people on one document.",
    evidence: "packages/core/src/data/merge.ts",
  },
  {
    title: "Pushing tasks to every tool",
    area: "product",
    body:
      "Action items go to Linear, Todoist, Asana, Notion, or any endpoint you point a signed webhook at. Jira, Monday and ClickUp are not built, and there is no two-way sync anywhere: a task closed in Linear does not close in Ledgeur.",
    evidence: "packages/core/src/tasks/push.ts",
  },
];

export const gapsIn = (area: GapArea): readonly Gap[] => GAPS.filter((g) => g.area === area);

/** The areas, in the order a buyer works through them. */
export const GAP_AREAS: readonly { id: GapArea; title: string; lede: string }[] = [
  {
    id: "security",
    title: "Security and compliance",
    lede: "The certifications and paperwork a procurement process asks for.",
  },
  {
    id: "admin",
    title: "Administration",
    lede: "What an IT team gets to manage, and what it does not.",
  },
  {
    id: "platform",
    title: "How you get it",
    lede: "Where the software runs and how it reaches your machines.",
  },
  {
    id: "product",
    title: "In the product itself",
    lede: "Things the app genuinely cannot do yet.",
  },
];
