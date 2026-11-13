# Coding Standards

This project is a 48-hour hackathon. Standards are calibrated for speed + judge-readiness, not production hardening. Readable and explainable beats clever.

## General Rules
- Write code a tired teammate can understand at 3am.
- Keep functions small and single-purpose.
- If a number appears more than once, give it a name.
- Every number on screen must trace back to arithmetic on NASA data — no magic constants.
- Never silently swallow exceptions; at minimum `print` the error so a teammate can debug.

## Python (Role 1 — engine)

- Python 3.11+
- Use type hints on all function signatures.
- Use f-strings for string formatting.
- Pure functions where possible — `signature(daily_df) -> dict` takes data in, returns dict out, no side effects. Easier to unit-test.
- Cache all NASA POWER responses to disk. Use a simple filename based on `lat_lon_startdate_enddate.json`. Never fetch the same point twice during the hackathon.
- Fail loudly if a required API response field is missing — do not return silent zeroes.
- Use `pathlib` for all file paths.

### Naming
- Functions: `snake_case`
- Constants: `UPPER_SNAKE_CASE` (e.g. `BASE_TEMP = 10`)
- Files: `snake_case.py`

### Key files
| File | Purpose |
|------|---------|
| `engine/power_client.py` | NASA POWER fetching + disk cache |
| `engine/signature.py` | Compute the 8 signature values — pure functions |
| `engine/grid.py` | Build and query `global_grid.json` |
| `engine/twin.py` | Trend fit, 2045 extrapolation, nearest-neighbour lookup |
| `engine/crops.py` | Load and query the crop knowledge base |
| `api/main.py` | FastAPI app, single endpoint, CORS enabled |

### Dependencies (pin versions)
```
fastapi==0.115.5
uvicorn==0.32.1
pandas==2.2.3
numpy==2.1.3
scipy==1.14.1
httpx==0.27.2
global-land-mask==1.0.0
```

## JavaScript / HTML (Role 2 — front-end)

- Vanilla JS or lightweight libraries only. No React, no build step — the simpler the better for a 48-hour project.
- Acceptable libraries: Leaflet.js (2D map), Chart.js (line charts), globe.gl (3D globe — 2-hour time-box only).
- Load `demo_field.json` as the default state. The app must be fully functional offline.
- API call pattern:
  ```js
  async function getTwin(lat, lon) {
    try {
      const res = await fetch(`/twin?lat=${lat}&lon=${lon}`);
      if (!res.ok) throw new Error(res.status);
      return await res.json();
    } catch (err) {
      // silent to the audience, visible to us in the console
      console.warn('API failed, using demo_field.json', err);
      return await fetch('./demo_field.json').then(r => r.json());
    }
  }
  ```
- Large type, high contrast. Test on a projector before hour 30.
- Caveats must always be visible — not behind a click, not in small print.

## JSON data files

- `contract.json` — agreed shape, fake values, committed in hour one
- `global_grid.json` — pre-computed grid of present-day signatures
- `demo_field.json` — frozen real output for the Kedah demo field (fallback)
- `weights.json` — signature weighting config
- `crops.json` — crop knowledge base (15–20 entries, each with source URL)

All JSON keys use `snake_case`.

## Git
- Commit messages: imperative, under 72 chars (`Add POWER disk cache`, `Wire fallback to demo_field.json`)
- Never commit: `.env`, API keys, any file with credentials
- Branch: work directly on `main` for the hackathon — branching overhead is not worth it at 48 hours
- Commit frequently. If a machine dies, you want to lose at most an hour of work.

## What NOT to do
- No machine learning models. We cannot explain them in the Q&A round.
- No yield prediction or profit forecasting.
- No 3D globe if the arc is not animating after 2 hours — drop to flat map.
- No new features after hour 30. Point at the timeline. The answer is no.
