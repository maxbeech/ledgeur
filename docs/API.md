# Ledgeur Meetings API

Read a person's meetings from another app, import a transcript you already have, and be told when a meeting finishes. You do not need to know how Ledgeur records or stores meetings.

- Base URL: `https://www.ledgeur.com/api/v1`
- Format: JSON, snake_case
- Available on paid plans. A key from a free workspace gets `402 plan_required`.
- TypeScript SDK: `@ledgeur/sdk` (see [packages/sdk](../packages/sdk/README.md))

## Authentication

Send an API key as a bearer token:

```
Authorization: Bearer ldg_...
```

Keys are the same ones the hosted MCP endpoint takes. Create one in Ledgeur under Account, Agent access. A key acts as the person who created it, so it can read what that person can read: their own meetings and meetings shared with their workspace. Nothing else.

## Errors

Every error has the same shape:

```json
{ "error": { "code": "not_found", "message": "That meeting was not found." } }
```

| Status | `code` | Meaning |
|---|---|---|
| 400 | `bad_request` | A parameter or body field is missing or invalid. The message says which. |
| 401 | `unauthorized` | No key, or the key is wrong or revoked. |
| 402 | `plan_required` | The key's owner is not on a paid plan. |
| 404 | `not_found` | No such meeting or webhook, or the key cannot see it. |
| 500 | `internal` | Our fault. Safe to retry. |
| 503 | `not_configured` | The deployment is missing server configuration. |

There is no rate limiting yet, so no 429. Please keep polling to once a minute or so; webhooks are better.

## Meetings

### `GET /meetings`

Query parameters:

- `updated_since`: ISO 8601 time. Only meetings changed after it.
- `limit`: 1 to 100, default 50.
- `cursor`: the `next_cursor` from the previous page.

Returns `{ "data": MeetingSummary[], "next_cursor": string | null }`, ordered by `updated_at` ascending.

Deleted meetings are left out, unless you pass `updated_since`. Then they are included with `deleted_at` set, so a poller learns about deletions. Keep the same query on every page; the cursor remembers which of the two modes you started in.

To sync, store the largest `updated_at` you have seen and pass it as `updated_since` next time. `updated_since` is exclusive.

```json
{
  "id": "…",
  "title": "Annual review",
  "status": "complete",
  "started_at": "2026-03-01T10:00:00.000Z",
  "ended_at": "2026-03-01T11:00:00.000Z",
  "duration_ms": 3600000,
  "lang": "en",
  "updated_at": "2026-03-01T11:05:00.500Z",
  "deleted_at": null,
  "url": "https://www.ledgeur.com/app/meetings/…"
}
```

`status` is one of `scheduled`, `recording`, `processing`, `complete`, `failed`. `started_at`, `ended_at` and `duration_ms` can be null.

### `GET /meetings/{id}`

A `Meeting`: everything in a summary, plus

```json
{
  "notes": { "summary": [], "decisions": [], "questions": [], "markdown": "…" },
  "action_items": [{ "id": "…", "text": "Send the letter", "owner": "Ann Adviser", "done": false, "due": "2026-03-08" }],
  "participants": [{ "id": "…", "label": "Speaker 1", "name": "Ann Adviser", "identity_confidence": 0.91 }]
}
```

`notes` is null until notes exist. `owner` and `due` are null when unset. Cancelled action items are left out. A deleted meeting is a 404 here; the list tells you it was deleted.

### `GET /meetings/{id}/transcript`

```json
{
  "meeting_id": "…",
  "segments": [{ "id": "…", "speaker_id": "…", "speaker": "Ann Adviser", "start_ms": 0, "end_ms": 4000, "text": "Welcome.", "confidence": 0.98 }],
  "text": "Ann Adviser: Welcome.\n…"
}
```

`speaker` is the identified name when there is one, otherwise the label ("Speaker 2"). `text` has one `Speaker: text` line per segment.

### `GET /meetings/{id}/participants`

`{ "data": [{ "id", "label", "name", "identity_confidence" }] }`. `name` is null until the person is identified.

### `GET /meetings/{id}/metadata`

```json
{
  "id": "…", "title": "…", "status": "complete", "started_at": "…", "ended_at": "…", "duration_ms": 3600000,
  "lang": "en", "word_count": 5400, "speaker_count": 2,
  "calendar_event": { "title": "Annual review", "starts_at": "…", "ends_at": "…" },
  "updated_at": "…"
}
```

`word_count` is null before notes exist. `calendar_event` is null when the meeting was not linked to one, or the event belongs to someone else.

### `POST /meetings`

Import a transcript you already have as a completed meeting owned by the key's user.

