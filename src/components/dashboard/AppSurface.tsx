import type { ReactNode } from "react";
import { AppFontVars } from "./app-fonts";

/**
 * The app design scope without the header — for /dev previews that mount a single
 * /app view with fixtures. Real /app routes get the same scope from DashboardShell.
 * Pair with `import "@/app/app/dashboard.css"` in the preview page.
 */
export function AppSurface({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div data-surface="app" className={className}>
      <AppFontVars />
      {children}
    </div>
  );
}
