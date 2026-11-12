// Non-text metadata per guarantee, in display order. `kicker` names the defense
// layer; `tags` are REAL, locale-independent mechanism identifiers from the
// codebase (envelope.ts, query/execute.ts, agent/lockdown.ts, rls_policies.sql)
// shown as spec chips so the claims read as a verifiable disclosure. Card prose
// (title/body) lives in the `security.items` catalog, merged by index — the same
// const-metadata-merged-by-index pattern as Features.
export const PILLARS: { kicker: string; tags: string[] }[] = [
  { kicker: "ENCRYPTION", tags: ["AES-256-GCM", "per-tenant DEK", "AAD-bound"] },
  { kicker: "ACCESS", tags: ["SELECT-only", "READ ONLY tx", "supalens_ro · OAuth"] },
  { kicker: "RUNTIME", tags: ["env-stripped", "no shell / net", "deny-by-default"] },
  { kicker: "ISOLATION", tags: ["RLS", "1 run = 1 tenant"] },
];
