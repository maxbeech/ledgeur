# The 2026-09 redesign, the mobile app, and sync

Living plan. Started 2026-09-06. Updated as work lands. Legend: ✅ done · 🟡 in progress · ⬜ planned.

## The brief

Overhaul the UX and UI to feel premium — in the family of Airbnb and ChatGPT,
with more pastel colour — then build companion iOS and Android apps that sync
perfectly with the desktop app.

## What the audit found (2026-09-06)

Three read-only audits over the whole repository before anything was changed.

**The design system was never actually shared.** `packages/ui/src/theme.css`
claims to be the single source of truth, and the marketing site imports it — but
the desktop app imported a hand copy (`apps/desktop/src/theme.css`) that had
drifted: `--color-faint` was `#988f7f` in the app, which measures **2.86:1** on
paper and fails AA, and it was the colour of every metadata line, timestamp and
hint in the product. `.ldg-prose` in the app copy set only `user-select`, so the
seven reading surfaces that used it had no typography at all. The app also had
its own `Button`, `Card`, `Chip`, `EmptyState`, `ErrorNote` with a different
primary colour, different radii, different press feedback and different focus
rings from the site's — the exact failure `primitives.tsx` was written to prevent.

**Nothing had a type scale.** 24 distinct arbitrary pixel sizes on the site;
five near-identical body sizes (13 / 13.5 / 14 / 14.5 / 15px). Five display
sizes in the app with no relationship to each other.

**The most template-shaped things**, in order: the gradient-avatar circle
(copied three times), the stat-tile row on Home, the starter-prompt grid on
Ask, the `white/10` dark rail, the shadcn-shaped segmented tab, two different
spinners, five loading patterns, six one-off notice boxes, a favicon that was
still a green "P" in Arial, and a PWA manifest in a third brand palette.

**Sync was one-shot and one-way.** A meeting was pushed once, on stop, with a
server-generated id the device never learned. No update path existed for
anything: renaming a speaker, editing a title, filing a meeting, typing notes —
none of it ever reached the cloud, and a second device showed the transcript as
it was the moment it was first pushed. Spaces, recipes, manual notes and the
copilot thread were not in the database at all. No Realtime. Meetings recorded
before signing in were never uploaded.

**Mobile did not exist.** `tauri ios init` had never been run; `gen/` held only
schemas. The package description, the README and the roadmap all said iOS and
Android.

## Design direction

One family, one scale, one palette, in two modes.

- **Type.** Plus Jakarta Sans, variable, for everything that is read or
  operated; Spline Sans Mono only for code. A twelve-step scale
  (12 · 13 · 14 · 15 · 17 · 20 · 24 · 30 · 38 · 48 · 60) declared once in the
  theme, so `text-lg` means the same thing in the app and on the site.
- **Colour.** A neutral canvas — white surfaces on a cool off-white ground,
  near-black text — with six pastel families, each a triad of a soft tint, a
  base, and a strong tone that clears AA as text on white and on its own tint:
  **iris** (the brand, the copilot, links, focus), **mint** (live, you, sync
  health), **peach** (recording, destructive), **butter** (warnings),
  **sky** and **rose** (speakers, spaces, avatars). Every pairing the system
  uses is measured in `packages/ui/test/run.mts`, in both modes.
- **Shape.** Radii on one scale: 12px controls, 16px cards, 24px sheets, and
  the composer as a pill. Shadows soft and layered rather than one grey drop.
  Panels separated by tint rather than by lines wherever the eye can do it.
- **Layout.** In the app, a light sidebar the way ChatGPT's is, the screen as a
  plain page rather than a window-inside-a-window, and one composer pinned at
  the bottom. On the site, whitespace and a friendly bold headline the way
  Airbnb's are, with the product drawn from its own components.
- **Motion.** One orchestrated arrival on Home; everything else answers a
  person's action. The recording halo stays, because it means something.
- **Dark mode.** Follows the system, with an override in Settings; both apps.

