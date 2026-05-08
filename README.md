# world_observer

衛星オンボードで動く小型 VLM エージェントが、ダウンリンク帯域を自律的に節約する PoC です。
LFM2.5-VL を ReAct ループで動かし、Sentinel-2 の Before/After フレームを変化分類して
`submit_to_ground` か `drop` を判定します。Gemini / 局所 vLLM 1.6B / 学習済
LFM2.5-VL-450M-sft-grpo の 3 系統を UI から切替可能です。

## 構成

```
world_observer/
├─ README.md
├─ LICENSE
├─ pyproject.toml               Python パッケージ定義 (uv 管理)
├─ setup.sh                     uv sync + SimSat clone + patch
├─ docker-compose.yaml          wildfire LoRA / LFM2 agent vLLM の起動定義
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
├─ tools/                       エージェントツール (vision / wildfire / spectral / region / quality / classifier ...)
├─ simsat_client/               SimSat (Sentinel-2 mock backend) の HTTP wrapper
│
├─ services/                    Docker で起動するモデルサーブ
│  ├─ wildfire/                 FireEdge LoRA (transformers + peft, :8085)
│  └─ agent/                    LFM2.5-VL-450M-sft-grpo (vLLM, :8086)
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

- Linux (Ubuntu 24.04 で確認)
- Python 3.10+ (`uv` 推奨)
- Docker
- GPU (ローカル推論サーバを動かす場合のみ。Gemini 経路だけなら不要)

## Quickstart

```bash
git clone https://github.com/Grow-some/world_observer.git
cd world_observer

cp .env.example .env              # 必要なら GOOGLE_API_KEY を記入
WITH_SIMSAT=1 ./setup.sh          # uv sync + SimSat clone + patch + sim 起動
./scripts/download_models.sh      # モデル重みを HF Hub から DL
docker compose up -d              # wildfire LoRA :8085 + LFM2 agent vLLM :8086
./scripts/smoke_test.sh           # 動作確認
uv run python -m app.server       # アプリ起動
```

ブラウザで <http://localhost:7860> を開きます。

## サービス構成

| サーバ | port | 役割 | 起動 |
|---|---:|---|---|
| SimSat | 9005 | Sentinel-2 mock backend | `WITH_SIMSAT=1 ./setup.sh` |
| wildfire LoRA | 8085 | `detect_wildfire` ツールが叩く FireEdge LoRA | `docker compose up -d lfm-wildfire` |
| LFM2 agent vLLM | 8086 | LFM2.5-VL-450M-sft-grpo を vLLM で配信 | `docker compose up -d lfm2-agent` |

## 環境変数

`.env.example` を `.env` にコピー。通常は空のままで動きます。

```bash
GOOGLE_API_KEY=          # Settings ⚙ で Gemini を選ぶ場合のみ
SIMSAT_API_URL=          # SimSat がリモートの場合のみ (既定 http://localhost:9005)
```

## License

[MIT](LICENSE)
