# Deploying Ledgeur

What has to be set, where, and what breaks if it is not. Everything here is a
real requirement of code in this repository — nothing is aspirational.

## The website and web app (Vercel)

`apps/marketing` is the marketing site, the web app at `/app`, the checkout
routes and the hosted agent endpoint. It is a Next.js app; deploying is a git
push once the project is linked.

### Environment variables

| Variable | Needed for | Without it |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Accounts, sync, agent access | Falls back to the value in `lib/site.ts`. Both this and the anon key are publishable by design — the anon key carries the `anon` role and every table is behind row-level security. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | as above | as above |
| `NEXT_PUBLIC_SITE_URL` | Stripe return URLs | Falls back to `SITE.url`. Set it on preview deployments, or a customer returns from checkout to production. |
| `STRIPE_SECRET_KEY` | Checkout, billing portal | Both routes return a 503 saying card payment is not configured, and the pricing page offers a contact link instead. Nothing crashes and nobody is charged. |
| `STRIPE_PRICE_ID` | Checkout | as above |
| `SUPABASE_SERVICE_ROLE_KEY` | The hosted agent endpoint | `POST /api/mcp` returns 503. **Server-side only — never expose this.** |
| `SUPABASE_JWT_SECRET` | The hosted agent endpoint | `POST /api/mcp` returns 503. **Server-side only.** |

`SUPABASE_JWT_SECRET` is new, and the endpoint cannot work without it. It is in
the Supabase dashboard under **Project Settings → API → JWT Settings → JWT
Secret**. It is what lets an access token be exchanged for a short-lived session
belonging to its owner, so row-level security — rather than application code —
decides what an agent can read. See `packages/mcp/src/token.ts`.

### What is static, and what is not

Everything except `/api/*` is prerendered at build. The marketing pages are fully
static; the blog, the programmatic SEO pages and the policy pages carry
`revalidate = 604800` (one week), so an edit reaches the cache without a deploy
while still being served from the edge in between.

`/app` is prerendered too — it is a client-side app over IndexedDB, so there is
nothing for a server to render per request.

## Supabase

Apply `supabase/migrations` in order. Then deploy the functions:

```bash
supabase functions deploy mcp-token stripe-webhook notion-oauth notion-save notion-context
```

### Function environment

| Variable | Function | Notes |
|---|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | all | Provided by the platform. |
| `STRIPE_SECRET_KEY` | `stripe-webhook` | |
| `STRIPE_WEBHOOK_SECRET_LIVE` / `_TEST` | `stripe-webhook` | Stripe signs live and test events with different secrets; the function tries both, so set whichever you use. |

### The Stripe webhook is not optional

Without it a completed checkout takes the customer's money and never flips
`orgs.plan`, so sync and agent access stay switched off for somebody who has
paid. Point a Stripe endpoint at the deployed `stripe-webhook` function and
subscribe it to:

- `checkout.session.completed`
- `customer.subscription.updated`
- `customer.subscription.deleted`

`POST /api/checkout` refuses to open a session it cannot attribute to a
workspace, so a payment can no longer be taken for nothing — but the webhook is
still what turns the plan on.

## The desktop app

`apps/desktop` builds with Tauri. Copy `.env.example` to `.env` and fill in the
Supabase URL and anon key; without them the app runs local-only, which is a
supported state rather than an error.

```bash
pnpm --filter @ledgeur/desktop tauri:build          # webview engine
pnpm --filter @ledgeur/desktop tauri:build:ai       # with the native engine
```

Signing and notarisation for macOS are in `apps/desktop/scripts/release-macos.mjs`.

## Verifying a deployment

1. `/` loads, and the fonts are the serif and grotesque — not system faces.
2. `/pricing` → "Start the free trial" while signed out redirects to `/signin`.
   If it opens Stripe, the auth gate is broken.
3. Sign up, then `/account` shows the workspace and the free plan.
4. Buy, and within a few seconds `/account` shows the Team plan. If it does not,
   the webhook is not wired.
5. Generate an access token, then:
   ```bash
   curl -X POST https://your-domain/api/mcp \
     -H "Authorization: Bearer ldg_…" \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
   ```
   Four tools come back. A 503 means `SUPABASE_SERVICE_ROLE_KEY` or
   `SUPABASE_JWT_SECRET` is missing; a 401 means the token is wrong or revoked.
6. `/app` → record something short. The transcript appears, and when you stop it,
   the speakers are separated. The first run downloads the models.
