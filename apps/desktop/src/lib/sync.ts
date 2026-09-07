// The sync engine: this device's cache and the cloud, kept in step.
//
// ── What it does ────────────────────────────────────────────────────────────
// Push:  every meeting recorded here that the cloud does not have; every edit
//        made here since the cloud last saw it (title, notes, space, speakers,
//        deletion); every space and recipe likewise.
// Pull:  every meeting the account can see that changed since the last pull,
//        written into the local cache so the library, search, tasks and the
//        copilot all work from one store — and work offline.
// Listen: Realtime change events on the synced tables, so a meeting recorded
//        on the laptop appears on the phone without anyone pressing refresh.
//
// The rules of who wins live in @ledgeur/core (data/merge.ts) and are tested
// there. This file is the loop that applies them to a Supabase client.
//
// ── Two backends ────────────────────────────────────────────────────────────
// The engine needs migration 0007. Against a backend that has not had it, it
// falls back to what the old code could do — push each new meeting once and
// pull the list — and says so in Settings rather than failing quietly. The
// probe is one cheap select; the answer is remembered until the next start.
//
// ── What never syncs ────────────────────────────────────────────────────────
// Voice prints (they identify a person even after the transcript is gone) and
// the copilot thread. `remoteSpeakers` below is the only path from a local
// speaker to the wire, and it does not carry `embedding`.

import { useSyncExternalStore } from "react";
import type { SupabaseClient, Session } from "@supabase/supabase-js";
import { planMerge, isSchemaError, isLegacyTwin, SYNC_MIGRATION, type NoteTemplate } from "@ledgeur/core";
import { getSupabase } from "./supabase.ts";
import {
  getMeeting, listMeetingRecords, purgeMeeting, saveMeeting, subscribeMeetings,
  type LocalMeeting, type LocalSegment, type LocalSpeaker,
} from "./meetingsStore.ts";
import { getFolderRecords, applyRemoteFolders, forgetFolders, normaliseTone, type Folder } from "./folders.ts";
import { getRecipeRecords, applyRemoteRecipes, forgetRecipes, type RecipeRecord } from "./recipes.ts";
import { createLogger } from "./logger.ts";

const log = createLogger("sync");

/* ------------------------------------------------------------------ status */

export type SyncPhase = "idle" | "syncing" | "signed-out" | "error" | "legacy";

export interface SyncStatus {
  phase: SyncPhase;
  /** ISO time of the last sync that finished without error. */
  lastSyncAt: string | null;
  /** Present in the "error" phase — the backend's own words where we have them. */
  error: string;
  /** What the last run did. */
  pushed: number;
  pulled: number;
  /** True while a Realtime channel is subscribed, i.e. the other device's
   *  changes arrive on their own. */
  live: boolean;
  /** The workspace this account syncs into, once known. */
  orgId: string | null;
}

let status: SyncStatus = { phase: "signed-out", lastSyncAt: null, error: "", pushed: 0, pulled: 0, live: false, orgId: null };
const listeners = new Set<() => void>();

function setStatus(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch };
  for (const l of listeners) l();
}

export function getSyncStatus(): SyncStatus {
  return status;
}

export function subscribeSync(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(subscribeSync, getSyncStatus, getSyncStatus);
}

/* ------------------------------------------------------------- bookkeeping */

const SINCE_KEY = "ledgeur.sync.since";

interface Since { userId: string; at: string }

function loadSince(userId: string): string | null {
  try {
    const raw = localStorage.getItem(SINCE_KEY);
    const s = raw ? (JSON.parse(raw) as Since) : null;
    return s && s.userId === userId ? s.at : null;
  } catch {
    return null;
  }
}

function saveSince(userId: string, at: string): void {
  try {
    localStorage.setItem(SINCE_KEY, JSON.stringify({ userId, at } satisfies Since));
  } catch { /* storage unavailable — next run pulls a little more */ }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s: string | undefined | null): s is string => Boolean(s && UUID.test(s));

/** The backend either has migration 0007 or it does not; remembered per start. */
let schema: "v7" | "legacy" | null = null;

