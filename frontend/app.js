// Climate Twin front-end.
// Loads the live API if it's running, otherwise falls back to contract.json.

const API_URL = 'http://localhost:8000/twin';
const API_TIMEOUT_MS = 15000;
const DEMO_FIELD = { lat: 6.12, lon: 100.37 }; // Kedah padi field

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTRIBUTION = '© OpenStreetMap';

const ARC_DURATION_MS = 1600;
const GLOBE_ARC_DURATION_MS = 1800;
const GLOBE_IDLE_SPIN_MS = 6000;   // start spinning this long after the reveal
const GLOBE_RESUME_SPIN_MS = 10000; // resume spinning this long after the user lets go

// Earth texture: NASA Blue Marble. A local copy (works offline) is tried first.
const EARTH_TEXTURES = [
  'vendor/globe/earth-blue-marble.jpg',
  'https://unpkg.com/three-globe@2/example/img/earth-blue-marble.jpg'
];
const EARTH_BUMP = [
  'vendor/globe/earth-topology.png',
  'https://unpkg.com/three-globe@2/example/img/earth-topology.png'
];
const SCREEN_FADE_MS = 350; // keep in sync with .optional transition in style.css

const prefersReducedMotion =
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// "why" text follows the "Why a Farmer Cares" column in README.md.
const SIGNATURES = {
  mean_temp: {
    label: 'Mean Temp (°C)',
    what: 'Average air temperature across the whole year.',
    why: 'Sets which crops are possible at all.'
  },
  gdd: {
    label: 'Growing Degree Days',
    what: 'Daily warmth above 10°C, added up over the year.',
    why: 'How fast a crop reaches maturity.'
  },
  rain_mm: {
    label: 'Annual Rainfall (mm)',
    what: 'Total rain in a year.',
    why: 'Whether irrigation is optional.'
  },
  wet_share: {
    label: 'Wet Season Share',
    what: 'How much of the year\'s rain falls in the wet season.',
    why: 'Monsoon shape: the same total rain can mean very different farming.'
  },
  dry_spell_days: {
    label: 'Longest Dry Spell (days)',
    what: 'Longest run of days with less than 1 mm of rain.',
    why: 'The number that kills a crop.'
  },
  heat_days: {
    label: 'Heat Stress Days',
    what: 'Days per year hotter than 35°C.',
    why: 'Causes flowering failure in rice, maize and vegetables.'
  },
  solar: {
    label: 'Solar Radiation (MJ/m²/day)',
    what: 'Average sunlight reaching the ground each day.',
    why: 'Sets the ceiling on photosynthesis.'
  },
  cold_month: {
    label: 'Coldest Month (°C)',
    what: 'Average temperature of the coldest month.',
    why: 'A hard limit for tropical tree crops.'
  }
};

// Story mode order. The reveal stays on screen; each later step opens one screen.
const STORY_STEPS = [
  { id: 'reveal', title: 'The reveal' },
  { id: 'crops', title: 'What grows there' },
  { id: 'honesty-panel', title: 'Why it matches' },
  { id: 'drift', title: 'The drift' },
  { id: 'viability', title: 'Crop viability' }
];

