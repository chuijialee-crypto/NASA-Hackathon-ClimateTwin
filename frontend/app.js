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

// Malaysian farming areas for the preset list. Coordinates are approximate
// (town or district level), which is finer than NASA POWER's ~50 km grid.
const MALAYSIA_PRESETS = [
  { name: 'Kedah: padi (demo field)', lat: 6.12, lon: 100.37 },
  { name: 'Perlis: padi (Arau)', lat: 6.43, lon: 100.27 },
  { name: 'Kelantan: padi (Kota Bharu)', lat: 6.12, lon: 102.24 },
  { name: 'Perak: padi (Kerian)', lat: 5.0, lon: 100.55 },
  { name: 'Selangor: padi (Sekinchan)', lat: 3.5, lon: 101.1 },
  { name: 'Pahang: durian (Raub)', lat: 3.79, lon: 101.86 },
  { name: 'Pahang: tea and vegetables (Cameron Highlands)', lat: 4.47, lon: 101.38 },
  { name: 'Johor: oil palm (Kluang)', lat: 2.03, lon: 103.32 },
  { name: 'Sabah: oil palm (Lahad Datu)', lat: 5.03, lon: 118.33 },
  { name: 'Sarawak: oil palm (Miri)', lat: 4.4, lon: 113.99 }
];

// Radar chart display scale: each spoke runs from a low to a high value for
// farmland. Display only; it doesn't affect matching. Swap in the global
// grid's min/max when the engine provides them.
const RADAR_RANGES = {
  mean_temp: [0, 32],
  gdd: [0, 8500],
  rain_mm: [0, 4000],
  wet_share: [0, 1],
  dry_spell_days: [0, 120],
  heat_days: [0, 150],
  solar: [8, 28],
  cold_month: [-20, 30]
};

// Story mode order. The reveal stays on screen; each later step opens one screen.
const STORY_STEPS = [
  { id: 'reveal', title: 'The reveal' },
  { id: 'crops', title: 'Crops for this climate' },
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
  radar: null,
  view: 'map',        // 'globe' or 'map'
  revealToken: 0,     // drops reveal animations that a newer reveal replaced
  globe: null,
  globeIntroDone: false,
  globeTimers: []
};

// ---------- UI copy (written by Role 3 in ui_copy.json) ----------

let COPY = {};

// Looks up "a.b.c" in ui_copy.json; returns fallback if it's missing.
function copy(path, fallback = '') {
  const value = path.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), COPY);
  return typeof value === 'string' && value.trim() ? prettyUnits(value) : fallback;
}

// Fills {name} placeholders, e.g. fill('In {place}', { place: 'Thailand' }).
function fill(template, values) {
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m));
}

// The copy is typed in plain ASCII ("35C", "MJ/m2"); show proper symbols.
function prettyUnits(text) {
  return String(text)
    .replace(/\(C\)/g, '(°C)')
    .replace(/(\d)C\b/g, '$1°C')
    .replace(/MJ\/m2\b/g, 'MJ/m²');
}

async function loadUiCopy() {
  try {
    const res = await fetch('./ui_copy.json');
    if (!res.ok) throw new Error(res.status);
    COPY = await res.json();
  } catch (err) {
    console.warn('ui_copy.json not loaded; using built-in text', err);
    return;
  }
  document.querySelectorAll('[data-copy]').forEach(el => {
    const text = copy(el.dataset.copy);
    if (text) el.textContent = text;
  });
  document.title = copy('app_name', document.title);
}

function sigLabel(key) {
  return copy(`honesty_panel.signature_labels.${key}`, SIGNATURES[key].label);
}

// Role 3's tooltip is "What it is. Why it matters." Split at the first sentence.
function sigTip(key) {
  const text = copy(`tooltips.${key}`);
  if (!text) return { what: SIGNATURES[key].what, why: SIGNATURES[key].why };
  const cut = text.search(/\.\s/);
  return cut < 0
    ? { what: '', why: text }
    : { what: text.slice(0, cut + 1), why: text.slice(cut + 2) };
}

