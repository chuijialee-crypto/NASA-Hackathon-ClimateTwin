# 🌍 Climate Twin

> *Every team here will tell a farmer what to plant next year. We are telling them where their farm is going — and who already farms there.*

**NASA Space Apps Challenge KL 2026** · Team 103 · Challenge: *Field Shift — Adapting Farms with NASA Data*

---

## What Is Climate Twin?

Every farmer adapting to a changing climate is asked to guess at a future nobody can predict. We think there’s a better question.

Climate Twin answers one question a farmer actually asks:

> **What is happening to my land, and who already farms land like it?**

Somewhere on Earth, there is already a place with the climate your field will have in 2045 — and people farm it today. Climate Twin finds that place using 40 years of NASA Earth observation data, shows you what grows there, and maps a path from the crop that’s failing to the one that won’t.

We don't predict the future. We find the place on Earth whose climate **today** matches what your field will have in **2045** — and show what is already grown there.

A farmer in Kedah, Malaysia picks their field. We find their climate twin in Central Thailand. That place exists, people farm it today, and we show exactly what they grow. That's the idea.

---

## The User Flow

```
1. Farmer picks a field on the map
         ↓
2. We pull 40 years of daily NASA POWER climate data for that point
         ↓
3. We compute a climate signature (8 agronomic numbers)
   and fit a linear trend to 2045
         ↓
4. We search a global grid for the closest present-day match
         ↓
5. We draw the arc: your field → its Climate Twin
   "This is your field in 2045. People farm it today."
         ↓
6. We show the backtest: your 1995 twin vs today
   Your farm has already moved 610 km in climate terms.
   That's the proof our method describes something real.
```

The wow moment is **step 5**. Everything else exists to make step 5 believable.

---

## The Climate Signature

Eight numbers describe a field's climate well enough to match it against anywhere on Earth. All eight come from [NASA POWER](https://power.larc.nasa.gov/) — no login required.

| # | Value | NASA Variable | Why a Farmer Cares |
|---|-------|--------------|-------------------|
| 1 | Mean annual temperature (°C) | `T2M` | Sets which crops are possible at all |
| 2 | Growing degree days, base 10°C | `T2M` daily sum | How fast a crop reaches maturity |
| 3 | Total annual rainfall (mm) | `PRECTOTCORR` | Whether irrigation is optional |
| 4 | Wet-season concentration | Monthly rain share | Monsoon shape — same total, very different farming |
| 5 | Longest dry spell (days) | Consecutive days < 1 mm | The number that kills a crop |
| 6 | Heat-stress days per year | Days `T2M_MAX` > 35°C | Flowering failure in rice, maize, vegetables |
| 7 | Mean solar radiation | `ALLSKY_SFC_SW_DWN` | Photosynthesis ceiling |
| 8 | Coldest-month mean temp (°C) | `T2M` monthly min | Hard limit on tropical perennials |

**Matching method:** Standardise all 8 values across a global grid (z-score), then find the grid cell with the smallest weighted Euclidean distance to the field's projected 2045 signature.

**Trend fit:** Ordinary least-squares linear regression on 40 years of data, extrapolated 20 years. We say so on screen — a linear trend is a simple assumption, not a climate model. We show the scatter plot so a judge can see exactly what we're assuming.

---

## NASA Data

