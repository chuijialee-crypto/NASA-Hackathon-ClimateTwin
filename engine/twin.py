"""Climate Twin engine: trend fit, 2045 extrapolation, twin lookup, crops, viability.

Entry point: climate_twin(lat, lon) -> dict, shaped like frontend/contract.json.

How a result is built (every number is arithmetic on NASA POWER data):
  1. Pull 1984-2024 daily data for the field (cached on disk by power_client).
  2. signature_now   = the 8 values over 2015-2024 (same window as the global grid).
  3. signature_2045  = OLS line through the 8 values of each year, read at 2045.
  4. Standardise (z-score) all 8 values across the global grid, then take the grid
     point with the smallest weighted Euclidean distance to:
        signature_2045            -> twin       (where the field is going)
        signature_now             -> twin_now   (the field's own climate today)
        field's 1990-2000 values  -> twin_1995  (the backtest)
     twin gets a small penalty per km of distance from the field, so two cells that
     match equally well resolve to the nearer one. twin_now and twin_1995 only look
     inside BACKTEST_MAX_KM of the field: 30 years of drift is regional.
  5. drift_km = distance between twin_1995 and twin_now.
  6. crops_there = crops whose tolerances all fit the twin's climate, each scored
     against signature_2045 and sorted best first.
  7. current_crop_viability = the field's current crop scored every 5 years from 2025 to
     2045 on a straight line from signature_now to signature_2045.
"""

import json
import math
from functools import lru_cache
from pathlib import Path

import pandas as pd
from scipy.stats import linregress

from engine.power_client import get_daily
from engine.signature import SIGNATURE_KEYS, signature

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
GRID_PATH = DATA_DIR / "global_grid.json"
WEIGHTS_PATH = DATA_DIR / "weights.json"
CROPS_PATH = DATA_DIR / "crops.json"
PLACES_PATH = DATA_DIR / "places.json"

# Time windows (nasa-data-reference.md, "Time Windows"). Must match the grid build.
TARGET_YEAR = 2045
PRESENT_START_YEAR, PRESENT_END_YEAR = 2015, 2024
PRESENT_MID_YEAR = (PRESENT_START_YEAR + PRESENT_END_YEAR) / 2  # signature_now is a 10 year mean
BACKTEST_START_YEAR, BACKTEST_END_YEAR = 1990, 2000
VIABILITY_YEARS = range(2025, TARGET_YEAR + 1, 5)  # 2025, 2030, ... 2045

EARTH_RADIUS_KM = 6371.0
MAX_PLACE_DISTANCE_KM = 800.0  # farther than this from a named place: show coordinates
ROUND_DIGITS = 2

# Geography in the twin search.
BACKTEST_MAX_KM = 1000.0         # twin_now and twin_1995 must be within this of the field
# Added to the climate distance for every 1000 km between field and candidate. With
# distances of 0.3-1.0 for good matches, 18,000 km adds about 0.14 and 2,700 km about 0.02:
# enough to break a near-tie, too small to override a clearly better climate match.
GEO_PENALTY_PER_1000_KM = 0.0075

DEMO_LAT, DEMO_LON = 6.12, 100.37
DEMO_FIELD_NAME = "Kedah padi field"
DEFAULT_CROP = "Paddy rice"  # the demo story; see pick_current_crop

# Crop suitability. crops.json gives each crop a rain band (min..max) and three one-sided
# limits: growing degree days (at least), heat days (at most), coldest month (at least).
# It has no separate "optimal" values, so the middle of the rain band stands in for the
# optimum. Score = rain_fit * (weakest one-sided limit score):
#   rain_fit        Gaussian in how far the year's rain is from the band's midpoint, as a
#                   share of that midpoint. Rain 30% off the midpoint scores 0.61.
#   limit scores    logistic of a margin: 0.5 at the limit, about 0.98 once "comfortable".
RAIN_FIT_WIDTH = 0.3          # Gaussian sigma, as a share of the rain band's midpoint
COMFORT_HEADROOM = 0.25       # gdd 25% above the need, or 25% of the heat-day allowance unused = comfortable
COLD_COMFORT_C = 2.0          # coldest month 2 C above the crop's minimum = comfortable
SUITABILITY_STEEPNESS = 4.0   # margin 0.5 inside the limit scores 0.88; 0.5 beyond scores 0.12
MARGIN_CLIP = 3.0             # keeps exp() finite for climates far outside a crop's range

