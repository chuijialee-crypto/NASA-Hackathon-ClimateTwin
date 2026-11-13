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

lats = range(-60, 75, 5)   # -60 to 70 in steps of 5
lons = range(-180, 180, 5) # -180 to 175 in steps of 5

# Filter to land points only — use a simple land mask or
# accept that some ocean points will be in the grid and
# filter them out when their crop list is empty
grid_points = list(itertools.product(lats, lons))
# ~504 points at 5° resolution
```

For the hackathon, ocean points returning empty crops can simply be excluded from matching.

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

```python
import numpy as np

def match_score(field_sig: dict, grid_sig: dict, weights: dict) -> float:
    """Lower score = better match."""
    keys = list(weights.keys())
    diff = np.array([field_sig[k] - grid_sig[k] for k in keys])
    w = np.array([weights[k] for k in keys])
    return float(np.sqrt(np.sum(w * diff**2)))
```

Standardise (z-score) all values across the grid before computing distances, so the different units (°C vs mm vs MJ/m²) don't dominate.

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
