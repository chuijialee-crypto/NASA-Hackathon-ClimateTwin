# Role 2 — Front-End Guide (Lee Chui Jia, Team Leader)

**Your Mission:** Build the visual reveal that makes Climate Twin immediately understandable. A stranger clicks one point and sees where their field is going.

---

## 🌙 Tonight — Pre-Hackathon Setup (30 minutes)

### Step 1: Download Libraries Offline (10 min)

#### Leaflet.js (2D map)
1. Go to: https://leafletjs.com/download.html
2. Download the **latest stable release** (currently 1.9.4)
3. Extract the zip — you'll get:
   - `leaflet.css`
   - `leaflet.js`
   - `images/` folder (marker icons)

#### Chart.js (line charts)
1. Go to: https://github.com/chartjs/Chart.js/releases
2. Download `chart.umd.js` from the latest release (v4.4.1 or newer)
   - Or direct link: https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.js
   - Right-click → Save As → `chart.umd.js`

#### globe.gl (optional 3D globe — only if you have time)
1. Direct download: https://cdn.jsdelivr.net/npm/globe.gl/dist/globe.gl.min.js
2. Right-click → Save As → `globe.gl.min.js`
3. Also needs Three.js: https://cdn.jsdelivr.net/npm/three/build/three.min.js

#### File Structure
Create this structure tonight:

```
frontend/
├── index.html
├── app.js
├── style.css
├── vendor/
│   ├── leaflet/
│   │   ├── leaflet.css
│   │   ├── leaflet.js
│   │   └── images/         # marker icons
│   ├── chartjs/
│   │   └── chart.umd.js
│   └── globe/              # optional
│       ├── globe.gl.min.js
│       └── three.min.js
└── demo_field.json         # created by Role 1, copied here by hour 22
```

**Action now:**
```bash
cd ~/Desktop/climate-twin
mkdir -p frontend/vendor/leaflet frontend/vendor/chartjs frontend/vendor/globe
```

Then download and move the files into those folders.

---

### Step 2: Create the Contract Stub (5 min)

Copy `contract.json` from `.kiro/steering/architecture.md` to `frontend/contract.json` — this is your fake data for development.

**Why:** You build against this fake data all Saturday. When Role 1's real API is ready, you just swap the URL.

---

### Step 3: Test Leaflet Works (10 min)

Create `frontend/test.html`:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Leaflet Test</title>
  <link rel="stylesheet" href="vendor/leaflet/leaflet.css" />
  <style>
    #map { height: 400px; width: 600px; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="vendor/leaflet/leaflet.js"></script>
  <script>
    const map = L.map('map').setView([6.12, 100.37], 6);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(map);
    L.marker([6.12, 100.37]).addTo(map).bindPopup('Kedah padi field').openPopup();
  </script>
</body>
</html>
```

Open `test.html` in your browser. You should see a map with a marker at the Kedah field.

✅ **If the map appears:** libraries work offline  
❌ **If you see blank tiles:** you're still hitting a CDN — check the file paths

---

### Step 4: Read the Contract (5 min)

Open `frontend/contract.json` and understand the structure:
- `field` — the farmer's field location
- `signature_now` and `signature_2045` — the 8 climate values
- `twin` — the matched location (your 2045 climate twin)
- `twin_1995` — the backtest location
- `crops_there` — what grows at the twin
- `caveats` — always show these on screen

**Your job:** render this data in a way a stranger understands without explanation.

---

## ⏰ Hour 0–2 — Kickoff (Hackathon Starts)

### Checkpoint: Agree contract.json with the team
Open `contract.json` with everyone. Confirm:
- Field names (snake_case)
- What `match_score` means (higher = better, 0–1)
- What `caveats` should look like on screen

**Commit it.** This is now the interface between you and Role 1.

### Start the HTML skeleton

Create `frontend/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Climate Twin</title>
  <link rel="stylesheet" href="vendor/leaflet/leaflet.css" />
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <header>
    <h1>🌍 Climate Twin</h1>
    <p class="tagline">Where is your farm going?</p>
  </header>

  <main>
    <!-- Screen 1: The Reveal -->
    <section id="reveal" class="screen">
      <div id="map"></div>
      <div id="result-text" class="overlay">
        <!-- e.g., "Your field in 2045 is Central Thailand today." -->
      </div>
    </section>

    <!-- Screen 2: The Honesty Panel (optional) -->
    <section id="honesty-panel" class="screen" style="display: none;">
      <h2>Climate Signatures</h2>
      <table id="signature-table">
        <!-- 8 rows: field-2045 vs twin-today -->
      </table>
    </section>

    <!-- Screen 3: The Drift (optional) -->
    <section id="drift" class="screen" style="display: none;">
      <h2>Your Field Has Already Moved</h2>
      <div id="drift-map"></div>
      <p id="drift-text"></p>
    </section>

    <!-- Screen 4: Viability Curve (optional) -->
    <section id="viability" class="screen" style="display: none;">
      <h2>Current Crop Viability</h2>
      <canvas id="viability-chart"></canvas>
    </section>

    <!-- Caveats — always visible -->
    <aside id="caveats">
      <h3>Important Notes</h3>
      <ul id="caveat-list">
        <!-- populated from contract.caveats -->
      </ul>
    </aside>
  </main>

  <script src="vendor/leaflet/leaflet.js"></script>
  <script src="vendor/chartjs/chart.umd.js"></script>
  <script src="app.js"></script>