# Heat stress on the field's current crop. Mean temperature, heat days and dry spell are
# compared with the field's own signature_now. Going above it costs a Gaussian penalty,
# exp(-z^2 / 2), where z is the rise measured in the field's own year-to-year scatter
# (std dev around its OLS line). Rises smaller than normal year-to-year swings cost little.
STRESS_KEYS = ("mean_temp", "heat_days", "dry_spell_days")
# Floors set the narrowest penalty scale allowed. Tropical year-to-year scatter in mean
# temperature is only about 0.2-0.3 C, so on its own it would treat half a degree of
# warming as a huge shift. The temperature floor stands in for a tolerance a crop can
# absorb. Heat days and dry spell floors mainly stop a divide-by-zero (heat days is 0
# every year in many places).
SCATTER_FLOOR = {"mean_temp": 0.8, "heat_days": 1.0, "dry_spell_days": 1.0}  # C, days, days

# A linear trend can leave the physically possible range far out; clamp to it.
# (low, high), None means no limit on that side.
PHYSICAL_BOUNDS: dict[str, tuple[float | None, float | None]] = {
    "gdd": (0.0, None),
    "rain_mm": (0.0, None),
    "wet_share": (0.25, 1.0),  # wettest 3 of 12 months can never hold less than 25%
    "dry_spell_days": (0.0, 366.0),
    "heat_days": (0.0, 366.0),
    "solar": (0.0, None),
}

CAVEATS = [
    "NASA POWER is gridded climate data at roughly 50 km, not a measurement of this specific field.",
    "We do not forecast weather, yield, or profit.",
    "A linear trend is a simplifying assumption, not a climate projection.",
    "Confirm any planting decision with a local agricultural adviser.",
]


class UnknownCropError(ValueError):
    """The requested crop name is not in crops.json."""


# ---------- Data files ----------

@lru_cache(maxsize=None)
def load_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def load_weights() -> dict[str, float]:
    """Signature weights; must cover exactly the 8 signature keys."""
    weights = load_json(WEIGHTS_PATH)
    if sorted(weights) != sorted(SIGNATURE_KEYS):
        raise ValueError(f"weights.json keys {sorted(weights)} do not match {sorted(SIGNATURE_KEYS)}")
    return weights


def load_grid_points() -> list[dict]:
    points = load_json(GRID_PATH)["points"]
    if not points:
        raise ValueError("global_grid.json has no points")
    return points


# ---------- Geography ----------

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in km."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlat, dlon = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def coordinate_label(lat: float, lon: float) -> str:
    ns = "N" if lat >= 0 else "S"
    ew = "E" if lon >= 0 else "W"
    return f"{abs(lat):.1f}°{ns}, {abs(lon):.1f}°{ew}"


def nearest_place(lat: float, lon: float, places: list[dict]) -> str | None:
    """Name of the closest entry in places.json, or None if none is close enough."""
    best = min(places, key=lambda p: haversine_km(lat, lon, p["lat"], p["lon"]))
    if haversine_km(lat, lon, best["lat"], best["lon"]) > MAX_PLACE_DISTANCE_KM:
        return None
    return best["name"]


def place_label(lat: float, lon: float, places: list[dict]) -> str:
    return nearest_place(lat, lon, places) or coordinate_label(lat, lon)


def field_name(lat: float, lon: float, places: list[dict]) -> str:
    if math.isclose(lat, DEMO_LAT) and math.isclose(lon, DEMO_LON):
        return DEMO_FIELD_NAME
    near = nearest_place(lat, lon, places)
    return f"Field near {near}" if near else f"Field at {coordinate_label(lat, lon)}"


# ---------- Trend and 2045 extrapolation ----------

def yearly_signatures(daily: pd.DataFrame) -> dict[int, dict]:
    """The 8 signature values for each calendar year in the data."""
    years = sorted({int(y) for y in daily.index.year})
    return {y: signature(daily[daily.index.year == y]) for y in years}


