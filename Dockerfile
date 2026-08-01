FROM node:24-bookworm-slim@sha256:235600a8101ab264e117b1768e925532262668dc9b581ef1dd7d96ced463b8e7 AS builder

ENV CI=1 \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps

RUN corepack pnpm install --frozen-lockfile
RUN corepack pnpm --filter @ai-devflow/api build
RUN corepack pnpm --filter @ai-devflow/web build

FROM node:24-bookworm-slim@sha256:235600a8101ab264e117b1768e925532262668dc9b581ef1dd7d96ced463b8e7 AS api-runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=builder --chown=node:node /app/apps/api/dist ./

USER node
EXPOSE 4310
CMD ["node", "server.js"]

FROM node:24-bookworm-slim@sha256:235600a8101ab264e117b1768e925532262668dc9b581ef1dd7d96ced463b8e7 AS web-runtime

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static

USER node
EXPOSE 4311
CMD ["node", "apps/web/server.js"]