| Source | What We Use It For |
|--------|-------------------|
| [NASA POWER API](https://power.larc.nasa.gov/api/temporal/daily/point) | 40 years of daily temperature, rainfall, solar — for any lat/lon on Earth. No API key needed. |

**Parameters:** `T2M`, `T2M_MAX`, `PRECTOTCORR`, `ALLSKY_SFC_SW_DWN` · Community: `AG` (Agroclimatology)

> ⚠️ NASA POWER is gridded at ~50 km resolution — it is not a measurement of a specific field. We say this on screen.

---

## Project Structure

```
climate-twin/
│
├── engine/
│   ├── power_client.py      # NASA POWER fetcher + disk cache
│   ├── signature.py         # Compute the 8 signature values (pure functions)
│   ├── grid.py              # Build and query global_grid.json
│   └── twin.py              # Trend fit, 2045 extrapolation, nearest-neighbour lookup
│
├── api/
│   └── main.py              # FastAPI app — one endpoint, CORS enabled
│
├── frontend/
│   ├── index.html
│   ├── app.js               # Map, arc animation, charts
│   └── style.css
│
├── data/
│   ├── global_grid.json     # Pre-computed grid of present-day climate signatures
│   ├── crops.json           # Crop knowledge base (15–20 crops, each with source)
│   ├── weights.json         # Signature matching weights (tunable)
│   ├── contract.json        # Agreed API response shape (fake values for dev)
│   └── demo_field.json      # Frozen real output — offline fallback for demo day
│
└── README.md
```

---

## API

```
GET /twin?lat={lat}&lon={lon}
```

Returns a JSON object with the field's current signature, projected 2045 signature, the Climate Twin location, the 1995 twin (backtest), recommended crops, and viability curve.

**Demo default:** `GET /twin?lat=6.12&lon=100.37` — a real padi field in Kedah, Malaysia.

**Response shape** (see `data/contract.json` for the full schema):

```json
{
  "field":            { "lat": 6.12, "lon": 100.37, "name": "Kedah padi field" },
  "signature_now":    { "mean_temp": 27.1, "gdd": 6240, "rain_mm": 2410, "..." },
  "signature_2045":   { "mean_temp": 28.4, "..." },
  "twin":             { "lat": 14.6, "lon": 100.5, "place": "Central Thailand", "match_score": 0.91 },
  "twin_1995":        { "place": "Penang mainland", "drift_km": 610 },
  "crops_there":      [ { "name": "Jasmine rice", "note": "Heat-tolerant, single season" } ],
  "current_crop_viability": [ { "year": 2025, "score": 0.82 }, { "year": 2045, "score": 0.38 } ],
  "caveats":          [ "NASA POWER is ~50 km gridded data, not a measurement of this field." ]
}
```

---

## Setup

### Requirements

- Python 3.11+
- Node / browser (front-end is static HTML/JS, no build step)

### Install Python dependencies

```bash
pip install fastapi==0.115.5 uvicorn==0.32.1 pandas==2.2.3 numpy==2.1.3 scipy==1.14.1 httpx==0.27.2
```

### Build the global grid (run this first — takes ~20–30 min)

```bash
python engine/grid.py
```

This fetches 2015–2025 NASA POWER data for ~500 land points at 5° resolution and saves `data/global_grid.json`. All responses are cached to `cache/` — safe to restart if it's interrupted.

### Start the API

```bash
uvicorn api.main:app --reload
```

API runs at `http://localhost:8000`. Test it:

```bash
curl "http://localhost:8000/twin?lat=6.12&lon=100.37"
```

### Open the front-end

Open `frontend/index.html` in a browser, or serve it locally:

```bash
python -m http.server 3000 --directory frontend
```

> **Offline fallback:** if the API is unreachable, the front-end automatically loads `data/demo_field.json`. The demo always works.

---

## Team

| Role | Responsibility |
|------|---------------|
| **Role 1** | Python data & climate engine — NASA POWER, signature computation, twin lookup |
| **Role 2** | Front-end — world map, arc animation, charts |
| **Role 3** | Agronomy & validity — crop knowledge base, sanity checks, UI copy, caveats |
| **Role 4** | Story & submission — demo video, project page, rehearsals, submission |

---

## Caveats

We put these on screen. We're listing them here too.

- NASA POWER is gridded at ~50 km resolution — it is not a measurement of this specific field.
- We do not forecast weather, yield, or profit.
- A linear trend is a simplifying assumption, not a climate projection.
- Confirm any planting decision with a local agricultural adviser.

Saying this out loud costs nothing and reads as competence.

---

## Data Sources

- [NASA POWER API](https://power.larc.nasa.gov/) — climate data
- [FAO ECOCROP](https://ecocrop.review.fao.org/) — crop climate tolerance ranges
- NASA Space Apps Challenge: [spaceappschallenge.org](https://www.spaceappschallenge.org/)

---

## AI Tool Disclosure

This project was built with assistance from [Kiro](https://kiro.dev), Amazon's AI-powered coding tool, as permitted and required to be disclosed under NASA Space Apps Challenge rules.

---

## Licence

MIT — see `LICENSE` for details.
