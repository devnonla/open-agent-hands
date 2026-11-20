FROM oven/bun:1 AS build
WORKDIR /app
COPY . .
RUN bun install --frozen-lockfile
RUN bun run build

FROM debian:bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends bubblewrap ca-certificates git \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --create-home --uid 1000 agenthands \
 && mkdir /data && chown agenthands /data
COPY --from=build /app/dist/agenthands /usr/local/bin/agenthands
USER agenthands
ENV HOST=0.0.0.0 PORT=8429 DATA_DIR=/data
VOLUME /data
EXPOSE 8429
CMD ["agenthands"]
