// Climate Twin front-end.
// Loads the live API if it's running, otherwise falls back to contract.json.

const API_URL = 'http://localhost:8000/twin';
const API_TIMEOUT_MS = 15000;
const DEMO_FIELD = { lat: 6.12, lon: 100.37 }; // Kedah padi field

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = '© OpenStreetMap';

const ARC_DURATION_MS = 1600;
const SCREEN_FADE_MS = 350; // keep in sync with .optional transition in style.css

const prefersReducedMotion =
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const SIGNATURE_LABELS = {
  mean_temp: 'Mean Temp (°C)',
  gdd: 'Growing Degree Days',
  rain_mm: 'Annual Rainfall (mm)',
  wet_share: 'Wet Season Share',
  dry_spell_days: 'Longest Dry Spell (days)',
  heat_days: 'Heat Stress Days',
  solar: 'Solar Radiation (MJ/m²/day)',
  cold_month: 'Coldest Month (°C)'
};

const state = {
  data: null,
  requestId: 0,      // drops responses from clicks the user has since replaced
  revealMap: null,
  revealLayer: null,
  arcFrame: null,
  driftMap: null,
  driftLayer: null,
  chart: null
};

// ---------- Helpers ----------

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
}

function fmt(value, digits) {
  return typeof value === 'number' ? value.toFixed(digits) : '—';
}

function pct(score) {
  return typeof score === 'number' ? (score * 100).toFixed(0) : '—';
}

function markerIcon(kind, { pop = false } = {}) {
  return L.divIcon({
    className: `ct-marker ct-marker--${kind}${pop ? ' ct-marker--pop' : ''}`,
    html: '<span class="ct-pin"></span>',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12],
    tooltipAnchor: [0, -14]
  });
}

function addMarker(layer, latlng, kind, { tooltip, popup, pop } = {}) {
  const marker = L.marker(latlng, {
    icon: markerIcon(kind, { pop }),
    riseOnHover: true
  }).addTo(layer);
  if (tooltip) marker.bindTooltip(tooltip, { direction: 'top', className: 'ct-tooltip' });
  if (popup) marker.bindPopup(popup);
  return marker;
}

// Points along a gentle curve between two locations (quadratic Bézier).
function arcPoints(from, to, segments = 80) {
  let [lat1, lon1] = from;
  let [lat2, lon2] = to;
  // Take the short way round across the date line.
  if (lon2 - lon1 > 180) lon2 -= 360;
  if (lon1 - lon2 > 180) lon2 += 360;

  const midLat = (lat1 + lat2) / 2;
  const midLon = (lon1 + lon2) / 2;
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  // Control point is pushed sideways from the midpoint, 25% of the distance.
  const ctrlLat = midLat - dLon * 0.25;
  const ctrlLon = midLon + dLat * 0.25;

  const points = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const u = 1 - t;
    points.push([
      u * u * lat1 + 2 * u * t * ctrlLat + t * t * lat2,
      u * u * lon1 + 2 * u * t * ctrlLon + t * t * lon2
    ]);
  }
  return points;
}

function cancelArcAnimation() {
  if (state.arcFrame !== null) {
    cancelAnimationFrame(state.arcFrame);
    state.arcFrame = null;
  }
}

// Draws the line progressively. Resolves when finished.
function animateArc(line, points) {
  return new Promise(resolve => {
    if (prefersReducedMotion) {
      line.setLatLngs(points);
      resolve();
      return;
    }
    const start = performance.now();
    const step = now => {
      const t = Math.min(1, (now - start) / ARC_DURATION_MS);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out
      const count = Math.max(2, Math.ceil(eased * points.length));
      line.setLatLngs(points.slice(0, count));
      if (t < 1) {
        state.arcFrame = requestAnimationFrame(step);
      } else {
        state.arcFrame = null;
        resolve();
      }
    };
    state.arcFrame = requestAnimationFrame(step);
  });
}

// ---------- Data ----------

let fallbackPromise = null;
function loadFallback() {
  if (!fallbackPromise) {
    fallbackPromise = fetch('./contract.json').then(r => {
      if (!r.ok) throw new Error(`contract.json: ${r.status}`);
      return r.json();
    });
    fallbackPromise.catch(() => { fallbackPromise = null; }); // allow retry
  }
  return fallbackPromise;
}

