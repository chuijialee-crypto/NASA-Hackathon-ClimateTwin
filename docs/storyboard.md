# Climate Twin — Storyboard

A screen-by-screen plan for how a user moves through Climate Twin.

**This is a design proposal, not a description of what is built.** The current app is a single-page web app with no login and no user accounts. Each screen below is marked **Exists**, **Partly exists** or **New**. The "New" screens (login, onboarding, saved fields) would need work beyond the front end — in particular, saving fields needs a backend — so treat this as a plan for the team to agree on, not a to-do list.

The flow and layout take inspiration from a reference app (a theme-park planner): a clear entry point, a consistent header, bottom-tab navigation, and one screen per stage. The content is Climate Twin's own.

---

## Shared layout

- **Header:** 🌍 Climate Twin logo, aurora background, and the current field's name.
- **Bottom navigation (5 tabs):** 🌍 Globe · 🗺️ Map · 📊 Compare · 🌾 Crops · ⋯ More.
- **Tone:** plain language, limitations always visible, no overclaiming.

---

## Screens

### (a) Login / Welcome — *New*
Logo and the tagline "Find the place that farms your field's future". Options: **Continue with Google**, **Continue with email**, and a **"Skip — explore the demo"** link.
**Purpose:** let returning farmers save their fields; let judges skip straight in.

### (b) Onboarding — *New*
Three swipe cards: **1. Pick your field. 2. See its 2045 climate twin. 3. See what grows there.** A "Get started" button.
**Purpose:** explain the idea with no presenter.

### (c) Home / Pick a field — *Partly exists (the picker is built)*
A short greeting, a map, the Malaysian preset list, a "Type coordinates" box, and recent fields.
**Purpose:** the entry point into a lookup.

### (d) Loading — *Exists*
The globe with a spinner: "Reading 40 years of NASA climate data…".
**Purpose:** an honest wait state.

### (e) The Reveal — *Exists*
3D globe (or flat map), an arc from the field to its twin, and the headline "Your field in 2045 is \<place\> today" with the match percentage.
**Purpose:** the core moment.

### (f) Compare climates — *Exists*
A table and radar chart of the 8 climate values: the field in 2045 vs the twin today, each value explained in farming terms.
**Purpose:** the honesty panel — show the numbers, hide nothing.

### (g) Crops for this climate — *Exists*
Crop cards for the twin, from `data/crops.json`, each with a note and an FAO ECOCROP source.
**Purpose:** what is grown there.

### (h) The Drift — *Exists (needs `twin_now` from the engine)*
A map of the field's 1995 twin vs its twin today, for example "moved 610 km since 1995".
**Purpose:** the backtest — evidence the method describes real change, not a forecast.

### (i) Crop viability — *Exists*
A line chart of the current crop's viability falling over time to 2055.
**Purpose:** how long today's crop holds.

### (j) Story mode — *Exists*
A guided walkthrough of the screens with Back / Next.
**Purpose:** a step-by-step tour for a stranger or a video.

### (k) Saved fields ("My Fields") — *New (needs login)*
A list of saved fields with their twins.
**Purpose:** compare several farms over time.

### (l) Share / Export — *Partly exists (download and print are built)*
A preview of the shareable image, with "Save image", "Print report" and "Share".
**Purpose:** take the result away.

### (m) More / Settings — *Partly exists (footer and caveats are built)*
Caveats, data sources, language (Bahasa Malaysia / English), and "About Climate Twin".
**Purpose:** help, credits and preferences.

---

## Flow

```
(a) Login ──► (b) Onboarding ──► (c) Home
                                   │ pick a field
                                   ▼
                              (d) Loading ──► (e) Reveal
                                                 │ bottom nav / Story mode
          ┌──────────────┬──────────────┬───────┴───────┬──────────────┐
          ▼              ▼              ▼               ▼              ▼
   (f) Compare     (g) Crops      (h) Drift     (i) Viability   (l) Share
                                   │
                              (k) My Fields  ◄── saved from any reveal

(m) More / Settings — reachable from the ⋯ tab on every screen.
```

---

## Build status at a glance

| State | Screens |
|-------|---------|
| **Exists** | (d) Loading, (e) Reveal, (f) Compare, (g) Crops, (h) Drift, (i) Viability, (j) Story mode |
| **Partly exists** | (c) Home (picker), (l) Share (download/print), (m) More (footer, caveats) |
| **New** | (a) Login, (b) Onboarding, (k) Saved fields |

## Suggested order if the team builds the new screens

1. **(b) Onboarding** and the **(m) More** page — small, no backend, and they make the app self-explanatory for judges.
2. **(a) Welcome screen** without real login (a "Start / Skip to demo" landing) — the polished entry point without inventing accounts.
3. **(a) Full login + (k) Saved fields** — only if the team decides accounts are worth a backend. Largest effort; weigh it against the submission deadline.
