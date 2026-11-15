# Climate Twin: Technical Brief for Mr. Amos

**Project:** Climate Twin (Team 103, NASA Space Apps Challenge Kuala Lumpur 2026, "Field Shift")
**Purpose of this document:** describe exactly what the backend computes, with the parameters and formulas taken directly from the source code.

**Idea in one sentence.** We do not forecast the future. We find the place on Earth whose climate *today* matches what a farmer's field is *trending toward* in 2045, and show what is already grown there.

**Source files covered:** `engine/power_client.py`, `engine/signature.py`, `engine/grid.py`, `engine/twin.py`, `api/main.py`. Configuration: `data/weights.json`, `data/crops.json`.

**Pipeline for one request:**

```
NASA POWER daily data (1984-2024, cached)
  -> 8-value climate signature per year
  -> OLS line per value, read at 2045            (signature_2045)
  -> z-score against 760-point global grid
  -> weighted Euclidean distance + small geographic penalty
  -> twin (2045), twin_now, twin_1995, drift_km, crops_there, viability curve
```

---

## 1. NASA Data Source and Cleaning (`engine/power_client.py`)

### 1.1 Source

| Item | Value (from code) |
|---|---|
| Endpoint | `https://power.larc.nasa.gov/api/temporal/daily/point` |
| Community | `AG` (Agroclimatology) |
| Parameters | `T2M`, `T2M_MAX`, `PRECTOTCORR`, `ALLSKY_SFC_SW_DWN` |
| Format | `JSON` |
| Authentication | None (NASA POWER needs no API key) |
| HTTP client / timeout | `httpx`, 120 s per request (a 40-year daily response is large) |

| Parameter | Meaning | Unit |
|---|---|---|
| `T2M` | Air temperature at 2 m, daily mean | °C |
| `T2M_MAX` | Air temperature at 2 m, daily maximum | °C |
| `PRECTOTCORR` | Precipitation, bias-corrected | mm/day |
| `ALLSKY_SFC_SW_DWN` | All-sky surface shortwave downward irradiance | MJ/m²/day |

**Spatial resolution.** POWER is a gridded product of roughly 0.5° (about 50 km). This figure appears in our on-screen caveat ("gridded climate data at roughly 50 km, not a measurement of this specific field"). It is not enforced in code. A value for a field is the value of the grid cell that contains it.

### 1.2 Date ranges

| Use | Window | Defined in |
|---|---|---|
| Field history (trend fit) | `19840101` to `20241231` (calendar years 1984-2024, called the "40-year" window) | `HISTORY_START`, `HISTORY_END` in `power_client.py` |
| Global grid (present-day reference) | `20150101` to `20241231` | `GRID_START`, `GRID_END` in `grid.py` |
| Backtest window | 1990-2000, sliced from the field history | `twin.py` |

### 1.3 Missing values (-999)

POWER marks missing observations with the fill value `-999.0`. In `to_dataframe()`:

```python
df = df.astype(float).replace(MISSING_VALUE, np.nan)   # MISSING_VALUE = -999.0
```

Fill values become `NaN` before any statistic is computed, so a missing day can never be averaged in as a very cold or "negative rain" day. Downstream rules (`signature.py`):

- Averages use valid days only (pandas skips `NaN`).
- A missing day breaks a dry-spell run. We never assume a missing day was dry.
- `check_input()` refuses to compute a signature if any of the 4 columns has less than 90% valid days (`MIN_VALID_FRACTION = 0.9`). The error is raised, not hidden.
- `check_shape()` raises a `ValueError` if the response lacks `properties.parameter` or any of the 4 parameters. There are no silent zeros.

### 1.4 Local JSON disk cache

- File name: `cache/{lat}_{lon}_{start}_{end}.json`, for example `cache/6.12_100.37_19840101_20241231.json`.
- `load_raw()` checks for the file first. If present it loads it (and re-validates its shape). Otherwise it downloads, then saves.
- Writes are atomic: the response is written to a `.tmp` file and then renamed. A crash cannot leave a half-written cache file.
- The cache currently holds 777 files. Each point is therefore downloaded once and never again. The grid build can be stopped and re-run safely.

---

