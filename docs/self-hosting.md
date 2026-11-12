# Self-hosting Supalens

A self-hosted install is the whole product for one team: connect databases, ask questions,
approve KPIs, run monitors, get alerts. No plan limits, no billing, no marketing site.

**You need Docker and an API key for a language model. Nothing else.** The model can be Anthropic
(the default), any OpenAI-compatible provider, or one you run yourself — see
[Model providers](#model-providers). There is no other account to create, and the browser makes
no request to a third party.

The first start builds the app image on your machine, and that build needs memory: give Docker
**at least 6 GB** (Docker Desktop → Settings → Resources). With less, the build is killed part-way
(`exit code: 137`). Running the finished stack takes about 2–3 GB.

## Install

```bash
git clone https://github.com/nullarch/supalens.git && cd supalens
./selfhost.sh
```

The script asks two things — the address people will open and your Anthropic API key (leave it
empty to configure another provider in `.env` afterwards) —
generates every other secret into `.env`, then builds and starts the stack. The first build
takes a few minutes.

Open the address. The first visit shows a one-time setup screen: create the administrator
account and name the workspace. Then connect a database under **Connections**.

**Back up `.env`.** `KEK_LOCAL_MASTER_KEY` in it encrypts every stored database credential. If
it is lost those credentials cannot be recovered.

## What runs

| Container | Role |
|---|---|
| `gateway` | The one published port (Caddy). Routes `/auth/v1` and `/rest/v1` to Supabase, everything else to the app |
| `web` | The app: UI, API, MCP endpoint, **and** the agents and scheduled jobs |
| `db` | Postgres (Supabase's image) — the application database |
| `auth` | Supabase Auth, with public sign-up turned off |
| `rest` | PostgREST |
| `migrate` | Runs once per start, applies new migrations, exits |

About 2–3 GB of memory is comfortable. Data lives in the `db-data` Docker volume.

## Accounts

There is no sign-up page and no social login. Accounts are internal:

- The **first visitor** creates the owner account on the setup screen. That screen never
  appears again once an account exists.
- An owner or admin **creates each further account** under Settings → Team: email, an initial
  password, and a role. Hand the password to the person; they change it under Settings.
- **Forgot a password?** An owner or admin sets a new one under Settings → Team.
- Removing a member deletes their account.

There is one workspace per install. Roles are owner, admin, member and viewer.

## Connecting data

- **PostgreSQL / MySQL** — paste a connection URL or fill in the fields. Create a read-only
  database user for Supalens; queries are also restricted to `SELECT` inside a read-only
  transaction.
- **A database on the same machine** — use the host name `host.docker.internal`.
- **Self-signed certificates and poolers** — choose "SSL — don't verify the certificate".
- **Firestore** — upload a service-account key with `roles/datastore.viewer`.

Databases on private and loopback addresses are allowed by default, because reading internal
databases is what an internal tool is for and every account was created by an admin. If people
you trust less can add sources, set `ALLOW_PRIVATE_DB_HOSTS=false` in `.env` and restart: without
it, a source form is a way to probe your internal network.

## Model providers

Set one of these in `.env` and restart (`docker compose up -d`). No rebuild is needed.

**Anthropic** — the default and the most tested.

```bash
ANTHROPIC_API_KEY=sk-ant-…
```

**Any OpenAI-compatible endpoint** — OpenAI, Google Gemini, OpenRouter, Groq, Azure OpenAI, or a
model you host with Ollama, vLLM or LM Studio.

```bash
LLM_PROVIDER=openai
LLM_BASE_URL=https://api.openai.com/v1     # the provider's OpenAI-compatible base URL
LLM_API_KEY=…                              # empty for a local server
LLM_MODEL=…                                # required: the model that answers questions
LLM_MODEL_SMALL=…                          # optional: a cheaper one for digests and alert explanations
```

| Provider | `LLM_BASE_URL` |
|---|---|
| OpenAI | `https://api.openai.com/v1` |
| Google Gemini | `https://generativelanguage.googleapis.com/v1beta/openai` |
| OpenRouter | `https://openrouter.ai/api/v1` |
| Ollama on the Docker host | `http://host.docker.internal:11434/v1` |

What to expect:

- The model must do **tool calling** reliably: every answer is a loop of "look at the schema, run
  a query, read the result". Large hosted models do; small local models often loop or call tools
  with malformed arguments.
- The prompts were written and tested against Claude. Other models work through the same tools
  and the same read-only guard, but answer quality has been tested far less.
- With a local model nothing leaves your network at all.
- Cost is not tracked for these providers (token counts are).

## Notifications

Paste a **Slack or Discord webhook URL** under Settings → Notifications. That needs no app
registration and is the simplest way to receive alerts.

Email is optional and uses your own mail server. Add to `.env` and restart:

```bash
SMTP_URL=smtp://user:password@mail.example.com:587
EMAIL_FROM="Supalens <bi@example.com>"
```

Without it, nothing claims to send email.

## Running behind your own domain

Set `NEXT_PUBLIC_APP_URL` to the public address (for example `https://bi.example.com`) and
rebuild: `docker compose up --build -d`. Terminate TLS either in your own reverse proxy in front
of the published port, or in the bundled Caddy by replacing `:80` in `selfhost/Caddyfile` with
your domain and publishing port 443.

Your proxy must **overwrite** `X-Forwarded-For` and must not buffer responses: answers stream
as server-sent events.

## Upgrading

```bash
git pull
./selfhost.sh
```

It keeps `.env`, rebuilds, applies new migrations and restarts. Work that was running during the
restart is marked failed and can simply be run again.

## Backups

```bash
docker compose exec db pg_dump -U postgres postgres > supalens-$(date +%F).sql
```

Keep the dump together with a copy of `.env` — the dump is useless without
`KEK_LOCAL_MASTER_KEY`.

## What the built-in task runner does and does not do

Agents, monitor checks (every five minutes), digests and maintenance run inside the `web`
container. That is what makes the install a single command. Know its limits:

- **One instance.** Do not run two `web` containers against one database; scheduled jobs would
  run twice.
- **Not durable.** A restart drops queued and running work.
- **No per-run isolation.** The agent's tool sandbox is unchanged (no shell, no file system
  outside a cloned repository, no network tools), but every run shares one container.
- `SUPALENS_MAX_CONCURRENT_TASKS` (default 4) bounds how many tasks run at once.

## Optional integrations

Each stays hidden in the UI until its variables are set, and each needs an app registered under
**your** account with the provider. `.env.example` lists the variables and callback URLs.

| Integration | What it adds | You register |
|---|---|---|
| GitHub App | Code-aware context and KPI proposals from your repository | A GitHub App (Contents: read) |
| Connect Supabase | One-click connect for Supabase projects | A Supabase OAuth app |
| Slack app | Bot channels and `@mention` answers (webhooks work without it) | A Slack app |
| Sample dataset | A demo source to try | A throwaway Postgres seeded with `demo/seed.sql` |

## Advanced

- **Your own Supabase project** instead of the bundled database:
  `docker-compose.external.yml`. Apply the schema with `npm run db:link && npm run db:push`, and
  turn public sign-up off in the project's Authentication settings.
- **Trigger.dev** instead of the built-in runner, for durable runs and isolation: build with
  `SUPALENS_TASK_BACKEND=trigger`, set `TRIGGER_PROJECT_REF` and `TRIGGER_SECRET_KEY`, add the
  runtime variables to your Trigger.dev project, and run `npm run trigger:deploy` after every
  upgrade.
- **An Anthropic-compatible gateway or proxy**: `ANTHROPIC_BASE_URL`, `HTTPS_PROXY` and
  `NODE_EXTRA_CA_CERTS` are passed through to the agent process.

## Troubleshooting

- **The setup screen does not appear** — an account already exists. Sign in, or reset from
  scratch with `docker compose down -v` (this deletes all data).
- **`web` keeps restarting** — `docker compose logs migrate web`. A failed migration stops the
  app from starting on a half-migrated schema.
- **A source will not connect** — the form explains the common causes. From inside the container
  `localhost` is the container itself; use `host.docker.internal` for the Docker host.
- **Answers do not stream** — a proxy in front is buffering. Disable response buffering for the
  app.
- **Monitors never run** — check `docker compose logs web | grep '\[tasks\]'`; the line
  `built-in backend ready` appears at start.
