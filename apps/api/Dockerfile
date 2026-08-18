# LifeHub API — portable container image (runs identically in dev/staging/prod)
FROM node:22-slim AS base
WORKDIR /app
ENV NODE_ENV=production

# System dependencies:
#  - tesseract-ocr: real OCR for scanned documents (the app falls back to a text
#    driver when it's absent, so images build without it too, but production wants it).
#  - ca-certificates: TLS to Postgres / S3 / Stripe.
RUN apt-get update \
  && apt-get install -y --no-install-recommends tesseract-ocr ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install ALL deps — the tsx runtime is used to run migrations, the worker and the
# server directly from TypeScript, so it must be present at runtime (not dev-only).
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY . .

# Non-root runtime user
RUN useradd -m appuser && chown -R appuser /app
USER appuser

EXPOSE 4000
# Default command runs migrations then the API (used by docker-compose).
# On Render the migration step is the service's preDeployCommand and the start
# command is overridden per-service (api vs worker) — see render.yaml.
CMD ["sh", "-c", "npx tsx src/db/migrate.ts && npx tsx src/index.ts"]