/**
 * Ask the backend which schema it has.
 *
 * `recheck` forces the question to be asked again. A backend does not usually
 * grow columns underneath a running app, so the answer is cached — but the one
 * time it does is when someone has just applied the migration the "Limited"
 * notice told them to, and the very next thing they do is press Sync now. Left
 * cached, that press reports "Limited" again and the only way out is to
 * restart the app, which nothing tells them to do.
 */
async function probeSchema(sb: SupabaseClient, recheck = false): Promise<"v7" | "legacy"> {
  if (schema && !recheck) return schema;
  const before = schema;
  const { error } = await sb.from("meetings").select("updated_at").limit(1);
  schema = error && isSchemaError(error.message) ? "legacy" : "v7";
  if (schema === "legacy") log.warn(`backend has not had migration ${SYNC_MIGRATION}; syncing the old way`);
  else if (before === "legacy") log.info(`backend now has migration ${SYNC_MIGRATION}; syncing everything`);
  return schema;
}

/** The workspace to sync into: the profile's default, else the first membership. */
// Every query here is checked, not just read. Dropping the error made a device
// with no network indistinguishable from an account with no workspace, and the
// caller's answer to the latter is "sign out and in again" — the worst possible
// advice for someone who is merely offline, since signing back in needs the
// network they have not got.
async function resolveOrg(sb: SupabaseClient, userId: string): Promise<{ id: string; defaultVisibility: "private" | "org" } | null> {
  const { data: profile, error: profileError } = await sb.from("profiles").select("default_org_id").eq("id", userId).maybeSingle();
  fail(profileError);
  const preferred = (profile as { default_org_id: string | null } | null)?.default_org_id;
  let q = sb.from("orgs").select("id, default_meeting_visibility").limit(1);
  if (preferred) q = q.eq("id", preferred);
  const { data: org, error: orgError } = await q.maybeSingle();
  fail(orgError);
  const row = org as { id: string; default_meeting_visibility: string } | null;
  if (!row && preferred) return resolveOrgAny(sb);
  return row ? { id: row.id, defaultVisibility: row.default_meeting_visibility === "org" ? "org" : "private" } : null;
}

async function resolveOrgAny(sb: SupabaseClient) {
  const { data, error } = await sb.from("orgs").select("id, default_meeting_visibility").limit(1).maybeSingle();
  fail(error);
  const row = data as { id: string; default_meeting_visibility: string } | null;
  return row ? { id: row.id, defaultVisibility: row.default_meeting_visibility === "org" ? ("org" as const) : ("private" as const) } : null;
}

const fail = (error: { message: string } | null): void => {
  if (error) throw new Error(error.message);
};

export const OFFLINE_MESSAGE = "No connection. Everything is saved on this device, and syncs by itself once you are back online.";

/**
 * Whether a failed sync is "this device has no network" rather than something
 * the backend said. Browsers and webviews word this differently — Chromium
 * "Failed to fetch", WebKit "Load failed", Firefox "NetworkError" — and none
 * of them are worth showing to a person.
 */
export function isOffline(message: string): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return /failed to fetch|load failed|networkerror|network request failed|err_internet_disconnected|fetch failed/i.test(message);
}

/* ------------------------------------------------------------- push: meetings */

/** A `speakers` row. No embedding — see the header. Do not add it. */
function remoteSpeakers(m: LocalMeeting): { label: string; identified_name: string | null; identity_confidence: number | null }[] {
  const labels = new Set<string>(m.segments.map((s) => s.speakerLabel));
  for (const s of m.speakers ?? []) labels.add(s.label);
  return [...labels].map((label) => {
    const identified = !/^Speaker \d+$/i.test(label);
    const conf = m.speakers?.find((s) => s.label === label)?.confidence
      ?? m.segments.find((s) => s.speakerLabel === label && s.speakerConfidence != null)?.speakerConfidence
      ?? null;
    return { label, identified_name: identified ? label : null, identity_confidence: identified ? conf : null };
  });
}

interface PushCtx { sb: SupabaseClient; userId: string; orgId: string; defaultVisibility: "private" | "org"; v7: boolean }