async function getTwin(lat, lon) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_URL}?lat=${lat}&lon=${lon}`, { signal: controller.signal });
    if (!res.ok) throw new Error(res.status);
    return { data: await res.json(), live: true };
  } catch (err) {
    console.warn('API failed, using contract.json fallback', err);
    return { data: await loadFallback(), live: false };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Loading + status ----------

function setLoading(isLoading) {
  document.getElementById('map-loading').hidden = !isLoading;
  document.getElementById('reveal').classList.toggle('is-loading', isLoading);
  if (isLoading) {
    const resultText = document.getElementById('result-text');
    resultText.classList.remove('is-visible');
    resultText.innerHTML = `
      <p class="reveal-loading">Finding the climate twin<span class="dots"></span></p>
    `;
    resultText.classList.add('is-visible');
  }
}

function setStatus(message, tone = 'info') {
  const el = document.getElementById('status');
  el.textContent = message;
  el.dataset.tone = tone;
}

// ---------- Selecting a field ----------

async function selectField(lat, lon, { fromClick = false } = {}) {
  const id = ++state.requestId;
  cancelArcAnimation();
  setLoading(true);

  if (fromClick) {
    state.revealLayer.clearLayers();
    addMarker(state.revealLayer, [lat, lon], 'field', {
      tooltip: `Selected point<br>${lat.toFixed(2)}, ${lon.toFixed(2)}`
    });
    setStatus(`Looking up ${lat.toFixed(2)}, ${lon.toFixed(2)}…`);
  }

  let result;
  try {
    result = await getTwin(lat, lon);
  } catch (err) {
    if (id !== state.requestId) return;
    console.error(err);
    setLoading(false);
    document.getElementById('result-text').innerHTML =
      '<p class="reveal-detail">Could not load any data. Open this page through a local server ' +
      '(<code>python3 -m http.server 3000</code>), not by double-clicking the file.</p>';
    setStatus('Data failed to load.', 'error');
    return;
  }
  if (id !== state.requestId) return; // a newer click replaced this one

  setLoading(false);
  state.data = result.data;

  if (result.live) {
    setStatus('Live result from the Climate Twin engine. Click the map to try another field.');
  } else if (fromClick) {
    setStatus(
      'The engine isn\'t running yet, so this shows the Kedah demo result instead of the point you clicked.',
      'warn'
    );
  } else {
    setStatus('Showing demo data (engine not connected). Click anywhere on the map to choose a field.', 'warn');
  }

  renderCaveats(state.data.caveats || []);
  refreshOpenScreens();
  await renderReveal(state.data, id);
}

// ---------- Screen 1: The Reveal (cannot be cut) ----------

function initRevealMap() {
  const map = L.map('map').setView([DEMO_FIELD.lat, DEMO_FIELD.lon], 5);
  L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION }).addTo(map);
  state.revealLayer = L.layerGroup().addTo(map);

  map.on('click', e => {
    const { lat, lng } = e.latlng.wrap();
    selectField(Number(lat.toFixed(2)), Number(lng.toFixed(2)), { fromClick: true });
  });

  state.revealMap = map;
}

async function renderReveal(data, id) {
  const { field, twin } = data;
  const map = state.revealMap;
  const layer = state.revealLayer;
  const resultText = document.getElementById('result-text');

  layer.clearLayers();
  resultText.classList.remove('is-visible');

  addMarker(layer, [field.lat, field.lon], 'field', {
    tooltip: `<b>${escapeHtml(field.name)}</b><br>Your field`,
    popup: `<b>${escapeHtml(field.name)}</b><br>Your field today`
  });

  map.flyToBounds([
    [field.lat, field.lon],
    [twin.lat, twin.lon]
  ], {
    paddingTopLeft: [60, 240],    // leave room for the headline box (can wrap to 2 lines)
    paddingBottomRight: [60, 40],
    duration: prefersReducedMotion ? 0 : 1,
    animate: !prefersReducedMotion
  });

  const arc = L.polyline([], {
    color: '#ff6b6b',
    weight: 3,
    dashArray: '10, 10',
    className: 'ct-arc'
  }).addTo(layer);
  arc.bindTooltip(`${twin.distance_km ?? '?'} km to your climate twin`, {
    sticky: true,
    className: 'ct-tooltip'
  });
  arc.on('mouseover', () => arc.setStyle({ weight: 6 }));
  arc.on('mouseout', () => arc.setStyle({ weight: 3 }));

  await animateArc(arc, arcPoints([field.lat, field.lon], [twin.lat, twin.lon]));
  if (id !== state.requestId) return; // a newer click took over mid-animation

  addMarker(layer, [twin.lat, twin.lon], 'twin', {
    pop: true,
    tooltip: `<b>${escapeHtml(twin.place)}</b><br>Your 2045 climate twin`,
    popup: `<b>${escapeHtml(twin.place)}</b><br>Your 2045 climate twin<br>` +
      `Match: ${pct(twin.match_score)}%`
  });

  resultText.innerHTML = `
    <p class="reveal-headline">Your field in 2045 is <strong>${escapeHtml(twin.place)}</strong> today.</p>
    <p class="reveal-detail">Climate match: ${pct(twin.match_score)}%</p>
  `;
  resultText.classList.add('is-visible');
}

// ---------- Screen 2: The Honesty Panel ----------

function renderHonestyPanel(data) {
  const { signature_2045, twin } = data;
  const table = document.getElementById('signature-table');

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
  for (const [key, label] of Object.entries(SIGNATURE_LABELS)) {
    const fieldVal = signature_2045[key];
    const twinVal = twin.signature[key];
    const diff = typeof fieldVal === 'number' && typeof twinVal === 'number'
      ? Math.abs(fieldVal - twinVal)
      : null;
    // Counts are whole numbers; wet_share is a 0–1 fraction.
    const digits = { gdd: 0, rain_mm: 0, dry_spell_days: 0, heat_days: 0, wet_share: 2 }[key] ?? 1;

    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${label}</td>
      <td>${fmt(fieldVal, digits)}</td>
      <td>${fmt(twinVal, digits)}</td>
      <td>${fmt(diff, digits)}</td>
    `;
    tbody.appendChild(row);
  }
}

