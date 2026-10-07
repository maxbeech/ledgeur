// The wire contract of the public Meetings API (REST at /api/v1) and of the
// webhooks it sends. snake_case, JSON.
//
// This file is the server's copy of the contract. The SDK (packages/sdk) is
// zero-dependency so it carries its own copy of these types, and a test in the
// SDK package fails the typecheck if the two ever drift apart.

export const MEETING_STATUSES = ["scheduled", "recording", "processing", "complete", "failed"] as const;
export type ApiMeetingStatus = (typeof MEETING_STATUSES)[number];

export const WEBHOOK_EVENTS = ["meeting.completed", "meeting.updated", "meeting.deleted"] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];

export interface ApiMeetingSummary {
  id: string;
  title: string;
  status: ApiMeetingStatus;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
  lang: string;
  updated_at: string;
  deleted_at: string | null;
  url: string;
}

export interface ApiParticipant {
  id: string;
  label: string;
  name: string | null;
  identity_confidence: number | null;
}

export interface ApiActionItem {
  id: string;
  text: string;
  owner: string | null;
  done: boolean;
  due: string | null;
}

export interface ApiMeetingNotes {
  summary: string[];
  decisions: string[];
  questions: string[];
  markdown: string | null;
}

export interface ApiMeeting extends ApiMeetingSummary {
  notes: ApiMeetingNotes | null;
  action_items: ApiActionItem[];
  participants: ApiParticipant[];
}

export interface ApiTranscriptSegment {
  id: string;
  speaker_id: string | null;
  speaker: string;
  start_ms: number;
  end_ms: number;
  text: string;
  confidence: number | null;
}

export interface ApiTranscript {
  meeting_id: string;
  segments: ApiTranscriptSegment[];
  text: string;
}

export interface ApiMeetingMetadata {
  id: string;
  title: string;
  status: ApiMeetingStatus;
  started_at: string | null;
  ended_at: string | null;
  duration_ms: number | null;
  lang: string;
  word_count: number | null;
  speaker_count: number;
  calendar_event: { title: string; starts_at: string; ends_at: string } | null;
  updated_at: string;
}

export interface ApiMeetingList {
  data: ApiMeetingSummary[];
  next_cursor: string | null;
}

export interface ApiCreateMeetingInput {
  title: string;
  started_at?: string;
  ended_at?: string;
  lang?: string;
  segments: { speaker: string; start_ms: number; end_ms: number; text: string }[];
  notes_markdown?: string;
}

export type ApiWebhookStatus = "delivered" | "retrying" | "failed";

export interface ApiWebhook {
  id: string;
  url: string;
  events: WebhookEventType[];
  created_at: string;
  last_delivery_at: string | null;
  last_status: ApiWebhookStatus | null;
  last_status_code: number | null;
}

export interface ApiWebhookCreated {
  id: string;
  url: string;
  events: WebhookEventType[];
  created_at: string;
  secret: string;
}

export interface ApiEvent {
  id: string;
  type: WebhookEventType;
  created_at: string;
  data: { meeting_id: string; meeting: ApiMeetingSummary };
}

export type ApiErrorCode =
  | "unauthorized" | "plan_required" | "not_found" | "bad_request"
  | "rate_limited" | "not_configured" | "internal";

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string };
}
