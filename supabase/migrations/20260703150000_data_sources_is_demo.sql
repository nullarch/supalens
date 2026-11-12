-- Demo data sources: an is_demo source is a read-only sample DB (creds from the DEMO_DATABASE_URL
-- host env, NOT the per-tenant vault) auto-attached to every org so users can try before connecting
-- their own database. Excluded from the plan connection cap + from the monthly query quota.
alter table data_sources add column is_demo boolean not null default false;
