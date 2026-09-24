FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .
ARG APP_GIT_SHA=unknown
ARG APP_BUILD_TIME
ENV APP_GIT_SHA=$APP_GIT_SHA
ENV APP_BUILD_TIME=$APP_BUILD_TIME
RUN npm run build

FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402 AS runtime

ENV NODE_ENV=production
ENV PORT=4173
ENV HOST=0.0.0.0
ENV DATABASE_URL=file:/data/homelab.db

WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY LICENSE THIRD_PARTY_NOTICES.md ./
ARG APP_GIT_SHA=unknown
ARG APP_BUILD_TIME
ENV APP_GIT_SHA=$APP_GIT_SHA
ENV APP_BUILD_TIME=$APP_BUILD_TIME
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-v* \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg /usr/local/bin/pnpm /usr/local/bin/pnpx \
    && mkdir -p /data \
    && chown node:node /data \
    && chmod 0700 /data

VOLUME ["/data"]
EXPOSE 4173
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4173/api/health >/dev/null || exit 1

CMD ["sh", "-c", "./node_modules/.bin/prisma db push --skip-generate && node dist/server/index.js"]