/** Insert or wholly replace a meeting: the row, its speakers, transcript, notes and tasks. */
async function pushFull(ctx: PushCtx, m: LocalMeeting, insert: boolean): Promise<void> {
  const { sb } = ctx;
  const base: Record<string, unknown> = {
    title: m.title || "Untitled meeting", status: "complete",
    started_at: m.startedAt, ended_at: m.endedAt, lang: m.lang,
  };
  if (ctx.v7) {
    Object.assign(base, {
      updated_at: m.updatedAt ?? m.createdAt,
      folder_id: isUuid(m.folderId) ? m.folderId : null,
      template_id: m.templateId ?? null,
      deleted_at: null,
    });
  }
  if (insert) {
    fail((await sb.from("meetings").insert({
      id: m.id, org_id: ctx.orgId, owner_id: ctx.userId, visibility: ctx.defaultVisibility,
      created_at: m.createdAt, ...base,
    })).error);
  } else {
    fail((await sb.from("meetings").update(base).eq("id", m.id)).error);
    // Children are replaced wholesale: a renamed speaker touches every line,
    // and diffing rows would be more code than it saves.
    fail((await sb.from("transcript_segments").delete().eq("meeting_id", m.id)).error);
    fail((await sb.from("speakers").delete().eq("meeting_id", m.id)).error);
    fail((await sb.from("action_items").delete().eq("meeting_id", m.id)).error);
  }

  const speakerIdByLabel = new Map<string, string>();
  const speakers = remoteSpeakers(m);
  if (speakers.length) {
    const { data, error } = await sb.from("speakers")
      .insert(speakers.map((s) => ({ meeting_id: m.id, ...s })))
      .select("id, label");
    fail(error);
    for (const r of (data ?? []) as { id: string; label: string }[]) speakerIdByLabel.set(r.label, r.id);
  }
  if (m.segments.length) {
    fail((await sb.from("transcript_segments").insert(
      m.segments.map((s) => ({
        meeting_id: m.id, speaker_id: speakerIdByLabel.get(s.speakerLabel) ?? null,
        start_ms: s.startMs, end_ms: s.endMs, text: s.text, confidence: s.confidence,
      })),
    )).error);
  }
  await pushNotes(ctx, m);
  if (m.actionItems.length) {
    fail((await sb.from("action_items").insert(
      m.actionItems.map((title) => ({ org_id: ctx.orgId, meeting_id: m.id, title })),
    )).error);
  }
}

async function pushNotes(ctx: PushCtx, m: LocalMeeting): Promise<void> {
  const note: Record<string, unknown> = {
    meeting_id: m.id, summary: m.summary, decisions: m.decisions, questions: m.questions,
    markdown: m.noteMarkdown, generator: "local", word_count: m.wordCount,
  };
  if (ctx.v7) Object.assign(note, { manual_notes: m.manualNotes ?? "", updated_at: m.updatedAt ?? m.createdAt });
  fail((await ctx.sb.from("meeting_notes").upsert(note, { onConflict: "meeting_id" })).error);
}

/** Title, filing, template and notes — an edit that did not touch the transcript. */
async function pushMeta(ctx: PushCtx, m: LocalMeeting): Promise<void> {
  fail((await ctx.sb.from("meetings").update({
    title: m.title || "Untitled meeting",
    updated_at: m.updatedAt ?? new Date().toISOString(),
    folder_id: isUuid(m.folderId) ? m.folderId : null,
    template_id: m.templateId ?? null,
  }).eq("id", m.id)).error);
  await pushNotes(ctx, m);
}

async function pushTombstone(ctx: PushCtx, m: LocalMeeting): Promise<void> {
  if (ctx.v7) {
    fail((await ctx.sb.from("meetings").update({ deleted_at: m.deletedAt, updated_at: m.updatedAt ?? m.deletedAt }).eq("id", m.id)).error);
  } else {
    fail((await ctx.sb.from("meetings").delete().eq("id", m.id)).error);
  }
}

