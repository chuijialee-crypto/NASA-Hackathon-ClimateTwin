# NASA Data Reference

## NASA POWER API

The only external data source this project uses. No login or API key required.

**Documentation:** https://power.larc.nasa.gov/docs/

**Base URL:**
```
https://power.larc.nasa.gov/api/temporal/daily/point
```

**Example request (daily data for Kedah, 2015–2025):**
```
https://power.larc.nasa.gov/api/temporal/daily/point
  ?parameters=T2M,T2M_MAX,PRECTOTCORR,ALLSKY_SFC_SW_DWN
  &community=AG
  &longitude=100.37
  &latitude=6.12
  &start=20150101
  &end=20241231
  &format=JSON
```

**Community:** Always use `AG` (Agroclimatology). It applies agricultural-relevant processing.

**Parameters we use:**

| Parameter | Description | Unit |
|-----------|-------------|------|
| `T2M` | Temperature at 2 metres (daily mean) | °C |
| `T2M_MAX` | Temperature at 2 metres (daily max) | °C |
| `PRECTOTCORR` | Precipitation, corrected | mm/day |
| `ALLSKY_SFC_SW_DWN` | All-sky surface shortwave downward irradiance | MJ/m²/day |

**Response shape:**
```json
{
  "properties": {
    "parameter": {
      "T2M": { "20150101": 27.3, "20150102": 26.9, ... },
      "T2M_MAX": { "20150101": 33.1, ... },
      "PRECTOTCORR": { "20150101": 12.4, ... },
      "ALLSKY_SFC_SW_DWN": { "20150101": 18.2, ... }
    }
  }
}
```

**Important caveats (put these on screen):**
- POWER data is gridded at ~50 km resolution, not a point measurement of a specific field
- Missing/fill values are -999.0 — filter these out before computing anything
- Spatial coverage: global land and ocean; temporal: 1981-present for most parameters

## Disk Caching Strategy

Cache file naming convention:
```
cache/{lat}_{lon}_{start}_{end}.json
```

Example: `cache/6.12_100.37_20150101_20241231.json`

Before every POWER request, check if the cache file exists. If it does, load it. If not, fetch and immediately save.

This means the global grid build only ever downloads each point once, even if the script crashes and restarts.

## Global Grid Construction

```python
import itertools
from global_land_mask import globe

GRID_STEP_DEG = 5
lats = range(-60, 75, GRID_STEP_DEG)   # -60 to 70 → 27 values
lons = range(-180, 180, GRID_STEP_DEG) # -180 to 175 → 72 values

all_points = list(itertools.product(lats, lons))  # 27 × 72 = 1,944 points
grid_points = [(lat, lon) for lat, lon in all_points if globe.is_land(lat, lon)]
print(f"{len(grid_points)} land points of {len(all_points)}")  # expect roughly 500–600
```

Filter to land **before** fetching. Fetching all 1,944 points and dropping ocean afterwards takes about 4× longer.

`global-land-mask` works offline (it ships a 1 km GLOBE-derived mask), so it adds no API calls. Source: [global-land-mask on PyPI](https://pypi.org/project/global-land-mask/).

If the build is still too slow, set `GRID_STEP_DEG = 10`: 14 × 36 = 504 points before masking, roughly 130–150 land points after.

## Time Windows

| Purpose | Window |
|---------|--------|
| Current signature (twin search target) | 2015–2024 |
| Field historical trend (40-year fit) | 1984–2024 |
| Backtest 1995 twin | 1990–2000 |

## Linear Trend to 2045

For each of the 8 signature values computed on the field's historical data:
1. Compute the value for each year in the 40-year window
2. Fit OLS linear regression: `value ~ year`
3. Extrapolate to 2045: `predicted = slope * 2045 + intercept`

This is the weakest scientific link. Say so on screen. Show the fitted line over the actual scatter so a judge can see exactly how much is being assumed.

```python
from scipy import stats
import numpy as np

def extrapolate_to_2045(years: list[int], values: list[float]) -> float:
    slope, intercept, r_value, p_value, std_err = stats.linregress(years, values)
    return slope * 2045 + intercept
```

## Weighted Euclidean Distance

Two steps. Standardise first, so different units (°C vs mm vs MJ/m²) don't dominate. Rainfall in raw mm would otherwise outweigh every other value.

```python
import numpy as np

def grid_stats(grid_sigs: list[dict], keys: list[str]) -> dict:
    """Mean and std of each signature value across the whole grid."""
    return {
        k: (float(np.mean([g[k] for g in grid_sigs])), float(np.std([g[k] for g in grid_sigs])))
        for k in keys
    }

def twin_distance(field_sig: dict, grid_sig: dict, weights: dict, stats: dict) -> float:
    """Weighted Euclidean distance on z-scored values. Lower = better match."""
    keys = list(weights.keys())
    z = lambda sig, k: (sig[k] - stats[k][0]) / stats[k][1]
    diff = np.array([z(field_sig, k) - z(grid_sig, k) for k in keys])
    w = np.array([weights[k] for k in keys])
    return float(np.sqrt(np.sum(w * diff**2)))

def match_score(distance: float) -> float:
    """Convert distance to the contract's 0–1 score. Higher = better match."""
    return 1 / (1 + distance)
```

The API returns `match_score(twin_distance(...))` in the contract's `twin.match_score` field. Compute `grid_stats` once over the present-day grid and reuse it for the 2045 lookup and the 1995 backtest, so all three are measured on the same scale.

## Crop Knowledge Base Format

File: `crops.json`

```json
[
  {
    "name": "Sorghum",
    "gdd_required": 2600,
    "rain_min_mm": 400,
    "rain_max_mm": 1200,
    "max_heat_days": 60,
    "min_cold_month_c": 15,
    "note": "Drought-tolerant cereal; established smallholder crop across semi-arid Asia",
    "source": "https://ecocrop.review.fao.org/"
  }
]
```

**Reference for tolerance ranges:** FAO ECOCROP database — https://ecocrop.review.fao.org/
