# @ledgeur/sdk

Typed client for the [Ledgeur Meetings API](../../docs/API.md) and its webhooks. No dependencies. Works in Node 20+ and edge runtimes (it uses `fetch` and Web Crypto).

```ts
import { Ledgeur } from "@ledgeur/sdk";

const ledgeur = new Ledgeur({ apiKey: process.env.LEDGEUR_API_KEY! });

// Catch up, then keep up
for await (const m of ledgeur.iterateMeetings({ updatedSince: lastSeen })) {
  if (m.deleted_at) remove(m.id);
  else if (m.status === "complete") save(await ledgeur.getMeeting(m.id));
}

const transcript = await ledgeur.getTranscript(id);   // { segments, text }
const people = await ledgeur.getMeetingParticipants(id);
const meta = await ledgeur.getMeetingMetadata(id);

const { secret } = await ledgeur.subscribeToMeetingComplete("https://example.com/ledgeur");
```

Verify deliveries with `verifyWebhook(rawBody, headers, secret)`, which returns the typed event or throws `LedgeurWebhookError`. API errors throw `LedgeurError` with `status`, `code` and `message`.

Options: `new Ledgeur({ apiKey, baseUrl = "https://www.ledgeur.com", fetch })`.