async function pushMeetings(ctx: PushCtx): Promise<number> {
  let pushed = 0;
  for (const m of await listMeetingRecords()) {
    if (m.status !== "complete") continue;
    // Somebody else's meeting, shared into the workspace: read-only here.
    if (m.ownerId && m.ownerId !== ctx.userId) continue;
    // Ids from before crypto.randomUUID existed cannot be cloud ids.
    if (!isUuid(m.id)) { if (!m.synced) log.warn("meeting has a non-uuid id and cannot be synced", { id: m.id }); continue; }

    if (m.deletedAt) {
      if (m.synced) await pushTombstone(ctx, m);
      await purgeMeeting(m.id);
      pushed++;
      continue;
    }
    if (!m.synced) {
      await pushFull(ctx, m, true);
    } else if (!ctx.v7) {
      continue; // the old backend has no way to take an edit
    } else if (m.dirty === "full") {
      await pushFull(ctx, m, false);
    } else if (m.dirty === "meta") {
      await pushMeta(ctx, m);
    } else {
      continue;
    }
    await saveMeeting({
      ...m, synced: true, dirty: undefined, syncedAt: new Date().toISOString(),
      ownerId: ctx.userId, orgId: ctx.orgId,
    }, "none");
    pushed++;
  }
  return pushed;
}

/* ------------------------------------------------------ push+pull: spaces */

interface FolderRow { id: string; owner_id: string; name: string; tone: string; created_at: string; updated_at: string; deleted_at: string | null }

async function syncFolders(ctx: PushCtx): Promise<number> {
  const { data, error } = await ctx.sb.from("folders").select("*").eq("owner_id", ctx.userId);
  fail(error);
  const remote: Folder[] = ((data ?? []) as FolderRow[]).map((r) => ({
    id: r.id, name: r.name, tone: normaliseTone(r.tone), createdAt: r.created_at, updatedAt: r.updated_at,
    ...(r.deleted_at ? { deletedAt: r.deleted_at } : {}),
  }));
  const local = getFolderRecords().filter((f) => isUuid(f.id));
  const plan = planMerge(local, remote);
  if (plan.push.length) {
    fail((await ctx.sb.from("folders").upsert(plan.push.map((f) => ({
      id: f.id, owner_id: ctx.userId, name: f.name, tone: f.tone,
      created_at: f.createdAt, updated_at: f.updatedAt, deleted_at: f.deletedAt ?? null,
    })))).error);
  }
  applyRemoteFolders(plan.pull, plan.removeLocally);
  // Tombstones the cloud now holds can be forgotten here.
  forgetFolders(plan.push.filter((f) => f.deletedAt).map((f) => f.id));
  return plan.push.length + plan.pull.length + plan.removeLocally.length;
}

/* ------------------------------------------------------ push+pull: recipes */

interface RecipeRow { owner_id: string; template_id: string; name: string; description: string; focus: string; looks_for: string[]; created_at: string; updated_at: string; deleted_at: string | null }

async function syncRecipes(ctx: PushCtx): Promise<number> {
  const { data, error } = await ctx.sb.from("note_templates").select("*").eq("owner_id", ctx.userId);
  fail(error);
  const remote: RecipeRecord[] = ((data ?? []) as RecipeRow[]).map((r) => ({
    id: r.template_id, name: r.name, description: r.description, focus: r.focus, looksFor: r.looks_for,
    updatedAt: r.updated_at, ...(r.deleted_at ? { deletedAt: r.deleted_at } : {}),
  } satisfies RecipeRecord & NoteTemplate));
  const plan = planMerge(getRecipeRecords(), remote);
  if (plan.push.length) {
    fail((await ctx.sb.from("note_templates").upsert(plan.push.map((t) => ({
      owner_id: ctx.userId, template_id: t.id, name: t.name, description: t.description ?? "",
      focus: t.focus ?? "", looks_for: t.looksFor ?? [], updated_at: t.updatedAt, deleted_at: t.deletedAt ?? null,
    })), { onConflict: "owner_id,template_id" })).error);
  }
  applyRemoteRecipes(plan.pull, plan.removeLocally);
  forgetRecipes(plan.push.filter((t) => t.deletedAt).map((t) => t.id));
  return plan.push.length + plan.pull.length + plan.removeLocally.length;
}

/* ---------------------------------------------------------- pull: meetings */

