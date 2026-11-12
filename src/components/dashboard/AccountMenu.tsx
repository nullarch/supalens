"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, LogOut, Moon, Plus, Sun } from "lucide-react";
import { isCloud } from "@/config/edition";
import type { AppChrome } from "@/lib/dashboards/types";
import { setActiveOrg } from "@/lib/org/actions";
import { useMenu } from "./useMenu";
import s from "./Shell.module.css";

/* The sidebar foot: one account row (avatar + email) that
   opens a small menu upward. It holds Terms, Privacy and Log out, plus the organization
   switcher and the theme toggle, so the rail itself stays uncluttered. */
export default function AccountMenu({
  user,
  org,
  orgs,
  buttonId,
  onNewOrg,
  onNavigate,
}: {
  user: AppChrome["user"];
  org: AppChrome["org"];
  orgs: AppChrome["orgs"];
  buttonId: string;
  onNewOrg: () => void;
  onNavigate?: () => void;
}) {
  const t = useTranslations("appChrome");
  const common = useTranslations("appCommon");
  const router = useRouter();
  const menu = useMenu<HTMLButtonElement>();
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* private mode — the theme still applies to this page */
    }
    setTheme(next);
  }

  async function onSwitch(orgId: string) {
    menu.close();
    if (orgId === org?.id) return;
    await setActiveOrg(orgId);
    onNavigate?.();
    router.refresh();
  }

  const label = user?.email || user?.name || t("user.fallbackName");

  return (
    <div className={s.account}>
      {menu.open && (
        <div className={s.accountMenu} aria-label={t("account.menu")} {...menu.menuProps}>
          {/* One workspace per self-hosted install: nothing to switch to or create. */}
          {isCloud() && (<>
          <span className={s.menuLabel}>{t("org.menuLabel")}</span>
          {orgs.length === 0 && <span className={s.menuEmpty}>{t("org.empty")}</span>}
          {orgs.map((o) => (
            <button
              key={o.id}
              type="button"
              role="menuitemradio"
              aria-checked={o.id === org?.id}
              className={s.menuItem}
              onClick={() => onSwitch(o.id)}
            >
              <span className={s.menuItemText}>{o.name}</span>
              {o.id === org?.id && <Check className={s.menuCheck} size={15} strokeWidth={2} aria-hidden />}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            className={s.menuItem}
            onClick={() => {
              menu.close(false);
              onNewOrg();
            }}
          >
            <Plus size={15} strokeWidth={2} aria-hidden />
            <span className={s.menuItemText}>{t("org.new")}</span>
          </button>
          <span className={s.menuRule} aria-hidden />
          </>)}
          <button type="button" role="menuitem" className={s.menuItem} onClick={toggleTheme}>
            {theme === "dark" ? <Sun size={15} strokeWidth={2} aria-hidden /> : <Moon size={15} strokeWidth={2} aria-hidden />}
            <span className={s.menuItemText}>{theme === "dark" ? common("theme.switchToLight") : common("theme.switchToDark")}</span>
          </button>
          {/* The hosted service's terms and privacy pages; a self-hosted install has neither. */}
          {isCloud() && (
            <>
              <Link href="/terms" role="menuitem" className={s.menuItem} onClick={() => menu.close(false)}>
                <span className={s.menuItemText}>{t("account.terms")}</span>
              </Link>
              <Link href="/privacy" role="menuitem" className={s.menuItem} onClick={() => menu.close(false)}>
                <span className={s.menuItemText}>{t("account.privacy")}</span>
              </Link>
            </>
          )}
          <span className={s.menuRule} aria-hidden />
          <form action="/auth/signout" method="post" className={s.menuForm}>
            <button type="submit" role="menuitem" className={s.menuItem}>
              <LogOut size={15} strokeWidth={2} aria-hidden />
              <span className={s.menuItemText}>{t("user.signout")}</span>
            </button>
          </form>
        </div>
      )}
      <button id={buttonId} type="button" className={s.accountButton} title={label} {...menu.triggerProps}>
        <span className={s.avatar} aria-hidden>{(user?.email || user?.name || "·").slice(0, 1).toUpperCase()}</span>
        <span className={s.accountText}>
          <span className={s.accountEmail}>{label}</span>
          {org && <span className="sr-only">{org.name}</span>}
        </span>
      </button>
    </div>
  );
}
