# world_observer

衛星ダウンリンク帯域を自律的に最適化する ReAct VLM エージェントの PoC です。  
LFM2.5-VL を ReAct ループで動かし、Sentinel-2 の Before/After フレームを変化分類して
`submit_to_ground` か `drop` を判定します。Gemini / 局所 vLLM (1.6B) / 学習済
LFM2.5-VL-450M-sft-grpo の 3 系統を Web UI から切り替えられます。

## 構成

```
world_observer/
├─ README.md
├─ LICENSE
├─ pyproject.toml               Python パッケージ定義 (uv 管理)
├─ uv.lock                      uv ロックファイル
├─ setup.sh                     uv sync + SimSat clone + patch
├─ docker-compose.yaml          全 4 サービス起動定義
├─ .env.example                 環境変数テンプレ
│
├─ app/                         FastAPI バックエンド + フロント
│  ├─ server.py                 /api/fetch, /api/run_agent (SSE)
│  └─ static/                   index.html / app.css / js/
│
├─ agent/                       ReAct ループ
│  ├─ react_loop_openai.py      OpenAI 互換経路 (Gemini / 局所 vLLM)
│  ├─ react_loop.py             google-genai SDK 経路
│  ├─ lfm2_agent.py             LFM2.5-VL-450M-sft-grpo 用 multi-turn loop
│  ├─ lfm2_tool_parser.py       vLLM 用 pythonic tool parser
│  ├─ providers.py
│  └─ prompts/
│
├─ tools/                       エージェントツール
│                               (vision / wildfire / spectral / region / quality / classifier …)
├─ simsat_client/               SimSat (Sentinel-2 mock backend) の HTTP wrapper
│
├─ services/                    コンテナ化されたモデルサービス
│  ├─ wildfire/                 FireEdge LoRA (transformers 5.5.0 + peft, :8085 / :8089)
│  ├─ agent/                    LFM2.5-VL-450M-sft-grpo (vLLM v0.20.1, :8086)
│  └─ app/                      Web UI サーバー (FastAPI + HTML/JS, :7860)
│
├─ config/
│  ├─ providers.yaml            VLM provider カタログ (UI Settings ▼)
│  └─ catalog_regions.yaml      地域カタログ
│
├─ scripts/
│  ├─ download_models.sh        HF Hub からモデル重みを取得
│  ├─ smoke_test.sh             起動〜1経路の自動検証
│  └─ serve_vllm_lfm2.sh
│
└─ patches/simsat/              SimSat fork へのローカルパッチ
```

## 必要なもの

| 要件 | 備考 |
|---|---|
| Linux (Ubuntu 24.04 で確認) | |
| Docker + Docker Compose | Compose spec v3 GPU devices 構文に対応したバージョン |
| NVIDIA GPU (8 GB VRAM 以上) | RTX 4060 8 GB で動作確認。Gemini 経路のみなら不要 |
| NVIDIA ドライバー ≥ 565 | CUDA 13.x 対応。ドライバー 595.71.01 / CUDA 13.2 で確認済み |
| [NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html) | `docker run --gpus all` を有効にするため必要 |
| Python 3.10+ + [uv](https://docs.astral.sh/uv/) | `setup.sh` や スクリプト類の実行に使用 |

## Quickstart

```bash
git clone https://github.com/Grow-some/world_observer.git
cd world_observer

# 1. 依存関係インストール + SimSat パッチ適用
cp .env.example .env              # 必要なら GOOGLE_API_KEY を記入
WITH_SIMSAT=1 ./setup.sh          # uv sync + SimSat clone + patch + sim 起動

# 2. モデル重みのダウンロード
./scripts/download_models.sh      # HF Hub からモデル重みを取得 (.env の *_MODEL_DIR に配置)

# 3. 全コンテナ起動 (初回はビルドあり)
docker compose up -d

# 4. 動作確認
./scripts/smoke_test.sh
```

ブラウザで <http://localhost:7860> を開きます。

## サービス構成

`docker compose up -d` で以下の 4 サービスがすべて起動します。

| コンテナ | ポート | 役割 | ベースイメージ |
|---|---:|---|---|
| `lfm-wildfire` | 8085 | wildfire LoRA 推論 (`detect_wildfire` ツール) | `pytorch/pytorch:2.11.0-cuda12.6-cudnn9-runtime` |
| `lfm-precursor` | 8089 | wildfire-precursor LoRA 推論 (`predict_wildfire_risk` ツール) | 同上 (`UPGRADE_LIBS=1` ビルド) |
| `lfm2-agent` | 8086 | LFM2.5-VL-450M-sft-grpo を vLLM で配信 | `vllm/vllm-openai:v0.20.1` |
| `world-observer-app` | **7860** | Web UI サーバー (FastAPI + HTML/JS) | `python:3.12-slim` |

SimSat (port 9005) はオプションです。`WITH_SIMSAT=1 ./setup.sh` または
`docker compose -f vendor/SimSat/docker-compose.yaml up -d sim` で起動できます。

### アクセス方法

| エンドポイント | URL |
|---|---|
| **Web UI** | <http://localhost:7860> |
| wildfire LoRA API | <http://localhost:8085/v1> |
| wildfire-precursor API | <http://localhost:8089/v1> |
| LFM2 agent vLLM API | <http://localhost:8086/v1> |
| SimSat (任意) | <http://localhost:9005> |

## 依存関係の詳細

### コンテナ内ライブラリ

| サービス | 主要ライブラリ |
|---|---|
| wildfire / precursor | `transformers==5.5.0`, `torchvision==0.26.0`, `peft>=0.18`, `accelerate>=1.0` |
| wildfire-precursor (`UPGRADE_LIBS=1`) | `transformers>=5.7,<5.8`, `peft>=0.19,<0.20` |
| lfm2-agent | `transformers==5.5.0`, `tokenizers==0.22.2`, `huggingface_hub==1.9.0` |
| app-server | `pyproject.toml` / `uv.lock` で管理 (FastAPI, httpx, google-genai 等) |

> **Note**: wildfire コンテナは PEP 668 対策として `uv venv --system-site-packages /opt/venv`
> でベースイメージの torch/CUDA ライブラリを継承しています。

## 環境変数

`.env.example` を `.env` にコピーして編集します。通常はデフォルト値のままで動きます。

```bash
# Settings ⚙ で Provider = Gemini を選ぶ場合のみ
# GOOGLE_API_KEY=

# SimSat がリモートにある場合のみ (既定: http://localhost:9005)
# SIMSAT_API_URL=http://localhost:9005

# モデル重みのホストパス (download_models.sh が自動設定)
# WILDFIRE_MODEL_DIR=./models/wildfire-staging
# WILDFIRE_PRECURSOR_ADAPTER_DIR=./models/wildfire-precursor-staging/adapter
# LFM2_AGENT_MODEL_DIR=./models/sft-grpo
```

## License

[MIT](LICENSE)
