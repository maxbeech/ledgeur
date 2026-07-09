# @ledgeur/mcp-server

The **paid tier**: an MCP server that opens a user's Ledgeur knowledge base
to Claude, ChatGPT, Cursor and any MCP-aware tool. Every query runs under the
user's Supabase RLS, so nothing leaks past your sharing rules.

## Tools

- `list_meetings` — recent meetings
- `search_meetings` — keyword search over meeting titles
- `get_meeting` — a meeting with notes, speakers and full transcript
- `list_tasks` — action items, optionally filtered by status

## Run

```bash
LEDGEUR_SUPABASE_URL=https://xxxx.supabase.co \
LEDGEUR_SUPABASE_ANON_KEY=... \
LEDGEUR_ACCESS_TOKEN=<user JWT from a paid plan> \
pnpm --filter @ledgeur/mcp-server start
```

## Claude Desktop config

```json
{
  "mcpServers": {
    "ledgeur": {
      "command": "pnpm",
      "args": ["--filter", "@ledgeur/mcp-server", "start"],
      "env": {
        "LEDGEUR_SUPABASE_URL": "https://xxxx.supabase.co",
        "LEDGEUR_SUPABASE_ANON_KEY": "...",
        "LEDGEUR_ACCESS_TOKEN": "..."
      }
    }
  }
}
```

The access token is issued in the app under **Integrations → Data access** on a
paid plan. It is a normal Supabase user JWT, so the server sees exactly what that
user sees — including org-shared "hive mind" meetings, never private ones.
