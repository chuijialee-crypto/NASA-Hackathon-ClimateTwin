# 🌍 Climate Twin

> *Every team here will tell a farmer what to plant next year. We are telling them where their farm is going, and who already farms there.*

**NASA Space Apps Challenge KL 2026** · Team 103 · Challenge: *Field Shift: Adapting Farms with NASA Data*

Climate Twin answers one question a farmer actually asks:

> **What is happening to my land, and who already farms land like it?**

We do not predict the future. We find the place on Earth whose climate **today** matches what a farmer's field is **trending toward in 2045**, and show what is already grown there. For the Kedah padi demo field, that place is **Bicol, Philippines** (2,739 km away, match score 0.80).

---

## Quick Start (2 minutes)

Requires Python 3.11+ and a web browser. No API keys, no build step.

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Start the backend (terminal 1), http://localhost:8000
uvicorn api.main:app --reload

# 3. Start the frontend (terminal 2), http://localhost:3000
python -m http.server 3000 --directory frontend
```

Open **http://localhost:3000** and click **"Use the demo field (Kedah, Malaysia)"**, or click any point on the map.

Check the API directly:

```bash
curl "http://localhost:8000/twin?lat=6.12&lon=100.37"
```

Run the tests (69 tests):

```bash
python -m pytest
```

### Automatic offline fallback

If the backend is not running, or NASA POWER is unreachable, the frontend does not break. It switches to **real, precomputed engine output** and says so in the status line:

| Situation | What is shown |
|---|---|
| The chosen point is one of the 10 Malaysian presets (within about 1 km) | That preset's saved engine result, from `frontend/malaysia_states.json` |
| Any other point | The Kedah demo result, from `frontend/demo_field.json` |

Both files are copies of `data/malaysia_states.json` and `data/demo_field.json`. The frontend tries `../data/` first and then the copy next to the page. They are produced by running the same `climate_twin()` engine (`python -m engine.export_presets`). Only the map background tiles need internet.

---

## How Climate Twin Works

```
1. Pick a field on the map
        ↓
2. Pull 40 years (1984-2024) of daily NASA POWER data for that point
        ↓
3. Compute an 8-number climate signature for every year,
   fit a straight line to each, and read the line at 2045
        ↓
4. Compare that 2045 signature with a pre-computed 760-point global land grid
   of present-day signatures; the closest match is the Climate Twin
        ↓
5. Draw the arc: your field → its twin, and show what grows there
        ↓
6. Backtest: find the field's twin for 1990-2000 and for 2015-2024.
   The distance between them (drift_km) shows the shift has already happened.
