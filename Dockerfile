FROM node:22-alpine AS build

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci

COPY server/ server/
COPY web/ web/
RUN npm run build -w web && npm run build -w server

FROM node:22-alpine

RUN apk add --no-cache python3 make g++

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY server/package.json server/
RUN npm ci -w server --omit=dev && apk del python3 make g++

COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/build web/build

RUN mkdir -p data/backups

VOLUME ["/app/data"]
EXPOSE 8082

CMD ["node", "server/dist/index.js"]