// ---------- Helpers ----------

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
}

function fmt(value, digits) {
  return typeof value === 'number' ? value.toFixed(digits) : '—';
}

function distanceLabel(twin) {
  const help = copy('tooltips.distance_km');
  return `<b>${twin.distance_km ?? '?'} km</b> to your climate twin${help ? `<br>${escapeHtml(help)}` : ''}`;
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
  setExportReady(false);
  syncFieldInputs(lat, lon);

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
  state.live = result.live;

  if (result.live) {
    setStatus('Live result from the Climate Twin engine. Click the map to try another field.');
  } else if (fromClick) {
    setStatus(
      'The engine isn\'t running yet, so this shows the Kedah demo result instead of the point you chose.',
      'warn'
    );
  } else {
    setStatus(`Showing demo data (engine not connected). ${copy('buttons.pick_field', 'Pick a field on the map')}, or choose one below.`, 'warn');
  }

  // Role 3 owns the caveat wording; the API's list is the fallback.
  const role3Caveats = Array.isArray(COPY.caveats?.items) ? COPY.caveats.items.map(prettyUnits) : [];
  renderCaveats(role3Caveats.length ? role3Caveats : (state.data.caveats || []));
  refreshOpenScreens();
  await renderReveal(state.data, id);
}

// ---------- Typed coordinates and Malaysian presets ----------

// Accepts "6.12", "-6.12", "6,12", "6.12 N" or "6.12°S". Returns a number or null.
function parseCoord(text, positive, negative) {
  let t = String(text).trim().toUpperCase().replace(/\u2212/g, '-').replace(/°/g, '').replace(',', '.');
  let sign = 1;
  const suffix = t.match(/\s*([NSEW])$/);
  if (suffix) {
    if (![positive, negative].includes(suffix[1])) return null;
    if (suffix[1] === negative) sign = -1;
    t = t.slice(0, suffix.index).trim();
    if (t.startsWith('-')) return null; // "-6 S" is ambiguous
  }
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  return sign * Number(t);
}

function syncFieldInputs(lat, lon) {
  document.getElementById('field-lat').value = String(lat);
  document.getElementById('field-lon').value = String(lon);
  const preset = document.getElementById('field-preset');
  const match = MALAYSIA_PRESETS.findIndex(p => p.lat === lat && p.lon === lon);
  preset.value = match >= 0 ? String(match) : '';
  setFieldError(null);
}

function setFieldError(message, input) {
  const error = document.getElementById('field-error');
  error.textContent = message || '';
  for (const id of ['field-lat', 'field-lon']) {
    const el = document.getElementById(id);
    if (el === input) el.setAttribute('aria-invalid', 'true');
    else el.removeAttribute('aria-invalid');
  }
  if (input) input.focus();
}

function initFieldForm() {
  const form = document.getElementById('field-form');
  const preset = document.getElementById('field-preset');
  const latInput = document.getElementById('field-lat');
  const lonInput = document.getElementById('field-lon');

  MALAYSIA_PRESETS.forEach((p, i) => preset.add(new Option(p.name, String(i))));

  preset.addEventListener('change', () => {
    const p = MALAYSIA_PRESETS[Number(preset.value)];
    if (!p || preset.value === '') return;
    selectField(p.lat, p.lon, { fromClick: true });
  });

  form.addEventListener('submit', e => {
    e.preventDefault();
    const lat = parseCoord(latInput.value, 'N', 'S');
    const lon = parseCoord(lonInput.value, 'E', 'W');
    if (lat === null || lat < -90 || lat > 90) {
      setFieldError('Latitude must be a number from −90 to 90 (north is positive).', latInput);
      return;
    }
    if (lon === null || lon < -180 || lon > 180) {
      setFieldError('Longitude must be a number from −180 to 180 (east is positive).', lonInput);
      return;
    }
    selectField(Number(lat.toFixed(4)), Number(lon.toFixed(4)), { fromClick: true });
  });

  // Clear the error as soon as the user edits the field.
  [latInput, lonInput].forEach(el => el.addEventListener('input', () => {
    if (el.getAttribute('aria-invalid')) setFieldError(null);
  }));
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
  // Bold the place name inside Role 3's headline template.
  const [before, after = ''] = copy('reveal.headline_template', 'Your field in 2045 is {twin_place} today.').split('{twin_place}');
  const subline = copy('reveal.subline');
  const matchHelp = copy('tooltips.match_score');
  resultText.innerHTML = `
    <p class="reveal-headline">${escapeHtml(before)}<strong>${escapeHtml(twin.place)}</strong>${escapeHtml(after)}</p>
    ${subline ? `<p class="reveal-subline">${escapeHtml(subline)}</p>` : ''}
    <p class="reveal-detail"><span class="reveal-hint" ${matchHelp ? `title="${escapeHtml(matchHelp)}" tabindex="0"` : ''}>Climate match: ${pct(twin.match_score)}%${matchHelp ? ' ⓘ' : ''}</span></p>
  `;
  resultText.classList.add('is-visible');
  setExportReady(true);
}