```

### The 8-value climate signature

All eight values are arithmetic on four NASA POWER daily variables.

| # | Value | NASA variable | Definition |
|---|-------|---------------|------------|
| 1 | Mean annual temperature (°C) | `T2M` | Mean of daily values |
| 2 | Growing degree days | `T2M` | Sum of max(T2M − 10, 0) per year |
| 3 | Annual rainfall (mm) | `PRECTOTCORR` | Mean daily rain × 365.25 |
| 4 | Wet-season share | `PRECTOTCORR` | Share of annual rain in the wettest 3 consecutive months |
| 5 | Longest dry spell (days) | `PRECTOTCORR` | Longest run of days under 1 mm, averaged over years |
| 6 | Heat-stress days per year | `T2M_MAX` | Days above 35 °C |
| 7 | Mean solar radiation (MJ/m²/day) | `ALLSKY_SFC_SW_DWN` | Mean of daily values |
| 8 | Coldest-month mean temperature (°C) | `T2M` | Lowest of the 12 calendar-month means |

Days marked `-999` by POWER are treated as missing and never averaged in.

### Matching and the 2045 trend

- **Trend:** ordinary least-squares line (`scipy.stats.linregress`) through each signature value's yearly series, 1984-2024, read at 2045. It is a simple direction-of-change estimate, not a climate model.
- **Global grid (760 land points):** a 5° global land grid plus a finer 1.5° grid over Southeast Asia (lat −10 to 25, lon 90 to 130). The 5° grid has no land cell on Peninsular Malaysia, so Malaysian fields needed the finer grid. Each point holds the 2015-2024 signature.
- **Distance:** z-score each value across the grid, then take the weighted Euclidean distance, with weights from `data/weights.json` (temperature and rainfall highest). `match_score = 1 / (1 + distance)`, so higher is better.
- **Geographic tie-break:** a penalty of 0.0075 per 1,000 km is added when ranking candidates, so two equally good matches resolve to the nearer one.
- **Backtest:** the 1990-2000 and 2015-2024 twins are searched within 1,000 km of the field. `drift_km` is the Haversine distance between them.
- **Crops:** a crop is listed if the twin's climate fits its FAO ECOCROP-style limits (`data/crops.json`, 18 crops, each with a source URL). The field's current crop gets a 2025-2045 viability index, an index of climate shift and not a yield forecast.

Every number on screen traces back to arithmetic on NASA POWER data. There is no machine learning.

### Speed

The global grid is pre-computed, so a request only reads the field's own 40-year series from the disk cache and scans 760 points. That takes about 0.1-0.2 s on our development machine for a cached field. A location never seen before needs one live NASA POWER download first.

---

## API

```
GET /twin?lat={lat}&lon={lon}[&crop={crop name}]
```

CORS is open. `crop` is optional (default: Paddy rice). Errors: `422` for an unknown crop, `502` if NASA POWER fails or returns bad data.

```json
{
  "field":                  { "lat": 6.12, "lon": 100.37, "name": "Kedah padi field" },
  "signature_now":          { "mean_temp": "…", "gdd": "…", "rain_mm": "…", "…": "8 values" },
  "signature_2045":         { "…": "8 values" },
  "twin":                   { "lat": "…", "lon": "…", "place": "Bicol, Philippines", "distance_km": 2739, "match_score": 0.8, "signature": { "…": "8 values" } },
  "twin_now":               { "lat": "…", "lon": "…", "place": "…" },
  "twin_1995":              { "lat": 5.0, "lon": 97.5, "place": "Aceh, Indonesia", "drift_km": 372 },
  "crops_there":            [ { "name": "…", "note": "…", "source": "…", "match_score": 0.0 } ],
  "current_crop":           "Paddy rice",
  "current_crop_viability": [ { "year": 2025, "score": 0.99 }, "…", { "year": 2045, "score": 0.9 } ],
  "caveats":                [ "…" ]
}
```

`frontend/contract.json` is the original agreed shape with placeholder values. `data/demo_field.json` is a frozen real response.

---

## Project Structure

```
├── engine/
│   ├── power_client.py      # NASA POWER fetcher + on-disk cache
│   ├── signature.py         # The 8 signature values (pure functions)
│   ├── grid.py              # Builds data/global_grid.json
│   ├── twin.py              # Trend fit, 2045 extrapolation, twin lookup, crops, viability
│   └── export_presets.py    # Saves engine output for the 10 Malaysian presets
├── api/main.py              # FastAPI app, one endpoint, CORS enabled
├── frontend/                # Static HTML/JS (Leaflet, Chart.js, globe.gl in vendor/)
│   ├── index.html, app.js, style.css
│   ├── demo_field.json      # Offline fallback: Kedah demo result
│   ├── malaysia_states.json # Offline fallback: saved result per preset
│   └── contract.json        # Agreed response shape (placeholder values)
├── data/
│   ├── global_grid.json     # Pre-computed 760-point grid of present-day signatures
│   ├── crops.json           # 18 crops with climate limits and source URLs
│   ├── weights.json         # Signature matching weights
│   ├── demo_field.json, malaysia_states.json, places.json, ui_copy.json
├── tests/                   # 69 tests (pytest)
├── docs/TECHNICAL_BRIEF_FOR_MENTOR.md   # Formulas and parameters in detail
├── .kiro/steering/          # Project guidelines used with Kiro (see disclosure)
└── requirements.txt
```

### Rebuilding the grid (optional)

`data/global_grid.json` is the pre-computed grid. If it is missing from your checkout, rebuild it (about 20-30 minutes, 5 parallel requests; every response is cached in `cache/`, so it is safe to stop and restart):

```bash
python -m engine.grid
```

---

## Caveats

These are on screen in the app as well.

- NASA POWER is gridded climate data at roughly 50 km, not a measurement of this specific field.
- We do not forecast weather, yield, or profit.
- A linear trend is a simplifying assumption, not a climate projection.
- Confirm any planting decision with a local agricultural adviser.

The weights, the geographic penalty and the crop-scoring widths are modelling choices made by the team. They are visible in `data/weights.json` and `engine/twin.py`. The crop limits in `data/crops.json` were compiled by the team from FAO ECOCROP-style ranges and have not been independently validated by an agronomist.

---

## Data & Tools Disclosure


### Data

| Source | Use |
|---|---|
| [NASA POWER Agroclimatology (AG) API](https://power.larc.nasa.gov/api/temporal/daily/point) | The only climate data source. Daily `T2M`, `T2M_MAX`, `PRECTOTCORR`, `ALLSKY_SFC_SW_DWN` for the field (1984-2024) and for every global grid point (2015-2024). Community `AG`. No key required. |
| [FAO ECOCROP](https://ecocrop.apps.fao.org/ecocrop/srv/en/home) | Reference for the crop climate tolerance ranges in `data/crops.json`. Each crop entry carries its source URL. |

### Third-party libraries and services

FastAPI, Uvicorn, pandas, NumPy, SciPy, HTTPX and global-land-mask (Python, see `requirements.txt`). Leaflet, Chart.js and globe.gl (front-end, in `frontend/vendor/`). OpenStreetMap map tiles.

### AI-assisted development (Kiro)

This project was built with **Amazon Kiro** (an AI-assisted development tool), disclosed as required by the [NASA Space Apps Challenge](https://www.spaceappschallenge.org/) rules. Kiro was guided by the project's steering files in [`.kiro/steering/`](.kiro/steering/) (architecture, coding standards, NASA data reference, judging criteria, roles and workflow). The team set the scope, reviewed the output, and chose the method. Kiro helped write and test the code and documentation. All climate numbers come from NASA POWER data and the arithmetic in `engine/`, not from an AI model.






---

## Team

| Role | Member | Responsibility |
|---|---|---|
| Data & climate engine | Loke Yi Cheng | NASA POWER, signatures, twin lookup, API |
| Front-end (Team Leader) | Lee Chui Jia | Map, arc, charts, offline fallback |
| Agronomy & validity | Koh Zhe Xuan | Crop knowledge base, sanity checks, UI copy |
| Story & submission | Ong Yan Xing | Demo video, project page, integration testing |

## Licence

MIT.
