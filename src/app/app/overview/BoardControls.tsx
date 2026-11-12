"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { Select } from "@/components/ui/Select";
import { setHomeDashboard } from "@/lib/dashboards/actions";
import s from "./overview.module.css";

/** The picker's value for "no choice — use the automatic rule". Not a valid board id. */
const AUTO = "__auto__";

export interface BoardControlsProps {
  boards: { id: string; name: string }[];
  /** The live board the workspace chose for the Overview; null = Automatic. */
  chosenId: string | null;
  /** The board on screen, opened for editing on its own page. */
  openSlug: string;
  /** owner/admin, and the home column exists. Everyone else reads the choice in the lede. */
  canSetHome: boolean;
  labels: { picker: string; pickerShort: string; auto: string; open: string; saving: string; saved: string };
}

/**
 * The Overview's title-row controls: WHICH dashboard this page shows (a saved workspace setting,
 * not a temporary view — every board is one click away in the sidebar), and open it to edit.
 * "Automatic" keeps following the rule (the AI-drafted core-KPI board, else the first favorite,
 * else the first board), so a workspace that never chooses still gets the board the AI built.
 */
export function BoardControls({ boards, chosenId, openSlug, canSetHome, labels }: BoardControlsProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ error: boolean; text: string } | null>(null);
  const value = chosenId && boards.some((b) => b.id === chosenId) ? chosenId : AUTO;
  return (
    <div className={s.boardControls}>
      {canSetHome && boards.length > 0 && (
        <span className={s.picker}>
          <span className={s.pickerLabel} aria-hidden>{labels.pickerShort}</span>
          <Select
            value={value}
            disabled={pending}
            onValueChange={(next) => {
              if (next === value) return;
              setStatus(null);
              startTransition(async () => {
                const result = await setHomeDashboard(next === AUTO ? null : next);
                if (result.ok) {
                  setStatus({ error: false, text: labels.saved });
                  router.refresh();
                } else setStatus({ error: true, text: result.message ?? result.reason });
              });
            }}
            options={[{ value: AUTO, label: labels.auto }, ...boards.map((b) => ({ value: b.id, label: b.name }))]}
            ariaLabel={labels.picker}
            className={s.pickerTrigger}
            size="sm"
          />
        </span>
      )}
      <Link href={`/app/dashboards/${openSlug}`} className="dx-btn-ghost dx-btn-sm">
        {labels.open}
      </Link>
      {pending && <p className="sr-only" role="status">{labels.saving}</p>}
      {status && (
        <p className={status.error ? s.controlsError : "sr-only"} role={status.error ? "alert" : "status"}>
          {status.text}
        </p>
      )}
    </div>
  );
}