export interface RemoteFull {
  id: string; org_id: string; owner_id: string; title: string; status: string; visibility: string;
  started_at: string | null; ended_at: string | null; lang: string; created_at: string;
  updated_at?: string; deleted_at?: string | null; folder_id?: string | null; template_id?: string | null;
  meeting_notes: { summary: string[]; decisions: string[]; questions: string[]; markdown: string; word_count: number; manual_notes?: string }[] | null;
  speakers: { id: string; label: string; identified_name: string | null; identity_confidence: number | null }[] | null;
  transcript_segments: { id: string; speaker_id: string | null; start_ms: number; end_ms: number; text: string; confidence: number | null }[] | null;
  action_items: { id: string; title: string; status: string }[] | null;
}

const EMBED = "*, meeting_notes(*), speakers(*), transcript_segments(*), action_items(id, title, status)";

/** A cloud meeting in the shape this device stores. Exported for the test
 *  that pins the embed shape — see test/sync.mts. */
export function toLocal(r: RemoteFull, previous: LocalMeeting | undefined): LocalMeeting {
  const bySpeaker = new Map((r.speakers ?? []).map((s) => [s.id, s]));
  const segments: LocalSegment[] = [...(r.transcript_segments ?? [])]
    .sort((a, b) => a.start_ms - b.start_ms)
    .map((s) => {
      const spk = s.speaker_id ? bySpeaker.get(s.speaker_id) : undefined;
      return {
        id: s.id, speakerLabel: spk?.identified_name || spk?.label || "Speaker 1",
        speakerConfidence: spk?.identity_confidence ?? null,
        startMs: s.start_ms, endMs: s.end_ms, text: s.text, confidence: s.confidence,
      };
    });
  // Speaking time is recomputed from the lines; the voice print, if this
  // device ever had one for that label, is kept — it never left here.
  const seconds = new Map<string, number>();
  for (const s of segments) seconds.set(s.speakerLabel, (seconds.get(s.speakerLabel) ?? 0) + (s.endMs - s.startMs) / 1000);
  const speakers: LocalSpeaker[] = (r.speakers ?? []).map((s) => {
    const label = s.identified_name || s.label;
    const kept = previous?.speakers?.find((p) => p.label === label);
    return { label, confidence: s.identity_confidence, speakingSeconds: seconds.get(label) ?? 0, ...(kept?.embedding ? { embedding: kept.embedding } : {}) };
  });
  // meeting_notes is keyed by meeting_id, so PostgREST treats the embed as
  // one-to-one and returns an object rather than a one-element array. Both
  // shapes are accepted, because the difference is a schema detail no reader
  // of this code should have to know.
  const embedded = r.meeting_notes as unknown;
  const note = (Array.isArray(embedded) ? embedded[0] : embedded) as NonNullable<RemoteFull["meeting_notes"]>[number] | null | undefined;
  const actionItems = (r.action_items ?? []).filter((a) => a.status !== "cancelled").map((a) => a.title);
  return {
    id: r.id, title: r.title, createdAt: r.created_at, startedAt: r.started_at, endedAt: r.ended_at,
    status: "complete", lang: r.lang, segments,
    speakers: speakers.length ? speakers : undefined,
    summary: note?.summary ?? [], decisions: note?.decisions ?? [], questions: note?.questions ?? [],
    actionItems, manualNotes: note?.manual_notes ?? previous?.manualNotes ?? "",
    messages: previous?.messages,
    noteMarkdown: note?.markdown ?? "", wordCount: note?.word_count ?? 0,
    synced: true, syncedAt: new Date().toISOString(),
    folderId: r.folder_id ?? undefined, templateId: r.template_id ?? undefined,
    updatedAt: r.updated_at ?? r.created_at,
    ownerId: r.owner_id, orgId: r.org_id,
  };
}