```json
{
  "title": "Review call",
  "started_at": "2026-03-01T10:00:00Z",
  "ended_at": "2026-03-01T11:00:00Z",
  "lang": "en",
  "segments": [{ "speaker": "Ann", "start_ms": 0, "end_ms": 4000, "text": "Welcome." }],
  "notes_markdown": "# Notes"
}
```

`title` and `segments` (at least one, at most 20,000) are required. One participant is created for each distinct `speaker` string. If you give `started_at` but not `ended_at`, the end is the start plus the last segment's `end_ms`. The body can be up to 10 MB. Returns `201` and the `Meeting`. Paid plans only.

The meeting is created in the key's workspace with that workspace's default sharing. It is not atomic over the wire: if the import fails part way, the partial meeting is removed and you get a 500.

## Webhooks

Ledgeur calls your server when a meeting finishes, changes or is deleted.

### `POST /webhooks`

```json
{ "url": "https://example.com/ledgeur", "events": ["meeting.completed", "meeting.updated", "meeting.deleted"] }
```

`url` must be https, except `http://localhost` for development. `events` is a non-empty subset of the three. Returns `201`:

```json
{ "id": "…", "url": "…", "events": ["meeting.completed"], "created_at": "…", "secret": "whsec_…" }
```

The `secret` is shown once. Store it. You can have 20 webhooks per key owner.

### `GET /webhooks`

`{ "data": [{ "id", "url", "events", "created_at", "last_delivery_at", "last_status", "last_status_code" }] }`. `last_status` is `delivered`, `retrying` or `failed` (or null before the first delivery). The secret is never shown again.

### `DELETE /webhooks/{id}`

`204` with no body.

### What you receive

Ledgeur sends `POST` with a JSON body:

```json
{
  "id": "evt id",
  "type": "meeting.completed",
  "created_at": "2026-03-01T11:07:00.000Z",
  "data": { "meeting_id": "…", "meeting": { "…": "MeetingSummary" } }
}
```

Headers: `Content-Type: application/json`, `X-Ledgeur-Event`, `X-Ledgeur-Delivery` (the event id, the same on every retry), `X-Ledgeur-Timestamp` and `X-Ledgeur-Signature`.

The payload is a summary. Fetch the meeting, transcript or notes with the API when you get it.

When events fire:

- `meeting.completed`: once per meeting, when its status is `complete` and nothing about the meeting, its transcript or its notes has changed for 2 minutes. A device sync rewrites the whole transcript, so the wait keeps you from hearing about it half way through.
- `meeting.updated`: later changes to the title, notes, transcript or participants, waited on the same way.
- `meeting.deleted`: the meeting was deleted (`deleted_at` is set in the payload).

You receive events for meetings the webhook owner can read: their own, and ones shared with their workspace.

A 2xx response counts as delivered. Anything else, a timeout (10 seconds) or a redirect is a failure and is retried after 1 minute, 5 minutes, 30 minutes, 2 hours and 12 hours, then dropped. Deliveries can arrive more than once; use the event id to ignore repeats. Order is not guaranteed.

Ledgeur resolves your hostname before each delivery and will not send to private, loopback, link-local or other internal addresses (or to a name that resolves to one). It connects to the address it checked, gives each delivery 10 seconds in total, never reads the response body and does not follow redirects. Write addresses in their usual form: spellings like 2130706433 or 017.0.0.1 are refused.

### Verifying a delivery

The signature is an HMAC-SHA256 of `${timestamp}.${rawBody}` with your `whsec_` secret, hex encoded, sent as `sha256=<hex>`. It is the same scheme as Ledgeur's own outbound notes webhook. Check the timestamp is recent (5 minutes) so a captured delivery cannot be replayed.

With the SDK:

```ts
import { verifyWebhook, LedgeurWebhookError } from "@ledgeur/sdk";

export async function POST(req: Request) {
  const raw = await req.text(); // the raw body, not parsed JSON
  try {
    const event = await verifyWebhook(raw, req.headers, process.env.LEDGEUR_WEBHOOK_SECRET!);
    if (event.type === "meeting.completed") {
      // fetch the meeting with ledgeur.getMeeting(event.data.meeting_id)
    }
    return new Response("ok");
  } catch (e) {
    if (e instanceof LedgeurWebhookError) return new Response("bad signature", { status: 400 });
    throw e;
  }
}
```

Without it, in Node:

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(raw, headers, secret) {
  const ts = headers["x-ledgeur-timestamp"];
  const sent = Date.parse(ts);
  if (!Number.isFinite(sent) || Math.abs(Date.now() - sent) > 5 * 60_000) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex");
  const got = headers["x-ledgeur-signature"] ?? "";
  return got.length === expected.length && timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}
```

## Versioning

This is v1. New fields can be added to responses; do not fail on fields you do not know. Breaking changes will go to a new path.
