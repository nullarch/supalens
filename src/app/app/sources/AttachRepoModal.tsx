"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { BaseModal, ModalButton } from "@/components/modals";
import { suggestRepos } from "@/lib/github-app/suggest";
import s from "./AttachRepoModal.module.css";

export interface AttachRepoOption {
  id: string;
  /** GitHub's own "owner/repo" — already discloses which connected org this came from. */
  fullName: string;
  defaultBranch: string;
}

export interface AttachTarget {
  id: string;
  name: string;
  attachedRepoId: string | null;
}

/** What the PATCH route reports back when it could not queue the context regeneration. */
type ContextSkip = "context_limit" | "quota_exceeded";

/** GitHub's mark (octicon mark-github, MIT) — names the place the code comes from. */
function GithubMark() {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="7" width="10" height="6.5" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

/**
 * One modal for the whole "give this data source its code" step.
 *
 * Connecting GitHub and attaching a repo used to be two separate moves — the modal only said
 * "no repos, go connect", and the user came back to a bare dropdown. Here the install CTA and
 * the repo picker are the same step: with no installation the modal IS the install prompt, and
 * the OAuth round-trip returns to `?attach=<sourceId>` so this modal reopens on the same source.
 *
 * The install path is the GitHub App (installation tokens). A login token must never clone —
 * see docs/github.md §2.
 */
export function AttachRepoModal({
  source,
  repos,
  githubAppUrl,
  mapError,
  onClose,
  onSaved,
}: {
  /** null closes the modal. */
  source: AttachTarget | null;
  repos: AttachRepoOption[];
  /**
   * The App's public github.com page, resolved on the server from GITHUB_APP_SLUG (this is a
   * client component — it must not import the server env config). null when the App isn't
   * configured, and the request-install link is then hidden rather than rendered broken.
   */
  githubAppUrl: string | null;
  /**
   * Turns a route error CODE into a localized sentence. Passed in rather than imported so this
   * component doesn't have to reach back into SourcesClient (which imports it) for the list.
   */
  mapError?: (code: string) => string | undefined;
  onClose: () => void;
  onSaved: (result: { contextSkipped: ContextSkip | null }) => void;
}) {
  const t = useTranslations("appSources");
  // The schema-only caveat is the wizard's copy — one sentence, one place to keep true.
  const tw = useTranslations("appWizard");

  const [selected, setSelected] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const open = source != null;

  useEffect(() => {
    if (!source) return;
    setSelected(source.attachedRepoId ?? "");
    setQuery("");
    setErr(null);
  }, [source]);

  const suggested = useMemo(
    () => (source ? suggestRepos(source.name, repos) : []),
    [source, repos],
  );
  const suggestedIds = useMemo(() => new Set(suggested.map((r) => r.id)), [suggested]);

  const rest = useMemo(() => {
    const q = query.trim().toLowerCase();
    return repos
      .filter((r) => !suggestedIds.has(r.id))
      .filter((r) => (q ? r.fullName.toLowerCase().includes(q) : true));
  }, [repos, suggestedIds, query]);
  const visibleIds = [...suggested, ...rest].map(repo => repo.id);
  const tabStop = selected === '' || visibleIds.includes(selected) ? selected : (visibleIds[0] ?? '');

  // ?attach=<id> round-trips through the authorize returnTo so the post-install redirect
  // reopens this modal on the same source (see the connected effect in SourcesClient).
  const connectHref = `/api/connect-github/authorize?returnTo=${encodeURIComponent(
    `/app/sources?attach=${source?.id ?? ""}`,
  )}`;

  async function save() {
    if (!source || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/data-sources/${source.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId: selected || null }),
      });
      const d = (await res.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
        contextGenerationSkipped?: ContextSkip;
      };
      if (!res.ok) {
        const known = d.error ? mapError?.(d.error) : undefined;
        throw new Error(known ?? d.message ?? t("attach.failed", { status: res.status }));
      }
      onSaved({ contextSkipped: d.contextGenerationSkipped ?? null });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const scopeBlock = (
    <div className={s.scope}>
      <span className={s.scopeIcon} aria-hidden>
        <LockIcon />
      </span>
      <span className={s.scopeText}>
        <code className={s.scopeCode}>{t("attach.scope")}</code>
        <span className={s.scopeNote}>{t("attach.scopeNote")}</span>
      </span>
    </div>
  );

  function repoRow(r: AttachRepoOption) {
    const on = selected === r.id;
    return (
      <button
        key={r.id}
        type="button"
        role="radio"
        aria-checked={on}
        tabIndex={tabStop === r.id ? 0 : -1}
        disabled={busy}
        className={`${s.repo} ${on ? s.repoOn : ""}`}
        onClick={() => setSelected(r.id)}
      >
        <span className={s.repoMark} aria-hidden>{on ? <CheckIcon /> : null}</span>
        <span className={s.repoText}>
          <span className={s.repoName}>{r.fullName}</span>
          <span className={s.repoBranch}>{t("attach.branch", { branch: r.defaultBranch })}</span>
        </span>
      </button>
    );
  }

  return (
    <BaseModal
      open={open}
      closeDisabled={busy}
      onClose={() => {
        if (!busy) onClose();
      }}
      size="md"
      className="max-w-[560px]"
      title={t("attach.modalTitle")}
      description={t("attach.modalDescription")}
    >
      {repos.length === 0 ? (
        /* No installation yet (or one with no repos granted): install IS the step. */
        <div className={s.wrap}>
          <div className={s.install}>
            <span className={s.installMark} aria-hidden>
              <GithubMark />
            </span>
            <span className={s.installTitle}>{t("attach.installTitle")}</span>
            <p className={s.installBody}>{t("attach.installBody")}</p>
            {scopeBlock}
            <Link href={connectHref} className={`dx-btn ${s.installCta}`}>
              {t("attach.installCta")}
            </Link>
          </div>
          {githubAppUrl ? (
            <p className={s.noAdmin}>
              {t("attach.noAdmin")}{" "}
              <a href={githubAppUrl} target="_blank" rel="noreferrer noopener" className={s.link}>
                {t("attach.noAdminCta")}
              </a>
            </p>
          ) : null}
          <p className={s.limit}>{tw("act3.limit")}</p>
          <div className={s.actions}>
            <ModalButton variant="ghost" onClick={onClose}>
              {tw("act3.later")}
            </ModalButton>
          </div>
        </div>
      ) : (
        <div className={s.wrap}>
          <div role="radiogroup" aria-label={t("attach.modalTitle")} className={s.picker}
            onKeyDown={event => {
              if (!(event.target instanceof HTMLElement) || event.target.getAttribute('role') !== 'radio') return;
              if (!['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
              event.preventDefault();
              const radios = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)'));
              const current = radios.indexOf(event.target as HTMLButtonElement);
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? radios.length - 1 : (current + (event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1) + radios.length) % radios.length;
              radios[next]?.focus();
              radios[next]?.click();
            }}>
          {suggested.length > 0 && source ? (
            <div className={s.group}>
              <span className={s.groupLabel}>{t("attach.suggested", { name: source.name })}</span>
              <div className={s.rows}>{suggested.map((r) => repoRow(r))}</div>
            </div>
          ) : null}

          <div className={s.group}>
            <div className={s.groupHead}>
              <span className={s.groupLabel}>{t("attach.allRepos")}</span>
              {repos.length > 6 ? (
                <input
                  type="search"
                  className={s.search}
                  value={query}
                  disabled={busy}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label={t("attach.searchLabel")}
                  placeholder={t("attach.searchPlaceholder")}
                />
              ) : null}
            </div>
            <div className={`${s.rows} ${s.list}`}>
              {rest.length > 0 ? (
                rest.map((r) => repoRow(r))
              ) : (
                <p className={s.empty}>{t("attach.noMatches", { query: query.trim() })}</p>
              )}
            </div>
          </div>

          <button
            type="button"
            role="radio"
            aria-checked={selected === ""}
            tabIndex={tabStop === '' ? 0 : -1}
            disabled={busy}
            className={`${s.repo} ${s.detach} ${selected === "" ? s.repoOn : ""}`}
            onClick={() => setSelected("")}
          >
            <span className={s.repoMark} aria-hidden>{selected === "" ? <CheckIcon /> : null}</span>
            <span className={s.repoText}>
              <span className={s.detachName}>{t("attach.detach")}</span>
            </span>
          </button>
          </div>

          {scopeBlock}

          <details className={s.advanced}>
            <summary className={s.advancedSummary}>
              <span className={s.advancedChevron}>
                <ChevronIcon />
              </span>
              {t("attach.advanced")}
            </summary>
            <p className={s.advancedBody}>{t("attach.advancedBody")}</p>
          </details>

          <Link href={connectHref} className={s.link} aria-disabled={busy} onClick={event => { if (busy) event.preventDefault(); }}>
            <GithubMark />
            {t("attach.connectAnotherOrg")}
          </Link>

          {err ? <div className={s.err} role="alert">{err}</div> : null}

          <div className={s.actions}>
            <ModalButton variant="ghost" onClick={onClose} disabled={busy}>
              {t("attach.cancel")}
            </ModalButton>
            <ModalButton onClick={save} disabled={busy}>
              {busy ? t("attach.saving") : t("attach.save")}
            </ModalButton>
          </div>
        </div>
      )}
    </BaseModal>
  );
}
