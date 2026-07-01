// The ParleyNotes domain model — the single source of truth for entity shapes
// shared across the desktop/mobile app, the backend, and the MCP server. These
// mirror the Supabase schema in supabase/migrations. Keep field names in sync.

/** ISO-8601 timestamp string (e.g. "2026-07-01T14:03:00Z"). */
export type Timestamp = string;
export type UUID = string;

/** A business account. The "company brain" is scoped to an org. */
export interface Org {
  id: UUID;
  name: string;
  /** Admin-controlled default for whether new meetings are shared org-wide. */
  defaultMeetingVisibility: MeetingVisibility;
  /** Whether the org has an active paid plan (gates MCP + hive-mind data access). */
  plan: OrgPlan;
  createdAt: Timestamp;
}

export type OrgPlan = "free" | "team" | "company";

export type OrgRole = "admin" | "member";

export interface Membership {
  orgId: UUID;
  userId: UUID;
  role: OrgRole;
  createdAt: Timestamp;
}

export interface Profile {
  id: UUID;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  /** Default org shown on launch. */
  defaultOrgId: UUID | null;
  createdAt: Timestamp;
}

/** private = only owner; org = shared into the org hive-mind. */
export type MeetingVisibility = "private" | "org";

export type MeetingStatus = "scheduled" | "recording" | "processing" | "complete" | "failed";

export interface Meeting {
  id: UUID;
  orgId: UUID;
  ownerId: UUID;
  title: string;
  status: MeetingStatus;
  visibility: MeetingVisibility;
  /** Source calendar event id if auto-started from a calendar prompt. */
  calendarEventId: string | null;
  startedAt: Timestamp | null;
  endedAt: Timestamp | null;
  /** Denormalised language hint used for transcription ("en" | "multi"). */
  lang: string;
  createdAt: Timestamp;
}

/** A distinct voice in a meeting. Diarization assigns segments to speakers and
 *  may guess a real identity with a confidence score (the "likelihood" metadata). */
export interface Speaker {
  id: UUID;
  meetingId: UUID;
  /** Stable per-meeting label, e.g. "Speaker 1". */
  label: string;
  /** Best-guess linked profile (a known colleague), if identified. */
  identifiedProfileId: UUID | null;
  /** Best-guess display name when no profile match. */
  identifiedName: string | null;
  /** 0..1 likelihood that the identity guess is correct. */
  identityConfidence: number | null;
}

export interface TranscriptSegment {
  id: UUID;
  meetingId: UUID;
  speakerId: UUID | null;
  startMs: number;
  endMs: number;
  text: string;
  /** 0..1 ASR confidence for this segment. */
  confidence: number | null;
}

/** Structured, generated notes for a completed meeting. */
export interface MeetingNote {
  meetingId: UUID;
  summary: string[];
  decisions: string[];
  questions: string[];
  /** Full rendered Markdown (source of truth for exports to Notion etc.). */
  markdown: string;
  /** Which generator produced this: local heuristic or a named LLM. */
  generator: string;
  wordCount: number;
  updatedAt: Timestamp;
}

export type TaskStatus = "open" | "in_progress" | "done" | "cancelled";

/** An action item extracted from a meeting (or created manually). */
export interface ActionItem {
  id: UUID;
  orgId: UUID;
  meetingId: UUID | null;
  title: string;
  status: TaskStatus;
  assigneeId: UUID | null;
  dueDate: string | null;
  createdAt: Timestamp;
}

export type IntegrationProvider = "notion" | "google" | "microsoft" | "onenote" | "google_docs";

/** A connected third-party account. Secrets live server-side (never in domain). */
export interface Integration {
  id: UUID;
  orgId: UUID;
  userId: UUID;
  provider: IntegrationProvider;
  /** e.g. the connected Notion workspace / calendar id. */
  externalAccountId: string | null;
  /** Provider-specific non-secret config (e.g. target Notion database id). */
  config: Record<string, unknown>;
  connectedAt: Timestamp;
}

/** A calendar event surfaced for the meeting auto-prompt. */
export interface CalendarEvent {
  id: string;
  provider: Extract<IntegrationProvider, "google" | "microsoft">;
  title: string;
  startsAt: Timestamp;
  endsAt: Timestamp;
  isOnline: boolean;
  meetingUrl: string | null;
}
