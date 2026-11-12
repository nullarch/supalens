/** Inline, scoped CSS: root-error rendering cannot depend on the failed layout's
 * stylesheet, fonts or providers. Token parity is tested against globals.css.
 *
 * One fallback in three contexts: inside the /app shell (app tokens and fonts are
 * published on <html> — the `html:has([data-surface="app"])` rules), on a public
 * route (globals.css tokens, no app fonts) and in the isolated root-error document
 * (only the tokens mirrored below). Base rules read only tokens every context
 * defines, with system-font fallbacks; app type and hover tints are app-only.
 * Anatomy (the product's empty/error state): a centered white card — optional
 * muted code, serif page title, one muted line, primary + secondary actions. */
export const FALLBACK_CSS = `
.sl-root-fallback {
  --paper: #fbfcfc; --paper-2: #ffffff; --ink: #191c20; --ink-2: #5e646d;
  --line: #e2e5e8; --line-2: #c3c8ce; --clay: #b94d32;
  --action: #202328; --action-hover: #363b42; --on-action: #ffffff;
  color-scheme: light; margin: 0; min-height: 100dvh; background: var(--paper); color: var(--ink);
}
.sl-root-fallback[data-fallback-theme="dark"] {
  --paper: #151618; --paper-2: #1a1c1e; --ink: #eeeff1; --ink-2: #a2a5aa;
  --line: #2a2d31; --line-2: #484e56; --clay: #f08a65;
  --action: #eeeff1; --action-hover: #d6d9dd; --on-action: #151719; color-scheme: dark;
}
@media(prefers-color-scheme: dark) {
  .sl-root-fallback:not([data-fallback-theme="light"]) {
    --paper: #151618; --paper-2: #1a1c1e; --ink: #eeeff1; --ink-2: #a2a5aa;
    --line: #2a2d31; --line-2: #484e56; --clay: #f08a65;
    --action: #eeeff1; --action-hover: #d6d9dd; --on-action: #151719; color-scheme: dark;
  }
}
.sl-fallback, .sl-fallback * { box-sizing: border-box; }
.sl-fallback {
  --fb-serif: "Iowan Old Style BT", "Iowan Old Style", Georgia, serif;
  --fb-sans: var(--font-sans, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Segoe UI", sans-serif);
  --fb-muted: var(--ink-3, var(--ink-2));
  display: grid; justify-items: center;
  width: min(100%, 560px); margin: 0 auto; padding: clamp(48px, 12vh, 120px) 20px 72px;
  font-family: var(--fb-sans); font-size: 14px; line-height: 1.625; color: var(--ink);
  overflow-wrap: anywhere; -webkit-font-smoothing: antialiased;
}
.sl-fallback-brand {
  display: inline-flex; align-items: center; gap: 8px; min-height: 44px; margin-bottom: 20px;
  color: var(--ink); text-decoration: none;
  font-family: var(--fb-serif); font-size: 20px; font-weight: 400; line-height: 1; letter-spacing: -.025em;
}
.sl-fallback-mark { display: inline-flex; color: var(--ink); }
.sl-fallback-card {
  width: 100%; min-width: 0; padding: 36px 32px 32px; text-align: center;
  border: 1px solid var(--line); border-radius: 16px; background: var(--paper-2);
}
.sl-fallback-code {
  margin: 0 0 6px; color: var(--fb-muted);
  font-size: 14px; font-weight: 500; line-height: 20px; font-variant-numeric: tabular-nums;
}
.sl-fallback h1 {
  margin: 0; color: var(--ink);
  font-family: var(--fb-serif); font-size: 28px; font-weight: 400; line-height: 1.26; letter-spacing: -.025em;
  text-wrap: balance;
}
.sl-fallback-copy { margin: 8px auto 0; max-width: 44ch; color: var(--fb-muted); font-size: 14px; line-height: 22.75px; text-wrap: pretty; }
.sl-fallback-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 24px; }
.sl-fallback-action {
  display: inline-flex; align-items: center; justify-content: center; min-height: 44px; max-width: 100%; padding: 8px 16px;
  border: 1px solid var(--line-2); border-radius: 10px; background: var(--paper-2); color: var(--ink);
  font: inherit; font-size: 14px; font-weight: 500; line-height: 20px; text-align: center; text-decoration: none;
  cursor: pointer; transition: opacity 150ms ease, background-color 150ms ease;
}
.sl-fallback-primary { border-color: var(--action); background: var(--action); color: var(--on-action); }
@media (hover: hover) {
  .sl-fallback-action:not(.sl-fallback-primary):hover { background: var(--ax-tint, var(--paper)); }
  .sl-fallback-primary:hover { opacity: .85; }
}
.sl-fallback-action:active { scale: .98; }
.sl-fallback a:focus-visible, .sl-fallback button:focus-visible { outline: 2px solid var(--brand, var(--ink)); outline-offset: 2px; }
/* Outside the app no CJK serif is loaded (the system fallback is uneven), so CJK
   titles keep the sans there; the app rule below restores its Noto Serif. */
.sl-fallback:is(:lang(ko), :lang(ja)) { --fb-serif: var(--fb-sans); }
.sl-fallback:is(:lang(ko), :lang(ja)) h1 { font-size: 26px; line-height: 1.35; letter-spacing: -.01em; }
.sl-fallback:lang(ko) { word-break: keep-all; }
.sl-fallback:lang(ja) { line-break: strict; }

/* inside the product: app type, centered in the content column */
html:has([data-surface="app"]) .sl-fallback {
  --fb-serif: var(--ax-serif); --fb-sans: var(--ax-sans);
  padding: clamp(24px, 8vh, 88px) 0 64px;
}
html:has([data-surface="app"]) .sl-fallback-mark { --clay: var(--ax-mark); }

@media (max-width: 480px) {
  .sl-fallback { padding: 32px 16px 48px; }
  .sl-fallback-card { padding: 28px 20px 20px; }
  .sl-fallback-actions { flex-direction: column; }
  .sl-fallback-action { width: 100%; }
  html:has([data-surface="app"]) .sl-fallback { padding: 8px 0 40px; }
}
@media (prefers-reduced-motion: reduce) {
  .sl-fallback-action { transition-duration: .01ms; }
  .sl-fallback-action:active { scale: none; }
}
`