def fit_trends(yearly: dict[int, dict]) -> dict[str, tuple[float, float]]:
    """OLS fit of value ~ year for each signature key. Returns (slope, intercept)."""
    years = sorted(yearly)
    trends = {}
    for key in SIGNATURE_KEYS:
        fit = linregress(years, [yearly[y][key] for y in years])
        trends[key] = (float(fit.slope), float(fit.intercept))
    return trends


def trend_scatter(yearly: dict[int, dict], trends: dict[str, tuple[float, float]]) -> dict[str, float]:
    """Year-to-year scatter of the stress keys: std dev of the yearly values around their OLS line."""
    years = sorted(yearly)
    if len(years) < 3:
        raise ValueError("need at least 3 years to measure scatter around a trend")
    scatter = {}
    for key in STRESS_KEYS:
        slope, intercept = trends[key]
        squares = [(yearly[y][key] - (slope * y + intercept)) ** 2 for y in years]
        scatter[key] = max(SCATTER_FLOOR[key], math.sqrt(sum(squares) / (len(years) - 2)))
    return scatter


def clamp(key: str, value: float) -> float:
    low, high = PHYSICAL_BOUNDS.get(key, (None, None))
    if low is not None:
        value = max(low, value)
    if high is not None:
        value = min(high, value)
    return value


def predict_signature(trends: dict[str, tuple[float, float]], year: int) -> dict:
    """Read each fitted line at `year`: slope * year + intercept."""
    return {k: clamp(k, trends[k][0] * year + trends[k][1]) for k in SIGNATURE_KEYS}


def window_signature(daily: pd.DataFrame, start_year: int, end_year: int) -> dict:
    """Signature over whole years start_year..end_year (inclusive)."""
    return signature(daily.loc[f"{start_year}-01-01":f"{end_year}-12-31"])


def interpolate_signature(now: dict, future: dict, year: float) -> dict:
    """Straight line from `now` (at PRESENT_MID_YEAR) to `future` (at TARGET_YEAR), read at `year`."""
    t = (year - PRESENT_MID_YEAR) / (TARGET_YEAR - PRESENT_MID_YEAR)
    t = min(1.0, max(0.0, t))
    return {k: now[k] + t * (future[k] - now[k]) for k in SIGNATURE_KEYS}


# ---------- Twin lookup ----------

def grid_stats(grid_sigs: list[dict], keys: list[str]) -> dict[str, tuple[float, float]]:
    """Mean and std of each signature value across the whole grid."""
    stats = {}
    for k in keys:
        values = [g[k] for g in grid_sigs]
        mean = sum(values) / len(values)
        std = math.sqrt(sum((v - mean) ** 2 for v in values) / len(values))
        if std == 0:
            raise ValueError(f"'{k}' is identical at every grid point, cannot z-score it")
        stats[k] = (mean, std)
    return stats


def twin_distance(field_sig: dict, grid_sig: dict, weights: dict, stats: dict) -> float:
    """Weighted Euclidean distance on z-scored values. Lower = better match."""
    total = 0.0
    for k, weight in weights.items():
        mean, std = stats[k]
        diff = (field_sig[k] - mean) / std - (grid_sig[k] - mean) / std
        total += weight * diff ** 2
    return math.sqrt(total)


def match_score(distance: float) -> float:
    """Contract's 0-1 score. Higher = better match."""
    return 1 / (1 + distance)


def find_twin(
    target: dict,
    points: list[dict],
    weights: dict,
    stats: dict,
    origin: tuple[float, float] | None = None,
    max_km: float | None = None,
    geo_penalty_per_1000_km: float = 0.0,
) -> tuple[dict, float]:
    """Grid point closest to `target`. Returns (grid point, climate distance).

    origin + max_km: only cells within max_km of the origin are candidates. If none are,
        the whole grid is used and a warning is printed (a remote field, not a silent switch).
    origin + geo_penalty_per_1000_km: candidates are ranked by climate distance plus
        penalty * km / 1000. The returned distance is the climate distance alone, so
        match_score still says how well the climate matches.
    """
    candidates = points
    if origin is not None and max_km is not None:
        near = [p for p in points if haversine_km(origin[0], origin[1], p["lat"], p["lon"]) <= max_km]
        if near:
            candidates = near
        else:
            print(f"WARNING: no grid cell within {max_km:.0f} km of {origin}; searching the whole grid")

    best_rank, best_distance, best_point = math.inf, math.inf, candidates[0]
    for point in candidates:
        distance = twin_distance(target, point["signature"], weights, stats)
        rank = distance
        if origin is not None and geo_penalty_per_1000_km:
            rank += geo_penalty_per_1000_km * haversine_km(origin[0], origin[1], point["lat"], point["lon"]) / 1000
        if rank < best_rank:
            best_rank, best_distance, best_point = rank, distance, point
    return best_point, best_distance


