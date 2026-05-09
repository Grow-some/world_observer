#!/usr/bin/env bash
# setup.sh — first-run bootstrap for SatelliteAgent.
#
# Idempotent: safe to re-run. Each step is skipped if its output is
# already in place.
#
# Steps:
#   1. Verify uv is installed.
#   2. Create .venv and install Python deps via uv sync.
#   3. Create an empty .env template if one isn't there yet.
#   4. (Optional, WITH_SIMSAT=1) Clone DPhi-Space/SimSat at the pinned
#      SHA into vendor/SimSat and apply patches/simsat/*.patch.
#      (The simsat container itself is started later via docker compose up -d.)
#
# Usage:
#   ./setup.sh                     # core install only
#   WITH_SIMSAT=1 ./setup.sh       # also clone+patch SimSat
#
set -euo pipefail

cd "$(dirname "$0")"

echo "[0/4] checking architecture..."
ARCH="$(uname -m)"
if [[ "$ARCH" == "x86_64" ]]; then
    echo "  ok ($ARCH)"
elif [[ "$ARCH" == "aarch64" ]]; then
    if [[ -f /etc/nv_tegra_release ]] || [[ "${JETSON:-0}" == "1" ]]; then
        echo "  Jetson detected ($ARCH) — GPU services require the Jetson compose override:"
        echo "    docker compose -f docker-compose.yaml -f docker-compose.jetson.yaml up -d"
    else
        echo "  WARNING: aarch64 detected but no Jetson signature found (/etc/nv_tegra_release)."
        echo "  If this is a Jetson device, re-run with: JETSON=1 ./setup.sh"
        echo "  Non-Jetson ARM is not supported for GPU services."
    fi
else
    echo "  ERROR: unsupported architecture '$ARCH'."
    echo "  Supported: x86_64 (standard) and aarch64 on NVIDIA Jetson (JETSON=1)."
    exit 1
fi

echo "[1/4] checking uv..."
if ! command -v uv >/dev/null 2>&1; then
    echo "  ERROR: uv is not installed."
    echo "  Install it from https://github.com/astral-sh/uv (e.g. 'pip install uv')"
    exit 1
fi
echo "  ok ($(uv --version))"

echo "[2/4] uv sync..."
uv sync --extra simsat --extra geo

echo "[3/4] .env template..."
if [ -f .env ]; then
    echo "  .env already exists — leaving it alone"
else
    cp .env.example .env
    echo "  copied .env.example → .env (all keys commented out — uncomment as needed)"
fi

echo "[4/4] SimSat (optional)..."
if [[ "${WITH_SIMSAT:-0}" == "1" ]]; then
    SIMSAT_SHA="52f5619330c1edbb2e330b2961a1a551bebc0d69"
    if [ ! -d vendor/SimSat ]; then
        echo "  cloning DPhi-Space/SimSat into vendor/SimSat..."
        mkdir -p vendor
        git clone https://github.com/DPhi-Space/SimSat.git vendor/SimSat
    fi
    pushd vendor/SimSat >/dev/null
    git fetch --quiet origin
    git checkout --quiet "$SIMSAT_SHA"
    if git apply --check ../../patches/simsat/*.patch >/dev/null 2>&1; then
        git apply ../../patches/simsat/*.patch
        echo "  applied patches/simsat/*.patch"
    else
        echo "  patches already applied (or repo dirty) — skipping"
    fi
    popd >/dev/null
    echo "  SimSat ready at vendor/SimSat — run 'docker compose up -d' to start it."
else
    echo "  skipped (set WITH_SIMSAT=1 to enable)."
    echo "  If you already have a reachable SimSat, set SIMSAT_API_URL in .env."
fi

if [[ "${ARCH}" == "aarch64" ]]; then
    COMPOSE_CMD="docker compose -f docker-compose.yaml -f docker-compose.jetson.yaml up -d"
else
    COMPOSE_CMD="docker compose up -d"
fi

cat <<EOF

Setup complete. Next:

    ./scripts/download_models.sh   # ~3 GB pull from HF Hub
    $COMPOSE_CMD  # start all services (SimSat + GPU servers + app)
    # open http://localhost:7860

EOF
