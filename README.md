# 🌍 Climate Twin

**Find the place that farms your field's future.**

Climate Twin takes a farm field, projects its climate to 2045 from 40 years of NASA data, and finds a real place on Earth whose climate **today** already matches that future. People farm that place now, so instead of guessing what a changing climate will bring, a farmer can look at somewhere it has already arrived and see what grows there.

> Built for the **NASA Space Apps Challenge 2026**, Kuala Lumpur — challenge: *Field Shift: Adapting Farms with NASA Data* (Team 103).

---

## The idea in one line

Somewhere on Earth, a place already has the climate your field will have in 2045. Climate Twin finds it from NASA data and shows what is grown there.

A farmer in Kedah, Malaysia picks their padi field. Climate Twin draws an arc to its twin in Central Thailand: *this is your field in 2045, and people farm it today.* It also looks back: the field's 1995 twin versus today shows how far its climate has already shifted, which is the evidence that the method describes something real.

---

## What you can do in the app

- **Pick a field** — click the globe or flat map, type a latitude and longitude, or choose a Malaysian preset (padi, durian, oil palm and more).
- **See the reveal** — a 3D globe (or flat map) draws an arc from your field to its climate twin, with the headline *"Your field in 2045 is \<place\> today."*
- **Compare climates** — a table and radar chart put your field's eight 2045 climate values next to the twin's values today, each explained in plain farming terms.
- **See the drift** — a backtest comparing the field's 1995 twin with today.
- **Crops for this climate** — crop cards for the twin, drawn from a crop knowledge base with FAO ECOCROP sources.
- **Crop viability** — a chart of how the current crop's viability falls over time.
- **Story mode** — steps through the screens one at a time.
- **Download / print** — save a shareable image or a print-friendly report.

The limitations are shown on screen, not hidden. Climate Twin does **not** forecast weather, yield or profit.

---

## The climate signature (8 values)

Each field and each grid point is reduced to eight numbers, all computed from NASA POWER data. The twin is the place whose values are closest to the field's projected 2045 values.

| # | Value | From | Why a farmer cares |
|---|-------|------|--------------------|
| 1 | Mean annual temperature | `T2M` | Which crops are possible at all |
| 2 | Growing degree days (base 10 °C) | `T2M` | How fast a crop matures |
| 3 | Total annual rainfall | `PRECTOTCORR` | Whether irrigation is optional |
| 4 | Wet-season concentration | `PRECTOTCORR` | Monsoon shape |
| 5 | Longest dry spell | `PRECTOTCORR` | Often the number that kills a crop |
| 6 | Heat-stress days (> 35 °C) | `T2M_MAX` | Flowering failure in rice and maize |
| 7 | Mean solar radiation | `ALLSKY_SFC_SW_DWN` | The ceiling on photosynthesis |
| 8 | Coldest-month mean temperature | `T2M` | The limit for tropical perennials |

The 2045 values come from an ordinary least-squares linear trend over 40 years of data. That is a deliberately simple assumption, and the app says so.

---

## NASA data

- **[NASA POWER](https://power.larc.nasa.gov/)** — 40 years of daily temperature, rainfall and solar radiation for any point on Earth, no login needed. Parameters: `T2M`, `T2M_MAX`, `PRECTOTCORR`, `ALLSKY_SFC_SW_DWN` (Agroclimatology community).
- **[NASA Blue Marble](https://visibleearth.nasa.gov/)** imagery for the 3D globe.

Crop climate tolerances come from the **[FAO ECOCROP](https://ecocrop.review.fao.org/)** database.

---

## Project status

The **front end is built and runs today** against a fixed demo result (`frontend/contract.json`), so the whole experience works end to end right now.

The **Python climate engine is still in progress.** When it is running (see below), the app calls it live; until then, every field shows the Kedah demo result and a notice says so.

---

## Run it

The front end is plain HTML, CSS and JavaScript — no build step, no install. All libraries are bundled in `frontend/vendor/` (Leaflet, Chart.js, globe.gl), so it works offline.

```bash
cd frontend
python3 -m http.server 3000
```

Then open **http://localhost:3000/index.html**.

> Open it through the local server, not by double-clicking `index.html`. Opening the file directly stops the browser from loading `contract.json`, and you get an empty map.

**Optional — the Earth photo for the 3D globe.** Without it (or offline) the globe shows as plain blue with grid lines, which is harmless. To include it:

```bash
cd frontend
curl -L -o vendor/globe/earth-blue-marble.jpg https://unpkg.com/three-globe@2/example/img/earth-blue-marble.jpg
curl -L -o vendor/globe/earth-topology.png   https://unpkg.com/three-globe@2/example/img/earth-topology.png
```

**The climate engine (when available).** The app expects an API at `http://localhost:8000/twin?lat=<lat>&lon=<lon>` that returns the shape in `frontend/contract.json`. Start it before opening the page and the app uses it automatically; if it is unreachable, the app falls back to the demo data.

---

## Project structure

```
.
├── frontend/
│   ├── index.html         # page structure
│   ├── app.js             # map/globe, reveal, charts, field picker, export
│   ├── style.css          # space theme, animated scenes, print styles
│   ├── contract.json      # demo result + the agreed API response shape
│   ├── ui_copy.json        # all on-screen text (edit here, no code change)
│   ├── test.html          # Leaflet smoke test
│   └── vendor/            # Leaflet, Chart.js, globe.gl (bundled, offline)
├── data/
│   └── crops.json         # crop knowledge base (18 crops, ECOCROP sources)
└── .kiro/                 # steering notes and hooks (project context)
```

---

## Limitations

Shown in the app, and repeated here:

- NASA POWER is gridded climate data at roughly 50 km, not a measurement of one specific field.
- We do not forecast weather, yield or profit.
- A linear trend is a simplifying assumption, not a climate projection.
- Confirm any planting decision with a local agricultural adviser.

---

## Team 103

| Role | Focus |
|------|-------|
| Loke Yi Cheng | Data and climate engine (Python, NASA POWER) |
| Lee Chui Jia (lead) | Front end: globe, map, reveal, charts |
| Koh Zhe Xuan | Agronomy, crop knowledge base, validity |
| Ong Yan Xing | Submission, documentation, integration |

---

## Built with Kiro

This project was built with the help of [Kiro](https://kiro.dev), Amazon's AI coding tool, as disclosed under the NASA Space Apps Challenge rules.

## Licence

MIT — see [`LICENSE`](LICENSE).
