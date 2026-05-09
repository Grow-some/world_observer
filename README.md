# world_observer

A PoC of a small VLM agent that runs onboard a satellite and autonomously
saves downlink bandwidth. LFM2.5-VL is driven in a ReAct loop, classifies
change between Sentinel-2 Before/After frames, and decides between
`submit_to_ground` and `drop`. Three backends are switchable from the UI:
Gemini, a local vLLM 1.6B, and the fine-tuned LFM2.5-VL-450M-sft-grpo.

## Layout

```
world_observer/
├─ README.md
├─ LICENSE
├─ pyproject.toml               Python package definition (managed by uv)
├─ setup.sh                     uv sync + SimSat clone + patch
├─ docker-compose.yaml          Service definitions for wildfire LoRA / LFM2 agent vLLM
├─ .env.example                 Environment variable template
│
├─ app/                         FastAPI backend + frontend
│  ├─ server.py                 /api/fetch, /api/run_agent (SSE)
│  └─ static/                   index.html / app.css / js/
│
├─ agent/                       ReAct loop
│  ├─ react_loop_openai.py      OpenAI-compatible path (Gemini / local vLLM)
│  ├─ react_loop.py             google-genai SDK path
│  ├─ lfm2_agent.py             Multi-turn loop for LFM2.5-VL-450M-sft-grpo
│  ├─ lfm2_tool_parser.py       Pythonic tool parser for vLLM
│  ├─ providers.py
│  └─ prompts/
│
├─ tools/                       Agent tools (vision / wildfire / spectral / region / quality / classifier ...)
├─ simsat_client/               HTTP wrapper for SimSat (Sentinel-2 mock backend)
│
├─ services/                    Model serving stacks launched via Docker
│  ├─ wildfire/                 FireEdge LoRA (transformers + peft, :8085)
│  └─ agent/                    LFM2.5-VL-450M-sft-grpo (vLLM, :8086)
│
├─ config/
│  ├─ providers.yaml            VLM provider catalog (UI Settings ▼)
│  └─ catalog_regions.yaml      Region catalog
│
├─ scripts/
│  ├─ download_models.sh        Fetch model weights from HF Hub
│  ├─ smoke_test.sh             Automated check from boot through one path
│  └─ serve_vllm_lfm2.sh
│
└─ patches/simsat/              Local patches for the SimSat fork
```

## Requirements

