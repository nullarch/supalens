# Contributing

Thanks for looking. Bug reports, fixes and small focused features are all welcome.

## Before you start

- For anything larger than a bug fix, open an issue first so we can agree on the shape.
- Security problems go to the address in [SECURITY.md](./SECURITY.md), not to the issue tracker.

## Development

```bash
npm install
cp .env.example .env.local      # fill in sections 1–4
npm run supabase:start          # local Supabase (Docker)
npm run dev                     # http://localhost:3000
npm run trigger:dev             # agents and crons, against your Trigger.dev dev environment
```

Checks that must pass:

```bash
npx tsc --noEmit -p .
npm test
npm run lint
```

`AGENTS.md` is the short map of the codebase; `CLAUDE.md` has the architecture in depth.

## Rules that are easy to break

- **Every new LLM entry point calls `checkUsageQuota`** before running and meters usage after.
- **Files imported by `trigger/*` must not `import 'server-only'`.**
- **The agent sandbox is a security boundary.** Adding a tool or widening an allow-list needs a
  matching change to `src/lib/agent/lockdown.test.ts` and an explanation in the pull request.
- **Hosted-only behaviour is gated on `isCloud()`** (`src/config/edition.ts`). A self-hosted
  install must never show billing, marketing pages, or an anonymous LLM endpoint.
- **UI text goes in `messages/{en,ko,ja}.json`**, all three, never hard-coded.
- **Migrations are append-only.** Never edit one that has been released; add a new one.

## Commits and pull requests

- Commit style: `feat(scope): …`, `fix(scope): …`, `docs: …`, `chore: …`.
- One change per pull request, with a test for any new invariant.
- No Prettier config: match the surrounding file's quote and semicolon style.

## Licence of contributions

Supalens is `AGPL-3.0-only` with one additional permission (see [NOTICE.md](./NOTICE.md)).
By submitting a contribution you agree that:

1. you wrote it, or have the right to submit it;
2. it is licensed to the project and its users under the same terms as the project; and
3. you grant the project maintainers the right to also distribute it under other licence terms,
   so the project can keep offering the hosted service and commercial arrangements from one
   codebase.

Add a `Signed-off-by:` line to your commits (`git commit -s`) to confirm this.
