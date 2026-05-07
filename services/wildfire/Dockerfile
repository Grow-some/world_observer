# Public PyTorch base — provides torch + CUDA 12.6 toolchain.
# transformers / peft are pinned below to match the LoRA fine-tune env.
# pytorch/pytorch:2.11.0 is the latest stable as of 2026-05.
FROM docker.io/pytorch/pytorch:2.11.0-cuda12.6-cudnn9-runtime

# Install uv via the official installer script.
# Ref: https://docs.astral.sh/uv/guides/integration/docker/#installing-uv
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*
ADD https://astral.sh/uv/install.sh /uv-installer.sh
RUN sh /uv-installer.sh && rm /uv-installer.sh

# Create a venv with --system-site-packages so the torch/CUDA libs installed
# by the pytorch base image are visible, while avoiding PEP 668 restrictions
# on the Debian system Python.  uv will install into this venv by default.
RUN /root/.local/bin/uv venv --system-site-packages /opt/venv

ENV PYTHONUNBUFFERED=1 \
    HF_HUB_DISABLE_TELEMETRY=1 \
    UV_NO_CACHE=1 \
    VIRTUAL_ENV=/opt/venv \
    PATH="/opt/venv/bin:/root/.local/bin:${PATH}"

WORKDIR /app

# Pin packages to match the LoRA fine-tune environment:
#   transformers==5.5.0  → recall=0.933 (reproducibility requirement)
#   tokenizers not pinned: transformers 5.5.0 requires >=0.22.0,<=0.23.0
#     (v5.5.0/setup.py), but tokenizers==0.22.0 declares huggingface-hub<1.0
#     which conflicts with transformers' own huggingface-hub>=1.5.0 requirement.
#     uv will resolve a compatible version within transformers' stated range.
#   torchvision==0.26.0  → torch 2.11.0 compat (pytorch/vision README matrix;
#                          torchvision 0.26.0 on PyPI declares torch==2.11.0)
RUN uv pip install \
    "transformers==5.5.0" \
    "torchvision==0.26.0"

# peft>=0.18, accelerate, fastapi, uvicorn, pillow
# torchvision excluded here (pinned above).
COPY requirements.txt /app/requirements.txt
RUN grep -v '^torchvision' requirements.txt | uv pip install -r /dev/stdin

# The wildfire-precursor LoRA needs transformers >=5.7 and peft >=0.19.
# Set UPGRADE_LIBS=1 at build time when serving the precursor adapter.
ARG UPGRADE_LIBS=0
RUN if [ "$UPGRADE_LIBS" = "1" ]; then \
        uv pip install \
            "transformers>=5.7,<5.8" \
            "peft>=0.19,<0.20"; \
    fi

COPY server.py /app/server.py

EXPOSE 8000
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000"]