| Tool | Version | Notes |
|---|---|---|
| Architecture | **x86\_64 (amd64)** or **aarch64 (Jetson Orin)** | Jetson uses separate Dockerfiles; see [Jetson (aarch64)](#jetson-aarch64) |
| Linux | Ubuntu 22.04 / 24.04 | other distros are untested |
| Python | 3.10+ | managed via `uv` |
| [uv](https://github.com/astral-sh/uv) | latest | Python package / venv manager |
| Docker Engine | 24+ | |
| [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html) | latest | required for GPU services |
| GPU (CUDA) | — | only for local inference servers; **not** required for the Gemini-only path |
| [Hugging Face account](https://huggingface.co/join) | — | required to download model weights; some repos need access approval |

## Environment setup

### 1. Install uv

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
# or: pip install uv
```

### 2. Install Docker + NVIDIA Container Toolkit (GPU path only)

Follow the official guides:

- Docker Engine: <https://docs.docker.com/engine/install/ubuntu/>
- NVIDIA Container Toolkit: <https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html>

Quick check:

```bash
docker run --rm --gpus all nvidia/cuda:12.1.0-base-ubuntu22.04 nvidia-smi
```

### 3. Install huggingface-cli

`scripts/download_models.sh` calls the `hf` CLI (provided by `huggingface_hub[cli]`).
The script defaults to `uv run hf`; install it as a uv tool so it is available:

```bash
uv tool install "huggingface_hub[cli]"
# verify
hf --version
```

Alternatively you can install it in any Python environment:

```bash
pip install "huggingface_hub[cli]"
```

### 4. Authenticate with Hugging Face (if required)

Some model repos (e.g. gated models) require you to be logged in:

```bash
huggingface-cli login
# paste your HF access token from https://huggingface.co/settings/tokens
```

You can also export the token as an environment variable instead:

```bash
export HF_TOKEN=hf_...
```

## Quickstart

```bash
git clone https://github.com/Grow-some/world_observer.git
cd world_observer

# 1. Core Python environment
cp .env.example .env              # edit: add GOOGLE_API_KEY if using Gemini
WITH_SIMSAT=1 ./setup.sh          # uv sync + SimSat clone + patch

# 2. Pull model weights (~2.8 GB total)
./scripts/download_models.sh

# 3. Start all services (SimSat + GPU servers + app server)
docker compose up -d

# 4. Sanity check
#    smoke_test starts its own app server; use APP_PORT to avoid the :7860 conflict
APP_PORT=7861 ./scripts/smoke_test.sh
```

Open <http://localhost:7860> in a browser.

> **Gemini-only path (no GPU needed)**  
> Skip step 2. Set `GOOGLE_API_KEY` in `.env` and choose *Gemini* in Settings ⚙.

## Service layout

| Server | Port | Role | Launch |
|---|---:|---|---|
| SimSat | 9005 | Sentinel-2 mock backend | `docker compose up -d simsat` |
| wildfire LoRA | 8085 | FireEdge LoRA called by the `detect_wildfire` tool | `docker compose up -d lfm-wildfire` |
| LFM2 agent vLLM | 8086 | Serves LFM2.5-VL-450M-sft-grpo via vLLM | `docker compose up -d lfm2-agent` |
| app server | 7860 | FastAPI + UI | `docker compose up -d app-server` |

## Environment variables

Copy `.env.example` to `.env`. It can normally stay empty.

```bash
GOOGLE_API_KEY=          # only when selecting Gemini in Settings ⚙
SIMSAT_API_URL=          # only when SimSat is remote (default http://localhost:9005)
```

## Jetson (aarch64)

Jetson Orin (JetPack 6.1+, L4T r36.4+) is supported via platform-specific Docker overrides.
`pytorch/pytorch` and `vllm/vllm-openai` publish x86_64-only images; the Jetson path replaces
them with NVIDIA's L4T-PyTorch base and [dusty-nv/jetson-containers](https://github.com/dusty-nv/jetson-containers) vLLM.

| | |
|---|---|
| Device | Jetson Orin NX 16 GB or Orin AGX 32/64 GB recommended (8 GB works; see memory note) |
| JetPack | 6.1+ (L4T r36.4+) |
| Docker | included in JetPack SDK |
| NVIDIA runtime | `sudo nvidia-ctk runtime configure --runtime=docker && sudo systemctl restart docker` |

### Jetson quickstart

```bash
JETSON=1 WITH_SIMSAT=1 ./setup.sh
./scripts/download_models.sh
docker compose -f docker-compose.yaml -f docker-compose.jetson.yaml up -d
APP_PORT=7861 ./scripts/smoke_test.sh   # optional
```

> **Memory note**
> 
> | Platform | VRAM / RAM | `--gpu-memory-utilization` | Measured peak |
> |---|---|---|---|
> | RTX 4060 (discrete 8 GB VRAM) | 8 GB dedicated | `0.5` (default) | ~7 GB — works fine |
> | Jetson Orin NX 16 GB (shared LPDDR5) | 16 GB shared | `0.40` (jetson override) | ~6.4 GB reserved |
> | Jetson Orin NX 8 GB (shared LPDDR5) | 8 GB shared | lower to `0.25`–`0.30` | OS takes 3–4 GB of the shared pool |
> 
> On discrete-VRAM GPUs, system RAM is separate so `0.5` is safe even on 8 GB cards.
> On Jetson, the OS and all processes share the same LPDDR5 pool, requiring a lower value.

### Jetson base images

| Service | x86_64 base | Jetson base |
|---|---|---|
| wildfire / precursor | `pytorch/pytorch:2.11.0-cuda12.6-cudnn9-runtime` | `nvcr.io/nvidia/l4t-pytorch:r36.4.0-pth2.3-py3` |
| lfm2-agent (vLLM) | `vllm/vllm-openai:v0.20.1` | `dustynv/vllm:r36.4.0` ([tags](https://hub.docker.com/r/dustynv/vllm/tags)) |

The SimSat and app-server containers use standard multi-arch Python/Ubuntu bases and build unchanged on Jetson.

## License

[MIT](LICENSE)
