# Known Issues

No open known issues at the moment.

## Resolved

### `127.0.0.1:8002 Connection refused` error
- Cause: the `lfm25_vl_local` entry in `providers.yaml` (`127.0.0.1:8002`) was unreachable from inside the container.
- Fix: removed `lfm25_vl_local` from `providers.yaml`. The default is now `lfm2_agent_openai` (which reaches `lfm2-agent` via the Docker service name).
- If a stale selection lingers in the browser, delete `satagent.vlm` from DevTools → Application → localStorage and reload.

### Watch scans ended with `end_turn`
- Fix: the Watch feature has been retired. The agent is now driven from the Web UI on a per-scene basis. `/api/watch/*`, `app/static/js/watch.js`, the related CSS, and data files (`data/watch_list.json`, `data/watch_results.json`) have all been removed.

### Duplicate VLM requests in `classify_change`
- Fix: added `make_classify_change_spectral` to `classifier_openai.py`. When `for_agent=True` and the provider is `openai_compat` (the same VLM as the agent itself), classification is now derived from spectral statistics, so no second image is sent to the VLM. Manual invocations via `/api/tool/invoke` still use VLM-based classification (for second-opinion use).

### Drift between `TOOL_SCHEMAS` and `build_tool_registry`
- Fix: added the six tools missing from `tools/schema.py` (`compute_index_delta`, `get_change_stats`, `detect_wildfire`, `predict_wildfire`, `analyze`, `capture_crop`). On server startup `_validate_tool_registry` now confirms that every name in `TOOL_SCHEMAS` is implemented by `build_tool_registry`, and aborts the container with `SystemExit(2)` if anything is missing.
