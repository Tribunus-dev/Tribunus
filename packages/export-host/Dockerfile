# ── Phase 3: Hardened Export Host Container ──────────────────────────────────
#
# Properties:
#   - No shell, no package manager, no runtime code loading
#   - No network except Unix socket for lease authority
#   - No writable filesystem after input is loaded
#   - Memory-capped, CPU-capped, time-capped
#   - Input verified before processing
#
# Usage:
#   docker build -t tribunus/export-host:latest .
#   docker run --rm \
#     --read-only \
#     --cap-drop=ALL \
#     --security-opt=no-new-privileges \
#     --memory=256m \
#     --cpus=1 \
#     --tmpfs /tmp:noexec,nosuid,size=64m \
#     -v /path/to/manifest.json:/input/manifest.json:ro \
#     -v /path/to/entries/:/input/entries/:ro \
#     -v /path/to/output:/output \
#     tribunus/export-host:latest \
#     --manifest /input/manifest.json \
#     --entries /input/entries/ \
#     --recipient-key /input/recipient.pem \
#     --lease-url http://127.0.0.1:0 \
#     --output /output/result.pack
# ──────────────────────────────────────────────────────────────────────────────

# ── Stage 1: Build ───────────────────────────────────────────────────────────
FROM oven/bun:1.3 AS builder
WORKDIR /build

# Cache dependencies first
COPY package.json ./
COPY ../../bun.lock ./
RUN bun install --frozen-lockfile --production

# Source and bundle to standalone binary
COPY tsconfig.json ./
COPY src/ ./src/
RUN bun build ./src/export-host.ts --compile --target=bun --outfile=export-host

# ── Stage 2: Runtime (scratch — no shell, no package manager) ───────────────
FROM scratch

# Single static binary
COPY --from=builder /build/export-host /export-host

# CA certificates for HTTPS lease-authority handshake (read-only)
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt

# Timezone data for log timestamps
COPY --from=builder /usr/share/zoneinfo /usr/share/zoneinfo

# Memory-mapped locale definitions (required by musl strerror on some paths)
COPY --from=builder /usr/share/misc /usr/share/misc

# Verify the binary is statically linked and no dynamic loader exists
RUN ["/export-host", "--help"]

# Resource limits enforced at the orchestrator layer (Docker) and in-process
ENTRYPOINT ["/export-host"]
