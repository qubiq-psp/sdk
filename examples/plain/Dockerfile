# examples/plain: the backend examples/plain/api (Fastify, no SDK) serving the plain build of examples/ui, in one
# container. Build from the repository root (README, "Docker"):
#   docker build -f examples/plain/Dockerfile -t psp-example-plain .
# The context is the repository root: the lockfile and the pnpm workspace live there (.dockerignore keeps
# node_modules, dist, .git and .env files out). Nothing secret is baked in: the key and the secret come from the
# environment of the container.

# The base image, by tag and by the digest of its multi-arch index (docker buildx imagetools inspect).
ARG NODE_IMAGE=node:22.23.5-alpine3.24@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a

# 0. The workspace manifests: every package.json, so the frozen lockfile matches whatever is filtered
FROM ${NODE_IMAGE} AS manifests
ENV CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# pnpm of the root package.json (`packageManager`), through corepack
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY scripts/lockfile-check.mjs scripts/
COPY packages/node/package.json packages/node/
COPY packages/react/package.json packages/react/
COPY examples/contract/package.json examples/contract/
COPY examples/plain/api/package.json examples/plain/api/
COPY examples/sdk/api/package.json examples/sdk/api/
COPY examples/ui/package.json examples/ui/
# Every package of the lockfile from registry.npmjs.org with an integrity hash
RUN node scripts/lockfile-check.mjs

# 1. Build: the dependencies of the backend and the UI only (no install scripts: allowBuilds in pnpm-workspace.yaml
#    allows none either), tsc of the backend, vite build of the UI with the plain widget.
FROM manifests AS build
RUN --mount=type=cache,id=pnpm-psp-example-plain,target=/root/.local/share/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --ignore-scripts --filter '@psp-examples/plain-api...' --filter @psp-examples/ui
COPY examples/contract/ examples/contract/
COPY examples/plain/api/ examples/plain/api/
COPY examples/ui/ examples/ui/
# build:plain fails when any @qubiq-psp/* module gets into the bundle (vite.config.ts, sdkModuleCheck)
RUN pnpm --filter @psp-examples/plain-api run build \
    && pnpm --filter @psp-examples/ui run build:plain

# 2. Production dependencies of the backend only: fastify, @fastify/static and the contract (routes.json) with its
#    own dependencies; no dev tools. The workspace layout stays: pnpm links them from /repo/node_modules/.pnpm.
FROM manifests AS deps
RUN --mount=type=cache,id=pnpm-psp-example-plain,target=/root/.local/share/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --prod --ignore-scripts --filter '@psp-examples/plain-api...'

# 3. Run: the compiled backend, its production node_modules and the built UI; no pnpm, no sources, no dev tools.
FROM ${NODE_IMAGE}
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4600 \
    APP_UI_DIR=/repo/ui \
    APP_TESTNET_ONLY=true
WORKDIR /repo
# Root-owned files: the process (user node) can read them, not change them
COPY --from=deps /repo/node_modules/ node_modules/
COPY --from=deps /repo/examples/contract/node_modules/ examples/contract/node_modules/
COPY --from=deps /repo/examples/plain/api/node_modules/ examples/plain/api/node_modules/
COPY examples/contract/package.json examples/contract/
COPY examples/contract/src/routes.json examples/contract/src/
COPY examples/plain/api/package.json examples/plain/api/
COPY --from=build /repo/examples/plain/api/dist/ examples/plain/api/dist/
COPY --from=build /repo/examples/ui/dist/plain/ ui/
WORKDIR /repo/examples/plain/api
USER node
EXPOSE 4600
# /api/config never calls the platform
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO /dev/null "http://127.0.0.1:${PORT}/api/config" || exit 1
CMD ["node", "dist/main.js"]
