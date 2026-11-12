"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

/* ============================================================
   ThemeToggle — sets <html data-theme="light|dark">, persists to
   localStorage("theme"). Initial theme is applied before first
   paint by the inline script in app/layout.tsx (no FOUC); this
   component only reads/flips it. Unstyled beyond the caller's
   className so it inherits each chrome's sizing conventions
   (landing header / app topbar).
   ============================================================ */

export default function ThemeToggle({ className }: { className?: string }) {
  const t = useTranslations("appCommon");
  // null until mounted — the server doesn't know the theme, so render a
  // theme-neutral button first and fill the icon in after hydration.
  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  useEffect(() => {
    setTheme(
      document.documentElement.dataset.theme === "dark" ? "dark" : "light",
    );
  }, []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* private mode etc. — theme still applies for this page */
    }
    setTheme(next);
  };

  return (
    <button
      type="button"
      className={className}
      onClick={toggle}
      aria-label={theme === "dark" ? t("theme.switchToLight") : t("theme.switchToDark")}
      title={theme === "dark" ? t("theme.light") : t("theme.dark")}
    >
      {theme === "dark" ? (
        /* sun */
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        /* moon (also the pre-hydration placeholder) */
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden>
          <path
            d="M20 13.2A8 8 0 0 1 10.8 4 8 8 0 1 0 20 13.2Z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      )}
    </button>
  );
}
