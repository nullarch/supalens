"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Menu } from "lucide-react";
import ActiveJobsIndicator from "./ActiveJobsIndicator";
import s from "./Shell.module.css";

/* Mobile-only bar (≤900px): the menu button — the only way to open the drawer — and
   the wordmark. Desktop pages have no top bar: each page owns
   its title row. */
export default function AppTopbar({
  onMenu,
  menuOpen,
  menuButtonId,
  navigationId,
  mobile,
}: {
  onMenu: () => void;
  menuOpen: boolean;
  menuButtonId: string;
  navigationId: string;
  mobile: boolean;
}) {
  const t = useTranslations("appChrome");

  return (
    <header className={s.topbar}>
      <button
        id={menuButtonId}
        className={s.menuButton}
        type="button"
        onClick={onMenu}
        aria-label={t("topbar.menu")}
        aria-expanded={menuOpen}
        aria-controls={navigationId}
        aria-haspopup="dialog"
      >
        <Menu size={18} strokeWidth={2} aria-hidden />
      </button>
      <Link href="/app/overview" className={s.topbarBrand}>
        <span className={s.wordmark}>Supalens</span>
      </Link>
      <div className={s.topbarRight}>{mobile && <ActiveJobsIndicator placement="bar" />}</div>
    </header>
  );
}
