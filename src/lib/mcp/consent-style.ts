/** Standalone OAuth documents do not pass through the React layout.
 * Mirror the small required token subset; consent-document.test.ts checks drift. */
const light = `
  color-scheme: light;
  --paper: #fbfcfc; --paper-2: #ffffff; --paper-3: #f0f2f4;
  --ink: #191c20; --ink-2: #5e646d; --line: #e2e5e8; --line-2: #c3c8ce;
  --brand: #b94d32; --action: #202328; --action-hover: #363b42; --on-action: #ffffff;
  --intent-negative: #aa293a; --intent-negative-bg: #fff1f2;
`
const dark = `
  color-scheme: dark;
  --paper: #151618; --paper-2: #1a1c1e; --paper-3: #222426;
  --ink: #eeeff1; --ink-2: #a2a5aa; --line: #2a2d31; --line-2: #484e56;
  --brand: #f08a65; --action: #eeeff1; --action-hover: #d6d9dd; --on-action: #151719;
  --intent-negative: #f39aa3; --intent-negative-bg: #302025;
`

export const CONSENT_CSS = `
:root { ${light} }
:root[data-theme="dark"] { ${dark} }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ${dark} } }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100dvh; background: var(--paper); color: var(--ink); font-family: Inter, "Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Segoe UI", sans-serif; font-size: 15px; line-height: 1.65; }
a { color: inherit; text-underline-offset: 3px; }
.page { width: min(100%, 680px); margin: 0 auto; padding: 40px 24px 64px; }
.brand { display: inline-flex; align-items: center; gap: 9px; text-decoration: none; font-size: 22px; font-weight: 650; letter-spacing: -.04em; margin-bottom: 32px; }
.brand svg { width: 30px; height: 30px; flex-shrink: 0; }
.card { padding: 32px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper-2); min-width: 0; overflow-wrap: anywhere; }
h1 { font-size: clamp(26px, 4vw, 32px); font-weight: 600; line-height: 1.25; letter-spacing: -.035em; margin: 0 0 16px; }
h2 { font-size: 15px; font-weight: 600; margin: 0 0 12px; }
p { margin: 0; }
.description { color: var(--ink-2); margin-bottom: 24px; }
.request { border: 1px solid var(--line); border-radius: 8px; padding: 20px; background: var(--paper); }
.client-name { font-size: 20px; font-weight: 550; line-height: 1.45; margin-bottom: 18px; }
dl { margin: 0; display: grid; gap: 16px; }
dt { font-size: 12px; color: var(--ink-2); margin-bottom: 5px; }
dd { margin: 0; font-size: 13px; }
code { font-family: ui-monospace, Menlo, monospace; font-size: 12px; overflow-wrap: anywhere; }
.scope-section { margin-top: 24px; }
.scopes { display: flex; flex-wrap: wrap; gap: 8px; list-style: none; margin: 0 0 12px; padding: 0; }
.scopes li { min-width: 0; max-width: 100%; padding: 4px 9px; border: 1px solid var(--line-2); border-radius: 6px; background: var(--paper-3); }
.note { font-size: 13px; color: var(--ink-2); }
.note + .note { margin-top: 10px; }
.account { margin: 24px 0; padding-top: 20px; border-top: 1px solid var(--line); font-size: 13px; color: var(--ink-2); }
.actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 24px 0 14px; }
button, .button { font: inherit; font-size: 14px; font-weight: 550; display: inline-flex; align-items: center; justify-content: center; min-height: 44px; border-radius: 6px; padding: 10px 18px; border: 1px solid var(--line-2); background: var(--paper-2); color: var(--ink); cursor: pointer; text-decoration: none; overflow-wrap: anywhere; }
.approve { flex: 1; background: var(--action); border-color: var(--action); color: var(--on-action); }
.approve:hover { background: var(--action-hover); border-color: var(--action-hover); }
.deny:hover, .button:hover { background: var(--paper-3); }
a:focus-visible, button:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; }
.brand:focus-visible { border-radius: 6px; }
.error { padding: 16px; border-radius: 8px; color: var(--intent-negative); background: var(--intent-negative-bg); margin: 24px 0 16px; }
.error-action { margin-top: 24px; }
.preview { margin-bottom: 24px; font-size: 12px; color: var(--ink-2); padding: 12px; border: 1px dashed var(--line-2); border-radius: 6px; }
@media (max-width: 480px) { .page { padding: 24px 16px 40px; } .card { padding: 22px 18px; } .request { padding: 16px; } .brand { margin-bottom: 24px; } .actions { flex-direction: column; } .actions button { width: 100%; } }
`

/** No dynamic values, user-supplied script or request IO. CSS supplies system fallback. */
export const CONSENT_THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}})();`