async function pullMeetings(ctx: PushCtx, since: string | null): Promise<{ pulled: number; newest: string | null }> {
  let q = ctx.sb.from("meetings").select(EMBED).order(ctx.v7 ? "updated_at" : "created_at", { ascending: true }).limit(500);
  if (ctx.v7 && since) q = q.gt("updated_at", since);
  const { data, error } = await q;
  fail(error);
  const rows = (data ?? []) as unknown as RemoteFull[];
  const local = await listMeetingRecords();
  let pulled = 0;
  let newest = since;

  for (const r of rows) {
    const stamp = r.updated_at ?? r.created_at;
    if (!newest || stamp > newest) newest = stamp;
    const mine = local.find((m) => m.id === r.id);

    if (r.deleted_at) {
      if (mine) { await purgeMeeting(r.id); pulled++; }
      continue;
    }
    // An edit made here that the cloud has not seen yet is newer than what
    // the cloud is offering; it will be pushed on the next pass instead.
    if (mine?.dirty && (mine.updatedAt ?? "") > stamp) continue;
    // Meetings pushed by the old engine live here under a different id. The
    // cloud copy takes over, carrying across what only this device had.
    const legacy = !mine ? local.find((m) => m.synced && !m.syncedAt && m.id !== r.id && isLegacyTwin(m, { title: r.title, startedAt: r.started_at, createdAt: r.created_at })) : undefined;
    const previous = mine ?? legacy;
    const next = toLocal(r, previous);
    if (legacy) {
      next.folderId = next.folderId ?? legacy.folderId;
      next.templateId = next.templateId ?? legacy.templateId;
      await purgeMeeting(legacy.id);
    }
    await saveMeeting(next, "none");
    pulled++;
  }
  return { pulled, newest };
}

/* --------------------------------------------------------------- the run */

let running: Promise<SyncStatus> | null = null;
let again = false;
/** A person asked for this sync, so the next run re-asks what schema the
 *  backend has. Set here and claimed by the run that serves the request. */
let recheckSchema = false;

/** Syncs a person asked for by hand, as opposed to the app's own. */
export const isManualSync = (reason: string): boolean => reason === "manual";

/** Sync now. Serialised: a call during a run queues one more run after it. */
export function syncNow(reason: string): Promise<SyncStatus> {
  if (isManualSync(reason)) recheckSchema = true;
  if (running) { again = true; return running; }
  running = (async () => {
    try {
      do {
        again = false;
        await runOnce(reason);
      } while (again);
    } finally {
      running = null;
    }
    return status;
  })();
  return running;
}

async function runOnce(reason: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) { setStatus({ phase: "signed-out" }); return; }
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { setStatus({ phase: "signed-out", orgId: null }); return; }

  setStatus({ phase: "syncing", error: "" });
  log.info("sync start", { reason });
  try {
    // A person pressing Sync now is the one moment the schema is worth asking
    // about again — see probeSchema. Claimed here rather than read from
    // `reason`, because a press that arrives mid-run is served by a repeat of
    // the run already going, under that run's reason.
    const recheck = recheckSchema;
    recheckSchema = false;
    const mode = await probeSchema(sb, recheck);
    const org = await resolveOrg(sb, session.user.id);
    if (!org) throw new Error("This account has no workspace yet. Sign out and in again to create one.");
    const ctx: PushCtx = { sb, userId: session.user.id, orgId: org.id, defaultVisibility: org.defaultVisibility, v7: mode === "v7" };

    let pushed = 0;
    if (ctx.v7) {
      pushed += await syncFolders(ctx);
      pushed += await syncRecipes(ctx);
    }
    pushed += await pushMeetings(ctx);
    const { pulled, newest } = await pullMeetings(ctx, ctx.v7 ? loadSince(session.user.id) : null);
    if (ctx.v7 && newest) saveSince(session.user.id, newest);

    setStatus({
      phase: ctx.v7 ? "idle" : "legacy",
      error: ctx.v7 ? "" : `The backend has not had migration ${SYNC_MIGRATION}, so only new meetings sync, one way. Apply it to sync edits, spaces and recipes.`,
      lastSyncAt: new Date().toISOString(), pushed, pulled, orgId: org.id,
    });
    log.info("sync done", { pushed, pulled, mode });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log.error("sync failed", e);
    // A device with no connection is not a broken one, and "TypeError: Failed
    // to fetch" is not something to put in front of a person. Nothing is lost
    // meanwhile: everything is on the device, and the next run picks it up.
    // The Realtime badge goes with it — there is no live channel without a
    // network, whether or not the socket got around to telling us.
    if (isOffline(message)) setStatus({ phase: "error", error: OFFLINE_MESSAGE, live: false });
    else setStatus({ phase: "error", error: message });
  }
}

