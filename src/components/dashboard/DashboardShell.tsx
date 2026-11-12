"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { usePathname } from "next/navigation";
import AppSidebar from "./AppSidebar";
import AppTopbar from "./AppTopbar";
import { AppFontVars } from "./app-fonts";
import s from "./DashboardShell.module.css";
import type { AppChrome } from "@/lib/dashboards/types";

import { COLLAPSED_KEY } from "./sidebar-boot";

/* The /app frame: a tinted navigation rail and a 1024px
   content column (1600px for pages that render data-page-width="wide") with no desktop top bar. `data-surface="app"` is the scope switch
   for the product tokens in src/app/app/dashboard.css (it also re-themes Radix
   portals opened from here). ≤900px the rail becomes a drawer opened from a
   mobile top bar. */
export default function DashboardShell({
  children,
  chrome,
}: {
  children: React.ReactNode;
  chrome: AppChrome;
}) {
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const navigationId = useId();
  const menuButtonId = useId();
  const pathname = usePathname();

  useEffect(() => {
    const media = window.matchMedia("(max-width: 900px)");
    const update = () => {
      setMobile(media.matches);
      if (!media.matches) setOpen(false);
    };
    update();
    // The /app layout applies the stored choice before paint; hosts without that boot
    // script (dev previews) catch up here.
    try {
      if (localStorage.getItem(COLLAPSED_KEY) === "1") document.documentElement.dataset.sidebar = "collapsed";
    } catch {
      /* storage blocked — keep the rail expanded */
    }
    setCollapsed(document.documentElement.dataset.sidebar === "collapsed");
    media.addEventListener("change", update);
    return () => {
      media.removeEventListener("change", update);
      // Leaving the app must not leave the collapsed flag on other surfaces.
      delete document.documentElement.dataset.sidebar;
    };
  }, []);

  useEffect(() => { setOpen(false); }, [pathname]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((value) => {
      const next = !value;
      if (next) document.documentElement.dataset.sidebar = "collapsed";
      else delete document.documentElement.dataset.sidebar;
      try {
        localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        /* storage blocked — the choice still applies to this page */
      }
      return next;
    });
  }, []);

  return (
    <div className={s.shell} data-surface="app">
      <AppFontVars />
      <AppSidebar
        chrome={chrome}
        open={open}
        mobile={mobile}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        navigationId={navigationId}
        menuButtonId={menuButtonId}
        onClose={() => setOpen(false)}
      />
      <div className={s.main}>
        <AppTopbar
          onMenu={() => setOpen(true)}
          menuOpen={open && mobile}
          menuButtonId={menuButtonId}
          navigationId={navigationId}
          mobile={mobile}
        />
        {/* A div, not <main>: several app views render their own <main> landmark. */}
        <div className={s.content} id="app-content">
          {children}
        </div>
      </div>
    </div>
  );
}
