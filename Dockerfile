# syntax=docker/dockerfile:1.6
#
# The Council — production image.
#
# Two-stage build:
#   - builder: full deps, compiles TS, compiles better-sqlite3 native addon
#   - runtime: slim image, git (for vault clones), tini (PID 1), compiled JS
#
# We use `pnpm deploy` to produce a self-contained bundle at /bundle, then
# copy that into the runtime. This avoids shipping the whole monorepo or the
# dev dependencies.

# ---------- builder ----------
FROM node:20-alpine AS builder

# Toolchain for better-sqlite3 (no prebuilt for Alpine/musl)
RUN apk add --no-cache python3 make g++ git

RUN corepack enable
WORKDIR /repo

# Copy workspace manifests first — maximizes layer cache hit on source-only changes
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY apps/backend/package.json ./apps/backend/

RUN pnpm install --frozen-lockfile

# Now the source — these layers bust on code changes
COPY apps/backend ./apps/backend

# Compile TS + copy prompts/schema.sql into dist
RUN pnpm --filter backend build

# Produce a standalone, production-only bundle at /bundle
# (backend/package.json declares `files: ["dist"]` so src/, .env, etc. do not leak in)
RUN pnpm --filter=backend deploy --prod /bundle

# ---------- runtime ----------
FROM node:20-alpine AS runtime

# git: required by simple-git to clone/pull/push the vault repo at runtime
# tini: proper PID 1 so SIGTERM reaches node
# ca-certificates: HTTPS for both Anthropic API and GitHub
RUN apk add --no-cache git ca-certificates tini

WORKDIR /app

COPY --from=builder /bundle ./

ENV NODE_ENV=production
EXPOSE 8080

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--enable-source-maps", "dist/index.js"]
