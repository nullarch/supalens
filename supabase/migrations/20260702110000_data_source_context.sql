-- Per-data-source AI-authored context document ("SUPALENS.md") injected into the query agent's
-- system prompt to lift NL->SQL / NL->Firestore accuracy. One CURRENT row per data source.
--   tier-1 = generated deterministically from the introspection cache (schema only, no repo)
--   tier-2 = code x DB analysis when a git repo is attached (source_repo_id set)
-- Reads are org-member scoped; writes are service_role only (the generator runs on the agent host).

create type context_status as enum ('pending', 'generating', 'fresh', 'stale', 'failed');

create table data_source_context (
  data_source_id     uuid primary key references data_sources(id) on delete cascade,
  org_id             uuid not null references organizations(id) on delete cascade,
  content_md         text,                                  -- the SUPALENS.md body (TRUSTED context)
  status             context_status not null default 'pending',
  source_repo_id     uuid references github_repositories(id) on delete set null, -- tier-2 provenance
  generated_from_sha text,                                  -- repo commit the doc was built from (staleness)
  schema_hash        text,                                  -- data_source_schemas.content_hash at gen time
  token_estimate     int,                                   -- rough size for prompt-budget planning
  model              text,
  error              text,
  generated_by       uuid references profiles(id) on delete set null,
  generated_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index data_source_context_org_idx on data_source_context (org_id);
create trigger trg_dsc_upd before update on data_source_context
  for each row execute function app.set_updated_at();

alter table data_source_context enable row level security;

-- Members of the owning org may read the context; there is NO authenticated write policy, so
-- writes are service_role only (mirrors data_source_schemas: member-read, host-write).
create policy dsc_sel on data_source_context for select to authenticated
  using (org_id in (select app.current_org_ids()));
