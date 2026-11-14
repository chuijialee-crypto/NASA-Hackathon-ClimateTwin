"""Thin API: one endpoint, GET /twin?lat=..&lon=..

Run from the project root:  uvicorn api.main:app --port 8000
The front-end calls http://localhost:8000/twin from another origin, so CORS is open.
"""

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from engine.twin import UnknownCropError, climate_twin

COORD_DECIMALS = 4  # the front-end sends 4 decimals; keeps cache file names tidy

app = FastAPI(title="Climate Twin API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])


@app.get("/twin")
def get_twin(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    crop: str | None = Query(None, description="Crop to score for viability (default: Paddy rice)"),
) -> dict:
    lat, lon = round(lat, COORD_DECIMALS), round(lon, COORD_DECIMALS)
    try:
        return climate_twin(lat, lon, crop)
    except UnknownCropError as err:
        raise HTTPException(status_code=422, detail=str(err)) from err
    except httpx.HTTPError as err:
        print(f"POWER request failed for ({lat}, {lon}): {err!r}")
        raise HTTPException(status_code=502, detail="NASA POWER request failed") from err
    except ValueError as err:  # bad or incomplete POWER data
        print(f"Bad data for ({lat}, {lon}): {err}")
        raise HTTPException(status_code=502, detail=f"NASA POWER data problem: {err}") from err
