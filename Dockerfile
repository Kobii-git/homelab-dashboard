FROM node:22-alpine AS build

ARG APP_GIT_SHA=unknown
ARG APP_BUILD_TIME
ENV APP_GIT_SHA=$APP_GIT_SHA
ENV APP_BUILD_TIME=$APP_BUILD_TIME

WORKDIR /app
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm install

COPY . .
RUN npm run build

FROM node:22-alpine

ARG APP_GIT_SHA=unknown
ARG APP_BUILD_TIME
ENV APP_GIT_SHA=$APP_GIT_SHA
ENV APP_BUILD_TIME=$APP_BUILD_TIME

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4173
ENV HOST=0.0.0.0
ENV DATABASE_URL=file:/data/homelab.db

COPY package.json package-lock.json* ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma

VOLUME ["/data"]
EXPOSE 4173

CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/server/index.js"]
