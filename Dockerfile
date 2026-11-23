FROM oven/bun:1 AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
RUN bun run build

FROM debian:bookworm-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends bubblewrap ca-certificates git \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --create-home --uid 1000 agenthands \
 && mkdir /data && chown agenthands /data
USER agenthands
ENV HOST=0.0.0.0 PORT=8429 DATA_DIR=/data AGENTHANDS_INSTALL=docker
VOLUME /data
EXPOSE 8429
CMD ["agenthands"]

FROM base AS release
ARG TARGETARCH
COPY --chmod=755 agenthands-${TARGETARCH} /usr/local/bin/agenthands

FROM base AS source
COPY --from=build /app/dist/agenthands /usr/local/bin/agenthands
