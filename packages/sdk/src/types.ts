// Wire types of the Ledgeur Meetings API. snake_case, exactly as sent.
// Kept in step with packages/core/src/api/contract.ts by a typecheck in test/.

export type MeetingStatus = "scheduled" | "recording" | "processing" | "complete" | "failed";
export type WebhookEventType = "meeting.completed" | "meeting.updated" | "meeting.deleted";

export interface MeetingSummary {
  id: string;
  title: string;
  status: MeetingStatus;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
  lang: string;
  updated_at: string;
  /** Set when the meeting was deleted. Only listed when `updated_since` is given. */
  deleted_at: string | null;
  /** Where a person can open the meeting. */
  url: string;
}

export interface Participant {
  id: string;
  /** "Speaker 1" until somebody is identified. */
  label: string;
  name: string | null;
  identity_confidence: number | null;
}

export interface ActionItem {
  id: string;
  text: string;
  owner: string | null;
  done: boolean;
  /** YYYY-MM-DD */
  due: string | null;
}

export interface MeetingNotes {
  summary: string[];
  decisions: string[];
  questions: string[];
  markdown: string | null;
}

export interface Meeting extends MeetingSummary {
  notes: MeetingNotes | null;
  action_items: ActionItem[];
  participants: Participant[];
}

export interface TranscriptSegment {
  id: string;
  speaker_id: string | null;
  /** The identified name when there is one, otherwise the label. */
  speaker: string;
  start_ms: number;
  end_ms: number;
  text: string;
  confidence: number | null;
}

export interface Transcript {
  meeting_id: string;
  segments: TranscriptSegment[];
  /** "Speaker: text" lines. */
  text: string;
}

export interface MeetingMetadata {
  id: string;
  title: string;
  status: MeetingStatus;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
  lang: string;
  word_count: number | null;
  speaker_count: number;
  calendar_event: { title: string; starts_at: string; ends_at: string } | null;
  updated_at: string;
}

export interface MeetingList {
  data: MeetingSummary[];
  next_cursor: string | null;
}

export interface CreateMeetingInput {
  title: string;
  started_at?: string;
  ended_at?: string;
  lang?: string;
  segments: { speaker: string; start_ms: number; end_ms: number; text: string }[];
  notes_markdown?: string;
}

export interface ListMeetingsOptions {
  /** ISO 8601 string or Date. Also returns meetings deleted since then. */
  updatedSince?: string | Date;
  /** 1 to 100. Default 50. */
  limit?: number;
  cursor?: string;
}

export interface Webhook {
  id: string;
  url: string;
  events: WebhookEventType[];
  created_at: string;
  last_delivery_at: string | null;
  last_status: "delivered" | "retrying" | "failed" | null;
  last_status_code: number | null;
}

export interface WebhookCreated {
  id: string;
  url: string;
  events: WebhookEventType[];
  created_at: string;
  /** Shown once. Store it; it verifies every delivery. */
  secret: string;
}

export interface CreateWebhookInput {
  /** https only, except http://localhost for development. */
  url: string;
  events: WebhookEventType[];
}

export interface LedgeurEvent {
  /** Event id; also the X-Ledgeur-Delivery header. Use it to deduplicate. */
  id: string;
  type: WebhookEventType;
  created_at: string;
  data: { meeting_id: string; meeting: MeetingSummary };
}
