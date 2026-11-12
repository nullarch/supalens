import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
function declarations(selector: string) {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`Missing token selector: ${selector}`);
  const block = css.slice(start, css.indexOf("}", start));
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

describe.each(["light", "dark"])("global product tokens / %s", (theme) => {
  const tokens = { ...declarations(":root"), ...(theme === "dark" ? declarations('[data-theme="dark"]') : {}) };
  it("keeps brand and operational meanings independent", () => {
    expect(color(tokens, "--brand")).not.toBe(color(tokens, "--intent-negative"));
    expect(new Set(["--intent-positive", "--intent-negative", "--intent-warning"].map((key) => color(tokens, key))).size).toBe(3);
  });
  it.each(["--paper", "--paper-2", "--paper-3"])("keeps body and secondary text readable on %s", (surface) => {
    for (const text of ["--ink", "--ink-2", "--ink-3"]) {
      expect(contrast(color(tokens, text), color(tokens, surface)), `${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it.each(["positive", "negative", "warning"])("keeps %s status text readable", (intent) => {
    expect(contrast(color(tokens, `--intent-${intent}`), color(tokens, `--intent-${intent}-bg`))).toBeGreaterThanOrEqual(4.5);
  });
  it("keeps primary and brand foregrounds readable at rest and on hover", () => {
    for (const [text, surfaces] of [["--on-action", ["--action", "--action-hover"]], ["--on-brand", ["--brand", "--brand-hover"]]] as const) {
      for (const surface of surfaces) expect(contrast(color(tokens, text), color(tokens, surface))).toBeGreaterThanOrEqual(4.5);
    }
  });
});

it("preserves identical localized keys for the new product sections", () => {
  const keys = (value: unknown, prefix = ""): string[] => {
    if (!value || typeof value !== "object") return [prefix];
    return Object.entries(value).flatMap(([key, child]) => keys(child, `${prefix}.${key}`)).sort();
  };
  const catalogs = ["en", "ko", "ja"].map((locale) => JSON.parse(readFileSync(resolve(process.cwd(), `messages/${locale}.json`), "utf8")));
  for (const namespace of ["globalProduct", "globalWorkflow", "appCommon"]) {
    for (const catalog of catalogs.slice(1)) expect(keys(catalog[namespace])).toEqual(keys(catalogs[0][namespace]));
  }
});