## 2. Backend Execution Flow and Performance (`engine/grid.py`, `api/main.py`)

### 2.1 The API (`api/main.py`)

One endpoint, built with FastAPI:

```
GET /twin?lat={lat}&lon={lon}[&crop={crop name}]
```

| Aspect | Behaviour |
|---|---|
| Validation | `lat` in [-90, 90], `lon` in [-180, 180] (FastAPI `Query` constraints) |
| Rounding | Coordinates rounded to 4 decimals (`COORD_DECIMALS = 4`) so cache file names stay tidy |
| Optional `crop` | Crop to score for the viability curve. Default is "Paddy rice". An unknown name returns HTTP 422 |
| CORS | Open (`allow_origins=["*"]`, GET only), so the browser front-end on another origin can call it |
| Errors | POWER network failure returns 502 "NASA POWER request failed". Incomplete or bad data returns 502 with the reason. Errors are printed to the server log |
| Handler | Calls `engine.twin.climate_twin(lat, lon, crop)` and returns its dict. The shape follows `frontend/contract.json` |

Run with: `uvicorn api.main:app --port 8000`

### 2.2 The pre-computed global grid (`engine/grid.py`)

The grid is built once, offline, by `python -m engine.grid`. It writes `data/global_grid.json`.

**Composition: 760 land points, 0 failed.**

1. **Global grid at 5°.** Latitudes -60 to 70, longitudes -180 to 175, step 5° (`GRID_STEP_DEG = 5`). Only points on land are kept, using `global_land_mask` (`globe.is_land`), which works offline. Filtering happens *before* downloading, so no ocean points are fetched.
2. **Southeast Asia densification at 1.5°** (`REGION_STEP_DEG = 1.5`). Region: latitude -10 to 25, longitude 90 to 130. Points already in the 5° grid are skipped. Reason, quoted from the code comment: the 5° grid has no land cell on Peninsular Malaysia, so Malaysian fields matched the Amazon. The finer grid fixes that.

For every point the build downloads 2015-2024 daily data (through the same cached `get_daily`), computes the 8-value signature, and stores `{lat, lon, signature}`.

**Build mechanics:**

- 5 concurrent requests (`MAX_WORKERS = 5`), using a thread pool.
- Network or malformed-response errors are retried up to 4 attempts with waits of 2 s, 4 s, 8 s (`RETRY_BASE_DELAY_S * 2^(attempt-1)`).
- A point that still fails is recorded in `meta.failed_points`. It does not stop the build.
- Output is sorted by (lat, lon) for reproducibility and saved atomically.
- `meta` records the step sizes, regional bounds, window, and `point_count`.

### 2.3 Why a request is fast

At request time the engine does **not** touch the 760 grid points' raw data. It reads one small file of ready-made signatures (loaded once and kept in memory with `lru_cache`). A request therefore does only this work:

1. Load the field's cached 1984-2024 daily data from disk.
2. Compute 41 yearly signatures and 8 OLS fits.
3. Three linear scans over 760 points (twin, `twin_now`, `twin_1995`), each point being an 8-term distance.

**Measured on the development machine** (project venv, demo field `6.12, 100.37`, data already cached): 0.12 to 0.17 s per call to `climate_twin()`. This is the engine function only, without HTTP overhead.

**Important limit.** The ~0.1 s figure applies to a field whose 1984-2024 data are already in `cache/`. A brand-new location needs one live NASA POWER download. Its speed depends on NASA's server, and the client allows up to 120 s. The pre-computed grid removes the 760-point download cost from every request. It does not remove the single download for a new field.

### 2.4 Offline fallback

The front-end (`frontend/app.js`) calls `http://localhost:8000/twin` with a 15 s timeout. If the API is unreachable, returns an error, or sends an unusable answer, it falls back to **real, precomputed engine output**. It never shows placeholder values. The fallback files are written by `python -m engine.export_presets`, which runs the same `climate_twin()` engine on each preset field:

| File | Content |
|---|---|
| `data/malaysia_states.json` | The full engine response for each of the 10 Malaysian preset fields (padi, durian, oil palm and others), each scored with its own local crop |
| `data/demo_field.json` | The full engine response for the Kedah demo field (`lat=6.12, lon=100.37`) |

