"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import LogoMark from "@/components/brand/LogoMark";
import LanguageSwitcher from "@/components/i18n/LanguageSwitcher";
import ThemeToggle from "@/components/theme/ThemeToggle";
import { CONNECT_HREF, DASHBOARD_HREF, LOGIN_HREF, NAV_LINKS, type NavLink } from "../headers/shared";
import { useSignedIn } from "../headers/useSignedIn";
import s from "./Header.module.css";

/* Quiet sticky bar: serif wordmark, 15px links, outlined log-in and ink CTA.
   Translucent white with blur once the page scrolls. Below 1080px the links,
   language, theme and log-in move into a full-height menu. The menu id
   (`cx-mobile-menu`) is the public-page verification contract. */
export default function Header({ sectionBase = "" }: { sectionBase?: "" | "/" } = {}) {
  const tNav = useTranslations("nav");
  const tCommon = useTranslations("common");
  const signedIn = useSignedIn();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 4);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      menuButton.current?.focus();
    };
    const wide = window.matchMedia("(min-width: 1080px)");
    const onWide = () => wide.matches && setOpen(false);
    window.addEventListener("keydown", onKey);
    wide.addEventListener("change", onWide);
    return () => {
      window.removeEventListener("keydown", onKey);
      wide.removeEventListener("change", onWide);
    };
  }, [open]);

  const close = () => setOpen(false);
  // Section anchors (#how …) live on the home page; other pages pass sectionBase="/".
  const renderLink = (link: NavLink, className: string, onClick?: () => void) =>
    link.href.startsWith("/") || (sectionBase && link.href.startsWith("#")) ? (
      <Link key={link.href} className={className} href={link.href.startsWith("#") ? `${sectionBase}${link.href}` : link.href} onClick={onClick}>
        {tNav(link.labelKey)}
      </Link>
    ) : (
      <a key={link.href} className={className} href={link.href} onClick={onClick}>
        {tNav(link.labelKey)}
      </a>
    );

  return (
    <header className={s.header} data-scrolled={scrolled} data-menu-open={open}>
      <div className={`ed-container ${s.bar}`}>
        <div className={s.lead}>
          <Link href="/" className={s.brand} aria-label={tCommon("brandHome")}>
            <LogoMark size={20} />
            <span className={s.wordmark}>Supalens</span>
          </Link>
          <nav className={s.nav} aria-label={tNav("ariaLabel")}>
            {NAV_LINKS.map((link) => renderLink(link, s.navLink))}
          </nav>
        </div>

        <div className={s.actions}>
          <span className={s.wide}>
            <LanguageSwitcher className={s.language} rootClassName={s.languageRoot} />
            <ThemeToggle className={s.iconButton} />
          </span>
          {signedIn ? (
            <a className={`ed-button ed-button--small ed-button--primary ${s.action}`} href={DASHBOARD_HREF}>
              {tCommon("goToApp")}
            </a>
          ) : (
            <>
              <a className={`ed-button ed-button--small ${s.action} ${s.wideLogin}`} href={LOGIN_HREF}>
                {tCommon("logIn")}
              </a>
              <a className={`ed-button ed-button--small ed-button--primary ${s.action}`} href={CONNECT_HREF}>
                {tNav("ctaConnect")}
              </a>
            </>
          )}
          <button
            ref={menuButton}
            type="button"
            className={`${s.iconButton} ${s.menuButton}`}
            aria-expanded={open}
            aria-controls="cx-mobile-menu"
            aria-label={open ? tNav("menuClose") : tNav("menuOpen")}
            onClick={() => setOpen((value) => !value)}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              {open ? (
                <path d="M3 3l12 12M15 3L3 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              ) : (
                <path d="M2 5.5h14M2 12.5h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              )}
            </svg>
          </button>
        </div>
      </div>

      <div id="cx-mobile-menu" className={s.menu} data-open={open} hidden={!open}>
        <div className="ed-container">
          <nav className={s.menuNav} aria-label={tNav("ariaLabel")}>
            {NAV_LINKS.map((link) => renderLink(link, s.menuLink, close))}
          </nav>
          {!signedIn && (
            <a className={`ed-button ${s.menuLogin}`} href={LOGIN_HREF}>
              {tCommon("logIn")}
            </a>
          )}
          <div className={s.menuFoot}>
            <LanguageSwitcher className={s.language} rootClassName={s.languageRoot} />
            <ThemeToggle className={s.iconButton} />
          </div>
        </div>
      </div>
    </header>
  );
}
