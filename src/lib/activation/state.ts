/**
 * Activation state — the io shell around `logic.ts`.
 *
 * Takes a Supabase client instead of creating one so it works with BOTH the user-JWT
 * client (RLS-scoped, `/app` pages) and the service-role admin client (Trigger crons,
 * lifecycle emails). Deliberately NOT `server-only` for that reason (see the comment
 * convention in `src/utils/supabase/admin.ts`).
 *
 * Demo sources are excluded at the source-id level so a demo-only org never reads as
 * "connected" — the contract `logic.ts` relies on.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  computeActivation,
  isMissingSchemaError,
  type ActivationInputs,
  type ActivationState,
} from "./logic";

type Client = Pick<SupabaseClient, "from">;

function describe(error: unknown): string {
  const e = error as { message?: unknown; code?: unknown } | null | undefined;
  const msg = typeof e?.message === "string" ? e.message : String(error);
  return e?.code ? `${msg} (${String(e.code)})` : msg;
}

/**
 * Read one count.
 *
 * A pre-migration schema (undefined table/column) degrades to 0 — the code may ship
 * before its migration. ANY other error THROWS: a transient fault read as 0 means
 * "step not done", which makes the lifecycle sweep email a false nudge and spend its
 * one-shot dedupe key on it. Callers that render a page let it reach the /app error
 * boundary; the sweep catches it and skips the org.
 */
async function countOf(
  label: string,
  q: PromiseLike<{ count: number | null; error: unknown }>,
): Promise<number> {
  const { count, error } = await q;
  if (error) {
    if (isMissingSchemaError(error)) return 0;
    throw new Error(`activation: ${label} count failed — ${describe(error)}`);
  }
  return count ?? 0;
}

export async function getActivationInputs(
  client: Client,
  orgId: string,
): Promise<ActivationInputs> {
  const { data: sources, error: sourcesError } = await client
    .from("data_sources")
    .select("id, repo_id")
    .eq("org_id", orgId)
    .eq("is_demo", false)
    .eq("status", "active")
    .is("deleted_at", null);
  if (sourcesError && !isMissingSchemaError(sourcesError)) {
    throw new Error(`activation: sources read failed — ${describe(sourcesError)}`);
  }

  const rows = (sources ?? []) as Array<{ id: string; repo_id: string | null }>;
  const ids = rows.map((r) => r.id);
  const reposAttached = rows.filter((r) => r.repo_id).length;

  const [
    contextsGenerated,
    kpisProposed,
    kpisAccepted,
    monitorsEnabled,
    slack,
    channels,
    legacyWebhook,
  ] = await Promise.all([
    ids.length
      ? countOf(
          "contexts",
          client
            .from("data_source_context")
            .select("data_source_id", { count: "exact", head: true })
            .in("data_source_id", ids)
            .in("status", ["fresh", "stale"]),
        )
      : 0,
    ids.length
      ? countOf(
          "kpis",
          client
            .from("kpi_catalog")
            .select("id", { count: "exact", head: true })
            .in("data_source_id", ids),
        )
      : 0,
    ids.length
      ? countOf(
          "accepted kpis",
          client
            .from("kpi_catalog")
            .select("id", { count: "exact", head: true })
            .in("data_source_id", ids)
            .eq("status", "accepted"),
        )
      : 0,
    ids.length
      ? countOf(
          "enabled monitors",
          client
            .from("alerts")
            .select("id", { count: "exact", head: true })
            .eq("org_id", orgId)
            .eq("enabled", true)
            .is("deleted_at", null)
            .in("data_source_id", ids),
        )
      : 0,
    countOf(
      "slack connection",
      client
        .from("provider_connections")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("provider", "slack")
        .eq("status", "active")
        .is("deleted_at", null),
    ),
    countOf(
      "notification channels",
      client
        .from("notification_channels")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("enabled", true)
        .is("deleted_at", null),
    ),
    // owner/admin-only RLS: a member's client simply sees 0 here, which is fine.
    countOf(
      "legacy slack webhook",
      client
        .from("org_slack_config")
        .select("org_id", { count: "exact", head: true })
        .eq("org_id", orgId),
    ),
  ]);

  return {
    realActiveSources: ids.length,
    reposAttached,
    contextsGenerated,
    kpisProposed,
    kpisAccepted,
    monitorsEnabled,
    slackConnected: slack > 0,
    alertChannelConfigured: channels > 0 || legacyWebhook > 0,
  };
}

export async function getActivationState(
  client: Client,
  orgId: string,
): Promise<ActivationState> {
  return computeActivation(await getActivationInputs(client, orgId));
}

/**
 * Count rows matching a query, without fetching them.
 *
 * Same error contract as the activation counts (pre-migration schema → 0, everything
 * else throws), exported so surfaces outside this module stop selecting rows just to
 * take their `.length`.
 */
export async function countRows(
  label: string,
  q: PromiseLike<{ count: number | null; error: unknown }>,
): Promise<number> {
  return countOf(label, q);
}