</body>
</html>
```

---

## ⏰ Hour 2–8 — Build Screen 1 (The Reveal)

**This is the only screen that cannot be cut.** Everything else is optional.

### Goal: Map + Arc + One Sentence

#### Step 1: Load the data

In `app.js`:

```javascript
async function getTwin(lat, lon) {
  try {
    const res = await fetch(`http://localhost:8000/twin?lat=${lat}&lon=${lon}`);
    if (!res.ok) throw new Error(res.status);
    return await res.json();
  } catch (err) {
    console.warn('API failed, using contract.json fallback', err);
    return await fetch('./contract.json').then(r => r.json());
  }
}

async function init() {
  const data = await getTwin(6.12, 100.37); // demo field
  renderReveal(data);
  renderCaveats(data.caveats);
}

init();
```

**Until Role 1's API is live, this loads `contract.json` automatically.**

---

#### Step 2: Render the map

```javascript
function renderReveal(data) {
  const { field, twin } = data;

  // Create map centered between the field and twin
  const centerLat = (field.lat + twin.lat) / 2;
  const centerLon = (field.lon + twin.lon) / 2;
  const map = L.map('map').setView([centerLat, centerLon], 5);

  // Add base layer
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
  }).addTo(map);

  // Add markers
  const fieldMarker = L.marker([field.lat, field.lon])
    .addTo(map)
    .bindPopup(`<b>${field.name}</b><br>Your field`);

  const twinMarker = L.marker([twin.lat, twin.lon])
    .addTo(map)
    .bindPopup(`<b>${twin.place}</b><br>Your 2045 climate twin`);

  // Draw arc (simple polyline — fancy animation comes later)
  const arc = L.polyline([[field.lat, field.lon], [twin.lat, twin.lon]], {
    color: '#ff6b6b',
    weight: 3,
    dashArray: '10, 10'
  }).addTo(map);

  // Fit map to show both markers
  map.fitBounds([
    [field.lat, field.lon],
    [twin.lat, twin.lon]
  ]);

  // The one sentence
  const resultText = document.getElementById('result-text');
  resultText.innerHTML = `
    <p class="reveal-headline">Your field in 2045 is <strong>${twin.place}</strong> today.</p>
    <p class="reveal-detail">Climate match: ${(twin.match_score * 100).toFixed(0)}%</p>
  `;
}
```

---

#### Step 3: Render caveats

```javascript
function renderCaveats(caveats) {
  const list = document.getElementById('caveat-list');
  caveats.forEach(c => {
    const li = document.createElement('li');
    li.textContent = c;
    list.appendChild(li);
  });
}
```

---

#### Step 4: Style it

In `style.css`:

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  background: #1a1a2e;
  color: #eee;
}

header {
  text-align: center;
  padding: 2rem;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

header h1 {
  font-size: 3rem;
  margin-bottom: 0.5rem;
}

.tagline {
  font-size: 1.2rem;
  opacity: 0.9;
}

main {
  max-width: 1200px;
  margin: 2rem auto;
  padding: 0 1rem;
}

#map {
  height: 600px;
  width: 100%;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.3);
}

#result-text {
  position: absolute;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0,0,0,0.85);
  padding: 1.5rem 2rem;
  border-radius: 8px;
  text-align: center;
  z-index: 1000;
  max-width: 90%;
}

.reveal-headline {
  font-size: 1.8rem;
  line-height: 1.4;
  margin-bottom: 0.5rem;
}

.reveal-detail {
  font-size: 1.1rem;
  opacity: 0.8;
}

#caveats {
  margin-top: 3rem;
  padding: 1.5rem;
  background: rgba(255, 255, 255, 0.05);
  border-left: 4px solid #ff6b6b;
  border-radius: 4px;
}

#caveats h3 {
  margin-bottom: 1rem;
  color: #ff6b6b;
}

#caveat-list {
  list-style: disc;
  margin-left: 1.5rem;
}

#caveat-list li {
  margin-bottom: 0.5rem;
  line-height: 1.5;
}
```