const state = {
  data: null,
  requestId: 0,      // drops responses from clicks the user has since replaced
  revealMap: null,
  revealLayer: null,
  arcFrame: null,
  driftMap: null,
  driftLayer: null,
  chart: null,
  view: 'map',        // 'globe' or 'map'
  revealToken: 0,     // drops reveal animations that a newer reveal replaced
  globe: null,
  globeIntroDone: false,
  globeTimers: []
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
    showPendingField(lat, lon);
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

// Shows the clicked point straight away while the twin is looked up.
function showPendingField(lat, lon) {
  state.revealToken++;
  cancelArcAnimation();
  const label = `Selected point<br>${lat.toFixed(2)}, ${lon.toFixed(2)}`;
  if (state.view === 'globe') {
    globePendingField(lat, lon, label);
  } else {
    state.revealLayer.clearLayers();
    addMarker(state.revealLayer, [lat, lon], 'field', { tooltip: label });
  }
}

async function renderReveal(data, id) {
  const token = ++state.revealToken;
  const resultText = document.getElementById('result-text');
  resultText.classList.remove('is-visible');

  if (state.view === 'globe') await globeReveal(data, token);
  else await mapReveal(data, token);

  // A newer click or replay took over mid-animation.
  if (id !== state.requestId || token !== state.revealToken) return;

  const { twin } = data;
  resultText.innerHTML = `
    <p class="reveal-headline">Your field in 2045 is <strong>${escapeHtml(twin.place)}</strong> today.</p>
    <p class="reveal-detail">Climate match: ${pct(twin.match_score)}%</p>
  `;
  resultText.classList.add('is-visible');
}

async function mapReveal(data, token) {
  const { field, twin } = data;
  const map = state.revealMap;
  const layer = state.revealLayer;

  cancelArcAnimation(); // story mode can replay the reveal mid-animation
  layer.clearLayers();

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
  if (token !== state.revealToken) return;

  addMarker(layer, [twin.lat, twin.lon], 'twin', {
    pop: true,
    tooltip: `<b>${escapeHtml(twin.place)}</b><br>Your 2045 climate twin`,
    popup: `<b>${escapeHtml(twin.place)}</b><br>Your 2045 climate twin<br>` +
      `Match: ${pct(twin.match_score)}%`
  });
}

// ---------- 3D globe (globe.gl) ----------

function webglAvailable() {
  try {
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function wait(ms) {
  return new Promise(resolve => {
    const t = setTimeout(resolve, ms);
    state.globeTimers.push(t);
  });
}

function clearGlobeTimers() {
  state.globeTimers.forEach(clearTimeout);
  state.globeTimers = [];
}

// Resolves with the first image URL that loads, or null if none do.
function firstLoadable(urls) {
  return urls.reduce((prev, url) => prev.then(found => found || new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(url);
    img.onerror = () => resolve(null);
    img.src = url;
  })), Promise.resolve(null));
}

// Midpoint and angular distance (degrees) between two points on the sphere.
function greatCircle(a, b) {
  const rad = Math.PI / 180;
  const toVec = p => [
    Math.cos(p.lat * rad) * Math.cos(p.lon * rad),
    Math.cos(p.lat * rad) * Math.sin(p.lon * rad),
    Math.sin(p.lat * rad)
  ];
  const [x1, y1, z1] = toVec(a);
  const [x2, y2, z2] = toVec(b);
  const dot = Math.min(1, Math.max(-1, x1 * x2 + y1 * y2 + z1 * z2));
  const [mx, my, mz] = [x1 + x2, y1 + y2, z1 + z2];
  return {
    lat: Math.atan2(mz, Math.hypot(mx, my)) / rad,
    lon: Math.atan2(my, mx) / rad,
    degrees: Math.acos(dot) / rad
  };
}

function globeMarker(kind, labelHtml, { pop = false } = {}) {
  const el = document.createElement('div');
  el.className = `ct-marker ct-marker--${kind} globe-marker${pop ? ' ct-marker--pop' : ''}`;
  el.innerHTML = `<span class="ct-pin"></span><span class="globe-label">${labelHtml}</span>`;
  return el;
}

const spinControl = {
  timer: null,
  stop() {
    clearTimeout(this.timer);
    if (state.globe) state.globe.controls().autoRotate = false;
  },
  startAfter(ms) {
    clearTimeout(this.timer);
    if (prefersReducedMotion || !state.globe) return;
    this.timer = setTimeout(() => {
      if (state.globe && state.view === 'globe') state.globe.controls().autoRotate = true;
    }, ms);
  }
};

function initGlobe() {
  if (typeof Globe !== 'function' || !webglAvailable()) return false;
  const el = document.getElementById('globe-view');
  let globe;
  try {
    globe = Globe({ animateIn: !prefersReducedMotion })(el)
      .backgroundColor('rgba(0, 0, 0, 0)')   // let the galaxy show through
      .showAtmosphere(true)
      .atmosphereColor('#7fdcff')
      .atmosphereAltitude(0.2)
      .showGraticules(true)
      // Markers are DOM elements so they share the flat map's look and hover effects
      .htmlElementsData([])
      .htmlLat('lat')
      .htmlLng('lng')
      .htmlAltitude(0.01)
      .htmlElement(d => d.el)
      .htmlTransitionDuration(0)
      // Fade out markers on the far side of the Earth
      .htmlElementVisibilityModifier((node, visible) => { node.style.opacity = visible ? '1' : '0'; })
      .arcsData([])
      .arcStartLat('startLat').arcStartLng('startLng')
      .arcEndLat('endLat').arcEndLng('endLng')
      .arcColor('color')
      .arcStroke('stroke')
      .arcAltitudeAutoScale(0.45)
      .arcDashLength('dashLength')
      .arcDashGap('dashGap')
      .arcDashInitialGap('dashInitialGap')
      .arcDashAnimateTime('dashAnimateTime')
      .arcLabel('label')
      .arcsTransitionDuration(0)
      .ringsData([])
      .ringColor(() => t => `rgba(255, 107, 107, ${1 - t})`)
      .ringMaxRadius(4)
      .ringPropagationSpeed(2.5)
      .ringRepeatPeriod(1100)
      .onGlobeClick(({ lat, lng }) => {
        selectField(Number(lat.toFixed(2)), Number(lng.toFixed(2)), { fromClick: true });
      });
  } catch (err) {
    console.warn('3D globe unavailable, using the flat map', err);
    return false;
  }

  // Ocean-blue globe until (or unless) the Earth photo loads.
  const material = globe.globeMaterial();
  material.color.set('#1d4f91');
  if (material.emissive) material.emissive.set('#06203f');

  firstLoadable(EARTH_TEXTURES).then(url => {
    if (!url) {
      console.warn('Earth texture not found; showing a plain globe with grid lines.');
      return;
    }
    material.color.set('#ffffff');
    if (material.emissive) material.emissive.set('#000000');
    globe.globeImageUrl(url).showGraticules(false);
    firstLoadable(EARTH_BUMP).then(bump => { if (bump) globe.bumpImageUrl(bump); });
  });

  const controls = globe.controls();
  controls.autoRotate = false;
  controls.autoRotateSpeed = 0.35;
  controls.enableDamping = true;
  controls.minDistance = 130;
  controls.maxDistance = 700;
  controls.addEventListener('start', () => spinControl.stop());
  controls.addEventListener('end', () => spinControl.startAfter(GLOBE_RESUME_SPIN_MS));

  // Keep the canvas the same size as its box.
  const resize = () => {
    if (el.clientWidth && el.clientHeight) globe.width(el.clientWidth).height(el.clientHeight);
  };
  new ResizeObserver(resize).observe(el);
  resize();

  // Don't draw frames while the globe is hidden or scrolled off screen.
  new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting && state.view === 'globe') globe.resumeAnimation();
    else globe.pauseAnimation();
  }).observe(el);

  state.globe = globe;
  return true;
}