Fallback order when the API is down:

1. If the selected point is within 0.01° (about 1 km) of a preset's coordinates, the saved response for that preset is shown. The status line says it is the saved engine result for the preset.
2. Otherwise the Kedah demo response is shown, and the status line states that it is the demo result and not the point that was chosen.

Each file is requested from `../data/` first (page served from the project folder) and then from a copy next to the page in `frontend/` (page served with `--directory frontend`). If `malaysia_states.json` cannot be loaded, the Kedah demo response is still available. With the API down, every number on screen comes from these saved files. Only the map background tiles need an internet connection.

Verified in a headless browser with the API stopped: the Pahang (Raub) preset returned its own saved result (twin Bicol, Philippines; current crop Durian), and a point that is not a preset returned the Kedah demo result with the correct status message.

---

## 3. Mathematical and Agronomic Formulas (`engine/signature.py`, `engine/twin.py`)

### 3.1 The 8 climate signature indicators (`signature.py`)

All "per year" quantities are a daily mean over valid days multiplied by `DAYS_PER_YEAR = 365.25`. This makes windows of any length (1 year or 10 years) comparable and means missing days shrink the sample instead of counting as zero.

| # | Key | Definition (exact) | Unit |
|---|---|---|---|
| 1 | `mean_temp` | mean of daily `T2M` | °C |
| 2 | `gdd` | growing degree days: `mean( max(T2M - 10, 0) ) × 365.25` (base `GDD_BASE_C = 10 °C`) | °C·day/yr |
| 3 | `rain_mm` | `mean(PRECTOTCORR) × 365.25` | mm/yr |
| 4 | `wet_share` | share of annual rain in the wettest 3 consecutive months (see below) | 0.25 to 1 |
| 5 | `dry_spell_days` | longest run of days with rain `< 1 mm` (`DRY_DAY_MM`), found for each calendar year, then averaged over the years | days |
| 6 | `heat_days` | `mean( T2M_MAX > 35 °C ) × 365.25` (`HEAT_STRESS_C = 35`) | days/yr |
| 7 | `solar` | mean of daily `ALLSKY_SFC_SW_DWN` | MJ/m²/day |
| 8 | `cold_month` | lowest of the 12 calendar-month mean `T2M` values | °C |

**`wet_share` in detail.** Take the mean daily rain for each calendar month and multiply by the days in that month (`[31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]`) to get monthly totals `m1..m12`. Slide a 3-month window around the year, wrapping December into January, and take the largest sum:

```
wet_share = max over i of ( m_i + m_(i+1) + m_(i+2) ) / sum(m_1..m_12)
```

Perfectly even rain gives 0.25. A sharply seasonal monsoon approaches 1. It raises an error if any calendar month has no data.

### 3.2 40-year OLS trend and the 2045 extrapolation (`twin.py`)

1. Pull daily data 1984-2024 for the field (cached).
2. Compute the 8-value signature **separately for each calendar year** (`yearly_signatures`, 41 yearly values per indicator).
3. For each of the 8 indicators, fit an ordinary least-squares line `value = slope × year + intercept` with `scipy.stats.linregress`.
4. Read each line at the target year:

```
signature_2045[k] = slope_k × 2045 + intercept_k
```

5. Clamp results to physically possible ranges (`PHYSICAL_BOUNDS`): `gdd`, `rain_mm`, `solar` ≥ 0; `wet_share` in [0.25, 1]; `dry_spell_days` and `heat_days` in [0, 366]. `mean_temp` and `cold_month` are not clamped.

**Other windows:**

- `signature_now` = the signature over 2015-2024 (same window as the global grid, so field and grid are comparable).
- `signature_1995` = the signature over 1990-2000.

A linear trend is a simplifying assumption, not a climate projection. This is stated on screen.

### 3.3 Distance, standardisation and the twin search (`twin.py`)

**Z-score standardisation.** Mean and (population) standard deviation of each indicator are computed once across all 760 grid points (`grid_stats`). The same statistics are used for all three lookups, so they sit on one scale. If an indicator has zero spread, the code raises an error.

