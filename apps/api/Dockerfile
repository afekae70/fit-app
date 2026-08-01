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
#
# Runs through `tsx` rather than a `tsc` build + `node dist/server.js`: @fit/shared ships raw
# TypeScript source (its package.json `exports` point at `./src/...`, with no compiled `dist`),
# so plain `node` cannot resolve its relative `.js`-suffixed imports at runtime. `tsx` is what
# the local dev server already runs on successfully, so production uses the same interpreter
# instead of a separate, untested compiled path.

FROM node:22-alpine
WORKDIR /app

# Manifests first — see note 2 above.
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/

# `npm ci` needs every workspace's manifest present to resolve the lockfile, which is why the
# shared package's manifest is copied even though only the API is being run.
RUN npm ci --workspace apps/api --include-workspace-root

COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

ENV NODE_ENV=production

# Non-root: the process needs no write access to the image, and running as root in a container
# that talks to the internet is free risk.
USER node

# Railway and Fly both inject PORT; the app reads it via env validation and defaults to 3000.
EXPOSE 3000

CMD ["npm", "run", "start", "--workspace", "apps/api"]