function globePendingField(lat, lon, label) {
  clearGlobeTimers();
  spinControl.stop();
  state.globe
    .arcsData([])
    .ringsData([])
    .htmlElementsData([{ lat, lng: lon, el: globeMarker('field', label) }]);
}

async function globeReveal(data, token) {
  const { field, twin } = data;
  const globe = state.globe;
  const live = () => token === state.revealToken;

  clearGlobeTimers();
  spinControl.stop();

  const fieldPoint = {
    lat: field.lat, lng: field.lon,
    el: globeMarker('field', `<b>${escapeHtml(field.name)}</b><br>Your field`)
  };
  globe.arcsData([]).ringsData([]).htmlElementsData([fieldPoint]);

  // Point the camera between the two places, a little north so the pair sits
  // below the headline box. Farther apart = higher camera.
  const mid = greatCircle({ lat: field.lat, lon: field.lon }, { lat: twin.lat, lon: twin.lon });
  const altitude = Math.min(2.6, Math.max(0.75, 0.55 + mid.degrees / 40));
  const view = { lat: mid.lat + 4 + mid.degrees * 0.15, lng: mid.lon, altitude };

  if (prefersReducedMotion) {
    globe.pointOfView(view, 0);
  } else if (!state.globeIntroDone) {
    // First time: start far out, a third of the way round, and swoop in.
    globe.pointOfView({ lat: view.lat - 10, lng: view.lng - 120, altitude: 3.2 }, 0);
    globe.pointOfView(view, 2400);
    await wait(2400);
  } else {
    globe.pointOfView(view, 1200);
    await wait(1200);
  }
  state.globeIntroDone = true;
  if (!live()) return;

  const coords = { startLat: field.lat, startLng: field.lon, endLat: twin.lat, endLng: twin.lon };
  const label = `${twin.distance_km ?? '?'} km to your climate twin`;
  const fullArc = {
    ...coords, label, color: ['#2ed573', '#ff6b6b'], stroke: 0.9,
    dashLength: 1, dashGap: 0, dashInitialGap: 0, dashAnimateTime: 0
  };

  if (!prefersReducedMotion) {
    // Draw the arc in: one dash, starting just before the field, slides in until
    // it covers the whole arc. It covers it after a third of the cycle.
    globe.arcsData([{
      ...fullArc, dashLength: 1, dashGap: 2, dashInitialGap: 1,
      dashAnimateTime: GLOBE_ARC_DURATION_MS * 3
    }]);
    await wait(GLOBE_ARC_DURATION_MS);
    if (!live()) return;
  }

  // Finished arc, plus a bright pulse that keeps travelling field → twin.
  const arcs = [fullArc];
  if (!prefersReducedMotion) {
    arcs.push({
      ...coords, label, color: ['rgba(255, 255, 255, 0)', '#fff6c9'], stroke: 1.4,
      dashLength: 0.12, dashGap: 0.88, dashInitialGap: 0, dashAnimateTime: 2600
    });
  }
  globe.arcsData(arcs);

  globe.htmlElementsData([fieldPoint, {
    lat: twin.lat, lng: twin.lon,
    el: globeMarker('twin', `<b>${escapeHtml(twin.place)}</b><br>Your 2045 climate twin · ${pct(twin.match_score)}% match`, { pop: true })
  }]);
  if (!prefersReducedMotion) globe.ringsData([{ lat: twin.lat, lng: twin.lon }]);

  spinControl.startAfter(GLOBE_IDLE_SPIN_MS);
}

