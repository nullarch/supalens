-- =====================================================================
-- MCP: provenance for code-derived saved queries.
-- When an AI client (Claude Code) in the user's repo derives a query from
-- source code, it records WHERE it came from so the dashboard is grounded
-- in code and can be re-derived as the code evolves.
--   source = { origin?: <repo path>, ref?: <git sha/branch>, note?: <text> }
-- =====================================================================
alter table saved_queries add column if not exists source jsonb;
comment on column saved_queries.source is
  'provenance for MCP/code-derived queries: {origin?: repo path, ref?: git ref, note?: text}';
