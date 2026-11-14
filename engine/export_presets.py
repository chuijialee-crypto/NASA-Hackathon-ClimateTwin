"""Run the /twin engine on the front-end's Malaysian presets and save the results.

Run from the project root:  python -m engine.export_presets

Reads MALAYSIA_PRESETS from frontend/app.js (so the list cannot drift from the UI), runs
engine.twin.climate_twin on each one with that preset's own local crop (read from its label,
see LABEL_TO_CROP), then writes:
  data/demo_field.json       the Kedah demo field's response (offline fallback)
  data/malaysia_states.json  every preset's full response, for teammates to inspect
and prints a summary table. Nothing is written unless all presets succeed.
"""

import json
import math
import re
import sys
from pathlib import Path

from engine.twin import DEMO_LAT, DEMO_LON, climate_twin

ROOT = Path(__file__).resolve().parent.parent
APP_JS = ROOT / "frontend" / "app.js"
DEMO_PATH = ROOT / "data" / "demo_field.json"
STATES_PATH = ROOT / "data" / "malaysia_states.json"

PRESETS_BLOCK = re.compile(r"const MALAYSIA_PRESETS = \[(.*?)\];", re.DOTALL)
PRESET_ENTRY = re.compile(r"\{\s*name:\s*'([^']+)',\s*lat:\s*(-?[\d.]+),\s*lon:\s*(-?[\d.]+)\s*\}")
# "Kedah: padi (demo field)" -> "padi"; "Pahang: tea and vegetables (Cameron Highlands)" -> "tea and vegetables"
PRESET_CROP_LABEL = re.compile(r"^[^:]+:\s*([^(]+?)\s*(?:\(|$)")

# The crop named in each preset's label -> its name in crops.json. Deriving it from the label
# keeps the export in step with what the UI shows for that preset.
LABEL_TO_CROP = {
    "padi": "Paddy rice",
    "durian": "Durian",
    "oil palm": "Oil palm",
    # crops.json has no tea. Chilli is its only vegetable, so it stands in for "tea and vegetables".
    "tea and vegetables": "Chilli",
}


def parse_presets(app_js_text: str) -> list[dict]:
    """The preset list from app.js: [{name, lat, lon}, ...] in dropdown order."""
    block = PRESETS_BLOCK.search(app_js_text)
    if not block:
        raise ValueError("MALAYSIA_PRESETS not found in app.js")
    presets = [
        {"name": name, "lat": float(lat), "lon": float(lon)}
        for name, lat, lon in PRESET_ENTRY.findall(block.group(1))
    ]
    if not presets:
        raise ValueError("MALAYSIA_PRESETS has no entries the parser understands")
    return presets


def baseline_crop_label(preset_name: str) -> str:
    """The crop word in a preset's label, e.g. 'padi'."""
    match = PRESET_CROP_LABEL.match(preset_name)
    if not match:
        raise ValueError(f"cannot read a crop from preset name '{preset_name}'")
    return match.group(1).strip().lower()


def baseline_crop(preset_name: str) -> str:
    """The crops.json crop to score for a preset. Fails loudly for a crop we have no mapping for."""
    label = baseline_crop_label(preset_name)
    if label not in LABEL_TO_CROP:
        raise ValueError(f"no crops.json crop mapped for '{label}' (preset '{preset_name}'); add it to LABEL_TO_CROP")
    return LABEL_TO_CROP[label]


def write_json(path: Path, data: object) -> None:
    """Write atomically (temp file, then rename)."""
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)


def run_presets(presets: list[dict]) -> tuple[list[dict], list[str]]:
    """Run the engine on each preset. Returns (results, error messages)."""
    results, errors = [], []
    for preset in presets:
        try:
            crop = baseline_crop(preset["name"])
            response = climate_twin(preset["lat"], preset["lon"], crop)
            results.append({
                "preset_name": preset["name"], "lat": preset["lat"], "lon": preset["lon"],
                "baseline_crop_label": baseline_crop_label(preset["name"]),
                "baseline_crop": crop,
                "response": response,
            })
        except Exception as err:  # keep going so one bad point shows up with the rest
            print(f"FAILED {preset['name']}: {err!r}")
            errors.append(preset["name"])
    return results, errors


def top_crop_label(response: dict) -> str:
    """Best-scoring crop in crops_there (the list is sorted best first), with its score and how many more fit."""
    crops = response["crops_there"]
    if not crops:
        return "none fit"
    extra = f" (+{len(crops) - 1})" if len(crops) > 1 else ""
    return f"{crops[0]['name']} {crops[0]['match_score']:.2f}{extra}"


def summary_rows(results: list[dict]) -> list[list[str]]:
    rows = []
    for item in results:
        r = item["response"]
        rows.append([
            item["preset_name"],
            f"{r['signature_now']['mean_temp']:.1f}",
            r["twin"]["place"],
            f"{r['twin']['distance_km']:,}",
            f"{r['twin_1995']['drift_km']:,}",
            top_crop_label(r),
            r["current_crop"],
            f"{r['current_crop_viability'][0]['score']:.2f} > {r['current_crop_viability'][-1]['score']:.2f}",
        ])
    return rows


def print_table(results: list[dict]) -> None:
    header = ["State preset", "Now (C)", "2045 twin", "Twin km", "Drift km", "Top crop at twin (score)", "Local crop", "Viability 2025>2045"]
    rows = summary_rows(results)
    widths = [max(len(row[i]) for row in [header] + rows) for i in range(len(header))]
    right = {1, 3, 4}  # numeric columns

    def line(row: list[str]) -> str:
        cells = [cell.rjust(widths[i]) if i in right else cell.ljust(widths[i]) for i, cell in enumerate(row)]
        return "  ".join(cells)

    print(line(header))
    print("  ".join("-" * w for w in widths))
    for row in rows:
        print(line(row))


def main() -> None:
    presets = parse_presets(APP_JS.read_text(encoding="utf-8"))
    print(f"{len(presets)} presets read from {APP_JS.name}")
    results, errors = run_presets(presets)
    if errors:
        print(f"{len(errors)} preset(s) failed, nothing saved: {errors}")
        sys.exit(1)

    demo = next((r for r in results if math.isclose(r["lat"], DEMO_LAT) and math.isclose(r["lon"], DEMO_LON)), None)
    if demo is None:
        print(f"No preset matches the demo field ({DEMO_LAT}, {DEMO_LON}), nothing saved")
        sys.exit(1)

    write_json(DEMO_PATH, demo["response"])
    write_json(STATES_PATH, {"source": "frontend/app.js MALAYSIA_PRESETS", "states": results})
    print(f"Saved {DEMO_PATH.relative_to(ROOT)} and {STATES_PATH.relative_to(ROOT)}\n")
    print_table(results)


if __name__ == "__main__":
    main()
