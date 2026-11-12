"use client";

import { ReportsIndex, type ReportListActions } from './ReportsIndex';
import type { DashboardSummary } from '@/lib/dashboards/types';

const EMPTY_REPORTS: DashboardSummary[] = [];

/**
 * Reports empty state. The primary path is NOT "build a board by hand" — approving the KPI
 * proposals creates the pinned "핵심 KPI" report (chart + definition + monitor) in one step,
 * so that is the emphasised action and the blank board is the ghost fallback.
 */
export function EmptyDashboards({ actions }: { actions?: ReportListActions }) {
  return <ReportsIndex dashboards={EMPTY_REPORTS} actions={actions} emptyState />;
}