What was removed on purpose: the paper grain, the serif display face, the
all-caps mono labels above every section, the eyebrow kicker on every page
header, the gradient avatars, the fade-and-slide on every section, the
`01 / 02 / 03` numbering where nothing is a sequence.

## Plan

### A. One design system — ✅
- [x] `packages/ui/src/tokens.ts` is the single source; `tokens.css` is
      generated from it (`pnpm --filter @ledgeur/ui build:theme`) and a test
      fails if the generated file is stale.
- [x] Light and dark palettes, radii, type scale, shadows, easings all in the
      theme; both apps import `@ledgeur/ui/theme.css` and nothing else.
- [x] One primitive set in `packages/ui/src/components/primitives.tsx`:
      Button / LinkButton / IconButton, Card, Label, Title, Badge, SpeakerChip,
      Avatar, Field / Input / Select / Textarea, Toggle, Spinner, ProgressBar,
      Notice, EmptyState, ErrorNote, Segmented, Rule, Logo.
      `apps/desktop/src/components/ui.tsx` becomes a re-export.
- [x] Contrast test covers every pastel pairing in both modes (223 assertions).

### B. The desktop app — ✅
- [x] Shell: light sidebar with spaces and recent meetings, page header,
      pinned composer, bottom tabs on phones, ⌘K palette restyled.
- [x] Every screen on the new primitives: Home, Record, the live room,
      Library, Meeting, Ask, Tasks, People, Settings and its cards.
- [x] Theme setting (system / light / dark).

### C. The site — ✅
- [x] Chrome (header, footer, sections, page header) on the new system.
- [x] Home, pricing, download, agents, blog, changelog, sign-in, account,
      the in-browser app; favicon, manifest and social image on the palette.
- [x] Header nav read from one list (`NAV.header`); `Section` takes a `pad`
      prop. Legal and SEO pages still carry a few `!py-*` overrides — they
      render correctly and were left alone.

### D. Sync that is actually sync — ✅ (engine) · ⬜ (migration on the live backend)
- [x] Migration `0007_sync.sql`: client-supplied meeting ids, `updated_at`
      and soft deletes on meetings, `folders` and `note_templates` tables,
      `meetings.folder_id` / `template_id`, `meeting_notes.manual_notes`,
      Realtime publication.
- [x] A sync engine (`apps/desktop/src/lib/sync.ts`) that pushes every
      unsynced local meeting, pulls every cloud meeting into the local cache,
      propagates edits (title, speakers, notes, space, template, delete) by
      `updated_at`, and listens to Realtime so a second device updates without
      a refresh.
- [x] Honest degraded state when the backend has not had the migration
      ("Limited", naming the migration). This is the mode the live project
      is in: no access token was available to apply 0007 from here, and a
      local Supabase stack could not start (Docker Desktop hung).
- [x] Tests over the pure merge logic in `packages/core`, and over the
      row mapping and the device stores in `apps/desktop`.
- [x] Verified between two browser origins against the live backend: six
      meetings pushed from one, pulled by the other with transcripts,
      speakers and notes; a meeting created on the second reached the first
      through Realtime; the same ids on both.

### E. iOS and Android — 🟡
- [x] Rust targets, `tauri ios init`, `tauri android init`, committed
      projects, microphone permission strings in both.
- [x] Desktop-only plugins and capabilities split by platform.
- [x] A phone shell: safe areas, bottom tabs, notes sheet, no desktop-only
      settings, microphone-only recording, model download on first record.
- [ ] Simulator / emulator runs — see the report for how far each got.

### F. Proof — 🟡
- [x] All packages test and typecheck.
- [x] Browser E2E by a separate agent: the site in light, dark and phone
      widths passed; the app's pass is recorded in the report.
- [x] `docs/MANUAL_TESTING.md` lists what needs a real phone.

## Assumptions made without asking

Listed as they are made; repeated in the final report.
