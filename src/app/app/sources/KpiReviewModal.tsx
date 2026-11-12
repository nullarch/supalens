"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";

import { BaseModal } from "@/components/modals";
import { listDashboardsForPicker } from "@/lib/dashboards/actions";
import type { DashboardSummary } from "@/lib/dashboards/types";
import type { KpiCatalogRow, KpiExtractionRow } from "@/lib/kpi/types";
import { KpiReviewClient } from "./[id]/kpis/KpiReviewClient";
import s from "./kpi-extract.module.css";

interface Loaded {
  kpis: KpiCatalogRow[];
  extraction: KpiExtractionRow | null;
  canManage: boolean;
  dashboards: DashboardSummary[];
}

/**
 * The KPI review list as a MODAL (was a full page at /app/sources/[id]/kpis). Bootstraps its
 * data client-side in one pass — GET .../kpis (catalog + extraction + canManage) + the dashboards
 * picker list — then hands it to the same KpiReviewClient in `variant="modal"`. The page route
 * still exists as a deep-link fallback (e.g. the sidebar active-jobs indicator links to it).
 */
export function KpiReviewModal({
  sourceId,
  sourceName,
  onClose,
}: {
  sourceId: string;
  sourceName: string;
  onClose: () => void;
}) {
  const t = useTranslations("appKpis");
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setData(null);
    setError(null);
    let cancelled = false;
    (async () => {
      try {
        const [res, dashboards] = await Promise.all([
          fetch(`/api/data-sources/${sourceId}/kpis`),
          listDashboardsForPicker().catch(() => [] as DashboardSummary[]),
        ]);
        if (cancelled) return;
        if (!res.ok) {
          setError(t("loadFailed"));
          return;
        }
        const d = (await res.json()) as {
          kpis?: KpiCatalogRow[];
          extraction?: KpiExtractionRow | null;
          canManage?: boolean;
        };
        if (cancelled) return;
        setData({
          kpis: d.kpis ?? [],
          extraction: d.extraction ?? null,
          canManage: !!d.canManage,
          dashboards,
        });
      } catch {
        if (!cancelled) setError(t("loadFailed"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sourceId, t]);

  return (
    <KpiReviewDialog sourceName={sourceName} onClose={onClose} busy={busy} loading={!data} error={error}>
      {data && <KpiReviewClient
        variant="modal"
        sourceId={sourceId}
        sourceName={sourceName}
        initialKpis={data.kpis}
        initialExtraction={data.extraction}
        dashboards={data.dashboards}
        canManage={data.canManage}
        onBusyChange={setBusy}
      />}
    </KpiReviewDialog>
  );
}

/** The same modal presentation for loaded, loading and failed review states. No data IO. */
export function KpiReviewDialog({ sourceName, onClose, busy = false, loading = false, error = null, children }: {
  sourceName: string;
  onClose: () => void;
  busy?: boolean;
  loading?: boolean;
  error?: string | null;
  children?: ReactNode;
}) {
  const t = useTranslations("appKpis");
  return (
    // Flex the body into the remaining viewport height; long localized titles keep their own space.
    <BaseModal
      open
      onClose={() => { if (!busy) onClose(); }}
      closeDisabled={busy}
      title={t("heading", { name: sourceName })}
      className="flex max-w-6xl flex-col overflow-hidden [&>div:last-of-type]:min-h-0 [&>div:last-of-type]:overflow-y-auto"
    >
      {error ? (
        <p role="alert" className={s.alert}>{error}</p>
      ) : loading ? (
        <div role="status" className={`dx-status ${s.reviewLoading}`}>
          <span className="dx-dot dx-dot-sync" aria-hidden /> {t("loading")}
        </div>
      ) : (
        children
      )}
    </BaseModal>
  );
}
