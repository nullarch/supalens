# Repository Guidelines

## Project Structure & Module Organization

Supalens is a Next.js 15/React 19 application for AI-assisted data monitoring and analysis.

- `src/app/`: App Router pages, layouts, and API routes; authenticated screens live under `app/`.
- `src/components/`: shared UI; `src/lib/`: domain logic; `src/utils/supabase/`: database clients and generated types.
- `trigger/`: background tasks. `supabase/migrations/`: timestamped SQL migrations.
- `messages/`: English, Korean, and Japanese translations; `public/`: static assets.
- `e2e/`: browser tests, fixtures, and page objects. Unit tests sit beside source files.
- `docs/`: setup and architecture notes; `video/`: separate Remotion package.

## Build, Test, and Development Commands

Use npm; CI uses Node.js 20.

- `npm ci`: install locked dependencies.
- `npm run dev`: start Turbopack development at `localhost:3000`.
- `npm run build` / `npm start`: build and serve production.
- `npm run lint`: run Next.js ESLint checks.
- `npm test` / `npm run test:watch`: run Vitest once or continuously.
- `npm run test:e2e`: run Playwright; starts the app on port 2000. Requires Docker and Chromium (`npx playwright install chromium`).
- `npm run supabase:start`: start local Supabase; `npm run trigger:dev`: develop background tasks.
- `npm run db:new -- descriptive_name`: create a migration; regenerate schema types afterward with `npm run db:types`.

## Coding Style & Naming Conventions

Use strict TypeScript, two-space indentation, and `@/` imports for `src/`. Match surrounding quote and semicolon styles; no Prettier configuration is present. Use PascalCase for React components, camelCase for functions, and kebab-case for domain modules. Preserve App Router filenames such as `page.tsx` and `route.ts`. Reuse existing UI components and CSS Modules. ESLint extends Next.js Core Web Vitals and TypeScript rules.

## Testing Guidelines

Vitest discovers `src/**/*.test.ts`; run a focused test with `npx vitest run src/lib/query/guard.test.ts`. Live database tests use `*.integration.test.ts` and require `TEST_PG_URL` or `TEST_MYSQL_URL`. No coverage threshold is configured.

Place Playwright tests in `e2e/tests/**/*.spec.ts`. Use `e2e/fixtures` for automatic test-data cleanup. See `E2E.md` for setup.

## Commit & Pull Request Guidelines

Follow history’s `feat(scope): description`, `fix(scope): description`, and `chore:`/`docs:` patterns; scopes are optional. Keep commits focused. PRs should describe behavior changes, link relevant issues, report validation, and include screenshots for UI changes. E2E CI runs for PRs targeting `main`.

## Security & Configuration Tips

Use `.env.example` to configure `.env.local`; never commit credentials. Keep service-role clients server-side. `db:types` and `db:link` target `SUPABASE_PROJECT_REF`; `db:push` changes the remote database. Integration setup is in `.env.example` and `docs/self-hosting.md`.
