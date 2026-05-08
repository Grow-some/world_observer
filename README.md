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

- Linux (verified on Ubuntu 24.04)
- Python 3.10+ (`uv` recommended)
- Docker
- GPU (only when running local inference servers; not required for the Gemini-only path)

## Quickstart

```bash
git clone https://github.com/Grow-some/world_observer.git
cd world_observer

cp .env.example .env              # fill in GOOGLE_API_KEY if needed
WITH_SIMSAT=1 ./setup.sh          # uv sync + SimSat clone + patch + sim launch
./scripts/download_models.sh      # pull model weights from HF Hub
docker compose up -d              # wildfire LoRA :8085 + LFM2 agent vLLM :8086
./scripts/smoke_test.sh           # sanity check
uv run python -m app.server       # start the app
```

Open <http://localhost:7860> in a browser.

## Service layout

| Server | Port | Role | Launch |
|---|---:|---|---|
| SimSat | 9005 | Sentinel-2 mock backend | `WITH_SIMSAT=1 ./setup.sh` |
| wildfire LoRA | 8085 | FireEdge LoRA called by the `detect_wildfire` tool | `docker compose up -d lfm-wildfire` |
| LFM2 agent vLLM | 8086 | Serves LFM2.5-VL-450M-sft-grpo via vLLM | `docker compose up -d lfm2-agent` |

## Environment variables

Copy `.env.example` to `.env`. It can normally stay empty.

```bash
GOOGLE_API_KEY=          # only when selecting Gemini in Settings ⚙
SIMSAT_API_URL=          # only when SimSat is remote (default http://localhost:9005)
```

## License

[MIT](LICENSE)