/* ---------------------------------------------------------------- session */

const TABLES = ["meetings", "meeting_notes", "action_items", "folders", "note_templates"] as const;
/** Module-wide, not per start: React's strict mode starts the engine twice in
 *  development, and the first instance's channel is still registered under
 *  its topic while its removal is in flight. */
let generation = 0;
const REALTIME_DEBOUNCE_MS = 1_500;
const PERIODIC_MS = 5 * 60_000;

/**
 * Run the engine for the life of the app: on start, on sign-in, when a change
 * arrives from another device, when the window comes back, every few minutes,
 * and whenever something here is saved.
 */
export function startSync(): () => void {
  const sb = getSupabase();
  if (!sb) return () => {};

  let channel: ReturnType<SupabaseClient["channel"]> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Whose session the channel was opened for. Supabase fires INITIAL_SESSION
   *  and SIGNED_IN for the same person, and a token refresh fires again; only
   *  a change of person needs a new channel. */
  let attachedFor: string | null = null;
  const schedule = (reason: string) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void syncNow(reason); }, REALTIME_DEBOUNCE_MS);
  };

  const detach = () => {
    if (channel) { void sb.removeChannel(channel); channel = null; }
    attachedFor = null;
    setStatus({ live: false });
  };
  const attach = (session: Session | null) => {
    try {
      attachInner(session);
    } catch (e) {
      log.error("could not subscribe to changes", e);
      setStatus({ live: false });
      void syncNow("session");
    }
  };
  const attachInner = (session: Session | null) => {
    const userId = session?.user.id ?? null;
    if (userId && userId === attachedFor) { void syncNow("session"); return; }
    detach();
    schema = null;
    if (!userId) { setStatus({ phase: "signed-out", orgId: null }); return; }
    // A fresh topic every time: `channel(name)` hands back an existing channel
    // of the same name, and callbacks cannot be added to one that is already
    // subscribed — which is exactly what a second attach for the same person
    // used to hit.
    let ch = sb.channel(`ledgeur-sync-${++generation}`);
    for (const table of TABLES) {
      ch = ch.on("postgres_changes", { event: "*", schema: "public", table }, () => schedule(`realtime:${table}`));
    }
    channel = ch.subscribe((state) => setStatus({ live: state === "SUBSCRIBED" }));
    attachedFor = userId;
    void syncNow("session");
  };

  void sb.auth.getSession().then(({ data }) => attach(data.session));
  const { data: auth } = sb.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "INITIAL_SESSION") attach(session);
  });

  const onVisible = () => { if (document.visibilityState === "visible") schedule("visible"); };
  document.addEventListener("visibilitychange", onVisible);
  // The radio coming back is the moment to try again. Without this, a phone
  // that recorded on a train catches up on the next five-minute tick, and the
  // "syncs by itself once you are back online" the failure promises is true
  // but slow enough to look untrue.
  const onOnline = () => schedule("online");
  window.addEventListener("online", onOnline);
  const interval = setInterval(() => schedule("periodic"), PERIODIC_MS);
  // A save here (an edit, a new recording) reaches the cloud promptly, not
  // at the next tick — but only when the save was a person's, which is what
  // `dirty` records. The engine's own writes come through with intent "none".
  const offStore = subscribeMeetings(() => {
    void getMeetingDirty().then((dirty) => { if (dirty) schedule("local-edit"); });
  });

  return () => {
    auth.subscription.unsubscribe();
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("online", onOnline);
    clearInterval(interval);
    offStore();
    if (timer) clearTimeout(timer);
    detach();
  };
}

async function getMeetingDirty(): Promise<boolean> {
  const all = await listMeetingRecords();
  return all.some((m) => m.status === "complete" && (m.dirty || (!m.synced && isUuid(m.id)) || m.deletedAt));
}

/** The org this account syncs into, for callers that index or export. */
export function currentOrgId(): string | null {
  return status.orgId;
}

/** Whether a given meeting is in the cloud under its own id. */
export async function isSynced(meetingId: string): Promise<boolean> {
  const m = await getMeeting(meetingId);
  return Boolean(m?.synced);
}
