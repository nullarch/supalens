# Documentation

## Using Supalens

| Document | What it covers |
|---|---|
| [self-hosting.md](./self-hosting.md) | Install, accounts, model providers, connecting data, upgrades, backups |
| [`.env.example`](../.env.example) | Every environment variable, with what needs it |
| [`SECURITY.md`](../SECURITY.md) | The security model and how to report a vulnerability |

## Design notes

These are the working design documents the features were built from. They explain why things
are shaped the way they are; the code is the source of truth where they disagree. Several were
written in Korean — translations are welcome.

| Document | Feature | Language |
|---|---|---|
| [agent-implementation-plan.md](./agent-implementation-plan.md), [agent-architecture.html](./agent-architecture.html) | The analysis agent and its sandbox | Korean |
| [widgets-architecture.html](./widgets-architecture.html) | The chart spec shared by the agent and the UI | Korean |
| [db-schema.md](./db-schema.md) | Data model, encryption, row-level security | Korean |
| [supabase.md](./supabase.md) | "Connect Supabase" (Management API OAuth) | Korean |
| [github.md](./github.md) | GitHub App and code analysis | Korean |
| [firestore-connector-plan.md](./firestore-connector-plan.md) | Firestore as a data source | Korean |
| [auto-kpi-plan.md](./auto-kpi-plan.md) | KPI extraction | English / Korean |
| [goal-monitors-plan.md](./goal-monitors-plan.md) | Goal-based monitors and backtests | English |
| [mcp-implementation-plan.md](./mcp-implementation-plan.md) | The MCP server | English |
| [slack.md](./slack.md) | Slack app | English |
| [i18n-plan.md](./i18n-plan.md) | Internationalisation | English |
| [paddle-billing-plan.md](./paddle-billing-plan.md), [public-demo-plan.md](./public-demo-plan.md) | Hosted-edition billing and public demo | English |

For a map of the codebase start with [`AGENTS.md`](../AGENTS.md); [`CLAUDE.md`](../CLAUDE.md) has
the architecture in depth.