async function mapReveal(data, token) {
  const { field, twin } = data;
  const map = state.revealMap;
  const layer = state.revealLayer;

  cancelArcAnimation(); // story mode can replay the reveal mid-animation
  layer.clearLayers();

  addMarker(layer, [field.lat, field.lon], 'field', {
    tooltip: `<b>${escapeHtml(field.name)}</b><br>${escapeHtml(copy('reveal.field_label', 'Your field'))}`,
    popup: `<b>${escapeHtml(field.name)}</b><br>${escapeHtml(copy('reveal.field_label', 'Your field'))}`
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
  arc.bindTooltip(distanceLabel(twin), {
    sticky: true,
    className: 'ct-tooltip'
  });
  arc.on('mouseover', () => arc.setStyle({ weight: 6 }));
  arc.on('mouseout', () => arc.setStyle({ weight: 3 }));

  await animateArc(arc, arcPoints([field.lat, field.lon], [twin.lat, twin.lon]));
  if (token !== state.revealToken) return;

  addMarker(layer, [twin.lat, twin.lon], 'twin', {
    pop: true,
    tooltip: `<b>${escapeHtml(twin.place)}</b><br>${escapeHtml(copy('reveal.twin_label', 'Your 2045 climate twin'))}`,
    popup: `<b>${escapeHtml(twin.place)}</b><br>${escapeHtml(copy('reveal.twin_label', 'Your 2045 climate twin'))}<br>` +
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
    globe = Globe({
      animateIn: !prefersReducedMotion,
      // Keep the last frame readable so "Download image" can copy it.
      rendererConfig: { antialias: true, alpha: true, preserveDrawingBuffer: true }
    })(el)
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
    el: globeMarker('field', `<b>${escapeHtml(field.name)}</b><br>${escapeHtml(copy('reveal.field_label', 'Your field'))}`)
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
  const label = distanceLabel(twin);
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
    el: globeMarker('twin', `<b>${escapeHtml(twin.place)}</b><br>${escapeHtml(copy('reveal.twin_label', 'Your 2045 climate twin'))} · ${pct(twin.match_score)}% match`, { pop: true })
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
        <th>${escapeHtml(copy('honesty_panel.columns.signature', 'Signature'))}</th>
        <th>${escapeHtml(copy('honesty_panel.columns.field_2045', 'Your Field (2045)'))}</th>
        <th>${escapeHtml(copy('honesty_panel.columns.twin_now', 'Twin (Today)'))}</th>
        <th>Difference</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tbody = table.querySelector('tbody');
  for (const key of Object.keys(SIGNATURES)) {
    const label = escapeHtml(sigLabel(key));
    const { what, why } = sigTip(key);
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
          ${what ? `<span class="sig-tip-what">${escapeHtml(what)}</span>` : ''}
          <strong class="sig-tip-why">${escapeHtml(why)}</strong>
        </span>
      </td>
      <td>${fmt(fieldVal, digits)}</td>
      <td>${fmt(twinVal, digits)}</td>
      <td>${fmt(diff, digits)}</td>
    `;
    tbody.appendChild(row);
  }

  renderRadar(data);
}

// ---------- Radar chart (Compare climates) ----------

const RADAR_SERIES = [
  { key: 'now', label: 'Your field today', color: '46, 158, 91', dash: [6, 4] },
  { key: '2045', label: 'Your field in 2045', color: '232, 137, 12', dash: [] },
  { key: 'twin', label: 'Twin today', color: '214, 40, 57', dash: [] }
];

// Puts a value on its spoke's 0–1 scale, clamped so outliers stay on the chart.
function radarScale(key, value) {
  if (typeof value !== 'number') return null;
  const [lo, hi] = RADAR_RANGES[key];
  return Math.min(1, Math.max(0, (value - lo) / (hi - lo)));
}

function renderRadar(data) {
  const keys = Object.keys(SIGNATURES);
  const sources = { now: data.signature_now, '2045': data.signature_2045, twin: data.twin.signature };
  const datasets = RADAR_SERIES.map(series => {
    const raw = keys.map(k => (sources[series.key] || {})[k]);
    return {
      label: series.label,
      raw,                                   // real values, for the tooltip
      data: keys.map((k, i) => radarScale(k, raw[i])),
      borderColor: `rgb(${series.color})`,
      backgroundColor: `rgba(${series.color}, 0.14)`,
      borderDash: series.dash,
      borderWidth: 2.5,
      pointBackgroundColor: `rgb(${series.color})`,
      pointRadius: 3.5,
      pointHoverRadius: 7
    };
  });

  if (state.radar) {
    state.radar.data.datasets = datasets;
    state.radar.update();
    return;
  }

  const ink = '#0b2545';
  state.radar = new Chart(document.getElementById('radar-chart'), {
    type: 'radar',
    data: {
      // Short spoke labels; the table has the full names.
      labels: ['Mean temp', 'Growing degree days', 'Rainfall', 'Wet season share',
        'Longest dry spell', 'Heat stress days', 'Solar radiation', 'Coldest month'],
      datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 1,
      animation: prefersReducedMotion ? false : { duration: 900 },
      scales: {
        r: {
          min: 0,
          max: 1,
          ticks: { display: false, stepSize: 0.25 },
          grid: { color: 'rgba(11, 37, 69, 0.15)' },
          angleLines: { color: 'rgba(11, 37, 69, 0.2)' },
          pointLabels: { color: ink, font: { size: 13, weight: '600' } }
        }
      },
      plugins: {
        legend: { position: 'bottom', labels: { color: ink, font: { size: 13 }, usePointStyle: true } },
        tooltip: {
          callbacks: {
            label: ctx => {
              const key = keys[ctx.dataIndex];
              const digits = { gdd: 0, rain_mm: 0, dry_spell_days: 0, heat_days: 0, wet_share: 2 }[key] ?? 1;
              return `${ctx.dataset.label}: ${fmt(ctx.dataset.raw[ctx.dataIndex], digits)}`;
            },
            title: items => sigLabel(keys[items[0].dataIndex])
          }
        }
      }
    }
  });
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
    fill(copy('crops_there.title', "Crops suited to {twin_place}'s climate"), { twin_place: data.twin.place });

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
      <p class="crop-note">${escapeHtml(prettyUnits(crop.note || ''))}</p>
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
    tooltip: `<b>${escapeHtml(copy('drift.twin_1995_label', 'Twin in 1995'))}</b><br>${escapeHtml(twin_1995.place)}`
  });
  addMarker(state.driftLayer, [twin.lat, twin.lon], 'twin', {
    tooltip: `<b>${escapeHtml(copy('drift.twin_now_label', 'Twin today'))}</b><br>${escapeHtml(twin.place)}`
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
    fill(copy('drift.template', "In climate terms, your field's twin has drifted {drift_km} km since 1995."), { drift_km: twin_1995.drift_km });
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
          title: { display: true, text: copy('transition.y_axis', 'Viability Score') }
        },
        x: {
          title: { display: true, text: copy('transition.x_axis', 'Year') }
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

// ---------- Download image and print report ----------

const SNAPSHOT_W = 1200;
const SNAPSHOT_H = 630;   // standard social-media preview size
const SNAPSHOT_FONT = "'Avenir Next', Avenir, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";

function setExportReady(ready) {
  for (const id of ['download-image', 'print-report']) {
    document.getElementById(id).disabled = !ready;
  }
}

// Wraps text into lines that fit maxWidth. Returns the y after the last line.
function drawWrapped(ctx, text, x, y, maxWidth, lineHeight) {
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y);
      line = word;
      y += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, y);
  return y + lineHeight;
}

function drawPin(ctx, x, y, color) {
  ctx.beginPath();
  ctx.arc(x, y, 9, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
}

function canRead(canvas) {
  try {
    canvas.getContext('2d').getImageData(0, 0, 1, 1);
    return true;
  } catch {
    return false; // a cross-origin image made the canvas unreadable
  }
}

// The visible map tiles can't be copied into a picture unless the tile server
// allows it (CORS). Re-request copies that ask for permission; if any copy
// fails, return null and the picture is drawn without the map background.
async function loadCorsTiles() {
  const box = document.getElementById('map').getBoundingClientRect();
  const tiles = [...document.querySelectorAll('#map img.leaflet-tile-loaded')];
  const loaded = await Promise.all(tiles.map(tile => new Promise(resolve => {
    const r = tile.getBoundingClientRect();
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const timer = setTimeout(() => resolve(null), 4000);
    img.onload = () => { clearTimeout(timer); resolve({ img, x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height }); };
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    img.src = tile.src;
  })));
  return loaded.length && loaded.every(Boolean) ? loaded : null;
}

// Draws the current globe or flat map into a canvas the size of its box,
// with pins (and on the flat map, the arc) drawn on top.
function captureView(data, corsTiles) {
  const { field, twin } = data;
  const el = document.getElementById(state.view === 'globe' ? 'globe-view' : 'map');
  const w = el.clientWidth;
  const h = el.clientHeight;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  let tilesIncluded = true;
  const pins = [];

  if (state.view === 'globe') {
    ctx.drawImage(state.globe.renderer().domElement, 0, 0, w, h);
    if (!canRead(out)) {
      ctx.clearRect(0, 0, w, h);
      tilesIncluded = false;
    }
    for (const [p, color] of [[field, '#2ed573'], [twin, '#ff6b6b']]) {
      const c = state.globe.getScreenCoords(p.lat, p.lon, 0.01);
      if (c) { drawPin(ctx, c.x, c.y, color); pins.push(c); }
    }
  } else {
    const map = state.revealMap;
    if (corsTiles) {
      ctx.fillStyle = '#aad3df'; // OpenStreetMap's sea colour
      ctx.fillRect(0, 0, w, h);
      corsTiles.forEach(t => ctx.drawImage(t.img, t.x, t.y, t.w, t.h));
    }
    if (!corsTiles || !canRead(out)) {
      ctx.fillStyle = '#16325c';
      ctx.fillRect(0, 0, w, h);
      tilesIncluded = false;
    }
    const pts = arcPoints([field.lat, field.lon], [twin.lat, twin.lon])
      .map(p => map.latLngToContainerPoint(p));
    ctx.setLineDash([10, 10]);
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#ff6b6b';
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
    ctx.setLineDash([]);
    const a = map.latLngToContainerPoint([field.lat, field.lon]);
    const b = map.latLngToContainerPoint([twin.lat, twin.lon]);
    drawPin(ctx, a.x, a.y, '#2ed573');
    drawPin(ctx, b.x, b.y, '#ff6b6b');
    pins.push(a, b);
  }
  // Centre of the pins, so the picture can be cropped around them.
  const focus = pins.length
    ? { x: pins.reduce((t, p) => t + p.x, 0) / pins.length, y: pins.reduce((t, p) => t + p.y, 0) / pins.length }
    : { x: w / 2, y: h / 2 };
  return { canvas: out, tilesIncluded, focus };
}

// Builds a 1200×630 summary card: the map on the left, the result on the right.
function composeSnapshot(data, corsTiles = null) {
  const { field, twin, twin_1995: past } = data;
  const canvas = document.createElement('canvas');
  canvas.width = SNAPSHOT_W;
  canvas.height = SNAPSHOT_H;
  const ctx = canvas.getContext('2d');

  // Space background with a few stars
  const bg = ctx.createLinearGradient(0, 0, SNAPSHOT_W, SNAPSHOT_H);
  bg.addColorStop(0, '#060824');
  bg.addColorStop(1, '#0d1a40');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, SNAPSHOT_W, SNAPSHOT_H);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
  for (let i = 0; i < 90; i++) {
    ctx.fillRect((i * 389) % SNAPSHOT_W, (i * 241) % SNAPSHOT_H, i % 3 === 0 ? 2 : 1, i % 3 === 0 ? 2 : 1);
  }

  // Map panel: crop the view to fill the box ("cover")
  const px = 36, py = 36, pw = 640, ph = SNAPSHOT_H - 72;
  const { canvas: view, tilesIncluded, focus } = captureView(data, corsTiles);
  const scale = Math.max(pw / view.width, ph / view.height);
  const sw = pw / scale, sh = ph / scale;
  // Crop around the pins, but never past the edge of the view.
  const sx = Math.min(view.width - sw, Math.max(0, focus.x - sw / 2));
  const sy = Math.min(view.height - sh, Math.max(0, focus.y - sh / 2));
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(px, py, pw, ph, 18);
  ctx.clip();
  ctx.fillStyle = '#02030c';
  ctx.fillRect(px, py, pw, ph);
  ctx.drawImage(view, sx, sy, sw, sh, px, py, pw, ph);
  ctx.restore();
  ctx.strokeStyle = 'rgba(127, 220, 255, 0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(px, py, pw, ph, 18);
  ctx.stroke();

  // Text panel
  const tx = 716, tw = SNAPSHOT_W - tx - 40;
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#9ff0c8';
  ctx.font = `800 26px ${SNAPSHOT_FONT}`;
  ctx.fillText(copy('app_name', 'Climate Twin').toUpperCase(), tx, 48);

  ctx.fillStyle = '#e8eefc';
  ctx.font = `500 26px ${SNAPSHOT_FONT}`;
  let y = drawWrapped(ctx, `${field.name} in 2045 is`, tx, 104, tw, 34);
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 44px ${SNAPSHOT_FONT}`;
  y = drawWrapped(ctx, twin.place, tx, y + 2, tw, 50);
  ctx.fillStyle = '#e8eefc';
  ctx.font = `500 26px ${SNAPSHOT_FONT}`;
  y = drawWrapped(ctx, 'today.', tx, y, tw, 34);

  ctx.fillStyle = '#ffd166';
  ctx.font = `700 24px ${SNAPSHOT_FONT}`;
  y = drawWrapped(ctx, `Climate match: ${pct(twin.match_score)}%`, tx, y + 14, tw, 32);

  ctx.fillStyle = '#c9d6f5';
  ctx.font = `400 19px ${SNAPSHOT_FONT}`;
  const lines = [
    `Field: ${field.lat.toFixed(2)}, ${field.lon.toFixed(2)}`,
    `Twin: ${twin.lat.toFixed(2)}, ${twin.lon.toFixed(2)} · ${twin.distance_km ?? '?'} km away`
  ];
  if (past && typeof past.drift_km === 'number') {
    lines.push(`Twin has drifted ${past.drift_km} km since 1995`);
  }
  const crops = (data.crops_there || []).map(c => c.name).filter(Boolean);
  if (crops.length) lines.push(`Suited to its climate: ${crops.slice(0, 4).join(', ')}`);
  for (const line of lines) y = drawWrapped(ctx, line, tx, y + 6, tw, 26);

  ctx.fillStyle = 'rgba(201, 214, 245, 0.75)';
  ctx.font = `400 15px ${SNAPSHOT_FONT}`;
  const date = new Date().toISOString().slice(0, 10);
  let foot = drawWrapped(ctx,
    `${copy('data_credit', 'Climate data: NASA POWER.')} ~50 km grid. Linear trend, not a forecast. Check with a local agricultural adviser.`,
    tx, SNAPSHOT_H - 104, tw, 20);
  drawWrapped(ctx, `Made ${date}${tilesIncluded ? '' : ' · map background not included'}`, tx, foot, tw, 20);
  return canvas;
}

function snapshotFilename(data) {
  const place = String(data.twin.place || 'twin').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `climate-twin-${place}-${new Date().toISOString().slice(0, 10)}.png`;
}

async function snapshotNow() {
  const tiles = state.view === 'map' ? await loadCorsTiles() : null;
  return composeSnapshot(state.data, tiles);
}

async function downloadImage() {
  if (!state.data) return;
  const button = document.getElementById('download-image');
  button.disabled = true;
  const canvas = await snapshotNow();
  button.disabled = !state.data;
  canvas.toBlob(blob => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = snapshotFilename(state.data);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}

// Before printing: put the snapshot at the top and open every screen so the
// report has everything. Afterwards, put the screens back as they were.
const printState = { prepared: false, wasOpen: [] };

// snapshot is passed in by the Print button; Ctrl/Cmd+P can't wait, so it
// builds one straight away (flat map drawn without its background).
function prepareForPrint(snapshot) {
  if (printState.prepared || !state.data) return;
  printState.prepared = true;
  const { field, twin } = state.data;
  const canvas = snapshot instanceof HTMLCanvasElement ? snapshot : composeSnapshot(state.data);
  document.getElementById('print-snapshot').src = canvas.toDataURL('image/png');
  document.getElementById('print-meta').textContent =
    `${field.name} (${field.lat.toFixed(2)}, ${field.lon.toFixed(2)}). Climate twin: ${twin.place}. ` +
    (state.live
      ? 'Live result from the Climate Twin engine. '
      : 'Demo data: the engine was not connected, so this is the example result. ') +
    `Printed ${new Date().toLocaleString()}.`;

  printState.wasOpen = [...document.querySelectorAll('.optional')].filter(s => !s.hidden).map(s => s.id);
  document.body.classList.add('printing');
  document.querySelectorAll('.optional').forEach(section => {
    section.hidden = false;
    section.classList.add('is-visible');
    renderScreen(section.id);
  });
  // Chart.js doesn't resize for print by itself; give the radar its paper size
  // (matches .radar-panel's print width minus padding; square, like on screen).
  if (state.radar) state.radar.resize(528, 528);
}

function restoreAfterPrint() {
  if (!printState.prepared) return;
  printState.prepared = false;
  document.body.classList.remove('printing');
  if (state.radar) state.radar.resize(); // back to fitting its box
  document.querySelectorAll('.optional').forEach(section => {
    if (!printState.wasOpen.includes(section.id)) {
      section.classList.remove('is-visible');
      section.hidden = true;
    }
  });
}

async function printReport() {
  if (!state.data) return;
  prepareForPrint(await snapshotNow());
  const img = document.getElementById('print-snapshot');
  try { await img.decode(); } catch { /* print anyway */ }
  window.print();
}

function initExport() {
  document.getElementById('download-image').addEventListener('click', downloadImage);
  document.getElementById('print-report').addEventListener('click', printReport);
  // Also handle Ctrl/Cmd+P from the browser menu.
  window.addEventListener('beforeprint', prepareForPrint);
  window.addEventListener('afterprint', restoreAfterPrint);
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

async function init() {
  await loadUiCopy();   // Role 3's wording, before anything is drawn
  initScenes();
  initRevealMap();   // create the flat map while its box is still visible
  initViews();       // then add the 3D globe and pick the starting view
  initFieldForm();
  document.getElementById('use-demo').addEventListener('click', () => selectField(DEMO_FIELD.lat, DEMO_FIELD.lon));
  initExport();
  initToggles();
  initStory();
  selectField(DEMO_FIELD.lat, DEMO_FIELD.lon);
}

init();
