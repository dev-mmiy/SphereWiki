# The SphereWiki sync super-peer (Hocuspocus WebSocket server), packaged for a container host
# (Fly.io / Railway / any Docker platform). Built from the monorepo root as context so the pnpm
# workspace resolves; `pnpm deploy` then emits a self-contained /out (dist + only the prod deps,
# including the built @spherewiki/shared) for a small runtime image.
#
# Build + run locally:
#   docker build -f apps/server/Dockerfile -t spherewiki-sync .
#   docker run --rm -p 8787:8787 spherewiki-sync
# Then point a client at it:  VITE_SYNC_URL=ws://localhost:8787

FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
# Copy the whole workspace (the .dockerignore trims node_modules / dist / caches).
COPY . .
RUN pnpm install --frozen-lockfile
# Build @spherewiki/shared then the server (the `...` pulls in workspace deps), then emit a
# self-contained deployable (its own dist + resolved prod node_modules) to /out.
RUN pnpm --filter "@spherewiki/server..." build
RUN pnpm --filter @spherewiki/server deploy --prod --legacy /out

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# The super-peer's port (the host may override PORT) and its durable per-room persistence dir — mount
# a volume here on the host so rooms survive restarts/redeploys (see fly.toml's [mounts]).
ENV PORT=8787
ENV SPHEREWIKI_DATA_DIR=/data
COPY --from=build /out /app
RUN mkdir -p /data
EXPOSE 8787
# Run as the built-in non-root `node` user.
USER node
CMD ["node", "dist/index.js"]
