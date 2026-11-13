# Project Overview

## Project Name: Team 103
Climate Twin — Field Shift: Adapting Farms with NASA Data

## Hackathon
NASA Space Apps Challenge Kuala Lumpur 2026
November 14–15, 2026 · 48-hour virtual hackathon
Challenge: **Field Shift — Adapting Farms with NASA Data**

## Team
4 members. Roles:
- **Role 1 — Loke Yi Cheng**: Python data/climate engine (critical path)
- **Role 2 — Lee Chui Jia (Team Leader)**: Front-end (map, arc, charts)
- **Role 3 — Koh Zhe Xuan**: Agronomy content and validity (crop knowledge base, sanity checks)
- **Role 4 — Ong Yan Xing**: Story, submission, demo video, integration testing

## The Core Idea
A web app that answers one question a farmer actually asks:
> *What is happening to my land, and who already farms land like it?*

We do NOT predict the future. We find the place on Earth whose climate **today** matches what a farmer's field will have in **2045**, and show what is already grown there. This is the Climate Twin.

## User Flow (6 Steps)
1. Farmer picks their field on a map (default: a real padi field in Kedah, Malaysia)
2. Pull 40 years of daily NASA POWER climate data for that point
3. Compute a **climate signature** — 8 agronomic numbers — and fit a linear trend to 2045
4. Search a pre-computed global grid for the closest present-day match → the **Climate Twin**
5. Draw the arc: *your field → its twin. This is your field in 2045. People farm it today.*
6. Show the **backtest**: the field's 1995 twin vs today, proving the method describes something real

## What We Are NOT Doing
- No yield prediction
- No profit forecast
- No weather forecast
- No machine learning black boxes
- Every number traces back to arithmetic on NASA data, explainable in 10 seconds to a judge

## NASA Data Sources
- **NASA POWER API** — primary data source, no login required
  - `T2M` — daily mean temperature at 2 metres
  - `T2M_MAX` — daily max temperature
  - `PRECTOTCORR` — precipitation (corrected)
  - `ALLSKY_SFC_SW_DWN` — all-sky surface shortwave downward irradiance (solar)
  - Covers any lat/lon from 1980s onward, ~50 km gridded resolution
- API base: `https://power.larc.nasa.gov/api/temporal/daily/point`

## The 8-Value Climate Signature

| # | Value | NASA Variable | Farmer Relevance |
|---|-------|---------------|-----------------|
| 1 | Mean annual temperature (°C) | T2M | Sets which crops are possible |
| 2 | Growing degree days, base 10°C | T2M daily | Crop maturity speed |
| 3 | Total annual rainfall (mm) | PRECTOTCORR | Irrigation need |
| 4 | Wet-season concentration | PRECTOTCORR monthly share | Monsoon shape |
| 5 | Longest dry spell (days) | PRECTOTCORR consecutive | The number that kills a crop |
| 6 | Heat-stress days per year | T2M_MAX > 35°C count | Flowering failure |
| 7 | Mean solar radiation | ALLSKY_SFC_SW_DWN | Photosynthesis ceiling |
| 8 | Coldest-month mean temp (°C) | T2M monthly min | Tropical perennial limit |

## Matching Method
- Standardise all 8 values across the global grid (z-score)
- Find grid cell with smallest **weighted Euclidean distance** to the field's 2045 signature
- Weights stored in a config file (rainfall and temperature weighted higher than radiation)
- Trend fit: ordinary least-squares linear regression, extrapolated 20 years
- Backtest: same lookup on the 1990–2000 window to get the 1995 twin

## Demo Default Field
A real padi field in Kedah, Malaysia: `lat=6.12, lon=100.37`

## The Pitch Opening
> *Every team here will tell a farmer what to plant next year. We are telling them where their farm is going — and who already farms there.*