// ---------- Switching between globe and flat map ----------

const VIEW_KEY = 'climate-twin-view';

function setView(view, { replay = true } = {}) {
  if (view === 'globe' && !state.globe) view = 'map';
  state.view = view;
  try { localStorage.setItem(VIEW_KEY, view); } catch { /* private mode */ }

  document.getElementById('globe-view').hidden = view !== 'globe';
  document.getElementById('map').hidden = view !== 'map';
  document.querySelectorAll('.view-btn').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.view === view)));

  if (view === 'map') {
    clearGlobeTimers();
    spinControl.stop();
    if (state.globe) state.globe.pauseAnimation();
    state.revealMap.invalidateSize(); // it was hidden, so re-measure
  } else {
    cancelArcAnimation();
    state.globe.resumeAnimation();
  }

  if (replay && state.data) renderReveal(state.data, state.requestId);
}

function initViews() {
  const hasGlobe = initGlobe();
  document.getElementById('view-switch').hidden = !hasGlobe;
  document.querySelectorAll('.view-btn').forEach(button => {
    button.addEventListener('click', () => {
      if (button.dataset.view !== state.view) setView(button.dataset.view);
    });
  });
  let saved = null;
  try { saved = localStorage.getItem(VIEW_KEY); } catch { /* private mode */ }
  setView(hasGlobe && saved !== 'map' ? 'globe' : 'map', { replay: false });
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
  for (const [key, { label, what, why }] of Object.entries(SIGNATURES)) {
    const fieldVal = signature_2045[key];
    const twinVal = twin.signature[key];
    const diff = typeof fieldVal === 'number' && typeof twinVal === 'number'
      ? Math.abs(fieldVal - twinVal)
      : null;
    // Counts are whole numbers; wet_share is a 0–1 fraction.
    const digits = { gdd: 0, rain_mm: 0, dry_spell_days: 0, heat_days: 0, wet_share: 2 }[key] ?? 1;

    const row = document.createElement('tr');
    row.className = 'sig-row';
    row.tabIndex = 0; // lets keyboard and touch users open the explanation
    const tipId = `tip-${key}`;
    row.setAttribute('aria-describedby', tipId);
    row.innerHTML = `
      <td class="sig-label">
        ${label} <span class="info" aria-hidden="true">ⓘ</span>
        <span class="sig-tip" id="${tipId}" role="tooltip">
          <span class="sig-tip-what">${what}</span>
          <strong class="sig-tip-why">${why}</strong>
        </span>
      </td>
      <td>${fmt(fieldVal, digits)}</td>
      <td>${fmt(twinVal, digits)}</td>
      <td>${fmt(diff, digits)}</td>
    `;
    tbody.appendChild(row);
  }
}

