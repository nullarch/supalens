# syntax=docker/dockerfile:1
#
# Supalens web server (Next.js, standalone output).
#
# In a self-hosted build this one image is the whole application: the UI, the API, and — unless
# SUPALENS_TASK_BACKEND=trigger — the agents and scheduled jobs too, running in this process.
#
# NEXT_PUBLIC_* values are inlined into the browser bundle at BUILD time, so the image is built
# with your own values (docker compose passes them from .env — see docs/self-hosting.md).

FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci

FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_SUPALENS_EDITION=selfhost
ARG SUPALENS_TASK_BACKEND
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SUPABASE_COOKIE_NAME
ARG NEXT_PUBLIC_MCP_URL
ARG NEXT_PUBLIC_TRIGGER_API_URL
ARG NEXT_PUBLIC_SUPPORT_EMAIL

ENV NEXT_PUBLIC_SUPALENS_EDITION=$NEXT_PUBLIC_SUPALENS_EDITION \
    SUPALENS_TASK_BACKEND=$SUPALENS_TASK_BACKEND \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_SUPABASE_COOKIE_NAME=$NEXT_PUBLIC_SUPABASE_COOKIE_NAME \
    NEXT_PUBLIC_MCP_URL=$NEXT_PUBLIC_MCP_URL \
    NEXT_PUBLIC_TRIGGER_API_URL=$NEXT_PUBLIC_TRIGGER_API_URL \
    NEXT_PUBLIC_SUPPORT_EMAIL=$NEXT_PUBLIC_SUPPORT_EMAIL \
    NEXT_OUTPUT=standalone \
    NEXT_TELEMETRY_DISABLED=1

# `public/` is optional in this repository; the runner stage copies it unconditionally.
RUN mkdir -p public && npm run build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# The code-analysis tasks clone repositories and search them; the agent runtime needs CA roots.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git ripgrep \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public

USER node
EXPOSE 3000
CMD ["node", "server.js"]
