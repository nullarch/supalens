-- =====================================================================
-- OAuth 2.1 (PKCE) for the MCP server — lets Claude Code / Cursor connect
-- via browser login instead of a pasted sl_ key. supalens is the
-- Authorization Server; issued access/refresh tokens live in api_keys
-- (kinds mcp_access_token / mcp_refresh_token, already defined).
--   oauth_clients     — dynamically-registered clients (RFC 7591, public/PKCE)
--   oauth_auth_codes  — short-lived authorization codes (hashed)
-- Both are service-role only (no anon/authenticated access).
-- =====================================================================

-- link an issued token back to its OAuth client (null for sl_ keys)
alter table api_keys add column if not exists client_id text;

create table if not exists oauth_clients (
  client_id                  text primary key,
  client_secret_hash         text,                                   -- null for public PKCE clients
  redirect_uris              text[] not null,
  client_name                text,
  token_endpoint_auth_method text not null default 'none',
  grant_types                text[] not null default array['authorization_code', 'refresh_token'],
  created_at                 timestamptz not null default now()
);

create table if not exists oauth_auth_codes (
  code_hash      text primary key,                                   -- sha256(code)
  client_id      text not null references oauth_clients(client_id) on delete cascade,
  org_id         uuid not null references organizations(id) on delete cascade,
  user_id        uuid references profiles(id) on delete set null,
  redirect_uri   text not null,
  code_challenge text not null,                                      -- PKCE S256
  scope          text,
  resource       text,                                              -- RFC 8707 resource indicator
  expires_at     timestamptz not null,
  consumed_at    timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists oauth_auth_codes_expiry on oauth_auth_codes (expires_at);

alter table oauth_clients    enable row level security;
alter table oauth_auth_codes enable row level security;
revoke all on oauth_clients, oauth_auth_codes from anon, authenticated;