```
z(x, k) = (x_k - mean_k) / std_k
```

**Weighted Euclidean distance** (lower is better):

```
distance = sqrt( sum over k of  w_k × ( z(field_k) - z(grid_k) )² )
```

**Weights** (`data/weights.json`):

| Indicator | Weight |
|---|---|
| `mean_temp` | 2.0 |
| `rain_mm` | 2.0 |
| `gdd` | 1.5 |
| `wet_share` | 1.5 |
| `dry_spell_days` | 1.5 |
| `heat_days` | 1.5 |
| `solar` | 1.0 |
| `cold_month` | 1.0 |

`load_weights()` raises an error unless the file has exactly the 8 signature keys.

**Match score** reported to the user (higher is better, between 0 and 1):

```
match_score = 1 / (1 + distance)
```

**Three lookups, all against the same grid:**

| Result | Target signature | Search area | Ranking |
|---|---|---|---|
| `twin` (the field in 2045) | `signature_2045` | whole grid | `distance + 0.0075 × km/1000` |
| `twin_now` | `signature_now` | grid cells within 1,000 km of the field | `distance` |
| `twin_1995` (backtest) | `signature_1995` | grid cells within 1,000 km of the field | `distance` |

**Geographic regularisation (main twin only).** The rank used to pick the best cell is

```
rank = climate_distance + GEO_PENALTY_PER_1000_KM × (km_from_field / 1000)
GEO_PENALTY_PER_1000_KM = 0.0075
```

Example from the code comments: 2,700 km adds about 0.02, 18,000 km adds about 0.14. The penalty is meant to break near-ties toward the closer cell, and it is too small to override a clearly better climate match. The `match_score` reported uses the **climate distance only**, without the penalty, so it still describes how well the climate matches.

**1,000 km backtest radius (`BACKTEST_MAX_KM = 1000`).** `twin_now` and `twin_1995` are only searched within 1,000 km of the field, because 30 years of climate drift is a regional movement. If no grid cell lies within 1,000 km, the code searches the whole grid and prints a warning.

### 3.4 Backtest and `drift_km` (Haversine)

```
twin_1995 = closest grid cell (within 1,000 km) to the field's 1990-2000 signature
twin_now  = closest grid cell (within 1,000 km) to the field's 2015-2024 signature
drift_km  = haversine( twin_1995, twin_now )
```

Haversine great-circle distance, with `R = 6371 km`:

```
a = sin²(Δφ/2) + cos φ1 · cos φ2 · sin²(Δλ/2)
d = 2R · asin( √a )
```

The idea is that if the field's best-matching reference location has shifted between the 1990-2000 and 2015-2024 windows, the method is describing a change that has already happened in observed data. `drift_km` measures between the two twins, not from the field itself. The same 8-value signature, the same grid statistics, and the same weights are used.

### 3.5 Crop suitability scoring (`twin.py`, thresholds from `data/crops.json`, 18 crops)

Each crop in `crops.json` carries a rain band (`rain_min_mm`, `rain_max_mm`) and three one-sided limits: `gdd_required` (at least), `max_heat_days` (at most), `min_cold_month_c` (at least). Tolerance ranges follow FAO ECOCROP, and each entry has a source URL.

**A. Rainfall fit: Gaussian around the midpoint of the rain band.**
The file has no separate "optimal" rainfall value, so the middle of the band stands in for the optimum.

```
midpoint  = (rain_min_mm + rain_max_mm) / 2
z         = (rain_mm - midpoint) / (0.3 × midpoint)        # RAIN_FIT_WIDTH = 0.3
rain_fit  = exp( -z² / 2 )
```

Distance is measured as a share of the midpoint, so a crop with a very wide band is not automatically a better fit. Rain 30% off the midpoint gives 0.61.

**B. One-sided stress limits.** Each limit becomes a margin (0 at the limit, 1 comfortably inside, negative beyond):

```
margin_gdd  = ( gdd / gdd_required - 1 ) / 0.25                       # COMFORT_HEADROOM = 0.25
margin_heat = ( max_heat_days - heat_days ) / ( max_heat_days × 0.25 )
margin_cold = ( cold_month - min_cold_month_c ) / 2.0                # COLD_COMFORT_C = 2 °C
```

