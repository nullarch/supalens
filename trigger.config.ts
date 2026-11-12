import { defineConfig } from '@trigger.dev/sdk'
import { additionalPackages, aptGet } from '@trigger.dev/build/extensions/core'

import { isCloud } from './src/config/edition'

/**
 * Trigger.dev project config. The `analyze` task (the Claude Agent SDK runtime) lives in
 * ./trigger and runs on Trigger.dev's long-running compute — NOT on the web server.
 *
 * The CLI evaluates this file in ITS OWN process, so the two variables below must be in the
 * shell or in the env file the CLI loads (`.env` by default, or `--env-file <path>`):
 *   TRIGGER_PROJECT_REF            your project ref (Trigger.dev dashboard → Project settings)
 *   NEXT_PUBLIC_SUPALENS_EDITION   'cloud' also deploys ./trigger/cloud (hosted-service tasks)
 */
const project = process.env.TRIGGER_PROJECT_REF
if (!project) {
  throw new Error(
    'TRIGGER_PROJECT_REF is not set. Put it in .env (or pass --env-file) before running the Trigger.dev CLI.',
  )
}

// Tasks only the hosted service runs (partner payment callbacks, marketing telemetry, lifecycle
// mail, the public X-ray scanner). A self-hosted project never deploys them, so it carries no
// idle five-minute crons.
// ./trigger is scanned recursively, so the split is an ignore pattern, not a second dir. Setting
// ignorePatterns replaces the CLI defaults — keep the test-file patterns it would have applied.
const ignorePatterns = [
  '**/*.test.ts', '**/*.spec.ts', '**/*.test.mts', '**/*.spec.mts', '**/*.test.cts', '**/*.spec.cts',
  '**/*.test.js', '**/*.spec.js', '**/*.test.mjs', '**/*.spec.mjs', '**/*.test.cjs', '**/*.spec.cjs',
  ...(isCloud() ? [] : ['**/trigger/cloud/**']),
]
console.log(`[trigger.config] edition=${isCloud() ? 'cloud (includes ./trigger/cloud)' : 'selfhost (./trigger/cloud excluded)'}`)

// The agent SDK ships its native CLI as a per-platform optional package. Workers are x64 unless
// TRIGGER_WORKER_ARCH=arm64 (self-hosted Trigger.dev on ARM).
const agentBinary = `@anthropic-ai/claude-agent-sdk-linux-${process.env.TRIGGER_WORKER_ARCH === 'arm64' ? 'arm64' : 'x64'}@0.3.195`

export default defineConfig({
  project,
  // Pin the task runtime to a Node LTS EXPLICITLY. Left unset it is 'node', which silently meant
  // Node 21 (non-LTS, EOL) — Trigger.dev stops accepting Node 21 deploys from 2026-10-05. Node 24 is
  // LTS until 2028-04; move to the next even release (node-26+) before then. Pinned in
  // src/lib/trigger-runtime.test.ts.
  runtime: 'node-24',
  dirs: ['./trigger'],
  ignorePatterns,
  build: {
    // @google-cloud/firestore (google-gax / protobufjs) loads .proto/JSON via dynamic require at
    // runtime; @anthropic-ai/claude-agent-sdk spawns a NATIVE per-platform CLI binary shipped as
    // an OPTIONAL dep (@anthropic-ai/claude-agent-sdk-<platform>). Bundling either with esbuild
    // drops those assets → "Native CLI binary for linux-x64 not found" at runtime. Mark them
    // external so they're installed in the deploy image instead of bundled.
    external: ['@google-cloud/firestore', '@anthropic-ai/claude-agent-sdk'],
    // external alone still doesn't guarantee the OPTIONAL platform binary is installed (the deploy
    // install omits optionals), so force-install the linux-x64 (glibc) binary that Trigger.dev's
    // deploy image needs. Pin to the SDK version. Bump BOTH together on an SDK upgrade.
    extensions: [
      additionalPackages({ packages: [agentBinary] }),
      // the code-analysis file tools (list_files / grep_code) shell out to ripgrep and every repo
      // task clones with git — install both into the deploy image instead of assuming the base has them.
      aptGet({ packages: ['git', 'ripgrep'] }),
    ],
  },
  // agent runs can be long; CPU time (not wall-clock streaming wait) is what counts.
  maxDuration: 3600,
  retries: {
    enabledInDev: false,
    default: { maxAttempts: 1 }, // agent runs are not idempotent — don't auto-retry
  },
})
