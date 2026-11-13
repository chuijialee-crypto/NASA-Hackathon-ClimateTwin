# Roles and Timeline

## Role Ownership

### Role 1 — Data & Climate Engine (Python)
The critical path. Nothing else works until the twin lookup returns a number.

**Deliverables:**
- NASA POWER API client with on-disk caching
- `signature(daily_df) -> dict` — 8 values, pure function
- Global grid build script → `global_grid.json` (5° resolution, ~500 land points)
- Trend fit + 2045 extrapolation (OLS linear regression per signature value)
- Nearest-neighbour twin lookup with configurable weights (`weights.json`)
- Backtest: same lookup on the 1990–2000 window → 1995 twin
- Current-crop viability curve: score field's own crop every 5 years to 2055
- FastAPI wrapper, single endpoint, CORS enabled
- Freeze `demo_field.json` by Saturday night

**Done when:** `GET /twin?lat=6.12&lon=100.37` returns the full contract shape in under 3 seconds, and the twin makes agronomic sense to Role 3.

**First task (minute one):** start the global grid download. 20–30 min, runs in background while everyone sets up. Never fetch the same point twice — cache to disk immediately.

---

### Role 2 — Front-End & The Reveal (HTML/JS)
Builds against `contract.json` from hour one. Never blocked by Role 1.

**Deliverables (in priority order — stop wherever the clock stops):**
1. **The Reveal** — world map, animated arc from field to twin, one sentence. Cannot be cut.
2. **The Honesty Panel** — 8 signature values side by side (field-2045 vs twin-today).
3. **The Drift** — 1995 twin and 2025 twin on same map with distance.
4. **The Transition** — viability curve over time.

Plus:
- Fallback: if API call fails, silently load `demo_field.json`
- Large type, high contrast, projector-tested before hour 30
- Caveats always visible

**Hard time-box:** 2 hours on a 3D globe. If the arc is not animating — drop to flat 2D map with SVG arc. Move on.

**Done when:** a stranger can click one point and understand the twin idea without explanation.

---

### Role 3 — Agronomy, Content & Validity
No coding required. This role owns the **Validity** judging criterion.

**Deliverables:**
- Crop knowledge base JSON: 15–20 crops, each with climate tolerances and a source URL
  - Start: padi rice, maize, cassava, groundnut, sweet potato, soybean, mung bean, sorghum, millet, chilli, pineapple, banana, oil palm, rubber, durian, jackfruit, pigeon pea, taro
  - Reference: FAO ECOCROP for tolerance ranges
- Pick the demo field: a real place, named, with coordinates and a real farming story
- Sanity-check the engine against 3 fields whose twin you can predict from knowledge
- Write the caveats panel text
- Write all UI copy: headline sentence, button labels, tooltips
- Compile sources list for README and project page

**Your veto power:** if the engine says a Kedah padi field's twin is in the Sahara, the weighting is broken. Test early, say so loudly, block the demo until it makes sense.

**Caveats to put on screen:**
> NASA POWER is gridded climate data at roughly 50 km, not a measurement of this specific field. We do not forecast weather, yield, or profit. A linear trend is a simplifying assumption, not a climate projection. Confirm any planting decision with a local agricultural adviser.

---

### Role 4 — Story, Submission & Integration
The most underrated role. Presentation is a full judging criterion.

**Deliverables:**
- Space Apps project page (problem, approach, NASA data used, what works, what doesn't)
- Demo video (check required length on submission page, build to it exactly)
- Demo script: 60s on problem, 90s on the reveal, 30s on limitations
- Three full timed rehearsals with the real app
- README with setup instructions that work on a clean machine
- Open-source licence
- Screenshots for the project page
- Submit **early** — treat the real deadline as 2 hours before the stated one
- Disclose AI tool use (Kiro) as the rules require

**You are also the team's first user.** Every few hours, open the app as a stranger. Try to break it. Report what confused you.

**The pitch structure:**
1. Open with the reframe: *Every team here will tell a farmer what to plant next year. We are telling them where their farm is going — and who already farms there.*
2. Name the farmer, name the field, show the arc. Specificity makes Impact real.
3. Close on the limitations. Judges will ask. Getting there first shows you understand your own system.

---

## Timeline

Hours from when the hackathon clock starts.

| Hours | Focus | Hard Gate |
|-------|-------|-----------|
| 0–2 | Agree scope, write `contract.json`, write Kiro spec, start grid download, test CORS | Contract committed; grid downloading |
| 2–8 | Build in parallel. Engine makes one real twin. Front-end renders fake data. | **Checkpoint 1:** real engine output in real UI, however ugly |
| 8–16 | Backtest, drift view, viability curve, crop knowledge base, first sanity checks | Twin passes Role 3's agronomic check |
| 16–22 | Sleep in shifts. Two people down at a time, never all four. | Nobody has been awake 24 hours straight |
| 22–30 | Polish, caveats panel, projector test, freeze `demo_field.json`, wire fallback | **Checkpoint 2:** app survives being unplugged from the internet |
| **30** | **Feature freeze. No new features after this point. No exceptions.** | Code is done |
| 30–40 | Video, project page, README, three timed rehearsals | Submission drafted in full |
| 40–44 | Submit. Then rest or polish the pitch. | Submitted with hours to spare |

**Checkpoint 1 at hour 8 is non-negotiable.** If the halves have not met by then, cut scope immediately.

**Feature freeze at hour 30** is what separates teams who demo well from teams still debugging when the judges walk up.

---

## Drop Order When Time Runs Short

Cut from the bottom up:

1. The transition plan (cut first)
2. The drift view
3. The viability curve
4. The honesty panel
5. **The reveal — cannot be cut.** Field, arc, twin, what grows there. If only one screen exists and it does this clearly with honest caveats, it beats a project that half-does six things.

---

## Risks and Kill-Switches

Decide these now. At 3am you will not make good scope calls.

| Risk | Early Warning | Response |
|------|--------------|---------|
| 3D globe eats the day | Arc not animating after 2 hours | Flat 2D map + SVG arc. Decided, not debated. |
| POWER API slow or rate-limiting | Grid build crawling | Drop to 10° grid (~130 points). Match quality barely suffers. |
| Browser cannot call POWER (CORS) | CORS error in hour one | Everything routes through FastAPI. Test this first. |
| Twin result is nonsense | Role 3 sanity check fails | Re-weight. If still broken by hour 16, match on 4 values instead of 8. |
| Live demo fails on stage | Any API flakiness Saturday | Fallback to `demo_field.json`. Wire this in by hour 22. |
| Scope creep | Someone says "we could also add…" | Point at this table. The answer is no after hour 30. |
| Team disagreement at hour 30 | Argument about a feature | Role 4 makes the call. 5 minutes, not 2 hours. |