---

### ✅ Checkpoint 1 (Hour 8)

**Definition of done:**
- Map renders with field and twin markers
- Arc connects them (even if it's just a dashed line — animation comes later)
- The one sentence appears: *"Your field in 2045 is Central Thailand today."*
- Caveats are visible at the bottom
- The app loads `contract.json` when the API isn't ready

**Test:** Open `index.html` in a browser. A stranger should understand the idea.

**If this works, you're ahead of schedule.** Most teams won't hit Checkpoint 1 until hour 10–12.

---

## ⏰ Hour 8–16 — Optional Screens (Priority Order)

### Screen 2: The Honesty Panel (if time allows)

```javascript
function renderHonestyPanel(data) {
  const { signature_2045, twin } = data;
  const table = document.getElementById('signature-table');

  const labels = {
    mean_temp: 'Mean Temp (°C)',
    gdd: 'Growing Degree Days',
    rain_mm: 'Annual Rainfall (mm)',
    wet_share: 'Wet Season Share',
    dry_spell_days: 'Longest Dry Spell (days)',
    heat_days: 'Heat Stress Days',
    solar: 'Solar Radiation (MJ/m²/day)',
    cold_month: 'Coldest Month (°C)'
  };

  table.innerHTML = `
    <thead>
      <tr>
        <th>Signature</th>
        <th>Your Field (2045)</th>
        <th>Twin (Today)</th>
        <th>Difference</th>
      </tr>
    </thead>
    <tbody>
    </tbody>
  `;

  const tbody = table.querySelector('tbody');
  for (const [key, label] of Object.entries(labels)) {
    const fieldVal = signature_2045[key];
    const twinVal = twin.signature[key];
    const diff = Math.abs(fieldVal - twinVal);

    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${label}</td>
      <td>${fieldVal.toFixed(1)}</td>
      <td>${twinVal.toFixed(1)}</td>
      <td>${diff.toFixed(1)}</td>
    `;
    tbody.appendChild(row);
  }

  document.getElementById('honesty-panel').style.display = 'block';
}
```

Call `renderHonestyPanel(data)` after `renderReveal(data)` in `init()`.

---

### Screen 3: The Drift (if time allows)

```javascript
function renderDrift(data) {
  const { field, twin, twin_1995 } = data;

  const driftMap = L.map('drift-map').setView([field.lat, field.lon], 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(driftMap);

  L.marker([field.lat, field.lon])
    .addTo(driftMap)
    .bindPopup('<b>Your field</b>');

  L.marker([twin_1995.lat, twin_1995.lon])
    .addTo(driftMap)
    .bindPopup(`<b>1995 twin</b><br>${twin_1995.place}`);

  L.marker([twin.lat, twin.lon])
    .addTo(driftMap)
    .bindPopup(`<b>2025 twin</b><br>${twin.place}`);

  L.polyline([
    [twin_1995.lat, twin_1995.lon],
    [twin.lat, twin.lon]
  ], { color: '#ffa502', weight: 3 }).addTo(driftMap);

  document.getElementById('drift-text').textContent =
    `Your field has already moved ${twin_1995.drift_km} km in climate terms from 1995 to today.`;

  document.getElementById('drift').style.display = 'block';
}
```

---

### Screen 4: Viability Curve (if time allows)

```javascript
function renderViability(data) {
  const ctx = document.getElementById('viability-chart').getContext('2d');
  const viability = data.current_crop_viability;

  new Chart(ctx, {
    type: 'line',
    data: {
      labels: viability.map(v => v.year),
      datasets: [{
        label: 'Current Crop Viability',
        data: viability.map(v => v.score),
        borderColor: '#ff6b6b',
        backgroundColor: 'rgba(255, 107, 107, 0.1)',
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      scales: {
        y: {
          beginAtZero: true,
          max: 1,
          title: { display: true, text: 'Viability Score' }
        },
        x: {
          title: { display: true, text: 'Year' }
        }
      }
    }
  });

  document.getElementById('viability').style.display = 'block';
}
```

---

## ⏰ Hour 16–22 — Polish + Projector Test

### Arc Animation (if you have 1–2 hours)

Replace the static polyline with an animated arc using Leaflet's built-in animation:

```javascript
// Animated arc using Leaflet.Polyline.SnakeAnim plugin
// Or use canvas/SVG for a custom arc — limit this to 2 hours max
```

**If the animation isn't working after 2 hours:** revert to the dashed polyline. The idea is clear without animation.

---

### Freeze demo_field.json (Hour 22)

Ask Role 1 (Loke Yi Cheng) for a real API response:
```bash
curl "http://localhost:8000/twin?lat=6.12&lon=100.37" > frontend/demo_field.json
```

Test the fallback:
1. Stop the API server
2. Refresh `index.html`
3. Confirm the app still works (using `demo_field.json`)

---

### Projector Test (Hour 22–24)

**Critical:** test on a projector or large external monitor before hour 30.

Things to check:
- ✅ Text is readable from 3 meters away
- ✅ Colors have sufficient contrast
- ✅ Map tiles load (not blank)
- ✅ Caveats are visible without scrolling

If text is too small, increase font sizes by 20–30%.

---

## ⏰ Hour 30 — Feature Freeze

**No new code after hour 30.** Only bug fixes and copy edits.

From here: video, rehearsals, screenshots.

---

## 🎯 Drop Order (If Time Runs Short)

If you're behind schedule, drop from the bottom up:

1. **Viability curve** — cut first
2. **Drift view** — cut second
3. **Honesty panel** — cut third
4. **Arc animation** — use dashed line
5. **The Reveal** — **cannot be cut**

A project that does only Screen 1 beautifully beats a project that half-does all four.

---

## ⏳ 3D Globe — The 2-Hour Rule

If you want a 3D spinning globe with an animated arc:

1. Start at hour 10 (after Checkpoint 1 is done)
2. Set a timer for 2 hours
3. If the arc is not animating by hour 12 → **stop immediately** and revert to the 2D map
4. No debate, no "just one more try" — the timeline says stop

globe.gl looks spectacular, but it can eat 8 hours. The 2-hour rule protects your demo.

---

## 🛠 Debugging Tips

### Map tiles not loading
- Check: `vendor/leaflet/leaflet.css` path is correct
- Check: OpenStreetMap tile server is reachable (try in browser: `https://a.tile.openstreetmap.org/6/32/22.png`)
- Fallback: use a different tile provider (CartoDB, Stamen)

### `contract.json` not loading (CORS error)
Run a local server:
```bash
cd frontend
python3 -m http.server 3000
```
Open `http://localhost:3000/index.html`

### API returns 500
Role 1's engine broke. Fall back to `contract.json` and keep working. Your fallback is already wired in.

### Chart.js not rendering
Check: `<canvas>` has an `id` and is visible (`display: block`)

---

## ✅ Your Success Criteria

By hour 30, you should have:
- ✅ A map with field and twin markers
- ✅ An arc connecting them (animated or dashed)
- ✅ One sentence: "Your field in 2045 is [place] today"
- ✅ Caveats always visible
- ✅ Offline fallback working (`demo_field.json`)
- ✅ Projector-tested (readable from 3 meters)

**If you have these six, you've succeeded.** Everything else is bonus.

---

## 🚀 Final Checklist (Hour 30–44)

- [ ] All vendor libraries committed to repo
- [ ] `demo_field.json` frozen and fallback tested
- [ ] Large type, high contrast (projector-tested)
- [ ] Caveats on screen, always visible
- [ ] Screenshot the reveal (for project page)
- [ ] Test in Chrome, Firefox, Safari (pick 2)

**Good luck, Lee Chui Jia.** The reveal is the heart of the project. Make it clear, make it beautiful, and the judges will remember it.
