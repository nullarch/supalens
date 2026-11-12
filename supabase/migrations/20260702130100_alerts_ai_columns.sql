-- AI-native alerts, part 2/2: threshold-less anomaly detection + LLM root-cause explanations.
--
--  * anomaly alerts (type='anomaly') carry NO user threshold — the runner runs a SERIES metric_sql
--    and fires when the latest point is a statistical outlier vs the trailing window. `sensitivity`
--    is the z-score/EWMA cutoff (default ~3.0). Threshold alerts leave it null.
--  * when an alert fires, a root-cause agent run (SUPALENS.md-aware) explains WHY; the explanation is
--    written back onto the firing alert_event.

alter table alerts
  add column sensitivity double precision;   -- anomaly outlier cutoff (z-score / EWMA); null for threshold alerts

alter table alert_events
  add column explanation        text,             -- LLM "why it fired" (root-cause agent output)
  add column explained          boolean not null default false,
  add column explanation_run_id uuid;             -- agent_runs id of the root-cause analysis, if persisted
