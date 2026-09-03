-- Contextely: the shared company-memory layer (Notion, Drive, Postgres, ...
-- condensed into one searchable place). Connected the same way as any other
-- integration — a row in `integrations` + a secret in `integration_secrets` —
-- so Ask/the copilot can draw on it via `contextely-context`.
alter type integration_provider add value 'contextely';
