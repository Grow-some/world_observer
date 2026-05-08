// providers.js — VLM provider is hardcoded; no UI selector.
// Settings modal removed per UI redesign (May 2026). The selection is fixed
// to lfm25_vl_sft_grpo (LFM2.5-VL-450M-sft-grpo via the lfm2_multiturn
// agent path); change config/providers.yaml to swap the underlying URL.
import { state, $ } from "./state-utils.js";

const FIXED_PROVIDER = "lfm25_vl_sft_grpo";
const FIXED_MODEL    = "LFM2.5-VL-450M-sft-grpo";

function renderProviderBadge(cfg) {
  const el = $("provider-info");
  if (!el) return;
  const name  = (cfg && cfg.name)  || FIXED_PROVIDER;
  const model = (cfg && cfg.default_model) || FIXED_MODEL;
  el.textContent = `${name} · ${model}`;
  el.className   = "provider-vllm";
}

export async function initProviders() {
  // Lock state to the fixed provider regardless of /api/providers contents.
  state.vlmProvider = FIXED_PROVIDER;
  state.vlmModel    = FIXED_MODEL;

  // Best-effort badge render with config from server (for the kind label),
  // but we never write back to state from here.
  try {
    const res = await fetch("/api/providers");
    if (res.ok) {
      const data = await res.json();
      const cfg  = (data.providers || []).find(p => p.name === FIXED_PROVIDER);
      renderProviderBadge(cfg || { name: FIXED_PROVIDER, default_model: FIXED_MODEL });
      return;
    }
  } catch (e) { /* fall through */ }
  renderProviderBadge({ name: FIXED_PROVIDER, default_model: FIXED_MODEL });
}
