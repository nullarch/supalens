-- Persistent, OPTIONAL repo attachment: a data source may attach ONE GitHub repository whose
-- application code is analyzed (code x DB) to produce a richer, code-aware context doc (tier-2).
-- The repo can back several data sources, so the FK lives on data_sources (many DS -> one repo).
alter table data_sources
  add column repo_id uuid references github_repositories(id) on delete set null;
create index data_sources_repo_idx on data_sources (repo_id);

-- Defense-in-depth: an attached repo MUST belong to the same org as the data source (the BFF
-- asserts this too). Blocks a cross-org repo attachment from ever landing in the row — the same
-- one-run-one-tenant invariant the combined code x DB run enforces at the app layer.
create or replace function app.assert_repo_same_org() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.repo_id is not null and not exists (
    select 1 from public.github_repositories r
    where r.id = new.repo_id and r.org_id = new.org_id
  ) then
    raise exception 'repo_id must reference a repository in the same org';
  end if;
  return new;
end $$;

create trigger trg_ds_repo_same_org
  before insert or update of repo_id on data_sources
  for each row execute function app.assert_repo_same_org();
