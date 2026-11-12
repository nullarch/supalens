# Security policy

## Reporting a vulnerability

Email **admin@supalens.ai** with a description, the affected version or commit, and steps to
reproduce. Please do not open a public issue for a suspected vulnerability.

You will get an acknowledgement within three working days. We will tell you whether we can
reproduce it, what we plan to do, and when a fix is released. We credit reporters unless you ask
us not to.

## Scope

Reports are most useful when they concern the boundaries the product depends on:

- **Tenant isolation** — one organization reading or changing another's data, sources or runs.
- **Read-only access to connected databases** — anything that lets the query path write, or read
  outside the guard (`src/lib/query`).
- **The agent sandbox** — a model or a cloned repository reaching credentials, the network or a
  tool outside the allow-list (`src/lib/agent/lockdown.ts`).
- **Stored credentials** — envelope encryption, the secrets vault, OAuth token handling.
- **Inbound webhooks and OAuth flows** — signature verification, state handling, redirects.

## Running your own install

Operators are responsible for their deployment. The points that matter most:

- Keep `KEK_LOCAL_MASTER_KEY` and `SUPABASE_SERVICE_ROLE_KEY` secret and backed up.
- **Private database hosts are allowed by default on a self-hosted install** (an internal tool
  reads internal databases). That turns the "add a source" form into a way to reach anything the
  server can reach. If people you do not fully trust can add sources, set
  `ALLOW_PRIVATE_DB_HOSTS=false`.
- **The built-in task runner shares one container.** The agent's tool sandbox is the same as on
  the hosted service, but there is no per-run isolation. Build with
  `SUPALENS_TASK_BACKEND=trigger` if you need it.
- Put the web server behind a reverse proxy that overwrites `X-Forwarded-For`; rate limits read
  the first hop.
- Public sign-up is off in the bundled stack: accounts are created inside the app. If you use
  your own Supabase project, turn "Allow new users to sign up" off there yourself.
