# Known Issues

現在オープン中の既知問題はありません。

## 解決済み

### `127.0.0.1:8002 Connection refused` エラー
- 原因：`providers.yaml` の `lfm25_vl_local` エントリ（`127.0.0.1:8002`）はコンテナから到達不能。
- 対応：`lfm25_vl_local` を `providers.yaml` から削除。デフォルトは `lfm2_agent_openai`（Docker サービス名で `lfm2-agent` に到達）。
- ブラウザに古い選択値が残っている場合は DevTools → Application → localStorage → `satagent.vlm` を削除して再読込。

### Watch スキャンが `end_turn` で終わる
- 対応：Watch 機能は廃止。エージェントは Web UI からシーン単位で実行する形に統一。`/api/watch/*`、`app/static/js/watch.js`、関連 CSS とデータファイル（`data/watch_list.json`、`data/watch_results.json`）を削除済み。

### `classify_change` の二重 VLM リクエスト
- 対応：`classifier_openai.py` に `make_classify_change_spectral` を追加し、`for_agent=True` かつ `openai_compat` プロバイダー（エージェント本体と同一 VLM）の場合はスペクトル統計から判定するように変更。VLM へ二度目の画像投入をしない。手動 `/api/tool/invoke` 経由は従来どおり VLM 判定（セカンドオピニオン用途）。

### TOOL_SCHEMAS と `build_tool_registry` の乖離
- 対応：`tools/schema.py` に欠けていた 6 ツール（`compute_index_delta`、`get_change_stats`、`detect_wildfire`、`predict_wildfire`、`analyze`、`capture_crop`）を追加。さらにサーバー起動時に `_validate_tool_registry` が `TOOL_SCHEMAS` のすべての名前が `build_tool_registry` で実装されているかを確認し、欠落があれば `SystemExit(2)` でコンテナを停止する。
