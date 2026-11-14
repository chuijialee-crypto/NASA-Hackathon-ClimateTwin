"""NASA POWER client: fetch daily data for one point, with an on-disk cache."""

import json
from pathlib import Path

import httpx
import numpy as np
import pandas as pd

POWER_URL = "https://power.larc.nasa.gov/api/temporal/daily/point"
PARAMETERS = ["T2M", "T2M_MAX", "PRECTOTCORR", "ALLSKY_SFC_SW_DWN"]
COMMUNITY = "AG"  # Agroclimatology, per nasa-data-reference.md
MISSING_VALUE = -999.0  # POWER fill value
REQUEST_TIMEOUT_S = 120  # 40 years of daily data is a large response

# Field historical trend window (nasa-data-reference.md, "Time Windows").
HISTORY_START = "19840101"
HISTORY_END = "20241231"

CACHE_DIR = Path(__file__).resolve().parent.parent / "cache"


def cache_path(lat: float, lon: float, start: str, end: str, cache_dir: Path = CACHE_DIR) -> Path:
    """Cache file name: cache/{lat}_{lon}_{start}_{end}.json"""
    return cache_dir / f"{lat}_{lon}_{start}_{end}.json"


def fetch_raw(lat: float, lon: float, start: str, end: str) -> dict:
    """Download one POWER response. Raises if the HTTP call fails or the shape is wrong."""
    params = {
        "parameters": ",".join(PARAMETERS),
        "community": COMMUNITY,
        "longitude": lon,
        "latitude": lat,
        "start": start,
        "end": end,
        "format": "JSON",
    }
    response = httpx.get(POWER_URL, params=params, timeout=REQUEST_TIMEOUT_S)
    response.raise_for_status()
    raw = response.json()
    check_shape(raw)
    return raw


def check_shape(raw: dict) -> None:
    """Fail loudly if a required parameter is missing from the response."""
    try:
        parameter = raw["properties"]["parameter"]
    except (KeyError, TypeError) as err:
        raise ValueError(f"POWER response has no properties.parameter: {str(raw)[:200]}") from err
    missing = [p for p in PARAMETERS if p not in parameter]
    if missing:
        raise ValueError(f"POWER response is missing parameters: {missing}")


def load_raw(lat: float, lon: float, start: str, end: str, cache_dir: Path = CACHE_DIR) -> dict:
    """Return the raw response, from disk if cached, otherwise download and save it."""
    path = cache_path(lat, lon, start, end, cache_dir)
    if path.exists():
        raw = json.loads(path.read_text(encoding="utf-8"))
        check_shape(raw)
        return raw

    raw = fetch_raw(lat, lon, start, end)
    cache_dir.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")  # write then rename, so a crash never leaves a half file
    tmp.write_text(json.dumps(raw), encoding="utf-8")
    tmp.replace(path)
    return raw


def to_dataframe(raw: dict) -> pd.DataFrame:
    """Raw POWER JSON -> DataFrame indexed by date, one column per parameter.

    Fill values (-999) become NaN so they cannot leak into any average.
    """
    check_shape(raw)
    parameter = raw["properties"]["parameter"]
    df = pd.DataFrame({name: pd.Series(parameter[name]) for name in PARAMETERS})
    df.index = pd.to_datetime(df.index, format="%Y%m%d")
    df.index.name = "date"
    df = df.astype(float).replace(MISSING_VALUE, np.nan)
    return df.sort_index()


def get_daily(
    lat: float,
    lon: float,
    start: str = HISTORY_START,
    end: str = HISTORY_END,
    cache_dir: Path = CACHE_DIR,
) -> pd.DataFrame:
    """Daily T2M, T2M_MAX, PRECTOTCORR, ALLSKY_SFC_SW_DWN for a point (cached)."""
    return to_dataframe(load_raw(lat, lon, start, end, cache_dir))
