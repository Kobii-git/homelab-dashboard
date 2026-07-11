FROM node:22-alpine AS build

ARG APP_GIT_SHA=unknown
ARG APP_BUILD_TIME
ENV APP_GIT_SHA=$APP_GIT_SHA
ENV APP_BUILD_TIME=$APP_BUILD_TIME

WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine AS runtime

ARG APP_GIT_SHA=unknown
ARG APP_BUILD_TIME
ENV APP_GIT_SHA=$APP_GIT_SHA
ENV APP_BUILD_TIME=$APP_BUILD_TIME
ENV NODE_ENV=production
ENV PORT=4173
ENV HOST=0.0.0.0
ENV DATABASE_URL=file:/data/homelab.db

WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown node:node /data && chmod 0700 /data

VOLUME ["/data"]
EXPOSE 4173
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4173/api/health >/dev/null || exit 1

CMD ["sh", "-c", "./node_modules/.bin/prisma db push --skip-generate && node dist/server/index.js"]
