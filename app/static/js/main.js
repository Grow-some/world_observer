// main.js — runAgent SSE + auto-run model + boot wiring

import { state, $, setStatus, updateBudget, BUDGET_MAX, escapeHtml } from "./state-utils.js";
import { initMaps, setImage, setMapLabel, resetMapsToOriginal } from "./maps.js";
import { loadDM3Cases, onDM3Change, loadTemplates, fetchImages, fetchImagesFireEdge,
         fetchImagesFireGuard, useCachedPair,
         searchBeforeCandidates, searchAfterCandidates,
         geocodeSearch, bindGeoResultsClick } from "./dm3-fetch.js";
import { invokeTool, setToolsStatus, obsTopSignal } from "./tools.js";
import { initProviders } from "./providers.js";

// ---- Trace rendering (minimal — no recording mode) ----

function clearTrace() {
  const q = $("trace-quick"); if (q) q.innerHTML = "";
  const a = $("trace-agent"); if (a) a.innerHTML = "";
}

// Render a single value as "key: value" lines, recursively. No braces, no \n.
function renderKeyValueLines(obj, prefix = "") {
  const lines = [];
  if (obj === null || obj === undefined) {
    lines.push(`<div class="kv-line">${escapeHtml(prefix || "value")}: <span class="kv-val">${obj === null ? "null" : "undefined"}</span></div>`);
    return lines;
  }
  if (typeof obj === "string") {
    // Multi-line strings (e.g. compute_index_delta observation): split on \n into separate lines.
    const parts = obj.split(/\r?\n/);
    for (const p of parts) {
      if (!p.trim()) continue;
      // If the line itself looks like "key: value", parse it; otherwise show as text.
      const m = p.match(/^\s*([^:]+?):\s*(.+)$/);
      if (m) {
        lines.push(`<div class="kv-line"><span class="kv-key">${escapeHtml(m[1].trim())}</span>: <span class="kv-val">${escapeHtml(m[2].trim())}</span></div>`);
      } else {
        lines.push(`<div class="kv-line"><span class="kv-val">${escapeHtml(p.trim())}</span></div>`);
      }
    }
    return lines;
  }
  if (typeof obj !== "object") {
    const v = typeof obj === "number" ? (Number.isInteger(obj) ? obj.toString() : obj.toFixed(3)) : String(obj);
    lines.push(`<div class="kv-line">${prefix ? `<span class="kv-key">${escapeHtml(prefix)}</span>: ` : ""}<span class="kv-val">${escapeHtml(v)}</span></div>`);
    return lines;
  }
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => {
      const childPrefix = prefix ? `${prefix}[${i}]` : `[${i}]`;
      lines.push(...renderKeyValueLines(item, childPrefix));
    });
    return lines;
  }
  for (const [k, v] of Object.entries(obj)) {
    const childPrefix = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object") {
      lines.push(...renderKeyValueLines(v, childPrefix));
    } else {
      lines.push(...renderKeyValueLines(v, childPrefix));
    }
  }
  return lines;
}

function renderObservationBody(ev) {
  const result = ev.result ?? null;
  const toolName = ev.name || "";
  const summary = (result && typeof result === "object")
    ? obsTopSignal(toolName, result)
    : (result == null ? "(no result)" : String(result));
  const summaryHtml = `<div class="obs-summary">${escapeHtml(summary)}</div>`;
  // Detailed key:value rendering (no braces, no escaped \n)
  let detailHtml = "";
  if (result !== null && result !== undefined) {
    const lines = renderKeyValueLines(result);
    if (lines.length) detailHtml = `<div class="obs-kv">${lines.join("")}</div>`;
  }
  let extra = "";
  if (result && typeof result === "object" && result.zoomed_before_key && result.zoomed_after_key) {
    extra = `<div class="zoom-hint">↑ zoomed view applied to the image panels above</div>`;
  }
  return `${summaryHtml}${detailHtml}${extra}`;
}

function renderTraceEvent(ev) {
  const type = ev.type || "?";
  const source = ev.source || "agent";
  let body = "";
  if (type === "thought")          body = escapeHtml(ev.text || "");
  else if (type === "action") {
    const args = ev.arguments || {};
    const argLines = renderKeyValueLines(args);
    const argHtml = argLines.length ? `<div class="act-args">${argLines.join("")}</div>` : "";
    body = `<code class="act-name">${escapeHtml(ev.name)}</code>${argHtml}`;
  }
  else if (type === "observation") body = renderObservationBody(ev);
  else if (type === "error")       body = escapeHtml(ev.text || "");
  else if (type === "final")       body = `<b>[END]</b> final: <code>${escapeHtml(ev.name || "?")}</code>`;
  else body = escapeHtml(JSON.stringify(ev));

  const line = document.createElement("div");
  line.className = `line src-${source}`;
  line.innerHTML = `<span class="tag tag-${type}">${type}</span>${body}`;
  // Route into per-source panel so the two parallel streams stay separated.
  const target = $(`trace-${source}`) || $("trace-agent");
  target.appendChild(line);
  target.scrollTop = target.scrollHeight;
}

// ---- Agent SSE loop ----

function stopAgent() {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
}