# ---------- Crops and viability ----------

def rain_midpoint_fit(crop: dict, sig: dict) -> float:
    """0-1 closeness of the year's rain to the middle of the crop's rain band (1.0 = exactly the middle).

    Distance is measured as a share of the midpoint, not of the band width, so a crop with a
    very wide band is not automatically a better fit than one centred on the local rainfall.
    """
    midpoint = (crop["rain_min_mm"] + crop["rain_max_mm"]) / 2
    z = (sig["rain_mm"] - midpoint) / (RAIN_FIT_WIDTH * midpoint)
    return math.exp(-0.5 * z * z)


def limit_margins(crop: dict, sig: dict) -> dict[str, float]:
    """Margins on the 3 one-sided limits. 0 = at the limit, 1 = comfortably inside, negative = beyond it."""
    return {
        "gdd": (sig["gdd"] / crop["gdd_required"] - 1) / COMFORT_HEADROOM,
        "heat": (crop["max_heat_days"] - sig["heat_days"]) / (crop["max_heat_days"] * COMFORT_HEADROOM),
        "cold": (sig["cold_month"] - crop["min_cold_month_c"]) / COLD_COMFORT_C,
    }


def comfort(margin: float) -> float:
    """Logistic 0-1 score for one margin: 0.5 at the limit, towards 1 well inside, towards 0 beyond."""
    margin = max(-MARGIN_CLIP, min(MARGIN_CLIP, margin))
    return 1 / (1 + math.exp(-SUITABILITY_STEEPNESS * margin))


def within_tolerance(crop: dict, sig: dict) -> bool:
    """True when all 4 of the crop's limits hold: rain inside its band, and the 3 one-sided limits met."""
    return (
        crop["rain_min_mm"] <= sig["rain_mm"] <= crop["rain_max_mm"]
        and all(m >= 0 for m in limit_margins(crop, sig).values())
    )


def crop_match_score(crop: dict, sig: dict) -> float:
    """Continuous 0-1 suitability of a crop in a climate: rain fit, scaled by the weakest one-sided limit."""
    weakest_limit = min(comfort(m) for m in limit_margins(crop, sig).values())
    return rain_midpoint_fit(crop, sig) * weakest_limit


def stress_penalty(rise: float, scatter: float) -> float:
    """Gaussian decay for a rise above the baseline: 1.0 at or below it, exp(-z^2/2) with z = rise / scatter."""
    z = max(0.0, rise) / scatter
    return math.exp(-0.5 * z * z)


def climate_stress_factor(sig: dict, baseline: dict, scatter: dict[str, float]) -> float:
    """Worst Gaussian penalty among mean temperature, heat-stress days and longest dry spell."""
    return min(stress_penalty(sig[k] - baseline[k], scatter[k]) for k in STRESS_KEYS)


def crops_for_climate(crops: list[dict], fit_sig: dict, target_sig: dict) -> list[dict]:
    """Crops whose 4 limits hold in `fit_sig` (the twin), scored on `target_sig` (the field in 2045).

    Sorted best first; crops with equal scores stay in crops.json order.
    """
    scored = [(crop_match_score(c, target_sig), c) for c in crops if within_tolerance(c, fit_sig)]
    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [
        {"name": c["name"], "note": c["note"], "source": c["source"], "match_score": round(score, ROUND_DIGITS)}
        for score, c in scored
    ]


