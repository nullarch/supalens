-- Public share links for an analysis answer: an unguessable token on the run.
-- A run is publicly viewable at /share/{share_token} only when this is set (opt-in).
alter table agent_runs add column share_token text;
create unique index agent_runs_share_token_idx on agent_runs (share_token) where share_token is not null;
