# Architecture

## System Shape

Four parts, each owned by one team member. They communicate through a shared JSON contract agreed in hour one.

```
Front-end (HTML/JS)
      │
      │  GET /twin?lat=..&lon=..
      ▼
Thin API (FastAPI, ~100 lines)
      │
      ▼
Python Engine
  ├── NASA POWER client (with disk cache)
  ├── Signature computation
  ├── Global grid (global_grid.json)
  ├── Twin lookup (weighted Euclidean distance)
  ├── Trend fit + 2045 extrapolation
  └── Backtest (1995 twin)
```

## The Contract

The single most important file in the project. Agreed in hour one, committed immediately. The front-end builds against the fake values; the engine builds to match the shape.

**File:** `contract.json`

```json
{
  "field": { "lat": 6.12, "lon": 100.37, "name": "Kedah padi field" },
  "signature_now": {
    "mean_temp": 27.1,
    "gdd": 6240,
    "rain_mm": 2410,
    "wet_share": 0.48,
    "dry_spell_days": 21,
    "heat_days": 12,
    "solar": 18.4,
    "cold_month": 25.9
  },
  "signature_2045": {
    "mean_temp": 28.4,
    "gdd": 6510,
    "rain_mm": 2290,
    "wet_share": 0.51,
    "dry_spell_days": 28,
    "heat_days": 22,
    "solar": 18.6,
    "cold_month": 26.8
  },
  "twin": {
    "lat": 14.6,
    "lon": 100.5,
    "place": "Central Thailand",
    "distance_km": 940,
    "match_score": 0.91,
    "signature": {
      "mean_temp": 28.3,
      "gdd": 6490,
      "rain_mm": 2250,
      "wet_share": 0.52,
      "dry_spell_days": 29,
      "heat_days": 20,
      "solar": 18.5,
      "cold_month": 26.5
    }
  },
  "twin_1995": {
    "lat": 5.4,
    "lon": 100.3,
    "place": "Penang mainland",
    "drift_km": 610
  },
  "crops_there": [
    {
      "name": "Jasmine rice",
      "note": "Heat-tolerant variety, single season",
      "source": "https://www.fao.org/ecocrop"
    }
  ],
  "current_crop_viability": [
    { "year": 2025, "score": 0.82 },
    { "year": 2030, "score": 0.74 },
    { "year": 2035, "score": 0.61 },
    { "year": 2040, "score": 0.49 },
    { "year": 2045, "score": 0.38 },
    { "year": 2050, "score": 0.27 },
    { "year": 2055, "score": 0.19 }
  ],
  "caveats": [
    "NASA POWER is ~50 km gridded data, not a measurement of this specific field.",
    "We do not forecast weather, yield, or profit.",
    "A linear trend is a simplifying assumption, not a climate projection.",
    "Confirm any planting decision with a local agricultural adviser."
  ]
}
```

**Also create:** `demo_field.json` — a frozen copy of a real API response. Used as a fallback if the live API fails during the demo. Wire the fallback into the front-end by hour 22.

## Front-End Screens (Priority Order)

Build in this order. Stop wherever the clock stops you. Only screen 1 is required.

1. **The Reveal** — world map, field marker, animated arc to twin, one sentence: *Your field in 2045 is Central Thailand today.* This cannot be cut.
2. **The Honesty Panel** — 8 signature values side by side: field-2045 vs twin-today. Plain table, clarity over decoration.
3. **The Drift** — 1995 twin and 2025 twin on the same map, with distance shown.
4. **The Transition** — viability curve falling over time, staged planting plan.

## Global Reference Grid

- Sample land points at **5° resolution**: 1,944 grid points, filtered with `global-land-mask` to roughly 500–600 land points before fetching
- Pull 2015–2024 daily POWER data for each (`start=20150101`, `end=20241231`)
- Compute the 8 signature values
- Save to `global_grid.json`
- Build this first — it takes 20–30 minutes with 5 concurrent requests
- Cache every POWER response to disk; never fetch the same point twice
- If the API is slow: drop to **10° grid** (~130–150 land points). Match quality barely suffers.

## Match Score

`twin.match_score` in the contract is **higher = better**, between 0 and 1. The engine computes a weighted Euclidean distance on z-scored values (lower = better) and converts it with `match_score = 1 / (1 + distance)`. See `nasa-data-reference.md` for the code.

## API

```
GET /twin?lat={lat}&lon={lon}
```

Returns the full contract shape. CORS enabled. Under 3 seconds for a known field.

**CORS check in hour one:** decide whether the browser calls POWER directly or everything routes through the FastAPI server. Test it immediately. Do not discover a CORS wall at 2am.

## Weights Config

Store signature weights in a config file (e.g. `weights.json`):

```json
{
  "mean_temp": 2.0,
  "gdd": 1.5,
  "rain_mm": 2.0,
  "wet_share": 1.5,
  "dry_spell_days": 1.5,
  "heat_days": 1.5,
  "solar": 1.0,
  "cold_month": 1.0
}
```

Role 3 owns tuning these. If the twin result is agronomically nonsense, the first fix is here.
