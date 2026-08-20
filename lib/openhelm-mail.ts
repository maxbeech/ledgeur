/**
 * OpenHelm Mail — this product's transactional email.
 *
 * ⚠️ GENERATED. The canonical copy is
 * `ProductFactory/_services/openhelm-mail/openhelm-mail.ts`; edit it there and
 * re-run `node _services/openhelm-mail/install.mjs` rather than editing this
 * file in a product. One implementation across every product is the point: a
 * per-product hand-rolled mail client is how sending rules, error handling and
 * from-addresses drift apart.
 *
 * WHAT THIS REPLACES. Products used to talk to Resend directly, each with its
 * own key, its own from-address and its own idea of what "failed" meant.
 * OpenHelm Mail is the platform's own provider, so a product gets a real
 * inbox (it can RECEIVE, not just send), real conversation threading,
 * bounce/complaint suppression, and a sending domain whose reputation is
 * isolated from every other product's.
 *
 * WHERE THE FROM-ADDRESS COMES FROM. Not from here. The inbox is bound to the
 * product server-side and sends from that product's own verified domain
 * (`hello@mail.<product domain>`) when its DNS is verified, and from the shared
 * OpenHelm relay until then. The product does not get to assert a from-address
 * the provider has not verified, which is exactly why deliverability holds.
 * `from` below selects among the product's OWN named senders (noreply@,
 * support@, …) — it cannot invent one.
 *
 * NO SILENT SUCCESS. An unconfigured product returns
 * `{ sent: false, reason: "not_configured" }` and a failed send returns
 * `{ sent: false, reason: "error", error }`. Nothing here ever returns a made-up
 * message id, and nothing here retries into a duplicate send — pass `clientId`
 * for idempotency if the caller may retry.
 *
 * SERVER ONLY. `OPENHELM_API_KEY` is an org-scoped credential; shipping it to a
 * browser would hand any visitor the ability to send as this product. The guard
 * below is a runtime one rather than an `import "server-only"` because these
 * products do not all declare that package, and a build that fails to resolve
 * an import is a worse outcome than a clear throw.
 */

/** Default deployment. Override with OPENHELM_API_URL for a self-hosted worker. */
const DEFAULT_API_URL = "https://openhelm-worker.fly.dev/v1";

function assertServer(): void {
  if (typeof window !== "undefined") {
    throw new Error(
      "openhelm-mail must only be used on the server - it carries the product's API key. " +
        "Move this call into a route handler, server action or server component.",
    );
  }
}

export interface MailConfig {
  apiUrl: string;
  apiKey: string | null;
  inboxId: string | null;
  /** This product's id on the platform. Required only to use named senders. */
  productId: string | null;
  /** Optional display name on outbound mail; the platform's is used when unset. */
  fromName: string | null;
}

export function mailConfig(): MailConfig {
  assertServer();
  return {
    apiUrl: (process.env.OPENHELM_API_URL || DEFAULT_API_URL).replace(/\/+$/, ""),
    apiKey: process.env.OPENHELM_API_KEY?.trim() || null,
    inboxId: process.env.OPENHELM_MAIL_INBOX_ID?.trim() || null,
    productId: process.env.OPENHELM_PRODUCT_ID?.trim() || null,
    fromName: process.env.OPENHELM_MAIL_FROM_NAME?.trim() || null,
  };
}

/** True when this deployment can actually send. Check before promising a user mail. */
export function emailEnabled(): boolean {
  const c = mailConfig();
  return Boolean(c.apiKey && c.inboxId);
}

export interface SendEmailInput {
  /**
   * Recipient(s). Several recipients are delivered as ONE message — they see
   * each other in the To header, which is what a shared alert should do. Use
   * `bcc` when they must not.
   */
  to: string | string[];
  subject: string;
  /** Body as HTML. Supply this, `text`, or `markdown` — at least one. */
  html?: string;
  text?: string;
  /** Markdown body; the platform renders both an HTML and a text part from it. */
  markdown?: string;
  cc?: string[];
  /** Blind copies. Never rendered into a header the other recipients can see. */
  bcc?: string[];
  replyTo?: string;
  /**
   * Send from one of this product's NAMED senders, by local-part — "noreply",
   * "support", "billing". Requires OPENHELM_PRODUCT_ID. Omit to send from the
   * product's primary identity. An unknown name is an error, never a silent
   * fallback to the primary: mail arriving from the wrong address is worse than
   * mail that visibly failed to send.
   */
  from?: string;
  /**
   * Idempotency key. Re-sending with the same value returns the original
   * message instead of delivering twice — use it anywhere a retry is possible
   * (webhook handlers, queue consumers, form posts).
   */
  clientId?: string;
  /** Reply inside an existing conversation rather than starting a new one. */
  replyToThreadId?: string;
}

export interface ReplyToInfo {
  address: string | null;
  /** "sending_domain" | "relay_fallback" | "override" | "none". `relay_fallback`
   *  means this product's own domain cannot yet receive replies (no MX). */
  reason: string;
  detail: string;
}

