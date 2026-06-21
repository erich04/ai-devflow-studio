FROM node:24-bookworm-slim AS app

ENV CI=1
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps

RUN corepack pnpm install --frozen-lockfile
RUN corepack pnpm --filter @ai-devflow/shared build
RUN corepack pnpm --filter @ai-devflow/api build
RUN corepack pnpm --filter @ai-devflow/web build

EXPOSE 4310 4311
