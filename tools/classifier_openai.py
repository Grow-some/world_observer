"""classify_change for any OpenAI-compatible chat-completions endpoint
(llama.cpp llama-server, vLLM, Ollama, etc).

Same input/output contract as classifier_gemini.make_classify_change so the
server can swap providers transparently.

Two factories live here:
  - make_classify_change          : VLM call (re-encodes both images and
                                    posts to the chat-completions endpoint).
                                    Used for manual /api/tool/invoke.
  - make_classify_change_spectral : NO second VLM call. Computes spectral
                                    index deltas via tools.scorer and maps
                                    them to a class verdict. Used inside the
                                    agent ReAct loop, where the agent VLM
                                    already sees the same images and a
                                    re-encoded second request would just
                                    double the per-step cost (the original
                                    duplicate-request bug).
"""
from __future__ import annotations

import base64
import json
from pathlib import Path
from typing import Any, Callable

import requests

from .classifier_gemini import CLASSIFY_PROMPT, ClassifyResult
from .scorer import get_change_stats_impl


def _data_url(path: str) -> str:
    p = Path(path)
    mime = "image/png" if p.suffix.lower() == ".png" else "image/jpeg"
    b64 = base64.b64encode(p.read_bytes()).decode()
    return f"data:{mime};base64,{b64}"


def _call_openai_classify(before_path: str, after_path: str, base_url: str,
                          model: str, api_key: str = "dummy",
                          timeout: float = 120.0) -> dict[str, Any]:
    body = {
        "model": model,
        "max_tokens": 1024,
        "temperature": 0.1,
        "response_format": {"type": "json_object"},
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": "BEFORE (previous satellite pass):"},
                {"type": "image_url", "image_url": {"url": _data_url(before_path)}},
                {"type": "text", "text": "AFTER (current pass over the same location):"},
                {"type": "image_url", "image_url": {"url": _data_url(after_path)}},
                {"type": "text", "text": (
                    CLASSIFY_PROMPT
                    + "\n\nReturn ONLY a JSON object matching this schema (no commentary):\n"
                    + '{"classes":[{"name":"<class>","confidence":<0..1>}], "bboxes":[[x,y,w,h], ...]}'
                )},
            ],
        }],
    }
    try:
        r = requests.post(
            f"{base_url.rstrip('/')}/chat/completions",
            json=body,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=timeout,
        )
    except requests.RequestException as e:
        return {"error": f"OpenAI-compat call failed: {type(e).__name__}: {e}"}
    if r.status_code != 200:
        return {"error": f"HTTP {r.status_code}: {r.text[:300]}"}
    try:
        data = r.json()
        text = data["choices"][0]["message"]["content"] or ""
    except (KeyError, IndexError, ValueError) as e:
        return {"error": f"unexpected response shape: {type(e).__name__}: {e}",
                "raw_preview": r.text[:400]}
    # Some servers wrap output in markdown fences; strip if present.
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.split("\n", 1)[-1].rsplit("```", 1)[0]

    # Try strict schema first (Gemini-shaped output). Fine-tuned models
    # (e.g. LFM2.5-VL wildfire LoRA) return custom labels like "brown_land"
    # and may omit / float-ify bboxes — fall back to a loose parse.
    try:
        parsed = ClassifyResult.model_validate_json(cleaned)
        result = parsed.model_dump()
    except Exception:
        try:
            raw = json.loads(cleaned)
        except Exception as e:
            return {"error": f"failed to parse model output: {type(e).__name__}: {e}",
                    "raw_preview": text[:400]}
        classes_out: list[dict[str, Any]] = []
        for c in raw.get("classes") or []:
            if not isinstance(c, dict):
                continue
            name = c.get("name") or c.get("label") or "unknown"
            try:
                conf = float(c.get("confidence", c.get("score", 0.0)))
            except (TypeError, ValueError):
                conf = 0.0
            classes_out.append({"name": str(name), "confidence": conf})
        bboxes_out: list[list[int]] = []
        for box in raw.get("bboxes") or []:
            if isinstance(box, (list, tuple)) and len(box) == 4:
                try:
                    bboxes_out.append([int(round(float(v))) for v in box])
                except (TypeError, ValueError):
                    continue
        result = {"classes": classes_out, "bboxes": bboxes_out, "loose_parsed": True}
    result["source"] = "openai_compat"
    result["model"] = model
    return result


