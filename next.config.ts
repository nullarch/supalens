import path from "node:path";
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// The clean public MCP host (hosted default: mcp.supalens.ai). A deployment that sets
// NEXT_PUBLIC_MCP_URL gets the same /mcp → /api/mcp/mcp rewrite on its own host.
function mcpHost(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_MCP_URL ?? "").hostname || "mcp.supalens.ai";
  } catch {
    return "mcp.supalens.ai";
  }
}

// Where background work runs — the same rule as resolveTaskBackend() in src/lib/tasks/backend.ts
// (kept inline: this file cannot import app TypeScript). A self-hosted build runs tasks inside the
// web server, so it aliases the two Trigger.dev packages to in-process implementations; every
// task definition and call site stays untouched. SUPALENS_TASK_BACKEND=trigger opts out.
const edition = (process.env.NEXT_PUBLIC_SUPALENS_EDITION ?? "").trim().toLowerCase();
const builtinTasks =
  ["selfhost", "self-hosted", "selfhosted"].includes(edition) &&
  (process.env.SUPALENS_TASK_BACKEND ?? "").trim().toLowerCase() !== "trigger";
const BUILTIN_SDK = "./src/lib/tasks/builtin/sdk.ts";
const BUILTIN_HOOKS = "./src/lib/tasks/builtin/react-hooks.ts";

// The Docker image build (see Dockerfile).
const imageBuild = process.env.NEXT_OUTPUT === "standalone";

const nextConfig: NextConfig = {
  // Published so runtime code (server and browser) agrees with the bundle it runs in.
  env: { NEXT_PUBLIC_SUPALENS_TASK_BACKEND: builtinTasks ? "builtin" : "trigger" },
  experimental: {
    ...(builtinTasks
      ? { turbo: { resolveAlias: { "@trigger.dev/sdk": BUILTIN_SDK, "@trigger.dev/react-hooks": BUILTIN_HOOKS } } }
      : {}),
    // An image build runs inside Docker's memory limit (often 2–4 GB on a laptop), so trade a
    // little build speed for a much lower peak.
    ...(imageBuild ? { webpackMemoryOptimizations: true } : {}),
  },
  // Types and lint are checked in CI; repeating them in an image build only costs memory.
  typescript: { ignoreBuildErrors: imageBuild },
  eslint: { ignoreDuringBuilds: imageBuild },
  // Self-contained server bundle for the Docker image (see Dockerfile). Opt-in so platform
  // builds that manage their own output (Vercel) are unaffected.
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
  // Turbopack (dev) ignores the webpack() hook below, so pin `pg` external
  // explicitly for both bundlers. Turbopack externals are require()-based and
  // don't produce the async-ESM-module wrapper described below.
  serverExternalPackages: ["pg", "satori", "@resvg/resvg-js"],
  // Fixed local fonts for share previews; no customer-text font requests at runtime.
  outputFileTracingIncludes: {
    // The agent SDK resolves its per-platform native binary at runtime, which file tracing does
    // not see. A built-in build runs agents in this server, so the binary must be in the image.
    ...(builtinTasks ? { '/**': ['./node_modules/@anthropic-ai/claude-agent-sdk*/**/*'] } : {}),
    // The MCP App view (scripts/build-mcp-app.mjs) is read from .mcp/ at runtime.
    '/api/mcp/[transport]': ['./.mcp/result-view.html'],
    '/share/*/opengraph-image/*': [
      './assets/fonts/share/*.otf', './assets/fonts/share/*.ttf', './assets/fonts/share/*LICENSE',
      './node_modules/harfbuzzjs/*.wasm',
    ],
  },
  // `pg` resolves through its package-exports "import" condition, so Next/webpack
  // externalizes it as an ESM external (`e.exports = import("pg")` — a promise). That
  // turns EVERY module that statically imports it (query/pool.ts → @/lib/query → every
  // server action/page touching the query engine) into a webpack ASYNC module, and
  // awaiting that module promise during a request drops the request-scope
  // AsyncLocalStorage → server actions 500 with "`cookies` was called outside a request
  // scope" (observed on the integrations actions in prod). Externalize it as CommonJS
  // instead: same runtime module, but require() keeps the module graph synchronous.
  // (mysql2 already externalizes as require() — no override needed.)
  webpack(config, { isServer }) {
    if (builtinTasks) {
      config.resolve.alias = {
        ...config.resolve.alias,
        "@trigger.dev/sdk$": path.resolve(BUILTIN_SDK),
        "@trigger.dev/react-hooks$": path.resolve(BUILTIN_HOOKS),
      };
    }
    if (isServer) {
      // Satori's font shaper resolves WASM relative to its installed package.
      // Keep it intact (and synchronously imported), not relocated into chunks.
      config.externals = [{ pg: "commonjs pg", satori: "commonjs satori" }, ...(config.externals ?? [])];
    }
    return config;
  },
  // Clean public MCP host: <mcp host>/mcp → the handler at /api/mcp/mcp.
  // (DNS must point that host at this app.)
  async rewrites() {
    const onMcpHost = [{ type: 'host' as const, value: mcpHost() }]
    return [
      { source: '/mcp', has: onMcpHost, destination: '/api/mcp/mcp' },
      // Keep previously shared image URLs usable after introducing locale IDs.
      { source: '/share/:token/opengraph-image', destination: '/share/:token/opengraph-image/en' },
    ]
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "X-XSS-Protection",
            value: "1; mode=block",
          },
        ],
      },
    ];
  },
};

// withSentryConfig no-ops the upload step (and adds negligible build overhead)
// when SENTRY_AUTH_TOKEN/SENTRY_ORG/SENTRY_PROJECT aren't set — safe for local
// dev and CI without a Sentry account.
// The Sentry build plugin exists to produce and upload source maps. An image build without Sentry
// upload credentials gains nothing from it and pays for it in build memory, so it is skipped;
// runtime error reporting (Sentry.init in instrumentation) does not depend on it.
const withSentry = imageBuild && !process.env.SENTRY_AUTH_TOKEN
  ? (config: NextConfig) => config
  : (config: NextConfig) => withSentryConfig(config, sentryBuildOptions);

const sentryBuildOptions = {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  widenClientFileUpload: true,
  webpack: {
    treeshake: { removeDebugLogging: true },
    automaticVercelMonitors: false,
  },
  // this app already implements X-Frame-Options: DENY (see headers() above);
  // the Sentry tunnel route would need its own care re: framing, and we don't
  // need ad-blocker circumvention for a B2B analytics tool — skip it.
  tunnelRoute: false,
};

export default withSentry(withNextIntl(nextConfig));
