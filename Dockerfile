FROM node:20-bookworm-slim

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    bash \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

# modelsdev is required at runtime by `scripts/check-env.mjs`. In Docker deployments we
# expect the host to provide it (mounted via docker-compose) at `/usr/local/lib/modelsdev`.
RUN ln -sf /usr/local/lib/modelsdev/bin/modelsdev /usr/local/bin/modelsdev

COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build

ENV NODE_ENV=production

EXPOSE 3000

CMD ["npm", "run", "start", "--", "-p", "3000", "-H", "0.0.0.0"]