function runAgent() {
  if (state.eventSource) stopAgent();
  if (!state.beforeKey || !state.afterKey) {
    setStatus("Fetch images first.");
    return;
  }

  const qp = new URLSearchParams({
    before_key: state.beforeKey,
    after_key:  state.afterKey,
  });
  if (state.vlmProvider)  qp.set("provider", state.vlmProvider);
  if (state.vlmModel)     qp.set("model",    state.vlmModel);
  if (state.dm3 && state.dm3.id) qp.set("scene_id", state.dm3.id);
  const instrEl = $("agent-instructions");
  const instructions = instrEl ? (instrEl.value || "").trim() : "";
  if (instructions) qp.set("instructions", instructions);
  const url = `/api/run_agent?${qp.toString()}`;
  const es = new EventSource(url);
  state.eventSource = es;

  es.onmessage = (msg) => {
    let ev;
    try { ev = JSON.parse(msg.data); } catch { return; }
    // Mark every SSE event from the multi-turn agent so the trace UI can
    // distinguish them from the parallel quick-model stream.
    ev.source = ev.source || "agent";
    renderTraceEvent(ev);

    if (ev.type === "error" || ev.type === "final") {
      stopAgent();
      return;
    }

    if (ev.type === "observation") {
      const r = ev.result || {};
      if (ev.name === "check_downlink_budget" && r.remaining_bytes !== undefined) {
        updateBudget(r.remaining_bytes);
      }
      if (r.zoomed_before_key && r.zoomed_after_key) {
        setImage("before", r.zoomed_before_key);
        setImage("after",  r.zoomed_after_key);
        const ratio = r.zoom_ratio ? `${r.zoom_ratio}x` : "";
        const bbox = r.crop_pixel_bbox ? JSON.stringify(r.crop_pixel_bbox) : "";
        setMapLabel("before", `Before [ZOOMED ${ratio}]`);
        setMapLabel("after",  `After [ZOOMED ${ratio} ${bbox}]`);
      }
    }
  };
  es.addEventListener("end", () => stopAgent());
  // Without this guard EventSource auto-reconnects on stream close → infinite loop
  es.onerror = () => stopAgent();
}

// ---- Direct (non-agent) model invocation, parallel to the agent ----

function pickQuickTool() {
  const src = state.dm3 && state.dm3.source;
  if (src === "FireEdge_HF" || src === "MCD64A1") return "detect_wildfire";
  if (src === "FireGuard_HF") return "predict_wildfire";
  return "classify_change";
}

async function runQuickModel() {
  const tool = pickQuickTool();
  const args = (tool === "classify_change")
    ? { image_before: "current_before", image_after: "current_after" }
    : {};
  renderTraceEvent({ source: "quick", type: "action", name: tool, arguments: args });
  const observation = await invokeTool(tool, args);
  if (observation == null) {
    renderTraceEvent({ source: "quick", type: "error", text: `${tool}: invocation failed` });
    return;
  }
  renderTraceEvent({ source: "quick", type: "observation", name: tool, result: observation });
}

// ---- Triggered after Fetch Images completes (both keys present) ----

function onImagesReady() {
  clearTrace();
  updateBudget(BUDGET_MAX);
  resetMapsToOriginal();
  // Fire-and-forget: direct model invocation runs in parallel with the agent SSE loop.
  runQuickModel();
  runAgent();
}

// ---- Boot wiring ----

// Surface any uncaught error in the status bar so silent boot failures are
// visible in the UI (otherwise: dropdown looks empty, search "doesn't work").
window.addEventListener("error", (e) => {
  console.error("[boot] uncaught", e.error || e.message);
  const s = document.getElementById("status");
  if (s) s.textContent = `JS error: ${e.message}`;
});
window.addEventListener("unhandledrejection", (e) => {
  console.error("[boot] unhandled rejection", e.reason);
  const s = document.getElementById("status");
  if (s) s.textContent = `JS error: ${e.reason && e.reason.message || e.reason}`;
});

async function boot() {
  // Run independent init tasks but never let one failure block listener wiring.
  const safe = async (label, fn) => {
    try { await fn(); }
    catch (e) { console.error(`[boot] ${label} failed`, e); }
  };
  await safe("loadTemplates", loadTemplates);
  await safe("loadDM3Cases",  loadDM3Cases);
  await safe("initProviders", initProviders);
  try { initMaps(); } catch (e) { console.error("[boot] initMaps failed", e); }
}

window.addEventListener("DOMContentLoaded", async () => {
  await boot();

  state.onImagesReady = onImagesReady;

  $("fetch-btn").addEventListener("click", fetchImages);
  $("fetch-fireedge-btn").addEventListener("click", fetchImagesFireEdge);
  $("fetch-fireguard-btn").addEventListener("click", fetchImagesFireGuard);
  $("cache-use-btn").addEventListener("click", useCachedPair);

  $("trace-clear-btn").addEventListener("click", () => {
    stopAgent();
    clearTrace();
    resetMapsToOriginal();
    setStatus("New session — trace cleared, agent stopped");
  });

  $("size_km").addEventListener("input", (e) => {
    $("size_km_val").textContent = e.target.value;
  });
  $("window_days").addEventListener("input", (e) => {
    $("window_days_val").textContent = e.target.value;
  });

  $("before-cand-btn").addEventListener("click", searchBeforeCandidates);
  $("after-cand-btn").addEventListener("click", searchAfterCandidates);

  const resetBtn = $("reset-maps-btn");
  if (resetBtn) {
    resetBtn.addEventListener("click", async () => {
      if (!state.beforeKey && !state.afterKey) { setToolsStatus("nothing to reset (fetch images first)"); return; }
      setToolsStatus("resetting maps...");
      await resetMapsToOriginal();
      setToolsStatus("maps reset to original RGB");
    });
  }

  $("dm3-case").addEventListener("change", onDM3Change);

  // Geocode search with debounce
  let geoTimer = null;
  bindGeoResultsClick();

  $("geo-search").addEventListener("input", (e) => {
    clearTimeout(geoTimer);
    const q = e.target.value;
    if (q.trim().length < 2) { $("geo-results").innerHTML = ""; return; }
    geoTimer = setTimeout(() => geocodeSearch(q), 450);
  });
  $("geo-search").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      clearTimeout(geoTimer);
      geocodeSearch(e.target.value);
    }
  });

});
