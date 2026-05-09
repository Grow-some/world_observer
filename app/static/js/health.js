// health.js — surface backend container readiness in the header.
//
// Polls /api/health on boot, then every 10 s while any required service is
// down. Once everything required is up we slow the poll to 60 s so the
// banner still catches a container that was killed mid-session.

const $ = (id) => document.getElementById(id);

const LABELS = {
  simsat:         "SimSat",
  wildfire_lora:  "wildfire LoRA",
  precursor_lora: "precursor LoRA",
  lfm2_agent:     "LFM2 vLLM",
};

let timer = null;

function classify(data) {
  const required = Object.entries(data.services || {})
    .filter(([_, s]) => !s.optional);
  const requiredDown = required.filter(([_, s]) => !s.ok);
  const optionalDown = Object.entries(data.services || {})
    .filter(([_, s]) => s.optional && !s.ok);

  if (requiredDown.length) {
    return { cls: "health-degraded",
             text: `⛔ starting up: ${requiredDown.map(([n]) => LABELS[n] || n).join(", ")}` };
  }
  if (optionalDown.length) {
    return { cls: "health-warn",
             text: `⚠ starting up (optional GPU services): ${optionalDown.map(([n]) => LABELS[n] || n).join(", ")} — Gemini-only path will still work; local-VLM / wildfire / detect_wildfire / Run Agent (lfm2_multiturn) will fail until ready` };
  }
  return { cls: "health-ok", text: "✓ all services ready" };
}

async function probe() {
  const banner  = $("health-banner");
  const text    = $("health-text");
  const spinner = $("health-spinner");
  if (!banner) return;
  banner.hidden = false;
  if (spinner) spinner.hidden = false;
  // Floor the spinner visibility at 600ms so the user actually sees the
  // animation even when /api/health responds in ~50ms locally.
  const minShow = new Promise((r) => setTimeout(r, 600));
  try {
    const r = await fetch("/api/health");
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    const { cls, text: msg } = classify(data);
    await minShow;
    banner.className = cls;
    text.textContent = msg;
    if (cls === "health-ok") {
      if (spinner) spinner.hidden = true;
      setTimeout(() => { if (banner.className === "health-ok") banner.hidden = true; }, 4000);
      schedule(60000);
    } else {
      // Keep the spinner visible while anything is still degraded/warn so
      // the user knows the page is actively re-polling.
      banner.hidden = false;
      schedule(10000);
    }
  } catch (e) {
    await minShow;
    banner.hidden = false;
    banner.className = "health-degraded";
    text.textContent = `⛔ /api/health failed: ${e.message} — app server reachable but probe errored`;
    schedule(10000);
  }
}

function schedule(ms) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(probe, ms);
}

export async function initHealth() {
  const banner = $("health-banner");
  if (banner) banner.addEventListener("click", probe);
  await probe();
}
