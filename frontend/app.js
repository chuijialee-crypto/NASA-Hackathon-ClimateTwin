// Climate Twin front-end.
// Loads the live API if it's running, otherwise falls back to contract.json.

const API_URL = 'http://localhost:8000/twin';
const DEMO_FIELD = { lat: 6.12, lon: 100.37 }; // Kedah padi field

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = '© OpenStreetMap';

async function getTwin(lat, lon) {
  try {
    const res = await fetch(`${API_URL}?lat=${lat}&lon=${lon}`);
    if (!res.ok) throw new Error(res.status);
    return await res.json();
  } catch (err) {
    console.warn('API failed, using contract.json fallback', err);
    return await fetch('./contract.json').then(r => r.json());
  }
}

// Screen 1: The Reveal (cannot be cut)
function renderReveal(data) {
  const { field, twin } = data;

  const centerLat = (field.lat + twin.lat) / 2;
  const centerLon = (field.lon + twin.lon) / 2;
  const map = L.map('map').setView([centerLat, centerLon], 5);

  L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION }).addTo(map);

  L.marker([field.lat, field.lon])
    .addTo(map)
    .bindPopup(`<b>${field.name}</b><br>Your field`);

  L.marker([twin.lat, twin.lon])
    .addTo(map)
    .bindPopup(`<b>${twin.place}</b><br>Your 2045 climate twin`);

  // Simple dashed arc. Animation comes later.
  L.polyline([[field.lat, field.lon], [twin.lat, twin.lon]], {
    color: '#ff6b6b',
    weight: 3,
    dashArray: '10, 10'
  }).addTo(map);

  map.fitBounds([
    [field.lat, field.lon],
    [twin.lat, twin.lon]
  ], { padding: [80, 80] });

  document.getElementById('result-text').innerHTML = `
    <p class="reveal-headline">Your field in 2045 is <strong>${twin.place}</strong> today.</p>
    <p class="reveal-detail">Climate match: ${(twin.match_score * 100).toFixed(0)}%</p>
  `;
}

// Screen 2: The Honesty Panel
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
    <tbody></tbody>
  `;

  const tbody = table.querySelector('tbody');
  for (const [key, label] of Object.entries(labels)) {
    const fieldVal = signature_2045[key];
    const twinVal = twin.signature[key];
    const diff = Math.abs(fieldVal - twinVal);
    // wet_share is a 0–1 fraction, so show two decimals for it.
    const digits = key === 'wet_share' ? 2 : 1;

    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${label}</td>
      <td>${fieldVal.toFixed(digits)}</td>
      <td>${twinVal.toFixed(digits)}</td>
      <td>${diff.toFixed(digits)}</td>
    `;
    tbody.appendChild(row);
  }

  document.getElementById('honesty-panel').style.display = 'block';
}

// Screen 3: The Drift
function renderDrift(data) {
  const { field, twin, twin_1995 } = data;

  // Show the section first so Leaflet can measure the container.
  document.getElementById('drift').style.display = 'block';

  const driftMap = L.map('drift-map').setView([field.lat, field.lon], 6);
  L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION }).addTo(driftMap);

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

  driftMap.fitBounds([
    [field.lat, field.lon],
    [twin_1995.lat, twin_1995.lon],
    [twin.lat, twin.lon]
  ], { padding: [40, 40] });

  document.getElementById('drift-text').textContent =
    `Your field has already moved ${twin_1995.drift_km} km in climate terms from 1995 to today.`;
}

// Screen 4: Viability Curve
function renderViability(data) {
  document.getElementById('viability').style.display = 'block';

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
}

function renderCaveats(caveats) {
  const list = document.getElementById('caveat-list');
  caveats.forEach(c => {
    const li = document.createElement('li');
    li.textContent = c;
    list.appendChild(li);
  });
}

// Optional screens must never break the reveal, so each one is isolated.
function tryRender(name, fn, data) {
  try {
    fn(data);
  } catch (err) {
    console.error(`${name} failed to render`, err);
  }
}

async function init() {
  const data = await getTwin(DEMO_FIELD.lat, DEMO_FIELD.lon);
  renderReveal(data);
  renderCaveats(data.caveats);
  tryRender('Honesty panel', renderHonestyPanel, data);
  tryRender('Drift view', renderDrift, data);
  tryRender('Viability curve', renderViability, data);
}

init();