def make_classify_change(before_path: str, after_path: str, *,
                         base_url: str, model: str,
                         api_key: str = "dummy") -> Callable[..., dict[str, Any]]:
    def classify_change(**_kwargs) -> dict[str, Any]:
        return _call_openai_classify(before_path, after_path, base_url, model, api_key)
    return classify_change


# ---------------------------------------------------------------------------
# Spectral-only classify_change (no second VLM call)
# ---------------------------------------------------------------------------

# Thresholds for mapping per-index strong-fraction to a class hypothesis.
# Tuned to match the indices the agent already sees via compute_index_delta /
# get_change_stats so the verdicts are consistent with the spectral evidence
# the agent fetches itself.
_FRAC_TRIGGER = 0.10  # ≥10% of pixels showing a strong delta in the index


def _spectral_classes(stats: dict[str, Any]) -> list[dict[str, Any]]:
    """Map get_change_stats output to {classes:[{name,confidence}], ...}."""
    out: list[tuple[str, float]] = []
    by_idx = stats.get("indices") or {}

    def _get(idx: str, key: str) -> float:
        v = (by_idx.get(idx) or {}).get(key)
        return float(v) if v is not None else 0.0

    # NBR strong decrease → fire / burn
    nbr_dec = _get("NBR", "frac_strong_decrease")
    if nbr_dec >= _FRAC_TRIGGER:
        out.append(("fire", min(1.0, nbr_dec * 1.5)))

    # NDVI strong decrease (and not a fire signature) → deforestation
    ndvi_dec = _get("NDVI", "frac_strong_decrease")
    if ndvi_dec >= _FRAC_TRIGGER and nbr_dec < _FRAC_TRIGGER:
        out.append(("deforestation", min(1.0, ndvi_dec * 1.3)))

    # MNDWI strong increase → flood / new water
    mndwi_inc = _get("MNDWI", "frac_strong_increase")
    if mndwi_inc >= _FRAC_TRIGGER:
        out.append(("flood", min(1.0, mndwi_inc * 1.5)))

    # NDBI strong increase (and not fire/flood) → urban / built-up growth
    ndbi_inc = _get("NDBI", "frac_strong_increase")
    if ndbi_inc >= _FRAC_TRIGGER and nbr_dec < _FRAC_TRIGGER and mndwi_inc < _FRAC_TRIGGER:
        out.append(("urban_growth", min(1.0, ndbi_inc * 1.5)))

    if not out:
        out.append(("no_change", 0.7))

    out.sort(key=lambda t: -t[1])
    return [{"name": n, "confidence": round(c, 3)} for n, c in out[:3]]


def make_classify_change_spectral(
    *,
    lat: float,
    lon: float,
    before_ts: str,
    after_ts: str,
    size_km: float,
    **_ignored,
) -> Callable[..., dict[str, Any]]:
    """Spectral-only classify_change. No VLM call — uses the same SimSat
    multi-band fetch the rest of the spectral toolchain uses.
    """
    def classify_change(**_kwargs) -> dict[str, Any]:
        try:
            stats = get_change_stats_impl(
                lat=lat, lon=lon,
                before_ts=before_ts, after_ts=after_ts,
                size_km=size_km,
            )
        except Exception as e:
            return {
                "classes": [{"name": "no_change", "confidence": 0.0}],
                "bboxes": [],
                "source": "spectral",
                "error": f"{type(e).__name__}: {e}",
            }
        if isinstance(stats, dict) and stats.get("error"):
            return {
                "classes": [{"name": "no_change", "confidence": 0.0}],
                "bboxes": [],
                "source": "spectral",
                "error": stats["error"],
            }
        return {
            "classes": _spectral_classes(stats),
            "bboxes": [],
            "source": "spectral",
            "indices_summary": {
                k: {"mean": (v or {}).get("mean"),
                    "frac_strong_decrease": (v or {}).get("frac_strong_decrease"),
                    "frac_strong_increase": (v or {}).get("frac_strong_increase")}
                for k, v in (stats.get("indices") or {}).items()
            },
        }
    return classify_change
