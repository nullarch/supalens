import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/* Pins the /app editorial token set (src/app/app/dashboard.css): scoped to the app
   surface, readable in both themes, and semantic states independent of the accent. */
const css = readFileSync(resolve(process.cwd(), "src/app/app/dashboard.css"), "utf8");
const global = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");

function declarations(selector: string) {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`Missing token selector: ${selector}`);
  const block = css.slice(start, css.indexOf("\n}", start));
  return Object.fromEntries([...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}
function color(tokens: Record<string, string>, name: string): string {
  const value = tokens[name];
  if (!value) throw new Error(`Missing token: ${name}`);
  const alias = /^var\((--[\w-]+)\)$/.exec(value);
  return alias ? color(tokens, alias[1]) : value;
}
function luminance(hex: string) {
  if (!/^#[\da-f]{6}$/i.test(hex)) throw new Error(`Expected opaque hex color: ${hex}`);
  const rgb = hex.slice(1).match(/../g)!.map((part) => {
    const value = parseInt(part, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
}
function contrast(a: string, b: string) {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

const LIGHT = 'html:has([data-surface="app"])';
const DARK = 'html[data-theme="dark"]:has([data-surface="app"])';

it("scopes every app token to the mounted app surface, never the global :root", () => {
  expect(css).not.toMatch(/(^|\n)\s*:root\s*\{/);
  expect(css).not.toMatch(/(^|\n)\s*\[data-theme="dark"\]\s*\{/);
  // globals.css keeps the public product system untouched by the app redesign.
  expect(global).toContain("--brand: #b94d32;");
});

describe.each([["light", LIGHT], ["dark", DARK]] as const)("app editorial tokens / %s", (theme, selector) => {
  const tokens = theme === "dark" ? { ...declarations(LIGHT), ...declarations(DARK) } : declarations(LIGHT);

  it("keeps the accent and the three operational states distinct", () => {
    const states = ["--intent-positive", "--intent-negative", "--intent-warning"].map((key) => color(tokens, key));
    expect(new Set(states).size).toBe(3);
    expect(states).not.toContain(color(tokens, "--brand"));
  });
  it.each(["--paper", "--paper-2", "--paper-3", "--ax-panel"])("keeps text readable on %s", (surface) => {
    for (const text of ["--ink", "--ink-2", "--ink-3"]) {
      expect(contrast(color(tokens, text), color(tokens, surface)), `${text} on ${surface} (${selector})`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it.each(["positive", "negative", "warning"])("keeps %s state text readable on its tint", (intent) => {
    expect(contrast(color(tokens, `--intent-${intent}`), color(tokens, `--intent-${intent}-bg`))).toBeGreaterThanOrEqual(4.5);
  });
  it("keeps action, accent, tag and bloom foregrounds readable", () => {
    for (const surface of ["--action", "--action-hover"]) expect(contrast(color(tokens, "--on-action"), color(tokens, surface))).toBeGreaterThanOrEqual(4.5);
    for (const surface of ["--brand", "--brand-hover"]) expect(contrast(color(tokens, "--on-brand"), color(tokens, surface))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color(tokens, "--brand"), color(tokens, "--ax-tag-bg"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color(tokens, "--ax-bloom-ink"), color(tokens, "--ax-bloom-bg"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color(tokens, "--on-panel"), color(tokens, "--panel"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(color(tokens, "--on-panel-2"), color(tokens, "--panel"))).toBeGreaterThanOrEqual(4.5);
  });
  it("defines eight distinct categorical series", () => {
    const series = Array.from({ length: 8 }, (_, i) => color(tokens, `--series-${i + 1}`));
    expect(new Set(series).size).toBe(8);
  });
});
