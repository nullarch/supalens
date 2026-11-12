"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createDraftDashboard } from "./actions";
import s from "./overview.module.css";

/** Builds the draft home dashboard, then re-renders the overview with it. */
export function DraftBoardButton({ dataSourceId, label, pendingLabel }: { dataSourceId: string; label: string; pendingLabel: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="dx-btn dx-btn-sm"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await createDraftDashboard(dataSourceId);
            if (result.ok) router.refresh();
            else setError(result.message ?? result.reason);
          });
        }}
      >
        {pending ? pendingLabel : label}
      </button>
      {error && <p className={s.emptyError} role="alert">{error}</p>}
    </>
  );
}
