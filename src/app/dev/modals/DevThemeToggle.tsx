'use client';

import { useEffect, useState } from 'react';

// Dev-only theme toggle so the modal system can be eyeballed in BOTH light and dark
// under the app tokens. Sets <html data-theme> (the same attribute the app's theme
// menu writes), starting from whatever the boot script applied.
export function DevThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => { setDark(document.documentElement.dataset.theme === 'dark'); }, []);
  return (
    <button
      type="button"
      className="dx-btn-ghost dx-btn-sm"
      aria-pressed={dark}
      onClick={() => {
        const next = !dark;
        setDark(next);
        document.documentElement.dataset.theme = next ? 'dark' : 'light';
      }}
      style={{ position: 'fixed', top: 16, right: 16, zIndex: 80 }}
    >
      {dark ? 'Light theme' : 'Dark theme'}
    </button>
  );
}
