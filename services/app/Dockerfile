# App server — lightweight Python container serving the UI on :7860.
# No GPU needed; this container proxies requests to the GPU services
# (lfm-wildfire :8085, lfm-precursor :8089, lfm2-agent :8086).
FROM docker.io/python:3.12-slim

# Install uv via the official installer script.
# Ref: https://docs.astral.sh/uv/guides/integration/docker/#installing-uv
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates git && \
    rm -rf /var/lib/apt/lists/*
ADD https://astral.sh/uv/install.sh /uv-installer.sh
RUN sh /uv-installer.sh && rm /uv-installer.sh

ENV PATH="/root/.local/bin:${PATH}" \
    UV_NO_CACHE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Install Python deps from lockfile (no GPU extras needed).
COPY pyproject.toml uv.lock /app/
RUN uv sync --no-dev --no-install-project

# Copy source packages.
COPY agent/        /app/agent/
COPY app/          /app/app/
COPY tools/        /app/tools/
COPY simsat_client/ /app/simsat_client/

EXPOSE 7860

# data/ and config/ are mounted at runtime via docker-compose volumes.
CMD ["/root/.local/bin/uv", "run", "uvicorn", "app.server:app", "--host", "0.0.0.0", "--port", "7860"]
