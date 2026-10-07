import { LedgeurError } from "./errors.ts";
import type {
  CreateMeetingInput, CreateWebhookInput, ListMeetingsOptions, Meeting, MeetingList, MeetingMetadata,
  MeetingSummary, Participant, Transcript, Webhook, WebhookCreated,
} from "./types.ts";

export interface LedgeurOptions {
  /** An `ldg_` key from Ledgeur under Account, Agent access. */
  apiKey: string;
  /** Default https://www.ledgeur.com */
  baseUrl?: string;
  /** Defaults to the global fetch. */
  fetch?: typeof globalThis.fetch;
}

type Query = Record<string, string | number | undefined>;

export class Ledgeur {
  readonly webhooks: {
    create(input: CreateWebhookInput): Promise<WebhookCreated>;
    list(): Promise<Webhook[]>;
    delete(id: string): Promise<void>;
  };

  readonly #apiKey: string;
  readonly #base: string;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: LedgeurOptions) {
    if (!options?.apiKey) throw new Error("Ledgeur: apiKey is required.");
    this.#apiKey = options.apiKey;
    this.#base = (options.baseUrl ?? "https://www.ledgeur.com").replace(/\/+$/, "");
    const f = options.fetch ?? globalThis.fetch;
    if (!f) throw new Error("Ledgeur: no fetch available. Pass one in options.fetch.");
    this.#fetch = f.bind(globalThis);

    this.webhooks = {
      create: (input) => this.#request<WebhookCreated>("POST", "/webhooks", undefined, input),
      list: async () => (await this.#request<{ data: Webhook[] }>("GET", "/webhooks")).data,
      delete: async (id) => { await this.#request<void>("DELETE", `/webhooks/${encodeURIComponent(id)}`); },
    };
  }

  /** One page of meetings, oldest change first. */
  listMeetings(options: ListMeetingsOptions = {}): Promise<MeetingList> {
    const since = options.updatedSince instanceof Date ? options.updatedSince.toISOString() : options.updatedSince;
    return this.#request("GET", "/meetings", { updated_since: since, limit: options.limit, cursor: options.cursor });
  }

  /**
   * Every meeting, page by page. With `updatedSince` it includes meetings
   * deleted since then (`deleted_at` is set), which is how a poller learns of
   * deletions.
   */
  async *iterateMeetings(options: { updatedSince?: string | Date; limit?: number } = {}): AsyncGenerator<MeetingSummary, void, undefined> {
    let cursor: string | undefined;
    for (;;) {
      const page = await this.listMeetings({ ...options, cursor });
      for (const m of page.data) yield m;
      if (!page.next_cursor) return;
      cursor = page.next_cursor;
    }
  }

  getMeeting(id: string): Promise<Meeting> {
    return this.#request("GET", `/meetings/${encodeURIComponent(id)}`);
  }

  getTranscript(id: string): Promise<Transcript> {
    return this.#request("GET", `/meetings/${encodeURIComponent(id)}/transcript`);
  }

  async getMeetingParticipants(id: string): Promise<Participant[]> {
    return (await this.#request<{ data: Participant[] }>("GET", `/meetings/${encodeURIComponent(id)}/participants`)).data;
  }

  getMeetingMetadata(id: string): Promise<MeetingMetadata> {
    return this.#request("GET", `/meetings/${encodeURIComponent(id)}/metadata`);
  }

  /** Import an existing transcript as a complete meeting. Paid plans only. */
  createMeeting(input: CreateMeetingInput): Promise<Meeting> {
    return this.#request("POST", "/meetings", undefined, input);
  }

  /** Shorthand for `webhooks.create({ url, events: ["meeting.completed"] })`. */
  subscribeToMeetingComplete(url: string): Promise<WebhookCreated> {
    return this.webhooks.create({ url, events: ["meeting.completed"] });
  }

  async #request<T>(method: string, path: string, query?: Query, body?: unknown): Promise<T> {
    const url = new URL(`${this.#base}/api/v1${path}`);
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));

    let res: Response;
    try {
      res = await this.#fetch(url.toString(), {
        method,
        headers: {
          Authorization: `Bearer ${this.#apiKey}`,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) {
      throw new LedgeurError(0, "network_error", e instanceof Error ? e.message : "Network error.");
    }

    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let parsed: unknown;
    try { parsed = text ? JSON.parse(text) : undefined; } catch { parsed = undefined; }

    if (!res.ok) {
      const err = (parsed as { error?: { code?: string; message?: string } } | undefined)?.error;
      throw new LedgeurError(res.status, err?.code ?? "unknown", err?.message ?? `Request failed with status ${res.status}.`);
    }
    return parsed as T;
  }
}