Each margin goes through a logistic curve (clipped to ±3 to keep `exp()` finite):

```
comfort(m) = 1 / ( 1 + exp(-4 × m) )          # SUITABILITY_STEEPNESS = 4
```

This gives 0.5 at the limit, about 0.88 at a margin of 0.5, and about 0.98 at a margin of 1.

**C. Combined score:**

```
crop_match_score = rain_fit × min( comfort(margin_gdd), comfort(margin_heat), comfort(margin_cold) )
```

The weakest one-sided limit controls the score.

**D. `crops_there` (the list shown for the twin).** A crop is listed only if all four limits hold in the **twin's** climate: rain inside its band, and all three margins ≥ 0. Listed crops are then **scored on `signature_2045`** (the field's own projected climate) and sorted best first.

### 3.6 Viability curve, 2025-2045 (`twin.py`)

The curve scores the field's *current* crop (default "Paddy rice", or the best-scoring crop if rice cannot grow there today, or the crop named in `?crop=`) every 5 years: 2025, 2030, 2035, 2040, 2045.

**Climate path.** A straight line from `signature_now` (placed at the middle of its window, 2019.5) to `signature_2045`:

```
t = clip( (year - 2019.5) / (2045 - 2019.5), 0, 1 )
signature(year) = signature_now + t × ( signature_2045 - signature_now )
```

**Score for each year:**

```
viability(year) = min( crop_match_score(crop, signature(year)),
                       stress_factor(signature(year)) )
```

**Stress factor.** For three indicators (`mean_temp`, `heat_days`, `dry_spell_days`), take the rise above the field's own `signature_now` and penalise it with a Gaussian measured in units of the field's own year-to-year scatter:

```
rise_k    = signature(year)_k - signature_now_k
z_k       = max(0, rise_k) / scatter_k
penalty_k = exp( -z_k² / 2 )
stress_factor = min over the three of penalty_k
```

`scatter_k` is the standard deviation of the 41 yearly values around their own OLS line, with a minimum:

```
scatter_k = max( floor_k,  sqrt( sum(residual²) / (n - 2) ) )
floor:  mean_temp = 0.8 °C,  heat_days = 1 day,  dry_spell_days = 1 day
```

For temperature, `max(scatter, 0.8 °C)` is a deliberate floor. Tropical year-to-year scatter in mean temperature is only about 0.2-0.3 °C, so without the floor half a degree of warming would be treated as a very large shift. The floor stands in for the tolerance a crop can absorb. For heat days and dry spell, the floor mainly avoids division by zero (heat days is 0 in every year at many places).

The result is an index of how far the climate has moved from what the crop sits in today. **It is not a yield forecast.**

### 3.7 Result for the demo field (computed from the current code and data)

Demo field: Kedah padi field, `lat=6.12, lon=100.37`.

| Output | Value |
|---|---|
| `twin` (2045) | Bicol, Philippines; 2,739 km away; match score 0.80 |
| `twin_1995` | Aceh, Indonesia (5.0, 97.5) |
| `drift_km` | 372 km |
| Current crop | Paddy rice |
| Viability 2025 / 30 / 35 / 40 / 45 | 0.99 / 0.98 / 0.96 / 0.94 / 0.90 |

---

## Limitations (stated on screen and in the pitch)

- NASA POWER is gridded data of roughly 50 km, not a measurement at the specific field. A farmer should validate with local station data.
- A linear trend over 1984-2024 is the simplest defensible model. It is a direction-of-change estimate, not a climate projection. There is no machine learning.
- We do not forecast weather, yield, or profit. The viability curve is an index of climate shift relative to a crop's tolerances.
- Weights, the 0.0075 geographic penalty, the Gaussian widths, and the 0.8 °C temperature floor are modelling choices made by the team. They are not fitted to data. They are visible in code and can be tuned.
- The crop tolerance bands come from FAO ECOCROP-style ranges. They have been compiled by the team and have not been independently validated by an agronomist.
- The fast response applies to fields already in the disk cache. A new location needs one live POWER download.
- Every number shown traces back to arithmetic on NASA POWER data.
