# vLLM image patched for LFM2.5-VL serving (CUDA 12.x, e.g. RTX 4060).
#
# Why each layer is needed:
# - vllm/vllm-openai:latest: official stable build with CUDA 12 support.
# - transformers 5.5.0 pin: 5.x is when Lfm2Vl entered transformers, but
#   newer releases shuffle private symbols vLLM's adapter relies on.
#   5.5.0 is the version confirmed working with the sft-grpo checkpoint.
# - sed patch on lfm2.py: vLLM's bundled adapter reads
#   `config.block_ff_dim` (the old transformers attribute name).
#   transformers 5.x renamed it to `intermediate_size`, so the launch
#   would crash with AttributeError without this rename.
# - lfm2_tool_parser.py copy: Python plugin loaded via
#   `--tool-parser-plugin /agent/lfm2_tool_parser.py` so vLLM can decode
#   the LFM2.5-VL-450M-sft-grpo Python-style tool calls
#   (`[fn(arg=...)]`) into OpenAI tool_calls JSON.
#
# Build:
#   docker build -t worldobserver/lfm2-agent:latest -f services/agent/Dockerfile .
#
# Run (bind a checkpoint at /model):
#   docker run --gpus all -p 8086:8000 \
#     -v /path/to/LFM2.5-VL-450M-sft-grpo:/model:ro \
#     worldobserver/lfm2-agent:latest \
#     --model /model --served-model-name LFM2.5-VL-450M-sft-grpo \
#     --port 8000 --host 0.0.0.0 \
#     --gpu-memory-utilization 0.5 --max-model-len 4096 \
#     --enforce-eager --trust-remote-code \
#     --enable-auto-tool-choice \
#     --tool-parser-plugin /agent/lfm2_tool_parser.py \
#     --tool-call-parser lfm2_pythonic
#
# Or run via the repo root docker-compose.yaml.

# vllm/vllm-openai:v0.20.1 is the latest stable as of 2026-05.
# cu129 = CUDA 12.9 driver-compatible (RTX 4060 / Ampere+ supported).
# Works with docker and podman (Compose spec v3 GPU devices syntax).
FROM docker.io/vllm/vllm-openai:v0.20.1

RUN apt-get update \
 && apt-get install -y --no-install-recommends git \
 && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
    "transformers==5.5.0" \
    "tokenizers==0.22.2" \
    "huggingface_hub==1.9.0" \
    "mistral_common==1.11.0" \
    "safetensors==0.6.2"

# vLLM >=0.20.1 has already fixed the block_ff_dim → intermediate_size rename
# in lfm2.py. No sed patch needed.

COPY agent/lfm2_tool_parser.py /agent/lfm2_tool_parser.py

# Entrypoint (`vllm serve`) is inherited from the base image.
EXPOSE 8000
