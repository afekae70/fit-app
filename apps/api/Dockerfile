# Build the API service for Railway / Fly.io / any container host.
#
# Two things about this Dockerfile are dictated by the monorepo rather than chosen:
#
#  1. **Build context is the repository root**, not apps/api. The service imports @fit/shared
#     via a workspace link, so a context rooted at apps/api cannot see it and the build fails
#     at the import. Build with `docker build -f apps/api/Dockerfile .` from the root.
#  2. **The root lockfile is copied before any source.** Layer caching keys on file contents,
#     so copying package manifests first means a source-only change reuses the (slow) install
#     layer instead of reinstalling every dependency.

FROM node:22-alpine AS builder
WORKDIR /app

# Manifests first — see note 2 above.
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/

# `npm ci` needs every workspace's manifest present to resolve the lockfile, which is why the
# shared package's manifest is copied even though only the API is being built.
RUN npm ci --workspace apps/api --include-workspace-root

COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

RUN npm run build --workspace apps/api

FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/

RUN npm ci --omit=dev --workspace apps/api --include-workspace-root

# @fit/shared ships TypeScript sources consumed through the workspace link, so the source has
# to be present at runtime too — there is no compiled dist to copy instead.
COPY packages/shared ./packages/shared
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# Non-root: the process needs no write access to the image, and running as root in a container
# that talks to the internet is free risk.
USER node

# Railway and Fly both inject PORT; the app reads it via env validation and defaults to 3000.
EXPOSE 3000

CMD ["node", "apps/api/dist/server.js"]