// ---------- Screen 3: The Drift ----------

function renderDrift(data) {
  const { field, twin, twin_1995 } = data;

  if (!state.driftMap) {
    state.driftMap = L.map('drift-map').setView([field.lat, field.lon], 6);
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION }).addTo(state.driftMap);
    state.driftLayer = L.layerGroup().addTo(state.driftMap);
  }
  // The container was hidden until now, so Leaflet must re-measure it.
  state.driftMap.invalidateSize();
  state.driftLayer.clearLayers();

  addMarker(state.driftLayer, [field.lat, field.lon], 'field', {
    tooltip: '<b>Your field</b>'
  });
  addMarker(state.driftLayer, [twin_1995.lat, twin_1995.lon], 'past', {
    tooltip: `<b>1995 twin</b><br>${escapeHtml(twin_1995.place)}`
  });
  addMarker(state.driftLayer, [twin.lat, twin.lon], 'twin', {
    tooltip: `<b>2025 twin</b><br>${escapeHtml(twin.place)}`
  });

  L.polyline([
    [twin_1995.lat, twin_1995.lon],
    [twin.lat, twin.lon]
  ], { color: '#ffa502', weight: 3 })
    .bindTooltip(`${twin_1995.drift_km} km of climate drift`, { sticky: true, className: 'ct-tooltip' })
    .addTo(state.driftLayer);

  state.driftMap.fitBounds([
    [field.lat, field.lon],
    [twin_1995.lat, twin_1995.lon],
    [twin.lat, twin.lon]
  ], { padding: [40, 40] });

  document.getElementById('drift-text').textContent =
    `Your field has already moved ${twin_1995.drift_km} km in climate terms from 1995 to today.`;
}

// ---------- Screen 4: Viability Curve ----------

function renderViability(data) {
  const viability = data.current_crop_viability || [];
  const labels = viability.map(v => v.year);
  const scores = viability.map(v => v.score);

  if (state.chart) {
    state.chart.data.labels = labels;
    state.chart.data.datasets[0].data = scores;
    state.chart.update();
    return;
  }

  const ctx = document.getElementById('viability-chart').getContext('2d');
  state.chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Current Crop Viability',
        data: scores,
        borderColor: '#ff6b6b',
        backgroundColor: 'rgba(255, 107, 107, 0.1)',
        pointRadius: 5,
        pointHoverRadius: 9,
        tension: 0.4
      }]
    },
    options: {
      responsive: true,
      animation: prefersReducedMotion ? false : { duration: 1200 },
      interaction: { mode: 'index', intersect: false },
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

// ---------- Caveats ----------

function renderCaveats(caveats) {
  const list = document.getElementById('caveat-list');
  list.replaceChildren(...caveats.map(c => {
    const li = document.createElement('li');
    li.textContent = c;
    return li;
  }));
}

// ---------- Show/hide optional screens ----------

const SCREEN_RENDERERS = {
  'honesty-panel': renderHonestyPanel,
  drift: renderDrift,
  viability: renderViability
};

function renderScreen(id) {
  if (!state.data) return;
  try {
    SCREEN_RENDERERS[id](state.data);
  } catch (err) {
    // Optional screens must never break the reveal.
    console.error(`${id} failed to render`, err);
  }
}

function openScreen(section) {
  section.hidden = false;           // make it measurable before rendering
  renderScreen(section.id);
  requestAnimationFrame(() => section.classList.add('is-visible'));
  section.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
}

function closeScreen(section) {
  section.classList.remove('is-visible');
  setTimeout(() => {
    if (!section.classList.contains('is-visible')) section.hidden = true;
  }, prefersReducedMotion ? 0 : SCREEN_FADE_MS);
}

function refreshOpenScreens() {
  document.querySelectorAll('.optional:not([hidden])').forEach(s => renderScreen(s.id));
}

function initToggles() {
  document.querySelectorAll('#screen-toggles .toggle').forEach(button => {
    button.addEventListener('click', () => {
      const section = document.getElementById(button.dataset.target);
      const open = button.getAttribute('aria-pressed') !== 'true';
      button.setAttribute('aria-pressed', String(open));
      if (open) openScreen(section);
      else closeScreen(section);
    });
  });
}

// ---------- Start ----------

function init() {
  initRevealMap();
  initToggles();
  selectField(DEMO_FIELD.lat, DEMO_FIELD.lon);
}

init();
