# Coworld game/player image for cogame-agricola. The same image backs the
# game runnable (coworld-main) and the bundled scripted player; the coworld
# manifest selects the entrypoint via `run`.
FROM docker.io/library/node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts index.html ./
COPY public public
COPY src src
RUN npm run build:web

ENV NODE_ENV=production
CMD ["npx", "tsx", "src/server/coworld-main.ts"]