// ---------- Crop cards ----------

// Only allow http(s) links from the data, never javascript: etc.
function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

function renderCrops(data) {
  const crops = data.crops_there || [];
  const container = document.getElementById('crop-cards');

  document.getElementById('crops-title').textContent =
    `What Grows in ${data.twin.place} Today`;

  if (crops.length === 0) {
    container.innerHTML = '<p class="crop-empty">No crop data for this twin yet.</p>';
    return;
  }

  container.replaceChildren(...crops.map((crop, i) => {
    const card = document.createElement('article');
    card.className = 'crop-card';
    card.style.setProperty('--i', i); // staggers the entrance animation

    const url = safeUrl(crop.source);
    const source = url
      ? `<a class="crop-source" href="${escapeHtml(url.href)}" target="_blank" rel="noopener noreferrer">
           Source: ${escapeHtml(url.hostname.replace(/^www\./, ''))} ↗
         </a>`
      : '';

    card.innerHTML = `
      <h3 class="crop-name">🌾 ${escapeHtml(crop.name)}</h3>
      <p class="crop-note">${escapeHtml(crop.note)}</p>
      ${source}
    `;
    return card;
  }));
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
  crops: renderCrops,
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

function closeScreen(section, { instant = false } = {}) {
  section.classList.remove('is-visible');
  if (instant) {
    section.hidden = true;
    return;
  }
  setTimeout(() => {
    if (!section.classList.contains('is-visible')) section.hidden = true;
  }, prefersReducedMotion ? 0 : SCREEN_FADE_MS);
}

function refreshOpenScreens() {
  document.querySelectorAll('.optional:not([hidden])').forEach(s => renderScreen(s.id));
}

function setScreenOpen(id, open, { instant = false } = {}) {
  const section = document.getElementById(id);
  const button = document.querySelector(`.toggle[data-target="${id}"]`);
  if (button) button.setAttribute('aria-pressed', String(open));
  if (open) openScreen(section);
  else if (!section.hidden) closeScreen(section, { instant });
}

function initToggles() {
  document.querySelectorAll('#screen-toggles .toggle[data-target]').forEach(button => {
    button.addEventListener('click', () => {
      const open = button.getAttribute('aria-pressed') !== 'true';
      setScreenOpen(button.dataset.target, open);
    });
  });
}

// ---------- Story mode ----------

const story = { active: false, step: 0 };

function goToStep(step) {
  story.step = Math.max(0, Math.min(STORY_STEPS.length - 1, step));
  const current = STORY_STEPS[story.step];

  // Show only the current step's screen. Close the others instantly so the
  // page doesn't shift while scrolling to the new one.
  for (const { id } of STORY_STEPS) {
    if (id !== 'reveal' && id !== current.id) setScreenOpen(id, false, { instant: true });
  }
  if (current.id !== 'reveal') setScreenOpen(current.id, true);

  if (current.id === 'reveal') {
    window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
    // Replay the arc so the presenter can start the story fresh.
    if (state.data) renderReveal(state.data, state.requestId);
  }

  document.getElementById('story-label').textContent =
    `Step ${story.step + 1} of ${STORY_STEPS.length}: ${current.title}`;
  document.querySelectorAll('#story-dots li').forEach((dot, i) => {
    dot.classList.toggle('is-current', i === story.step);
    dot.classList.toggle('is-done', i < story.step);
  });
  document.getElementById('story-prev').disabled = story.step === 0;
  document.getElementById('story-next').textContent =
    story.step === STORY_STEPS.length - 1 ? 'Finish ✓' : 'Next →';
}

function startStory() {
  story.active = true;
  document.body.classList.add('story-active');
  document.getElementById('story-bar').hidden = false;
  goToStep(0);
  document.getElementById('story-next').focus();
}

function exitStory() {
  if (!story.active) return;
  story.active = false;
  document.body.classList.remove('story-active');
  document.getElementById('story-bar').hidden = true;
  document.getElementById('story-start').focus();
}

function nextStep() {
  if (story.step === STORY_STEPS.length - 1) exitStory();
  else goToStep(story.step + 1);
}

function initStory() {
  document.getElementById('story-dots').replaceChildren(
    ...STORY_STEPS.map(() => document.createElement('li'))
  );
  document.getElementById('story-start').addEventListener('click', startStory);
  document.getElementById('story-next').addEventListener('click', nextStep);
  document.getElementById('story-prev').addEventListener('click', () => goToStep(story.step - 1));
  document.getElementById('story-exit').addEventListener('click', exitStory);

  // Arrow keys, Page Up/Down (what presentation clickers send) and Escape.
  document.addEventListener('keydown', e => {
    if (!story.active || e.altKey || e.ctrlKey || e.metaKey) return;
    // Space/Enter on a focused button already triggers its click.
    const onButton = e.target instanceof HTMLButtonElement;
    // Arrow keys pan a focused map, so leave them to Leaflet there.
    const onMap = e.target instanceof Element && e.target.closest('.leaflet-container');
    const arrowsOk = !onMap;
    if (e.key === 'PageDown' || (e.key === 'ArrowRight' && arrowsOk) || (e.key === ' ' && !onButton && !onMap)) {
      e.preventDefault();
      nextStep();
    } else if (e.key === 'PageUp' || (e.key === 'ArrowLeft' && arrowsOk)) {
      e.preventDefault();
      goToStep(story.step - 1);
    } else if (e.key === 'Escape') {
      exitStory();
    }
  });
}

// ---------- Animated scene backgrounds ----------

// Fills each .particles container with decorative pieces. Every piece gets
// random CSS variables (position, size, timing) so the scene doesn't look
// tiled. The look and motion live in style.css.
const PARTICLE_VARS = {
  stalk: () => ({ x: rand(0, 100), h: rand(28, 62), delay: rand(-4, 0), dur: rand(2.6, 4.2) }),
  cloud: () => ({ x: rand(0, 85), y: rand(4, 45), s: rand(0.6, 1.4), delay: rand(-80, 0), dur: rand(55, 90) }),
  bird:  () => ({ x: rand(5, 90), y: rand(1, 8), s: rand(0.6, 1.2), delay: rand(-26, 0), dur: rand(18, 28) }),
  heat:  () => ({ x: rand(5, 90), delay: rand(-6, 0), dur: rand(4, 7) }),
  tuft:  () => ({ x: rand(0, 100), s: rand(0.7, 1.3), delay: rand(-12, 0) }),
  star:  () => ({ x: rand(0, 100), y: rand(0, 100), s: rand(1, 3), delay: rand(-4, 0), dur: rand(1.8, 4) }),
  // Larger stars with a cross-shaped glint
  bright: () => ({ x: rand(2, 98), y: rand(2, 98), s: rand(3, 5), delay: rand(-6, 0), dur: rand(3, 6) }),
  // Shooting stars: dur is the whole cycle; the streak itself takes the first ~12%
  meteor: () => ({ ...meteorPath(), delay: rand(0, 9), dur: rand(7, 14) })
};

// A new start point, angle and length for a shooting star.
function meteorPath() {
  return { x: rand(-5, 85), y: rand(-5, 55), angle: rand(18, 42), len: rand(90, 170) };
}

const VAR_UNITS = { x: '%', y: '%', h: 'px', delay: 's', dur: 's', angle: 'deg', len: 'px' };

function setVars(el, vars) {
  for (const [name, value] of Object.entries(vars)) {
    el.style.setProperty(`--${name}`, `${value.toFixed(2)}${VAR_UNITS[name] ?? ''}`);
  }
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function initScenes() {
  document.querySelectorAll('.particles[data-particle]').forEach(container => {
    const kind = container.dataset.particle;
    const makeVars = PARTICLE_VARS[kind];
    const count = Number(container.dataset.count) || 0;
    const pieces = [];
    for (let i = 0; i < count; i++) {
      const piece = document.createElement('span');
      piece.className = `p p--${kind}`;
      setVars(piece, makeVars());
      if (kind === 'meteor') {
        // Each time the streak loops, send it somewhere new.
        piece.addEventListener('animationiteration', () => setVars(piece, meteorPath()));
      }
      pieces.push(piece);
    }
    container.replaceChildren(...pieces);
  });
}

// ---------- Start ----------

function init() {
  initScenes();
  initRevealMap();   // create the flat map while its box is still visible
  initViews();       // then add the 3D globe and pick the starting view
  initToggles();
  initStory();
  selectField(DEMO_FIELD.lat, DEMO_FIELD.lon);
}

init();
