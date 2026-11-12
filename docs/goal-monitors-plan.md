# Goal monitors — "set a goal, not a threshold"

**Status: BUILT (v1, 2026-09-27), not yet deployed.** Pending ops: apply migration
`20260927110005_goal_monitors.sql` (`db:push`, then `db:types`), `npm run trigger:deploy` (the
`analyze` task gained drafting mode; `evaluate-alerts` / `explain-alert` gained goal evaluation),
then push `main`. Migrate FIRST: before it, drafting runs fail to insert (`agent_runs.channel`
CHECK does not allow `'monitor'` yet) — every read degrades on 42703, so nothing else breaks.

## One line

The operator types a goal ("tell me when daily signups dip"); the read-only analysis agent finds
the data and drafts a monitor — a daily series + a structured rule; the approval card shows the
series, the rule's usual-range edge and **how often this rule would have alerted over the last 90
days**; the operator tunes it with a slider and approves. Nothing is created before approval.

## Why

A hand-picked number (`signups < 50`) is a goal frozen at the moment someone typed it. When the
business grows, the number silently stops meaning anything (signups halve from 500 to 250 and the
monitor stays green). Two structural fixes, no AI tuning needed:

- **Rules that follow the data.** An anomaly rule judges the latest day against a BOUNDED trailing
  window (28 days), so its baseline follows growth; a relative rule compares with a trailing
  average. An absolute number is only used when the operator actually gave one.
- **Approval against evidence.** The backtest turns "is 3σ right?" into "would have alerted twice
  in 90 days (Aug 17, Sep 14)".

Storing the goal (the operator's words) + the rule as data is also the prerequisite for the next
step — AI-proposed condition changes ("loosening this would have cut false alerts 4 → 1") — which
is deliberately NOT in v1 (no customer history to learn from yet).

## Data model (migration `20260927110005`)

- `alerts.goal text` (≤ 500) — the operator's words, the monitor's headline.
- `alerts.condition jsonb` — `src/lib/alerts/condition.ts::MonitorCondition` (zod, `v: 1`):
  - `anomaly {direction: down|up|both, sensitivity σ (1–6), window 8–90}`
  - `relative {direction: down|up, pct (fraction), window 1–90}`
  - `absolute {operator, threshold}`
  `NULL` = legacy monitor, evaluated exactly as before. Goal monitors still write the legacy
  columns (`legacyColumnsFor`: type label + operator/threshold/sensitivity placeholders).
- `agent_runs.channel += 'monitor'` — drafting runs are ordinary metered runs, labelled.
- RLS unchanged (`alerts_sel` / `alerts_write` cover the new columns).

## Evaluation (pure, one seam)

`src/lib/alerts/monitor-eval.ts::evaluateMonitorResult` is the ONLY place a query result becomes a
verdict — the runner, "test now" (`actions.ts::testAlert`) and the recovery check all call it.
For a goal monitor (`condition.ts`):

- **Series contract**: first column = the day, last column = the measure, oldest → newest.
- **In-progress day skipped** (`dropInProgress`): trailing buckets dated ≥ min(today UTC, today in
  the org zone) are dropped. Without this every daily monitor "detects a collapse" each morning
  (a few hours of today vs full days). The legacy anomaly path and the old demo KPI SQL had exactly
  that bug; KPI anomaly alerts now apply as goal conditions and get the fix.
- **anomaly**: signed z of the latest point vs the previous `window` points; a flat baseline gets a
  5%-of-mean noise floor (a metric that sat at exactly 100 does not read 99 as ∞σ).
- **relative**: % change vs the mean of the previous `window` points (zero baseline never fires).
- **backtest** (`backtestCondition`): replays every point through the SAME `decideTransition`
  hysteresis the runner uses and counts firing edges.

## Drafting pipeline (no new LLM entry point)

`POST /api/agent/analyze {intent: 'monitor'}` — same auth, member+ gate (a viewer can't approve),
SQL sources only, `checkUsageQuota`, dedupe, `createAgentRun(channel 'monitor')` → the `analyze`
task with `{intent, goal}` → `runAnalysis({monitorDraft: {goal, timezone}})`, which appends the
TRUSTED `MONITOR_DRAFT_PROMPT` and registers `propose_monitor` (allow-list extended only for that
run; pinned in `lockdown.test.ts`). The local SSE route reads `channel = 'monitor'` for the same.

`propose_monitor` (`src/lib/alerts/draft.ts::validateMonitorProposal`) reads ONLY the in-process
result store: SQL bound from the `queryId` that ran, the series proven evaluable by
`goal-series.ts::checkGoalSeries` (≥ 2 columns, one row per day, **no missing days** — a zero day
must be 0 or a drop to zero can never fire — ends at the latest complete day, enough history for
the rule), and it replies with the backtest so the model can loosen a noisy rule itself. The
goal on the draft is bound by the HOST, never the model. The draft streams as a new
`AnalysisChunk {type: 'monitor_draft'}` and persists as `agent_runs.result.monitor_draft`.

Accuracy is structural (same stance as KPI extraction / X-ray): every number the approval card
shows — usual range, latest value, backtest — is computed by code from the draft's sample.

## Surfaces

- `/app/monitors`: "+ New monitor" opens the goal composer (`goal/GoalComposer.tsx`); KPI / Ask /
  SQL moved under "Other ways". `?new=goal[&goal=&source=]` prefills, `?draft=<runId>` reopens a
  persisted draft. Approval card: `goal/DraftCard.tsx` (+ `SeriesBandChart`, `ConditionControls`,
  pure `draft-view.ts`). Rows show `Goal: “…”` and the rule in short form; the inline editor edits
  the rule with the same controls.
- Monitor detail: goal + rule sentence (`condition-label.ts`). Incidents: graded by the structured
  rule (`incidents.ts::gradingRow`), relative rules state their rule instead of a fake "≥ 0".
- Email: goal line under the monitor name; relative rules get their own message. The root-cause
  agent receives the goal.
- MCP `create_alert` accepts `goal` + `condition`, runs the metric once, applies the same series
  check and returns the backtest; `list_alerts` returns goal/condition.
- Auto-KPI: `KpiAlertConfig.direction`; anomaly KPIs apply as goal conditions (window 28).
- i18n: `appMonitors.goal.*`, `appCondition.*` (shared rule wording), `alertActions`, `emailAlert`.

## Local tools

- Design fixture without LLM/DB: `/dev/monitors?mode=goal` (approval card), `?mode=goal-composer`,
  `?mode=mixed` (goal rows in the list).
- Real drafting against the demo DB, no app DB / Trigger:
  `npx tsx --env-file=.env.local scripts/goal-draft-local.ts "tell me when daily signups dip" --locale ko --tz Asia/Seoul`
  (verified 2026-09-27: dip → anomaly down; "30% below last week" → relative 0.3/7; "above 200" →
  absolute gt 200; "failed payments spike" → anomaly up; ≈ $0.07–0.14 per draft).

## v2 backlog

- Hourly buckets (v1 is daily only — goal monitors are judged once per completed day).
- Weekday seasonality (compare with the same weekday) for strongly weekly metrics.
- AI-proposed condition changes from `ack_kind = 'expected'` / snooze / never-fired signals, as a
  diff + backtest comparison — the loop this data model was built for.
- "Turn into monitor" from /app/ask still opens the SQL form (an answer is a question, not a goal).
