"""Build the global reference grid: one present-day climate signature per land point.

Run from the project root:  python -m engine.grid

Safe to stop and re-run. Every POWER response is cached in cache/, so a re-run
only downloads the points that are still missing, then rebuilds the output file.
Output: data/global_grid.json

The grid is the 5 degree global land points plus a 1.5 degree regional grid over
Southeast Asia (see REGION_* below).
"""

import itertools
import json
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import httpx
from global_land_mask import globe

from engine.power_client import get_daily
from engine.signature import signature

GRID_STEP_DEG = 5                  # use 10 if POWER is too slow
LAT_MIN, LAT_MAX = -60, 70         # inclusive; no Antarctica
LON_MIN, LON_MAX = -180, 175       # inclusive

# Finer regional grid over Southeast Asia. The 5 degree grid has no land cell on
# Peninsular Malaysia (every nearby cell is ocean), so Malaysian fields matched
# the Amazon. These extra points sit between the 5 degree points.
REGION_STEP_DEG = 1.5
REGION_LAT_MIN, REGION_LAT_MAX = -10.0, 25.0
REGION_LON_MIN, REGION_LON_MAX = 90.0, 130.0

# Present-day window (nasa-data-reference.md, "Time Windows").
# Change GRID_END to 20251231 to include 2025.
GRID_START = "20150101"
GRID_END = "20241231"

MAX_WORKERS = 5                    # concurrent POWER requests (architecture.md)
MAX_ATTEMPTS = 4
RETRY_BASE_DELAY_S = 2.0           # waits 2, 4, 8 seconds between attempts

OUTPUT_PATH = Path(__file__).resolve().parent.parent / "data" / "global_grid.json"


def land_points(step: int = GRID_STEP_DEG) -> list[tuple[int, int]]:
    """Grid points on land. Filtered before fetching, so no ocean downloads."""
    lats = range(LAT_MIN, LAT_MAX + 1, step)
    lons = range(LON_MIN, LON_MAX + 1, step)
    return [(lat, lon) for lat, lon in itertools.product(lats, lons) if globe.is_land(lat, lon)]


def frange(start: float, stop: float, step: float) -> list[float]:
    """start, start+step, ... up to stop (inclusive), rounded so 1.5 steps stay clean."""
    count = int((stop - start) / step + 1e-9)
    return [round(start + i * step, 1) for i in range(count + 1)]


def regional_land_points(
    global_points: list[tuple[int, int]],
    step: float = REGION_STEP_DEG,
) -> list[tuple[float, float]]:
    """Land points on the finer Southeast Asia grid, minus any the 5 degree grid already has."""
    already = {(float(lat), float(lon)) for lat, lon in global_points}
    lats = frange(REGION_LAT_MIN, REGION_LAT_MAX, step)
    lons = frange(REGION_LON_MIN, REGION_LON_MAX, step)
    return [
        (lat, lon)
        for lat, lon in itertools.product(lats, lons)
        if (lat, lon) not in already and globe.is_land(lat, lon)
    ]


def all_points() -> list[tuple[float, float]]:
    """The 5 degree global land points plus the regional Southeast Asia points."""
    base = land_points()
    return base + regional_land_points(base)


def compute_point(lat: float, lon: float) -> dict:
    """Download (or load from cache) one point and compute its signature.

    Retries network errors with a growing wait. Other errors (bad data) are not retried.
    """
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            daily = get_daily(lat, lon, GRID_START, GRID_END)
            break
        except (httpx.HTTPError, ValueError) as err:
            # ValueError here covers a truncated or malformed response.
            if attempt == MAX_ATTEMPTS:
                raise
            delay = RETRY_BASE_DELAY_S * 2 ** (attempt - 1)
            print(f"  retry {attempt}/{MAX_ATTEMPTS - 1} for ({lat}, {lon}) in {delay:.0f}s: {err}")
            time.sleep(delay)
    return {"lat": lat, "lon": lon, "signature": signature(daily)}


def build_grid(points: list[tuple[float, float]]) -> tuple[list[dict], list[dict]]:
    """Compute every point in parallel. Returns (good points, failures)."""
    results: list[dict] = []
    failures: list[dict] = []
    started = time.time()

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(compute_point, lat, lon): (lat, lon) for lat, lon in points}
        for done, future in enumerate(as_completed(futures), start=1):
            lat, lon = futures[future]
            try:
                results.append(future.result())
            except Exception as err:  # keep going; one bad point must not kill a 30 min build
                print(f"  FAILED ({lat}, {lon}): {err}")
                failures.append({"lat": lat, "lon": lon, "error": str(err)})
            if done % 25 == 0 or done == len(points):
                print(f"{done}/{len(points)} points done ({time.time() - started:.0f}s)")

    results.sort(key=lambda p: (p["lat"], p["lon"]))  # same output every run
    failures.sort(key=lambda p: (p["lat"], p["lon"]))
    return results, failures


def save_grid(points: list[dict], failures: list[dict], path: Path = OUTPUT_PATH) -> None:
    """Write the grid file atomically (temp file, then rename)."""
    grid = {
        "meta": {
            "step_deg": GRID_STEP_DEG,
            "regional_step_deg": REGION_STEP_DEG,
            "regional_bounds": {
                "lat_min": REGION_LAT_MIN, "lat_max": REGION_LAT_MAX,
                "lon_min": REGION_LON_MIN, "lon_max": REGION_LON_MAX,
            },
            "window_start": GRID_START,
            "window_end": GRID_END,
            "point_count": len(points),
            "failed_points": failures,
        },
        "points": points,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(grid, indent=1), encoding="utf-8")
    tmp.replace(path)


def main() -> None:
    points = all_points()
    base_count = len(land_points())
    print(
        f"{len(points)} land points: {base_count} at {GRID_STEP_DEG} degrees + "
        f"{len(points) - base_count} regional at {REGION_STEP_DEG} degrees, window {GRID_START}-{GRID_END}"
    )
    results, failures = build_grid(points)
    save_grid(results, failures)
    print(f"Saved {len(results)} points to {OUTPUT_PATH}")
    if failures:
        print(f"{len(failures)} points failed (listed in meta.failed_points). Re-run to retry them.")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