def pick_current_crop(crops: list[dict], sig_now: dict, crop_name: str | None) -> dict:
    """The crop whose viability we chart.

    A named crop is used as asked. Otherwise paddy rice (the demo story), unless it
    cannot grow in today's climate there, then the best-scoring crop in crops.json.
    """
    if crop_name:
        for crop in crops:
            if crop["name"].lower() == crop_name.strip().lower():
                return crop
        raise UnknownCropError(f"unknown crop '{crop_name}'")
    default = next((c for c in crops if c["name"] == DEFAULT_CROP), None)
    if default and within_tolerance(default, sig_now):
        return default
    return max(crops, key=lambda c: crop_match_score(c, sig_now))


def viability_curve(crop: dict, sig_now: dict, sig_2045: dict, scatter: dict[str, float]) -> list[dict]:
    """Score the crop every 5 years, 2025-2045, along the line from signature_now to signature_2045.

    Score = the weakest of: the crop's own suitability in that year's climate, and the
    Gaussian penalty for temperature, heat days and dry spell rising above today's.
    It is an index of how far the climate has moved from what the crop sits in today,
    not a yield forecast.
    """
    curve = []
    for year in VIABILITY_YEARS:
        sig = interpolate_signature(sig_now, sig_2045, year)
        score = min(crop_match_score(crop, sig), climate_stress_factor(sig, sig_now, scatter))
        curve.append({"year": year, "score": round(score, ROUND_DIGITS)})
    return curve


# ---------- The response ----------

def round_signature(sig: dict) -> dict:
    return {k: round(float(sig[k]), ROUND_DIGITS) for k in SIGNATURE_KEYS}


def point_entry(point: dict, places: list[dict]) -> dict:
    return {"lat": point["lat"], "lon": point["lon"], "place": place_label(point["lat"], point["lon"], places)}


def climate_twin(lat: float, lon: float, crop_name: str | None = None) -> dict:
    """Full /twin answer for one field. Same keys as frontend/contract.json."""
    daily = get_daily(lat, lon)
    yearly = yearly_signatures(daily)
    trends = fit_trends(yearly)
    scatter = trend_scatter(yearly, trends)

    sig_now = window_signature(daily, PRESENT_START_YEAR, PRESENT_END_YEAR)
    sig_2045 = predict_signature(trends, TARGET_YEAR)
    sig_1995 = window_signature(daily, BACKTEST_START_YEAR, BACKTEST_END_YEAR)

    points = load_grid_points()
    weights = load_weights()
    stats = grid_stats([p["signature"] for p in points], list(weights))  # one scale for all 3 lookups
    origin = (lat, lon)

    twin_pt, twin_dist = find_twin(
        sig_2045, points, weights, stats, origin=origin, geo_penalty_per_1000_km=GEO_PENALTY_PER_1000_KM)
    now_pt, _ = find_twin(sig_now, points, weights, stats, origin=origin, max_km=BACKTEST_MAX_KM)
    past_pt, _ = find_twin(sig_1995, points, weights, stats, origin=origin, max_km=BACKTEST_MAX_KM)

    places = load_json(PLACES_PATH)
    crops = load_json(CROPS_PATH)
    current_crop = pick_current_crop(crops, sig_now, crop_name)

    twin = point_entry(twin_pt, places)
    twin.update({
        "distance_km": round(haversine_km(lat, lon, twin_pt["lat"], twin_pt["lon"])),
        "match_score": round(match_score(twin_dist), ROUND_DIGITS),
        "signature": round_signature(twin_pt["signature"]),
    })
    twin_1995 = point_entry(past_pt, places)
    twin_1995["drift_km"] = round(haversine_km(past_pt["lat"], past_pt["lon"], now_pt["lat"], now_pt["lon"]))

    return {
        "field": {"lat": lat, "lon": lon, "name": field_name(lat, lon, places)},
        "signature_now": round_signature(sig_now),
        "signature_2045": round_signature(sig_2045),
        "twin": twin,
        "twin_now": point_entry(now_pt, places),
        "twin_1995": twin_1995,
        "crops_there": crops_for_climate(crops, twin_pt["signature"], sig_2045),
        "current_crop": current_crop["name"],
        "current_crop_viability": viability_curve(current_crop, sig_now, sig_2045, scatter),
        "caveats": CAVEATS,
    }
