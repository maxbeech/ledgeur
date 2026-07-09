# Supabase — Ledgeur backend

The database schema in `migrations/` is the **source of truth** for the app's
data shapes (mirrored in `packages/core/src/domain/entities.ts`).

## Apply the schema

```bash
# Local stack (needs Docker):
supabase start
supabase db reset          # applies migrations/*.sql in order

# Against a hosted project:
supabase link --project-ref <ref>
supabase db push
```

## Migrations

- `0001_init.sql` — extensions (pgvector), enums, and all tables.
- `0002_rls.sql` — helper functions, the new-user trigger, RLS policies enforcing
  the hive-mind sharing model, and the `match_embeddings` RAG RPC.

## Auth

`config.toml` enables Google and Microsoft (Azure) OAuth — both personal and
work accounts — plus SAML SSO for enterprise. Set the client IDs/secrets as env
vars (`SUPABASE_AUTH_GOOGLE_CLIENT_ID`, etc.). Calendar read scopes are requested
at sign-in for the meeting auto-prompt.

## Notes on the sharing model

`orgs.default_meeting_visibility` is the admin-set default. A meeting is visible
to org members only when `visibility = 'org'`. Semantic search
(`match_embeddings`) re-checks membership + per-meeting visibility, so the hive
mind and the MCP server never leak private meetings.
