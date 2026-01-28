FROM python:3.13-bookworm

ARG UV_VERSION=0.9.26
ARG BUN_VERSION=1.3.6

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  dnsutils \
  gnupg \
  git \
  bash \
  coreutils \
  iproute2 \
  jq \
  netcat-openbsd \
  openssh-client \
  procps \
  ripgrep \
  socat \
  tini \
  && rm -rf /var/lib/apt/lists/*

# Node.js 24.x
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
  && apt-get update \
  && apt-get install -y --no-install-recommends nodejs \
  && rm -rf /var/lib/apt/lists/*

# bun
RUN curl -fsSL https://bun.sh/install | bash -s -- bun-v${BUN_VERSION} \
  && install -m 0755 /root/.bun/bin/bun /usr/local/bin/bun \
  && install -m 0755 /root/.bun/bin/bunx /usr/local/bin/bunx \
  && rm -rf /root/.bun

# uv
RUN curl -fsSL https://astral.sh/uv/install.sh | env UV_VERSION="${UV_VERSION}" sh \
  && install -m 0755 /root/.local/bin/uv /usr/local/bin/uv \
  && rm -rf /root/.local

RUN mkdir -p /vercel/sandbox/workspace

WORKDIR /vercel/sandbox/workspace

ENV HOME=/vercel/sandbox/workspace

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bash", "-lc", "sleep infinity"]
