# Monitoring Agent — Fact Check & Design Gap Analysis

`docs/known_issues.md` に記載された既知問題を実コードに照らしてファクトチェックし、その上で「ユーザのクエリで監視地点をセットし、定期的に監視するエージェント」を成立させるために不足している機能・仕様を洗い出す。

本ドキュメントは設計ノートで、実装変更は含まない。

---

## 1. `known_issues.md` のファクトチェック

### 1.1 「`127.0.0.1:8002` Connection refused」 — ✅ 概ね正確

| 主張 | 実コード | 判定 |
|---|---|---|
| `lfm25_vl_local` の `base_url: http://127.0.0.1:8002/v1` がコンテナ外向け | [config/providers.yaml](config/providers.yaml#L29-L35) | ✅ 一致 |
| サーバの `default: true` より localStorage が優先される | [app/static/js/providers.js](app/static/js/providers.js#L70-L74) `provs.find(p => p.name === saved.provider) ? saved.provider : (provs.find(p => p.default)?.name …)` | ✅ 一致 |
| localStorage キーは `satagent.vlm` | [app/static/js/providers.js](app/static/js/providers.js#L4) `const STORAGE_KEY = "satagent.vlm";` | ✅ 一致 |
| `lfm25_vl_local` の `default: false` 明示 | [config/providers.yaml](config/providers.yaml#L33) | ✅ 一致 |

**追加で見つけた具体的問題箇所**
- [config/providers.yaml](config/providers.yaml#L26-L35) のコメントは「コンテナ外で `vllm serve` を立てる前提」だが、`docker-compose.yaml` で UI を立てた瞬間、ブラウザ → サーバ → `http://127.0.0.1:8002` の順で経由するため、コンテナ内 server.py が `127.0.0.1` を解決してしまい必ず失敗する（コンテナの localhost には vLLM は存在しない）。`base_url` は `http://host.docker.internal:8002/v1` などにすべきで、現状の値は事実上常に壊れている。
- [app/server.py](app/server.py#L62-L65) の起動ログは `Gemini path disabled (local vLLM provider is used by default)` と表示するが、実際の `default: true` は `lfm2_agent_openai` であり、メッセージが誤解を招く。

### 1.2 Watch — `verdict=end_turn` のまま完走しない

#### (a) 「`tool_choice="auto"` でテキスト応答になる」 — ❌ **現コードと不一致（記述が古い）**

[agent/react_loop_openai.py](agent/react_loop_openai.py#L109-L155) を確認した範囲では:

```python
# Always use tool_choice="required": LFM2.5-VL-450M-sft-grpo was
# trained with tool_choice="required" …
"tool_choice": "required",
```

すなわち `forced_tool_steps` というロジックは現在のソースには **存在しない**（grep ヒット 0 件）。`tool_choice` は常時 `"required"` で固定。`known_issues.md` のこの節は過去のリビジョンに対する記述で、現状にはあてはまらない。**修正が必要。**

実際に `verdict = end_turn` が出る経路は次の方:

```python
# react_loop_openai.py L173-L178
tool_calls = msg.get("tool_calls") or []
if not tool_calls:
    yield {"type": "final", "name": "end_turn", …}
    return
```

つまり `tool_choice="required"` を出していても、vLLM 側がツール呼び出し JSON を生成できず空 `tool_calls` を返した時点で `end_turn` が確定する。これは「auto に切り替わっているから」ではない。

#### (b) 「`classify_change` ループ」 — ⚠️ 半分正しい

- ツールカタログに `classify_change` 等が含まれるのは事実 → [agent/react_loop_openai.py](agent/react_loop_openai.py#L60-L97) の `_tool_catalog_block` および `tools/schema.py` の `TOOL_SCHEMAS`。
- 既に [agent/react_loop_openai.py](agent/react_loop_openai.py#L208-L218) で「`classify_change` 後にスペクトル系ツールを呼べ」とユーザロールでヒントを差し込む暫定対策が入っている。それでもループが止まらない、という挙動報告は仕様より経験則で、根本原因は (b) ではなく **「LFM2.5-VL-450M-sft-grpo が SFT 時の 4-tool スキーマ（compute_index_delta / analyze / submit_to_ground / drop）以外のツールに対して未学習」** という (a) の正しい記述の方。

#### (c) 「`classify_change` の二重リクエスト」 — ✅ 正確

- [tools/classifier_openai.py](tools/classifier_openai.py#L29-L48) の `_call_openai_classify` は **画像 2 枚を base64 で再投入** している。Watch スキャン中に `classify_change` をツールとして呼ぶと、エージェント本体の vision 入力に加え、もう 1 回フルサイズ画像を vLLM に送る。
- さらに [app/server.py](app/server.py#L573-L583) 側で watch 用に画像を 256px へ縮小しているにもかかわらず、`classifier_openai._data_url` には縮小ロジックがなく **元サイズのまま** base64 化される。`react_loop_openai._data_url` は 512px に縮小する分岐があるので非対称（[agent/react_loop_openai.py](agent/react_loop_openai.py#L24-L41)）。

#### (d) 「TOOLS スキーマ不一致」 — ✅ 正確

| 経路 | tool_registry | tool_choice | 想定モデル |
|---|---|---|---|
| `lfm2_multiturn` (DM3 専用, [agent/lfm2_agent.py](agent/lfm2_agent.py#L57-L114) `TOOLS`) | 4 ツール (`compute_index_delta` / `analyze` / `submit_to_ground` / `drop`) | required | LFM2.5-VL-450M-sft-grpo |
| `lfm2_agent_openai` (Watch 既定, [agent/react_loop_openai.py](agent/react_loop_openai.py#L43-L57) `TOOL_SCHEMAS`) | 8 ツール (`classify_change` / `fetch_band` / `compute_index` / `compute_index_delta` / `zoom_in` / `compose_report` / `submit_to_ground` / `drop`) | required | 同モデル |

同じチェックポイントへ、SFT 時とは別のツールセット・別のシステムプロンプトが流れ込んでいる。これは事実。

#### (e) 「`iter_lfm2_agent` を `case_meta` 無しで呼べるようにすればよい」 — ⚠️ 部分的に正しい

- [agent/lfm2_agent.py](agent/lfm2_agent.py#L365-L388) の `iter_lfm2_agent` は **`case_meta: dict` を必須引数** に取り、 `execute_tool(... case_meta=case_meta, case_id=case_id)` 経由で SimSat 実取得に使う。
- 「`case_meta` なしで呼べるように」ではなく、**`case_meta = {"lat": …, "lon": …, "before_date": …, "after_date": …, "size_km": …}` を Watch エントリから合成して渡せばよい**。`_run_watch_scan` は既に `before_date`/`after_date`/`lat`/`lon`/`size_km` を保持しているので、データは揃っている。記述を「Watch から `iter_lfm2_agent` に case_meta を合成して渡す」に直すべき。
- なお [agent/lfm2_agent.py](agent/lfm2_agent.py#L271) の `execute_tool` シグネチャは `case_id` も必須（未使用だが受け取る）。`case_id="watch:<watch_id>"` などで埋めれば足りる。

#### 関連する既存バグ／ノイズ

- [agent/react_loop_openai.py](agent/react_loop_openai.py#L164) `"max_tokens": 256` は `tool_call` JSON 用と書かれているが、ツール呼び出し前のテキスト応答（`content`）が長くなると 256 トークンで切れて空 `tool_calls` になり、結果として `end_turn` で fall-through する。これも `verdict=end_turn` の発生要因。
- `_run_watch_scan` の画像縮小 ([app/server.py](app/server.py#L573-L583) `_shrink_for_watch` 256px) は `react_loop_openai._data_url` 内でさらに 512→256 系の resize を通るが、Sentinel 元解像度 60m × 5km = 約 83px のため再縮小は no-op。**しかし `classifier_openai._data_url` だけ縮小なし**で、結果としてここがコンテキストを食い潰す（前述）。
- [app/server.py](app/server.py#L569-L572) のコメント「`size_km=5 @ 60m → ~83×83 px`」は妥当だが、`_fetch_one(... after_date, fetch_size_km, 10, fetch_res)` の 4 番目引数は `window_days` であり、Watch では Before=30 / After=10 と非対称。今日にちょうど Sentinel-2 パスが無いと After fetch が失敗 → `verdict=null, status=error`（end_turn 以前で死ぬ）。

---

## 2. 「ユーザクエリで監視地点をセットし定期監視するエージェント」のために必要な機能と不足している設計

### 2.1 現状で動いている範囲

- 自然言語クエリ → 候補座標リスト: `POST /api/watch/resolve` → Gemini 2.5 Flash ([app/server.py](app/server.py#L2255-L2298))
- 監視エントリの永続化: `data/watch_list.json` ([app/server.py](app/server.py#L437-L445))
- 60s 周期の単一スレッドスケジューラ: `_watch_scheduler_loop` ([app/server.py](app/server.py#L613-L640))
- スキャン: 直近 N 日 → 今日 で Before/After を SimSat fetch → ReAct ループで判定 → `data/watch_results.json` に追記 ([app/server.py](app/server.py#L539-L611))
- 結果一覧 UI: 30s ポーリング ([app/static/js/watch.js](app/static/js/watch.js#L116-L180))

### 2.2 不足している機能・設計（優先度付き）

#### A. エージェント実行系（**最優先 / 既に動いていない**）

| # | 課題 | 必要な設計 |
|---|---|---|
| A1 | Watch 既定の `lfm2_agent_openai` が SFT スキーマと不整合で `end_turn` 連発 (上記 1.2) | Watch 経路では `iter_lfm2_agent` を直接呼ぶ。Watch エントリから `case_meta` を合成し、`case_id="watch:<id>"`、`include_images=False` を既定に。`_run_watch_scan` の `provider` 分岐に `lfm2_multiturn` を追加し、`scene_id` の代わりに `case_meta` を受ける内部 API を切る。 |
| A2 | `tool_choice="required"` 経路でも空 `tool_calls` で `end_turn` 直行 | `iter_lfm2_agent` への切替で根本解消するが、保険として `_run_watch_scan` 側で `verdict in {None, "end_turn"}` をリトライ対象に分類する。 |
| A3 | `classify_change` の二重画像送信 | Watch では `classify_change` を tool_registry から外す（`iter_lfm2_agent` の 4-tool セットなら不要）。または [tools/classifier_openai.py](tools/classifier_openai.py#L20-L25) に max_side リサイズを追加。 |

#### B. 監視タスクの仕様（ドメイン情報の欠落）

| # | 課題 | 必要な設計 |
|---|---|---|
| B1 | `WatchEntry` ([app/server.py](app/server.py#L2244-L2253)) に **何を監視するか**（火災・洪水・伐採・建造物変化…）が無い | `target: Literal["wildfire","flood","deforestation","builtup","algal_bloom","any"]` と `instructions: str` を追加。`/api/run_agent` には既に `instructions` 引数があるが Watch 側で素通しされていない ([app/server.py](app/server.py#L1899-L1924))。 |
| B2 | Gemini 解決結果に `target/instructions` のヒントが含まれない | `/api/watch/resolve` のプロンプトを `target` を返すよう拡張。Watch 候補 UI ([app/static/js/watch.js](app/static/js/watch.js#L56-L74)) で表示・編集可能に。 |
| B3 | アラート閾値 (`min_confidence`, `must_cite_index` 等) が無い | `WatchEntry.alert_policy: {min_confidence, required_indices, exclude_classes}` を追加し、`_run_watch_scan` 内で `verdict=submit_to_ground` だけでは通知せず policy 評価で再判定。 |
| B4 | ポリゴン/AOI 非対応（点+`size_km` のみ） | `geometry: {type, coordinates}` (GeoJSON) を任意フィールドに。SimSat fetch がポリゴン bbox 対応していなければ bbox を内接矩形として扱う暫定設計を明記。 |

#### C. 時系列・ベースライン管理

| # | 課題 | 必要な設計 |
|---|---|---|
| C1 | Before は毎回 `now - lookback_days` を再 fetch → 毎回違うシーンが Before になる | ベースライン戦略を選択可能に: `baseline_mode: "rolling" \| "fixed" \| "best_clear"`。`fixed`（登録時シーンを保持）と `best_clear`（雲量最小の代表シーンを採用）の 2 モード追加。 |
| C2 | After の `now` 直近に Sentinel-2 パスが無いと黙って fetch エラー | `after_date` 決定時に SimSat の利用可能 STAC item から `latest_after >= last_scan_at` を選ぶ「過去探索」ロジック。最新 5 〜 10 日の中で雲量 < 閾値のものを採用。 |
| C3 | 連続スキャンで同じ事象が繰り返し `submit_to_ground` され通知が重複 | `last_alert_signature: hash(verdict, target_class, bbox)` を保持し、新スキャンで一致したら抑制。 |
| C4 | 履歴が `watch_results.json` 全エントリ混在で 200 件上限 ([app/server.py](app/server.py#L451-L457)) → 個別タイムライン取れず | スキーマ変更: `data/watch/<watch_id>/results.jsonl` に分離、UI は per-watch タイムライン表示。 |

#### D. スケジューラとライフサイクル

| # | 課題 | 必要な設計 |
|---|---|---|
| D1 | スケジューラが `threading.Thread(daemon=True)` 単一プロセス、再起動で in-flight が消失、ロックは JSON の楽観更新のみ ([app/server.py](app/server.py#L613-L640)) | 最低限：エントリごとの `running: bool` を `watch_list.json` に立てて重複起動を防ぐ。中期：APScheduler または cron + worker queue (RQ / Celery) へ。`last_scan_at` の楽観更新は競合に弱い。 |
| D2 | `interval_hours >= 0.5` だが Sentinel-2 revisit は 5 日 → 無駄スキャンが大半 | 登録時バリデーションで `interval_hours >= 24` 推奨、`< 24` 設定時は警告。スケジューラ側で「前回 After date と同じ STAC item しか取れない場合はスキップ」する dedupe を入れる。 |
| D3 | 失敗時のリトライ / バックオフが無い | `WatchEntry.failure_count`, `next_retry_at`, exponential backoff（10min → 1h → 6h、3 回連続失敗で `enabled=False` に自動降格）。 |
| D4 | スケジューラ起動が `_lifespan` 内のみ。worker 多重起動時に複数スケジューラが立つ | leader election か、スケジューラを別 docker サービスへ分離。 |

#### E. 通知・アラート配信

| # | 課題 | 必要な設計 |
|---|---|---|
| E1 | 結果は JSON ファイルに溜まるだけ。UI を開かないと気付けない | `notification: {channels: [webhook, slack, email], min_verdict, throttle_min}` を `WatchEntry` に追加。`_run_watch_scan` 末尾でディスパッチ。 |
| E2 | 通知ペイロードのスキーマが未定義 | `WatchAlert` Pydantic モデルを定義: `{watch_id, name, lat, lon, before/after_date, verdict, summary, evidence_indices, confidence, image_urls{before,after,delta}, scanned_at}`. |

#### F. 認証・マルチテナント

| # | 課題 | 必要な設計 |
|---|---|---|
| F1 | `/api/watch*` 全エンドポイントに認証無し | API キー (Bearer) ヘッダ必須化。`WatchEntry.owner: str` を追加し、リスト/削除を owner で絞る。 |
| F2 | `/api/watch/resolve` は Gemini API キーをリクエストボディで受け取れる ([app/server.py](app/server.py#L2240-L2241)) | サーバ側 .env のキーのみ許容に変更、もしくはクライアント送信時の漏洩注意点を明記。 |

#### G. UI / UX

| # | 課題 | 必要な設計 |
|---|---|---|
| G1 | 監視対象の追加が「クエリ → 候補リスト → 全件チェック」しかなく、地図クリック追加できない ([app/static/js/watch.js](app/static/js/watch.js#L23-L73)) | 既存 `maps.js` と連動して「地図上でピン → Watch に追加」フローを追加。 |
| G2 | 候補編集（lat/lon/size_km/target）ができない | `renderCandidates` の各行を編集可能フィールドに。 |
| G3 | 結果の差分画像 / 該当バンド可視化が無い | `WatchAlert` の `image_urls` と組み合わせて結果カードに Before/After/Delta サムネを表示。 |

#### H. 監視ループの観測可能性

| # | 課題 | 必要な設計 |
|---|---|---|
| H1 | `_run_watch_scan` の途中ログは `print` のみ ([app/server.py](app/server.py#L611)) | 構造化ロガー（JSON）で `event=watch_scan` を吐く。Prometheus 用の counter（`watch_scan_total{status,verdict}`）と histogram（`watch_scan_duration_seconds`）を追加。 |
| H2 | スキャンの ReAct トレースが per-watch で残らない（`/api/run_agent` 経由のときだけ `_save_agent_trace` される） | `_run_watch_scan` でも ReAct イベント列を `data/watch/<watch_id>/traces/<scanned_at>.yaml` に保存。 |

---

## 3. ミニマム改修ロードマップ（優先順）

1. **A1, A3** — Watch 経路を `iter_lfm2_agent(case_meta=…)` に切替。`classify_change` を Watch tool_registry から外す。これだけで `verdict=end_turn` 問題は解消する見込み。
2. **B1, B2, E1** — `WatchEntry` に `target/instructions/notification` を追加、Webhook 通知だけまず実装。Resolve プロンプトに `target` を追加。
3. **C1, C2, C3** — ベースライン固定モードと After date の STAC アウェアな選定、アラート重複抑制。
4. **D1, D3** — `running` フラグ・指数バックオフ・自動 disable。
5. **F1** — API キー導入。
6. **H1, H2** — 構造化ログとトレース保存。
7. **D4** — スケジューラを別サービスへ分離（必要に応じて）。

---

## 4. 既知問題ドキュメント側への修正提案

`docs/known_issues.md` に対して以下の差し替えを推奨:

- 「`tool_choice="auto"` でテキスト応答」セクションを削除し、**「`tool_choice="required"` でも vLLM が空 `tool_calls` を返した瞬間に `end_turn` 終了する」「`max_tokens=256` 制限で content 生成中に切れる」** に書き換え。
- 「`iter_lfm2_agent` を `case_meta` なしで呼べるようにする」を **「Watch エントリから `case_meta` を合成して `iter_lfm2_agent` に渡す内部 API を切る」** に書き換え。
- `lfm25_vl_local` の `base_url` は `host.docker.internal` か `.env` の `LFM25_VL_BASE_URL` 上書き対応をデフォルト推奨に格上げし、回避策ではなく恒久対応として記載。