export type SendResult =
  | {
      sent: true;
      /** Platform message id. */
      id: string;
      /**
       * "sent" | "scheduled" | "pending_approval". `pending_approval` means the
       * inbox is holding it for human release — it has NOT been delivered, so a
       * caller that wants to say "check your inbox" should require "sent".
       */
      status: string;
      threadId: string | null;
      /** Where replies will actually land, and why. Null if the platform did not say. */
      replyTo: ReplyToInfo | null;
      /** Recipients dropped because they are suppressed (hard bounce/complaint).
       *  The message WAS delivered to everyone else. */
      suppressed: string[];
    }
  | { sent: false; reason: "not_configured" | "error"; error?: string };

/** Named-sender inbox ids, resolved once per process. */
const senderCache = new Map<string, string>();

async function resolveSender(cfg: MailConfig, localPart: string): Promise<string> {
  const key = localPart.trim().toLowerCase();
  const cached = senderCache.get(key);
  if (cached) return cached;
  if (!cfg.productId) {
    throw new Error(`sending as "${key}" needs OPENHELM_PRODUCT_ID to be set`);
  }
  const res = await fetch(`${cfg.apiUrl}/inboxes/product/senders/list`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({ product_id: cfg.productId }),
  });
  if (!res.ok) throw new Error(`could not list senders (HTTP ${res.status})`);
  const payload = (await res.json()) as { senders?: Array<{ id: string; local_part: string }> };
  for (const s of payload.senders ?? []) senderCache.set(s.local_part.toLowerCase(), s.id);
  const found = senderCache.get(key);
  if (!found) {
    const known = (payload.senders ?? []).map((s) => s.local_part).join(", ") || "none";
    throw new Error(`this product has no sender "${key}" (has: ${known})`);
  }
  return found;
}

/**
 * Send one transactional email.
 *
 * ONE request, one message, however many recipients. An earlier version looped
 * and sent N separate messages because the platform accepted only a single
 * recipient; that made a five-person alert into five threads and five units of
 * the daily cap, and meant a partial failure had no coherent result to report.
 */
export async function sendEmail(input: SendEmailInput): Promise<SendResult> {
  const cfg = mailConfig();
  if (!cfg.apiKey || !cfg.inboxId) {
    console.warn(
      `[mail] OpenHelm Mail is not configured (OPENHELM_API_KEY / OPENHELM_MAIL_INBOX_ID) - ` +
        `skipped "${input.subject}"`,
    );
    return { sent: false, reason: "not_configured" };
  }

  const to = (Array.isArray(input.to) ? input.to : [input.to]).map((r) => r.trim()).filter(Boolean);
  if (to.length === 0) return { sent: false, reason: "error", error: "no recipient" };
  if (!input.html && !input.text && !input.markdown) {
    return { sent: false, reason: "error", error: "no body (html, text or markdown)" };
  }

  let inboxId = cfg.inboxId;
  if (input.from) {
    try {
      inboxId = await resolveSender(cfg, input.from);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error(`[mail] ${detail}`);
      return { sent: false, reason: "error", error: detail };
    }
  }

  const body: Record<string, unknown> = {
    to,
    subject: input.subject,
    body_html: input.html,
    body_markdown: input.markdown,
    text: input.text,
    cc: input.cc,
    bcc: input.bcc,
    reply_to: input.replyTo,
    client_id: input.clientId,
    reply_to_thread_id: input.replyToThreadId,
    from_name: cfg.fromName ?? undefined,
  };
  for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];

  try {
    const res = await fetch(`${cfg.apiUrl}/inboxes/${encodeURIComponent(inboxId)}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(body),
    });
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      // The platform's own message, not a paraphrase: "recipient is suppressed
      // after a hard bounce" and "daily cap reached" need different fixes.
      const detail =
        typeof payload.error === "string"
          ? payload.error
          : typeof payload.message === "string"
            ? payload.message
            : `HTTP ${res.status}`;
      console.error(`[mail] send failed: ${detail}`);
      return { sent: false, reason: "error", error: detail };
    }
    return {
      sent: true,
      id: String(payload.message_id ?? ""),
      status: String(payload.status ?? "sent"),
      threadId: (payload.thread_id as string | null) ?? null,
      replyTo: (payload.reply_to as ReplyToInfo | null) ?? null,
      suppressed: Array.isArray(payload.suppressed) ? (payload.suppressed as string[]) : [],
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error(`[mail] send failed: ${detail}`);
    return { sent: false, reason: "error", error: detail };
  }
}

/**
 * The address this product actually sends from, for showing in a UI ("replies
 * go to …") or a support page.
 *
 * Returns null when unconfigured or unreachable rather than guessing from the
 * product's domain — the guess would be wrong for exactly as long as DNS
 * verification is outstanding, which is when it matters most.
 */
export async function sendingAddress(): Promise<string | null> {
  const cfg = mailConfig();
  if (!cfg.apiKey || !cfg.inboxId) return null;
  try {
    const res = await fetch(`${cfg.apiUrl}/inboxes/${encodeURIComponent(cfg.inboxId)}`, {
      headers: { authorization: `Bearer ${cfg.apiKey}` },
      // The address changes only on domain verification; a short cache keeps
      // this off the hot path of every page render.
      next: { revalidate: 300 },
    } as RequestInit);
    if (!res.ok) return null;
    const payload = (await res.json()) as { address?: string };
    return payload.address ?? null;
  } catch {
    return null;
  }
}

/** Drop the cached sender lookup. Call after adding a sender in the same process. */
export function resetSenderCache(): void {
  senderCache.clear();
}
