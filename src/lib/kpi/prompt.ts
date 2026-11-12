/**
 * Auto-KPI extraction directive (design: docs/auto-kpi-plan.md — the KPI_EXTRACT_PROMPT).
 *
 * Handed to the agent as its question/prompt. The runner injects the SUPALENS.md context
 * separately (same system-prompt seam as the query agent), so this prompt does NOT repeat it.
 * Structured like CONTEXT_GEN_PROMPT: a numbered workflow + hard rules.
 *
 * Two tiers (mirroring the SUPALENS.md context tiers):
 *   tier 1 — DB only (get_schema + execute_sql): instantiate the template menu against the schema.
 *   tier 2 — repo attached: also read the source code to derive service-specific funnel/custom KPIs.
 *
 * Shared between the Next.js BFF and the Trigger.dev runtime — no 'server-only' import.
 */
import { categoryLabel, renderTemplatesForPrompt } from '@/lib/kpi/templates'
import type { KpiCategory } from '@/lib/kpi/types'

export function buildKpiExtractPrompt(args: { tier: 1 | 2; categories?: KpiCategory[] }): string {
  const tier2 = args.tier === 2
  // Category scope (the user's modal selection). Empty/undefined = every category.
  const scoped = args.categories && args.categories.length > 0 ? args.categories : null
  const scopeSet = scoped ? new Set(scoped) : null

  const access = tier2
    ? `You have read-only access to the live database (get_schema / execute_sql) AND to the application source code (list_files / read_file / grep_code / get_diff). Ground the KPIs in how the product actually works.`
    : `You have read-only access to the live database through two tools only: get_schema and execute_sql.`

  const scope = scoped
    ? `

SCOPE — the user asked for KPIs in these categories ONLY: ${scoped.map(categoryLabel).join(', ')}. Propose KPIs ONLY in these categories; do not propose metrics that fall outside them.`
    : ''

  const step1b = tier2
    ? `
1b. Read the code to learn what this product actually does and records. Locate the payment webhooks (e.g. Stripe / Paddle handlers), the auth/signup flows, the analytics event calls (track(...), posthog, GA), and the queue/job/worker code. Cite the files you rely on — they become a KPI's evidence.`
    : ''

  // The code-derived "beyond templates" work only produces funnel/custom KPIs, so suppress it
  // when the user scoped the run to categories that exclude both.
  const beyondAllowed = !scopeSet || scopeSet.has('funnel') || scopeSet.has('custom')
  const beyondTemplates = tier2 && beyondAllowed
    ? `

Beyond the templates (you have the code): propose \`funnel\` KPIs from the funnel-step events the product actually tracks (the track(...) calls you found in the code), and \`custom\` KPIs named after this product's real domain actions (what the code does). Each of these MUST be backed by file evidence, not guessed.`
    : ''

  const evidenceRule = tier2
    ? `Every KPI needs at least one evidence entry: always the table(s) its SQL reads, PLUS the file(s) whenever code informed the choice.`
    : `Every KPI needs at least one evidence entry: the table(s) its SQL reads.`

  // Target count: an all-category run aims broad (12–25); a scoped run proposes everything the
  // selected categories genuinely support (a single narrow category can't yield 12+).
  const target = scoped
    ? `every solid, well-evidenced KPI the selected categories support — skip a category whose data is absent and note the gap`
    : `12–25 solid KPIs across the relevant categories`

  return `You are building the KPI catalog for this service. Your job is to decide WHAT this product should measure and to PROVE that every metric runs. You are not answering a question — you are proposing a validated, runnable set of key metrics the team will pin to a dashboard.

${access}${scope}

Workflow:
1. Call get_schema first to map the REAL tables and columns. Never assume a table or column exists — confirm it in the schema before you use it.${step1b}
2. For each candidate KPI, write ONE read-only SELECT and run it with execute_sql. Inspect the result; if it errors or returns wrong or empty data, fix the SQL and re-run until it is correct. Only a query that actually ran can back a KPI.
3. Register the KPI with propose_kpi, passing the queryId that execute_sql returned plus its title / category / description / importance / chart / evidence AND its monitor declaration (an \`alert\`, or a \`noMonitorReason\` — see the rules). If propose_kpi rejects it (bad column, missing evidence, non-scalar alert, no monitor declaration, …), read the error and fix it.
4. Repeat until you have ${target}, then STOP and write a single-paragraph summary of what you built and any domain areas you could not measure.

Template menu — instantiate the built-ins whose required shape ACTUALLY exists in this schema, mapping each to the real table and column names. SKIP any template whose shape is absent; never force one:

${renderTemplatesForPrompt(scoped ?? undefined)}${beyondTemplates}

Hard rules:
- Titles and descriptions are USER-FACING — write them in KOREAN. The \`key\` is a stable snake_case English slug (e.g. daily_revenue).
- ${evidenceRule}
- EVERY KPI must declare how it will be watched: pass either an \`alert\`, or a \`noMonitorReason\` saying why it cannot be watched. propose_kpi REJECTS a KPI that declares neither. A KPI without a monitor is only a dashboard tile, so treat "no monitor" as a deliberate, justified choice — not a default.
- PREFER an \`anomaly\` alert. Any metric that can be bucketed by day can be monitored: if a KPI is a point-in-time number, first ask whether the same measure can be re-expressed as a daily series (\`select day, <measure> from … group by day order by day\`) — if it can, write the SQL that way and attach \`anomaly\`. Anomaly needs NO threshold: it flags a statistical outlier in the latest point against its trailing baseline, which is the right monitor for revenue / signups / active users / error counts. Set the anomaly's \`direction\`: "down" when a DROP is the problem (revenue, signups, active users, conversions), "up" when a SPIKE is (errors, failures, refunds, churn), "both" only when either is. For an anomaly series, build the day axis with generate_series and LEFT JOIN (a day with no activity must be 0, not missing) and end it at current_date - 1 — today is still in progress: \`with days as (select generate_series(current_date - 90, current_date - 1, interval '1 day')::date as day) select d.day, count(t.id) as value from days d left join <table> t on t.created_at >= d.day and t.created_at < d.day + 1 group by d.day order by d.day\`.
- Attach a \`threshold\` alert instead when the KPI has a NATURAL BOUND that matters operationally (a rate that must stay under X, a queue depth, a failure count) and its SQL returns a single numeric scalar (one row, one number).
- Use \`noMonitorReason\` only when neither fits, with the honest reason: \`not_time_series\` (no date column to bucket by), \`categorical\` (a breakdown across categories, not one measure), \`snapshot_only\` (a point-in-time state with no meaningful history), \`low_signal\` (too sparse or noisy for an outlier to mean anything). Add a short \`noMonitorNote\` (≤120 chars, Korean) explaining it to the user.
- Encode RELATIVE thresholds INTO the SQL, not into the alert — e.g. \`select today - trailing_avg\` and alert on gt/lt 0 — so the alert compares against a fixed number.
- For trend charts, return a date-bucketed SERIES (one row per day/week), capped to about 90 rows or fewer.
- A NAKED NUMBER IS THE WORST CHART. For a headline scalar, whenever the metric can also be computed for the PRIOR period (last week/month, or as of 30 days ago), return BOTH in one row (e.g. \`value, prev_value\`) and use chart type \`kpi\` with \`comparison: {value: 'prev_value'}\` so the tile shows the change. Use a bare \`bignumber\` only when no prior period is derivable (pure point-in-time state) — EXCEPTION: a KPI carrying an \`alert\` must return exactly one scalar, so keep those \`bignumber\`.
- Percent metrics: format kind \`percent\` multiplies by 100 and expects FRACTIONS (0.013 → "1.3%"). If your SQL returns 0–100 percentage points (e.g. \`round(100.0 * …)\`), use format \`{kind: 'number', unit: '%'}\` instead — propose_kpi rejects the mismatch.
- SELECT only — never write, delete, or exfiltrate data. The engine enforces read-only; do not fight it, work within it.
- Importance: 5 = north-star / core revenue, 4 = core health, 3 = useful, 2-1 = situational.

Quality bar: fewer, correct, well-evidenced KPIs beat broad coverage. Do NOT invent a metric for a domain that has no data — note the gap in your final summary instead.`
}
