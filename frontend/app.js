// Climate Twin front-end.
// Loads the live API if it's running. If it isn't, it falls back to real,
// precomputed engine output: data/malaysia_states.json (one result per preset)
// and data/demo_field.json (the Kedah demo field).

const API_URL = 'http://localhost:8000/twin';
const API_TIMEOUT_MS = 15000;
// Each file is tried at these paths in order. '../data/' works when the server
// root is the project folder. './' works when the server root is the frontend
// folder (python -m http.server 3000 --directory frontend), using the copy kept there.
const DEMO_FIELD_PATHS = ['../data/demo_field.json', './demo_field.json'];
const STATE_PRESETS_PATHS = ['../data/malaysia_states.json', './malaysia_states.json'];
const CROPS_PATHS = ['../data/crops.json', './crops.json'];
// A clicked or typed point counts as a preset when it is within this many degrees
// of the preset's coordinates (0.01 degrees is about 1 km).
const PRESET_MATCH_TOLERANCE_DEG = 0.01;
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

// Chart display scale: each bar runs from a low to a high value for
// farmland. Display only; it doesn't affect matching. Swap in the global
// grid's min/max when the engine provides them.
const DISPLAY_RANGES = {
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
  compare: null,
  view: 'map',        // 'globe' or 'map'
  loading: false,     // a lookup is in progress
  pending: null,      // { lat, lon } being looked up
  dataId: 0,          // requestId that produced state.data
  resultShown: false, // the reveal for state.data finished drawing
  arcResolve: null,   // lets a cancelled arc animation finish its promise
  revealToken: 0,     // drops reveal animations that a newer reveal replaced
  globe: null,
  globeIntroDone: false,
  globeTimers: []
};

// ---------- UI copy (written by Role 3 in ui_copy.json) ----------

let COPY = {};
let CROPS = [];      // Role 3's crop knowledge base (data/crops.json)
let cropTimer = null;

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
// Only temperatures with two digits ("10C", "~35C") are converted, so text
// like "Phase 2C" is left alone; "(C)" only when it isn't a copyright line.
function prettyUnits(text) {
  return String(text)
    .replace(/\(C\)(?!\s*\d)/g, '(°C)')
    .replace(/(^|[^\w.])(\d{2})C\b/g, '$1$2°C')
    .replace(/MJ\/m2\b/g, 'MJ/m²');
}

// Role 3's crop list, used for the header crop rotation (and later the engine).
async function loadCrops() {
  try {
    const list = await fetchJsonFromFirst(CROPS_PATHS);
    if (Array.isArray(list)) CROPS = list;
  } catch (err) {
    console.warn('crops.json not loaded; using built-in crop set', err);
  }
}

async function loadUiCopy() {
  try {
    const json = await fetchJsonFromFirst(['../data/ui_copy.json', './ui_copy.json']); // same order as the other data files
    if (!isObj(json)) throw new Error('ui_copy.json is not an object');
    COPY = json;
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

// Distances come from the engine: round them and never put raw values in HTML.
function km(value) {
  return isNum(value) ? Math.round(value).toLocaleString('en-US') : '?';
}

function distanceLabel(twin) {
  const help = copy('tooltips.distance_km');
  return `<b>${km(twin.distance_km)} km</b> to your climate twin${help ? `<br>${escapeHtml(help)}` : ''}`;
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

// The longitude for `lon` that is within 180° of `fromLon` (may be outside
// −180…180), so a line from fromLon takes the short way across the date line.
function nearLon(fromLon, lon) {
  if (lon - fromLon > 180) return lon - 360;
  if (fromLon - lon > 180) return lon + 360;
  return lon;
}

// Points along a gentle curve between two locations (quadratic Bézier).
function arcPoints(from, to, segments = 80) {
  let [lat1, lon1] = from;
  const lat2 = to[0];
  const lon2 = nearLon(lon1, to[1]); // short way round across the date line

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
  // Let whoever was waiting carry on (their token check then stops them).
  if (state.arcResolve) {
    state.arcResolve();
    state.arcResolve = null;
  }
}

// Draws the line progressively. Resolves when finished.
function animateArc(line, points) {
  return new Promise(done => {
    const resolve = () => { state.arcResolve = null; done(); };
    state.arcResolve = resolve;
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

// Returns the JSON from the first path that answers. Throws, naming every
// path tried, if none do.
async function fetchJsonFromFirst(paths) {
  const failures = [];
  for (const path of paths) {
    try {
      const res = await fetch(path);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      failures.push(`${path} (${err.message})`);
    }
  }
  throw new Error(`could not load any of: ${failures.join(', ')}`);
}
// The Kedah demo field: the response of the real engine, frozen by engine.export_presets.
let demoFieldPromise = null;
function loadDemoField() {
  if (!demoFieldPromise) {
    demoFieldPromise = fetchJsonFromFirst(DEMO_FIELD_PATHS);
    demoFieldPromise.catch(() => { demoFieldPromise = null; }); // allow retry
  }
  return demoFieldPromise;
}
// The saved engine result for every preset. Optional: if the file is missing we
// still have the demo field, so a failure here is logged and gives an empty list.
let statePresetsPromise = null;
function loadStatePresets() {
  if (!statePresetsPromise) {
    statePresetsPromise = fetchJsonFromFirst(STATE_PRESETS_PATHS)
      .then(file => (Array.isArray(file?.states) ? file.states : []))
      .catch(err => {
        console.warn('malaysia_states.json not loaded; only the demo field is available offline', err);
        statePresetsPromise = null; // allow retry
        return [];
      });
  }
  return statePresetsPromise;
}
// The saved engine response for the preset at (lat, lon), or null if it is not a preset.
function findPresetResponse(presets, lat, lon) {
  const match = presets.find(p =>
    isNum(p?.lat) && isNum(p?.lon) &&
    Math.abs(p.lat - lat) <= PRESET_MATCH_TOLERANCE_DEG &&
    Math.abs(p.lon - lon) <= PRESET_MATCH_TOLERANCE_DEG);
  return match ? match.response : null;
}
// Offline answer for (lat, lon): the saved preset result if the point is a preset,
// otherwise the Kedah demo field. `source` says which one, so the page can say so.
async function loadFallback(lat, lon) {
  const preset = normaliseTwin(findPresetResponse(await loadStatePresets(), lat, lon));
  if (preset) return { data: preset, source: 'preset' };
  const demo = normaliseTwin(await loadDemoField());
  if (!demo) throw new Error('demo_field.json is missing the field or twin location');
  return { data: demo, source: 'demo' };
}

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isPoint = p => !!p && isNum(p.lat) && isNum(p.lon);
const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);

// Checks the parts the reveal can't do without, and tidies the optional
// parts so a missing or wrong-typed one can't break the page.
// Returns the cleaned data, or null if the core is unusable.
function normaliseTwin(raw) {
  if (!isObj(raw) || !isPoint(raw.field) || !isPoint(raw.twin)) return null;
  const twin = { ...raw.twin, place: String(raw.twin.place ?? '').trim() || 'an unnamed place' };
  if (!isObj(twin.signature)) twin.signature = {};
  return {
    ...raw,
    field: { ...raw.field, name: String(raw.field.name ?? '').trim() || 'Your field' },
    twin,
    signature_now: isObj(raw.signature_now) ? raw.signature_now : {},
    signature_2045: isObj(raw.signature_2045) ? raw.signature_2045 : {},
    twin_1995: isObj(raw.twin_1995) ? raw.twin_1995 : null,
    twin_now: isPoint(raw.twin_now) ? raw.twin_now : null,
    crops_there: Array.isArray(raw.crops_there) ? raw.crops_there.filter(isObj) : [],
    current_crop_viability: Array.isArray(raw.current_crop_viability)
      ? raw.current_crop_viability.filter(v => isObj(v) && isNum(v.score)) : [],
    caveats: Array.isArray(raw.caveats) ? raw.caveats.map(String) : []
  };
}

async function getTwin(lat, lon) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  let invalid = false;
  try {
    const res = await fetch(`${API_URL}?lat=${lat}&lon=${lon}`, { signal: controller.signal });
    if (!res.ok) throw new Error(res.status);
    // From here on the engine did answer, so any problem means a bad answer.
    invalid = true;
    const data = normaliseTwin(await res.json());
    if (data) return { data, live: true };
    throw new Error('engine answer is missing the field or twin location');
  } catch (err) {
    console.warn('API failed, using saved engine data (malaysia_states.json / demo_field.json)', err);
    const { data, source } = await loadFallback(lat, lon);
    return { data, live: false, invalid, source };
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
  state.loading = true;
  state.pending = { lat, lon };
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
    state.loading = false;
    state.resultShown = false; // the old result is no longer on screen
    setLoading(false);
    document.getElementById('result-text').innerHTML =
      '<p class="reveal-detail">Could not load any data. Open this page through a local server ' +
      '(<code>python3 -m http.server 3000</code>), not by double-clicking the file.</p>';
    setStatus('Data failed to load.', 'error');
    return;
  }
  if (id !== state.requestId) return; // a newer click replaced this one

  state.loading = false;
  setLoading(false);
  state.data = result.data;
  state.dataId = id;
  state.resultShown = false;
  state.live = result.live;

  if (result.invalid) {
    setStatus('The engine sent an incomplete answer, so this shows saved engine data instead.', 'error');
  } else if (result.live) {
    setStatus('Live result from the Climate Twin engine. Click the map to try another field.');
  } else if (result.source === 'preset') {
    setStatus('The engine isn\'t running, so this shows the saved engine result for the preset you chose.', 'warn');
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
  renderCaveats(role3Caveats.length ? role3Caveats : state.data.caveats);
  refreshOpenScreens();
  await renderReveal(state.data, id);
}

// Re-draws the current result (view switch, story mode) only when it is
// still the one on screen. While loading, it re-shows the pending pin instead.
function replayReveal() {
  if (state.loading) {
    if (state.pending) showPendingField(state.pending.lat, state.pending.lon);
    return;
  }
  // dataId !== requestId means the latest lookup failed: keep its error showing.
  if (state.data && state.dataId === state.requestId) {
    renderReveal(state.data, state.dataId);
  }
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
    if (/^[+-]/.test(t)) return null; // "-6 S" is ambiguous
  }
  // Allows "+6.12", ".5" and "6." as well as "6.12".
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return null;
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
  if (state.view === 'globe' && state.globe) {
    globePendingField(lat, lon, label);
  } else if (state.revealLayer) {
    state.revealLayer.clearLayers();
    addMarker(state.revealLayer, [lat, lon], 'field', { tooltip: label });
  }
}

async function renderReveal(data, id) {
  const token = ++state.revealToken;
  const resultText = document.getElementById('result-text');
  resultText.classList.remove('is-visible');
  setExportReady(false);

  try {
    if (state.view === 'globe') await globeReveal(data, token);
    else await mapReveal(data, token);
  } catch (err) {
    console.error('Reveal failed to draw', err);
    if (id !== state.requestId || token !== state.revealToken) return;
    resultText.innerHTML = '<p class="reveal-detail">Something went wrong drawing this result.</p>';
    resultText.classList.add('is-visible');
    setStatus('This result could not be drawn. Try another field.', 'error');
    return;
  }

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
  state.resultShown = true;
  setExportReady(true);
}

async function mapReveal(data, token) {
  const { field } = data;
  // Same longitude the arc uses, so the pin sits at the arc's end.
  const twin = { ...data.twin, lon: nearLon(data.field.lon, data.twin.lon) };
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
    const entry = { resolve };
    entry.timer = setTimeout(() => {
      state.globeTimers = state.globeTimers.filter(e => e !== entry);
      resolve();
    }, ms);
    state.globeTimers.push(entry);
  });
}

// Stops pending waits early; the waiting reveal then sees its token is stale.
function clearGlobeTimers() {
  const pending = state.globeTimers;
  state.globeTimers = [];
  pending.forEach(e => { clearTimeout(e.timer); e.resolve(); });
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
  // Clamp so the camera never tips over a pole.
  const view = { lat: Math.max(-85, Math.min(85, mid.lat + 4 + mid.degrees * 0.15)), lng: mid.lon, altitude };

  if (prefersReducedMotion) {
    globe.pointOfView(view, 0);
  } else if (!state.globeIntroDone) {
    // First time: start far out, a third of the way round, and swoop in.
    globe.pointOfView({ lat: Math.max(-85, view.lat - 10), lng: view.lng - 120, altitude: 3.2 }, 0);
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

  if (replay) replayReveal();
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

// Short everyday names for the chart. The table keeps the fuller labels.
const PLAIN_NAMES = {
  mean_temp: 'Average temperature',
  gdd: 'Warmth for crop growth',
  rain_mm: 'Yearly rain',
  wet_share: 'Rain in the wet season',
  dry_spell_days: 'Longest dry spell',
  heat_days: 'Very hot days',
  solar: 'Sunshine',
  cold_month: 'Coldest month'
};

// Counts are whole numbers; wet_share is a 0–1 fraction.
const DIGITS = { gdd: 0, rain_mm: 0, dry_spell_days: 0, heat_days: 0, wet_share: 2 };
const sigDigits = key => DIGITS[key] ?? 1;

// A change smaller than `little` counts as "little change"; `big` or more is "a lot".
// Each size is in that value's own unit. These are display rules of thumb, not crop limits.
const CHANGE_BANDS = {
  mean_temp: { little: 0.15, big: 1.0, unit: '°C' },
  gdd: { little: 60, big: 400, unit: 'degree-days' },
  rain_mm: { little: 100, big: 500, unit: 'mm' },
  wet_share: { little: 0.02, big: 0.08, unit: '' },
  dry_spell_days: { little: 2, big: 7, unit: 'days' },
  heat_days: { little: 2, big: 10, unit: 'days' },
  solar: { little: 0.2, big: 1.0, unit: 'MJ/m²/day' },
  cold_month: { little: 0.2, big: 1.0, unit: '°C' }
};

// Plain-language pros and cons for each direction of change. `lean` says which way the
// balance tips for a typical farm: 'pro', 'con' or 'mixed'. General rules of thumb only.
const PROS_CONS = {
  mean_temp: {
    up: { lean: 'con', pro: 'Crops can grow and ripen a little faster.', con: 'Hotter days and nights add heat stress, so crops need more water and shade.' },
    down: { lean: 'pro', pro: 'Less heat stress on crops and on people working the field.', con: 'Growth can slow, so crops may take longer to be ready.' }
  },
  gdd: {
    up: { lean: 'mixed', pro: 'More warmth to ripen crops, so seasons can get shorter.', con: 'Faster ripening can leave less time to fill grain or fruit.' },
    down: { lean: 'mixed', pro: 'Cooler seasons ease heat stress.', con: 'Crops need longer to mature, so the season stretches.' }
  },
  rain_mm: {
    up: { lean: 'mixed', pro: 'More natural water, so less irrigation is needed.', con: 'Wetter spells raise the risk of waterlogging, flooding and crop disease.' },
    down: { lean: 'con', pro: 'Fields stay drier, which makes field work and harvest easier.', con: 'Less natural water, so irrigation costs and drought risk go up.' }
  },
  wet_share: {
    up: { lean: 'con', pro: 'Wet-season rain is easier to plan around.', con: 'More rain falls in a short, heavy season, leaving longer dry stretches outside it.' },
    down: { lean: 'pro', pro: 'Rain is spread more evenly through the year.', con: 'The wet season is a weaker signal, so planting dates are harder to time.' }
  },
  dry_spell_days: {
    up: { lean: 'con', pro: 'Dry weeks help with harvesting and drying grain.', con: 'Longer gaps between rains can stress crops, so you may need to irrigate.' },
    down: { lean: 'pro', pro: 'Fewer long gaps without rain, so crops get steadier water.', con: 'Less dry weather makes it harder to harvest and dry crops.' }
  },
  heat_days: {
    up: { lean: 'con', pro: 'Little upside, apart from faster drying of harvested crops.', con: 'More days above 35 °C can stop rice, maize and vegetables from setting grain or fruit.' },
    down: { lean: 'pro', pro: 'Fewer damaging days, so crops set grain or fruit more reliably.', con: 'No real downside.' }
  },
  solar: {
    up: { lean: 'pro', pro: 'More sunlight for photosynthesis, which supports growth.', con: 'Soil and crops lose water faster in strong sun.' },
    down: { lean: 'con', pro: 'Less water is lost to the sun, so soil stays moist longer.', con: 'Less sunlight can slow growth, especially in cloudy wet seasons.' }
  },
  cold_month: {
    up: { lean: 'pro', pro: 'Tropical tree crops are safer from cool spells.', con: 'Crops that need a cool spell to flower may do worse.' },
    down: { lean: 'con', pro: 'More cool nights help some crops to flower.', con: 'Cold can damage tropical tree crops such as oil palm and durian.' }
  }
};
const STEADY_TEXT = 'No big change from today, so your current routine should still fit.';
const LEAN_TEXT = { pro: 'Mostly better', con: 'Mostly harder', mixed: 'Mixed' };
const ARROW = { up: '▲', down: '▼', steady: '=' };

// Direction and size of the change from today to 2045 for one value, or null if either is missing.
function changeOf(key, now, future) {
  if (!isNum(now) || !isNum(future)) return null;
  const delta = future - now;
  const band = CHANGE_BANDS[key];
  const size = Math.abs(delta);
  const direction = size < band.little ? 'steady' : (delta > 0 ? 'up' : 'down');
  return { delta, direction, big: size >= band.big };
}

// The "Pros & Cons" cell: a status tag (words and an arrow, not colour alone), then one pro and one con.
function prosConsCell(key, change) {
  if (!change) return '<span class="chip chip--steady">No data</span>';
  if (change.direction === 'steady') {
    return `<span class="chip chip--steady">${ARROW.steady} Little change</span>
      <p class="pc-line">${escapeHtml(STEADY_TEXT)}</p>`;
  }
  const rule = PROS_CONS[key][change.direction];
  const move = (change.direction === 'up' ? 'Rising' : 'Falling') + (change.big ? ' a lot' : '');
  return `<span class="chip chip--${rule.lean}">${ARROW[change.direction]} ${move} · ${LEAN_TEXT[rule.lean]}</span>
    <p class="pc-line pc-pro"><b>Pro:</b> ${escapeHtml(rule.pro)}</p>
    <p class="pc-line pc-con"><b>Con:</b> ${escapeHtml(rule.con)}</p>`;
}

function renderHonestyPanel(data) {
  const { signature_now, signature_2045, twin } = data;
  const table = document.getElementById('signature-table');

  table.innerHTML = `
    <thead>
      <tr>
        <th>${escapeHtml(copy('honesty_panel.columns.signature', 'Signature'))}</th>
        <th>Today (2025)</th>
        <th>${escapeHtml(copy('honesty_panel.columns.field_2045', 'Your Field (2045)'))}</th>
        <th>${escapeHtml(copy('honesty_panel.columns.twin_now', 'Twin (Today)'))}</th>
        <th>Gap to twin</th>
        <th class="proscons">Pros &amp; Cons (2025 vs 2045)</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tbody = table.querySelector('tbody');
  for (const key of Object.keys(SIGNATURES)) {
    const label = escapeHtml(sigLabel(key));
    const { what, why } = sigTip(key);
    const nowVal = (signature_now || {})[key];
    const fieldVal = signature_2045[key];
    const twinVal = twin.signature[key];
    const gap = isNum(fieldVal) && isNum(twinVal) ? Math.abs(fieldVal - twinVal) : null;
    const digits = sigDigits(key);

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
      <td>${fmt(nowVal, digits)}</td>
      <td>${fmt(fieldVal, digits)}</td>
      <td>${fmt(twinVal, digits)}</td>
      <td>${fmt(gap, digits)}</td>
      <td class="proscons">${prosConsCell(key, changeOf(key, nowVal, fieldVal))}</td>
    `;
    tbody.appendChild(row);
  }

  renderCompareChart(data);
}

// ---------- Comparison chart: today vs 2045, two bars per value ----------

const COMPARE_SERIES = [
  { key: 'now', label: 'Today', color: '46, 158, 91' },
  { key: '2045', label: '2045 trend', color: '232, 137, 12' }
];

// Puts a value on its bar's 0–1 scale, clamped so outliers stay on the chart.
function displayScale(key, value) {
  if (!isNum(value)) return null;
  const [lo, hi] = DISPLAY_RANGES[key];
  return Math.min(1, Math.max(0, (value - lo) / (hi - lo)));
}

function renderCompareChart(data) {
  const keys = Object.keys(SIGNATURES);
  const sources = { now: data.signature_now || {}, '2045': data.signature_2045 || {} };
  // Each name carries an arrow for the direction of change, so the chart reads at a glance.
  const labels = keys.map(k => {
    const change = changeOf(k, sources.now[k], sources['2045'][k]);
    return `${PLAIN_NAMES[k]} ${change ? ARROW[change.direction] : ''}`.trim();
  });
  const datasets = COMPARE_SERIES.map(series => {
    const raw = keys.map(k => sources[series.key][k]);
    return {
      label: series.label,
      raw,                                   // real values, for the tooltip
      data: keys.map((k, i) => displayScale(k, raw[i])),
      backgroundColor: `rgba(${series.color}, 0.9)`,
      borderRadius: 4,
      barPercentage: 0.85,
      categoryPercentage: 0.8
    };
  });

  if (state.compare) {
    state.compare.data.labels = labels;
    state.compare.data.datasets = datasets;
    state.compare.update();
    return;
  }

  const ink = '#0b2545';
  state.compare = new Chart(document.getElementById('compare-chart'), {
    type: 'bar',
    data: { labels, datasets },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: prefersReducedMotion ? false : { duration: 700 },
      scales: {
        x: {
          min: 0,
          max: 1,
          border: { display: false },
          grid: { color: 'rgba(11, 37, 69, 0.1)' },
          ticks: { display: false, stepSize: 0.5 }   // light lines at low / middle / high only
        },
        y: {
          border: { display: false },
          grid: { display: false },
          ticks: { color: ink, font: { size: 14, weight: '600' } }
        }
      },
      plugins: {
        legend: { position: 'top', align: 'start', labels: { color: ink, font: { size: 14 }, usePointStyle: true } },
        tooltip: {
          callbacks: {
            title: items => PLAIN_NAMES[keys[items[0].dataIndex]],
            label: ctx => {
              const key = keys[ctx.dataIndex];
              const value = fmt(ctx.dataset.raw[ctx.dataIndex], sigDigits(key));
              return `${ctx.dataset.label}: ${value} ${CHANGE_BANDS[key].unit}`.trim();
            }
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
  const { field, twin_1995: past, twin_now: now } = data;
  if (!isPoint(past)) throw new ScreenDataMissing('This result has no 1995 backtest yet.');

  if (!state.driftMap) {
    state.driftMap = L.map('drift-map').setView([field.lat, field.lon], 6);
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION }).addTo(state.driftMap);
    state.driftLayer = L.layerGroup().addTo(state.driftMap);
  }
  // The container was hidden until now, so Leaflet must re-measure it.
  state.driftMap.invalidateSize();
  state.driftLayer.clearLayers();

  const pastLon = nearLon(field.lon, past.lon);
  const points = [[field.lat, field.lon], [past.lat, pastLon]];
  addMarker(state.driftLayer, points[0], 'field', {
    tooltip: `<b>${escapeHtml(copy('reveal.field_label', 'Your field'))}</b>`
  });
  addMarker(state.driftLayer, points[1], 'past', {
    tooltip: `<b>${escapeHtml(copy('drift.twin_1995_label', 'Twin in 1995'))}</b><br>${escapeHtml(past.place ?? '')}`
  });

  // Today's twin is the match for the field's climate *now*. The main twin is
  // the match for 2045, so it isn't drawn here. Only draw the drift line when
  // the engine sends twin_now.
  if (now) {
    const nowPoint = [now.lat, nearLon(field.lon, now.lon)];
    points.push(nowPoint);
    addMarker(state.driftLayer, nowPoint, 'twin', {
      tooltip: `<b>${escapeHtml(copy('drift.twin_now_label', 'Twin today'))}</b><br>${escapeHtml(now.place ?? '')}`
    });
    L.polyline([points[1], nowPoint], { color: '#ffa502', weight: 3 })
      .bindTooltip(`<b>${km(past.drift_km)} km</b> of climate drift`, { sticky: true, className: 'ct-tooltip' })
      .addTo(state.driftLayer);
  }

  state.driftMap.fitBounds(points, { padding: [40, 40], maxZoom: 7 });

  document.getElementById('drift-text').textContent = isNum(past.drift_km)
    ? fill(copy('drift.template', "In climate terms, your field's twin has drifted {drift_km} km since 1995."), { drift_km: km(past.drift_km) })
    : 'The distance the twin has drifted since 1995 is not in this result.';
}

// ---------- Screen 4: Viability Curve ----------

// Plain-language status for a viability score (0-1), best first.
const VIABILITY_STATUS = [
  { min: 0.75, label: 'Healthy', cls: 'ok', color: '#2e9e5b', band: 'rgba(46, 158, 91, 0.16)' },
  { min: 0.5, label: 'Watch', cls: 'watch', color: '#d97706', band: 'rgba(232, 137, 12, 0.18)' },
  { min: 0, label: 'At risk', cls: 'risk', color: '#d62839', band: 'rgba(214, 40, 57, 0.14)' }
];

function viabilityStatus(score) {
  return VIABILITY_STATUS.find(s => score >= s.min) || VIABILITY_STATUS[VIABILITY_STATUS.length - 1];
}

const percentOf = score => `${Math.round(score * 100)}%`;

// Draws the three status bands behind the line (with their names in the right margin)
// and the score above or below each point, so no gridlines or axis numbers are needed.
const viabilityGuides = {
  id: 'viabilityGuides',
  beforeDatasetsDraw(chart) {
    const { ctx, chartArea: area, scales: { y } } = chart;
    ctx.save();
    VIABILITY_STATUS.forEach((status, i) => {
      const top = y.getPixelForValue(i === 0 ? 1 : VIABILITY_STATUS[i - 1].min);
      const bottom = y.getPixelForValue(status.min);
      ctx.fillStyle = status.band;
      ctx.fillRect(area.left, top, area.right - area.left, bottom - top);
      ctx.fillStyle = status.color;
      ctx.font = '700 14px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(status.label, area.right + 10, (top + bottom) / 2);
    });
    ctx.restore();
  },
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const scores = chart.data.datasets[0].data;
    ctx.save();
    ctx.fillStyle = '#4a2511';
    ctx.font = '700 14px sans-serif';
    ctx.textAlign = 'center';
    chart.getDatasetMeta(0).data.forEach((point, i) => {
      const nearTop = scores[i] > 0.88;   // put the number below the point when there is no room above
      ctx.textBaseline = nearTop ? 'top' : 'bottom';
      ctx.fillText(percentOf(scores[i]), point.x, point.y + (nearTop ? 12 : -12));
    });
    ctx.restore();
  }
};

function renderViability(data) {
  const viability = data.current_crop_viability;
  if (!viability.length) throw new ScreenDataMissing('This result has no viability scores yet.');
  const labels = viability.map(v => v.year);
  const scores = viability.map(v => v.score);
  const dotColors = scores.map(s => viabilityStatus(s).color);

  if (state.chart) {
    state.chart.data.labels = labels;
    state.chart.data.datasets[0].data = scores;
    state.chart.data.datasets[0].pointBackgroundColor = dotColors;
    state.chart.update();
  } else {
    const ctx = document.getElementById('viability-chart').getContext('2d');
    state.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Current crop viability',
          data: scores,
          borderColor: '#4a2511',
          borderWidth: 3,
          tension: 0,
          fill: false,
          pointRadius: 8,
          pointHoverRadius: 10,
          pointBackgroundColor: dotColors,
          pointBorderColor: '#fff',
          pointBorderWidth: 2
        }]
      },
      options: {
        responsive: true,
        animation: prefersReducedMotion ? false : { duration: 900 },
        layout: { padding: { right: 72, top: 8 } },   // room for the band names
        scales: {
          y: { min: 0, max: 1, border: { display: false }, grid: { display: false }, ticks: { display: false } },
          x: {
            offset: true, border: { color: 'rgba(74, 37, 17, 0.35)' },
            grid: { display: false },
            ticks: { color: '#4a2511', font: { size: 14, weight: '600' } }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            callbacks: {
              title: items => String(items[0].label),
              label: ctx => `${percentOf(ctx.parsed.y)}: ${viabilityStatus(ctx.parsed.y).label}`
            }
          }
        }
      },
      plugins: [viabilityGuides]
    });
  }

  renderViabilitySummary(data);
  renderActionPlan(data);
}

// One plain sentence above the chart: where the crop stands now and at the end of the curve.
function renderViabilitySummary(data) {
  const el = document.getElementById('viability-summary');
  if (!el) return;
  const first = data.current_crop_viability[0];
  const last = data.current_crop_viability[data.current_crop_viability.length - 1];
  const crop = data.current_crop || 'The current crop';
  el.textContent =
    `${crop}: ${viabilityStatus(first.score).label} in ${first.year} (${percentOf(first.score)}), ` +
    `${viabilityStatus(last.score).label} by ${last.year} (${percentOf(last.score)}).`;
}

// ---------- "How to Help Today's Crops Last Longer" ----------

const MILESTONES = [
  { year: 2025, tag: 'Near-term', phase: 'near' },
  { year: 2035, tag: 'Mid-term', phase: 'mid' },
  { year: 2045, tag: 'Long-term', phase: 'long' }
];

const clamp01 = v => Math.min(1, Math.max(0, v));
const whole = v => (isNum(v) ? String(Math.round(v)) : '?');

function cropFor(name) {
  if (!name) return null;
  return CROPS.find(c => c && String(c.name).toLowerCase() === String(name).toLowerCase()) || null;
}

// Everything the advice needs, taken from the /twin response and crops.json.
function planContext(data) {
  const current = String(data.current_crop || '').toLowerCase();
  return {
    n: data.signature_now || {},
    f: data.signature_2045 || {},
    name: data.current_crop || 'your crop',
    crop: cropFor(data.current_crop),            // null if crops.json did not load
    alternatives: (data.crops_there || [])       // crops that fit the twin's climate, best first
      .map(c => c && c.name)
      .filter(name => name && name.toLowerCase() !== current)
      .slice(0, 2),
    twinPlace: data.twin.place,
    likesWater: /paddy|rice|taro/i.test(data.current_crop || '')
  };
}

// How strongly each climate risk applies to this field, from 0 (none) to 1 (strong).
function driverSeverities(ctx) {
  const { n, f, crop } = ctx;
  const rise = key => (isNum(f[key]) && isNum(n[key]) ? f[key] - n[key] : 0);
  const heatUsed = crop && isNum(f.heat_days) ? f.heat_days / crop.max_heat_days : 0;
  return {
    heat: clamp01(Math.max(rise('heat_days') / 10, rise('mean_temp') / 1.0, heatUsed)),
    dry: clamp01(Math.max(rise('dry_spell_days') / 7, ((f.dry_spell_days ?? 0) - 14) / 20)),
    wet: clamp01(Math.max(rise('rain_mm') / 600, rise('wet_share') / 0.08)),
    lessrain: clamp01(-rise('rain_mm') / 400)
  };
}

// One action and the benefit it gives, per risk and milestone phase.
const ACTIONS = {
  heat: {
    near: () => ({
      act: 'Plan planting so flowering misses the hottest weeks, and mulch bare soil.',
      gain: 'Protects flowers from heat damage and keeps the soil cooler.'
    }),
    mid: ({ n, f, name, crop }) => ({
      act: 'Add shade or windbreak trees, and make sure water is available on hot days.',
      gain: (f.heat_days > n.heat_days + 0.5
        ? `Eases heat stress as days above 35 °C go from ${whole(n.heat_days)} to ${whole(f.heat_days)} a year`
        : `Eases heat stress as average temperature trends from ${fmt(n.mean_temp, 1)} to ${fmt(f.mean_temp, 1)} °C`) +
        (crop ? `; ${name} tolerates up to ${crop.max_heat_days}.` : '.')
    }),
    long: ({ name }) => ({
      act: 'Choose heat-tolerant varieties and adjust planting dates as the warm trend continues.',
      gain: `Keeps ${name} within its heat limit for longer.`
    })
  },
  dry: {
    near: ({ n }) => ({
      act: 'Mulch the soil, and note how many days pass between rains.',
      gain: `Soil holds moisture longer, so a dry week hurts less (longest dry spell today: ${whole(n.dry_spell_days)} days).`
    }),
    mid: ({ f, name }) => ({
      act: 'Build or repair a pond or tank, and plan irrigation for the driest weeks.',
      gain: `Water is there for ${name} when rain stops (trend: a ${whole(f.dry_spell_days)}-day dry spell by 2045).`
    }),
    long: () => ({
      act: 'Plant drought-tolerant varieties, or give part of the land to a hardier crop.',
      gain: 'Spreads the risk so one long dry spell cannot take the whole harvest.'
    })
  },
  wet: {
    near: ({ n, f, likesWater }) => ({
      act: likesWater
        ? 'Check and repair bunds, spillways and drains before the wet season.'
        : 'Clear drains and field channels before the wet season.',
      gain: `${likesWater ? 'Keeps extra water under control' : 'Stops standing water that rots roots and spreads disease'} ` +
        `as rain trends from ${whole(n.rain_mm)} to ${whole(f.rain_mm)} mm a year.`
    }),
    mid: ({ likesWater }) => likesWater
      ? {
        act: 'Store extra rainwater in ponds or tanks, so heavy rain can be used in the dry months.',
        gain: 'Turns extra rain into irrigation and reduces flooding.'
      }
      : {
        act: 'Raise beds and add drainage where water collects.',
        gain: 'Keeps roots out of standing water and stops topsoil washing away.'
      },
    long: ({ name, likesWater }) => likesWater
      ? {
        act: 'Shift planting dates to match the new wet-season timing, and keep water-control structures in good repair.',
        gain: 'Keeps planting in step with when the rain actually falls.'
      }
      : {
        act: 'Move crops that dislike wet feet to higher, well-drained ground.',
        gain: `Matches ${name} to the water it will actually get.`
      }
  },
  lessrain: {
    near: () => ({
      act: 'Measure rainfall on your own land, and record when it falls short.',
      gain: 'Gives you an early warning from your own field, not just regional averages.'
    }),
    mid: () => ({
      act: 'Add drip or sprinkler irrigation for the driest months.',
      gain: 'Gets more crop from every litre of water.'
    }),
    long: () => ({
      act: 'Move part of the land to crops that need less water.',
      gain: 'Lowers irrigation cost and drought risk.'
    })
  },
  soil: {
    near: () => ({
      act: 'Add compost or crop residue, and keep a simple weather and harvest diary.',
      gain: 'Healthier soil holds more water and nutrients, and the diary shows early signs of change.'
    }),
    mid: () => ({
      act: 'Rotate crops, or plant a legume between seasons.',
      gain: 'Restores soil nutrients and spreads the risk.'
    }),
    long: () => ({
      act: 'Review the plan with a local agricultural adviser and update it with fresh data.',
      gain: 'Keeps decisions based on what is happening on your own land.'
    })
  },
  switch: {
    near: ({ name }) => ({
      act: `Ask a local adviser whether ${name} still suits this land.`,
      gain: 'Catches a poor fit early, while changes are cheap.'
    }),
    mid: ({ name, alternatives }) => ({
      act: alternatives.length
        ? `Trial a small plot of ${alternatives.join(' or ')} next to ${name}.`
        : `Trial a small plot of a second crop next to ${name}.`,
      gain: 'Shows what works on your own soil before you commit.'
    }),
    long: ({ name, alternatives, twinPlace }) => ({
      act: alternatives.length
        ? `Move the main crop toward ${alternatives.join(' or ')}, which fit the climate of your 2045 twin (${twinPlace}).`
        : 'Move the main crop to one that fits the 2045 climate; ask your adviser which.',
      gain: `Keeps income steady if ${name} no longer fits.`
    })
  }
};

// Picks up to two risks for a milestone: the strongest ones for this field, plus
// "switch crops" when that milestone's viability score is low, and soil care as the fallback.
function planFor(milestone, ctx, severity, score) {
  const candidates = Object.entries(severity).map(([id, s]) => ({ id, s }));
  if (isNum(score) && score < (milestone.phase === 'near' ? 0.5 : 0.75)) {
    candidates.push({ id: 'switch', s: Math.min(1, (1 - score) * 1.2) });
  }
  candidates.sort((a, b) => b.s - a.s);
  const chosen = candidates.filter(c => c.s >= 0.2).slice(0, 2).map(c => c.id);
  for (const c of [{ id: 'soil', s: 1 }, ...candidates]) {
    if (chosen.length >= 2) break;
    if (!chosen.includes(c.id) && c.s > 0) chosen.push(c.id);
  }
  return chosen.map(id => ACTIONS[id][milestone.phase](ctx));
}

function renderActionPlan(data) {
  const box = document.getElementById('action-plan');
  if (!box) return;
  const ctx = planContext(data);
  const severity = driverSeverities(ctx);
  const scoreByYear = new Map(data.current_crop_viability.map(v => [v.year, v.score]));

  const cards = MILESTONES.map(milestone => {
    const score = scoreByYear.get(milestone.year);
    const status = isNum(score) ? viabilityStatus(score) : null;
    const items = planFor(milestone, ctx, severity, score);
    const chip = status
      ? `<span class="chip chip--${status.cls}">${percentOf(score)} · ${status.label}</span>`
      : '';
    return `
      <article class="milestone milestone--${status ? status.cls : 'none'}">
        <header class="milestone-head">
          <span class="milestone-year">${milestone.year}</span>
          <span class="milestone-tag">${milestone.tag}</span>
          ${chip}
        </header>
        <h4>Prevention &amp; Action</h4>
        <ol class="actions">${items.map(i => `<li>${escapeHtml(i.act)}</li>`).join('')}</ol>
        <h4>Field Benefits</h4>
        <ol class="benefits">${items.map(i => `<li>${escapeHtml(i.gain)}</li>`).join('')}</ol>
      </article>`;
  });

  box.innerHTML = `
    <h3>How to Help Today's Crops Last Longer</h3>
    <p class="action-plan-intro">
      For <b>${escapeHtml(ctx.name)}</b> at ${escapeHtml(data.field.name)}. General farming steps matched to this
      field's climate trend, not a yield forecast. Check them with a local agricultural adviser.
    </p>
    <div class="milestones">${cards.join('')}</div>`;
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

// Thrown by a screen when this result simply doesn't include its data.
class ScreenDataMissing extends Error {}

function renderScreen(id) {
  if (!state.data) return;
  const section = document.getElementById(id);
  let message = section.querySelector('.screen-error');
  try {
    SCREEN_RENDERERS[id](state.data);
    section.classList.remove('has-error');
  } catch (err) {
    // Optional screens must never break the reveal. Hide this screen's
    // content (it may still show the previous field) and say why.
    if (!(err instanceof ScreenDataMissing)) console.error(`${id} failed to render`, err);
    if (!message) {
      message = document.createElement('p');
      message.className = 'screen-error';
      message.setAttribute('role', 'status');
      section.querySelector('h2').after(message);
    }
    message.textContent = err instanceof ScreenDataMissing
      ? err.message
      : 'This part of the result could not be shown.';
    section.classList.add('has-error');
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
    replayReveal();
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
    if (!story.active || e.altKey || e.ctrlKey || e.metaKey || e.isComposing) return;
    // Leave typing alone: keys in the coordinate boxes or the preset list.
    if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]')) return;
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

// Export buttons work only when a finished result is on screen and no
// export is already running.
const exportState = { ready: false, busy: false };

function setExportReady(ready) {
  exportState.ready = ready;
  updateExportButtons();
}

function updateExportButtons() {
  for (const id of ['download-image', 'print-report']) {
    document.getElementById(id).disabled = !exportState.ready || exportState.busy;
  }
}

// The result an export should use, or null if none is ready.
function exportableResult() {
  return exportState.ready && !state.loading && state.data && state.dataId === state.requestId
    ? { data: state.data, id: state.dataId }
    : null;
}

// ctx.roundRect is missing in Safari < 16 and Firefox < 112.
function roundedRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
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
    const markers = state.globe.htmlElementsData();
    for (const [p, color, kind] of [[field, '#2ed573', 'field'], [twin, '#ff6b6b', 'twin']]) {
      // globe.gl fades out markers on the far side of the Earth; skip those.
      const m = markers.find(d => d.el.classList.contains(`ct-marker--${kind}`));
      if (m && m.el.style.opacity === '0') continue;
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
  roundedRectPath(ctx, px, py, pw, ph, 18);
  ctx.clip();
  ctx.fillStyle = '#02030c';
  ctx.fillRect(px, py, pw, ph);
  ctx.drawImage(view, sx, sy, sw, sh, px, py, pw, ph);
  ctx.restore();
  ctx.strokeStyle = 'rgba(127, 220, 255, 0.5)';
  ctx.lineWidth = 2;
  roundedRectPath(ctx, px, py, pw, ph, 18);
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
    `Twin: ${twin.lat.toFixed(2)}, ${twin.lon.toFixed(2)} · ${km(twin.distance_km)} km away`
  ];
  if (past && isNum(past.drift_km)) {
    lines.push(`Twin has drifted ${km(past.drift_km)} km since 1995`);
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

async function snapshotFor(result) {
  const tiles = state.view === 'map' ? await loadCorsTiles() : null;
  return composeSnapshot(result.data, tiles);
}

// Runs an export once at a time, with the buttons greyed out meanwhile.
// Returns false if the result changed while it ran (a new field was chosen).
async function runExport(task) {
  const result = exportableResult();
  if (!result || exportState.busy) return;
  exportState.busy = true;
  updateExportButtons();
  try {
    await task(result, () => result.id === state.requestId && !state.loading);
  } catch (err) {
    console.error('Export failed', err);
    setStatus('Sorry, that export failed. Try again.', 'error');
  } finally {
    exportState.busy = false;
    updateExportButtons();
  }
}

function downloadImage() {
  return runExport(async (result, stillCurrent) => {
    const canvas = await snapshotFor(result);
    if (!stillCurrent()) return;
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('could not encode the image');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = snapshotFilename(result.data);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

// Before printing: put the snapshot at the top and open every screen so the
// report has everything. Afterwards, put the screens back as they were.
const printState = { prepared: false, wasOpen: [] };

function printMeta(result) {
  const { field, twin } = result.data;
  return `${field.name} (${field.lat.toFixed(2)}, ${field.lon.toFixed(2)}). Climate twin: ${twin.place}. ` +
    (state.live
      ? 'Live result from the Climate Twin engine. '
      : 'Saved result: the engine was not connected, so this is precomputed Climate Twin output. ') +
    `Printed ${new Date().toLocaleString()}.`;
}

// The Print button passes a ready snapshot. Ctrl/Cmd+P can't wait, so then it
// builds one straight away (flat map drawn without its background).
function prepareForPrint(snapshot) {
  if (printState.prepared) return;
  const img = document.getElementById('print-snapshot');
  const meta = document.getElementById('print-meta');
  const result = exportableResult();
  if (!result) {
    // Nothing finished to print (still loading, or no result yet).
    img.removeAttribute('src');
    meta.textContent = state.loading
      ? 'A new result was still loading. Print again once it has appeared.'
      : 'There is no result to print yet.';
    return;
  }

  // Remember what was open *before* changing anything. A screen that is
  // fading out counts as closed.
  const wasOpen = [...document.querySelectorAll('.optional')]
    .filter(s => !s.hidden && s.classList.contains('is-visible')).map(s => s.id);
  try {
    const canvas = snapshot instanceof HTMLCanvasElement ? snapshot : composeSnapshot(result.data);
    img.src = canvas.toDataURL('image/png');
    meta.textContent = printMeta(result);
  } catch (err) {
    console.error('Print snapshot failed', err);
    img.removeAttribute('src');
    meta.textContent = printMeta(result);
  }

  printState.wasOpen = wasOpen;
  printState.prepared = true;
  document.body.classList.add('printing');
  document.querySelectorAll('.optional').forEach(section => {
    section.hidden = false;
    section.classList.add('is-visible');
    renderScreen(section.id);
  });
  // Chart.js doesn't resize for print by itself; give the comparison chart its paper size
  // (matches .compare-panel's print width minus padding).
  if (state.compare) state.compare.resize(528, 380);
}

function restoreAfterPrint() {
  if (!printState.prepared) return;
  printState.prepared = false;
  document.body.classList.remove('printing');
  if (state.compare) state.compare.resize(); // back to fitting its box
  document.querySelectorAll('.optional').forEach(section => {
    const open = printState.wasOpen.includes(section.id);
    if (!open) {
      section.classList.remove('is-visible');
      section.hidden = true;
    }
    // Keep the toggle buttons in step with what is showing.
    const button = document.querySelector(`.toggle[data-target="${section.id}"]`);
    if (button) button.setAttribute('aria-pressed', String(open));
  });
}

function printReport() {
  return runExport(async (result, stillCurrent) => {
    const snapshot = await snapshotFor(result);
    if (!stillCurrent()) return;
    prepareForPrint(snapshot);
    const img = document.getElementById('print-snapshot');
    try { await img.decode(); } catch { /* print anyway */ }
    if (!stillCurrent()) { restoreAfterPrint(); return; }
    window.print();
  });
}

function initExport() {
  document.getElementById('download-image').addEventListener('click', downloadImage);
  document.getElementById('print-report').addEventListener('click', printReport);
  // Also handle Ctrl/Cmd+P from the browser menu.
  window.addEventListener('beforeprint', () => prepareForPrint());
  window.addEventListener('afterprint', restoreAfterPrint);
}

// ---------- Header: rotate the orbiting crops ----------

// Emoji for the crops in data/crops.json. Names not listed fall back to 🌱.
const CROP_EMOJI = {
  'Paddy rice': '🌾', 'Maize': '🌽', 'Cassava': '🥔', 'Groundnut': '🥜',
  'Sweet potato': '🍠', 'Soybean': '🫛', 'Mung bean': '🫘', 'Sorghum': '🌾',
  'Pearl millet': '🌾', 'Chilli': '🌶️', 'Pineapple': '🍍', 'Banana': '🍌',
  'Oil palm': '🌴', 'Rubber': '🌳', 'Durian': '🧌', 'Jackfruit': '🟢',
  'Pigeon pea': '🫛', 'Taro': '🌿'
};

// Crops shown if crops.json hasn't loaded (names it would also produce).
const DEFAULT_CROP_EMOJI = ['🌾', '🌽', '🥥', '🍌', '🍍', '🌶️', '🥜', '🍠', '🌴'];

// __fastCrops speeds these up for tests.
const CROP_ROTATE_MS = (typeof window !== 'undefined' && window.__fastCrops) ? 800 : 4000; // each orbit crop swaps this often
const CROP_FADE_MS = (typeof window !== 'undefined' && window.__fastCrops) ? 150 : 600;     // length of the cross-fade

// Unique emoji for the header, from Role 3's crop list when available.
function cropEmojiList() {
  const names = Array.isArray(CROPS) ? CROPS.map(c => c && c.name).filter(Boolean) : [];
  const fromData = [...new Set(names.map(n => CROP_EMOJI[n] || '🌱'))];
  const list = fromData.length >= 4 ? fromData : DEFAULT_CROP_EMOJI;
  return list;
}

function initCropRotation() {
  const slots = [...document.querySelectorAll('.crop .crop-upright > .crop-emoji')];
  if (!slots.length) return;
  document.documentElement.style.setProperty('--crop-fade', `${CROP_FADE_MS}ms`);
  const emoji = cropEmojiList(); // already unique
  if (emoji.length <= slots.length || prefersReducedMotion) return; // nothing to rotate to

  // What each slot currently shows, and a shared cursor into the list.
  const current = slots.map((_, i) => emoji[i % emoji.length]);
  slots.forEach((slot, i) => {
    slot.textContent = current[i];
    // A second span sits on top (inside the same upright wrapper) for the fade.
    const next = document.createElement('span');
    next.className = 'crop-emoji crop-emoji--next';
    next.setAttribute('aria-hidden', 'true');
    slot.parentElement.appendChild(next); // .crop-upright
  });

  // The next emoji along the list that none of the four slots is showing,
  // so the four crops on screen are always different from each other.
  let cursor = slots.length;
  function nextEmoji() {
    for (let tries = 0; tries < emoji.length; tries++) {
      const candidate = emoji[cursor % emoji.length];
      cursor++;
      if (!current.includes(candidate)) return candidate;
    }
    return null; // can't happen: the list is longer than the slot count
  }

  let tick = 0;
  cropTimer = setInterval(() => {
    const i = tick % slots.length; // rotate one crop per tick, staggered
    tick++;
    const pick = nextEmoji();
    if (!pick) return;
    const shown = slots[i];
    const next = shown.parentElement.querySelector('.crop-emoji--next');
    next.textContent = pick;
    current[i] = pick;
    // Cross-fade: new one in, current one out.
    next.classList.add('is-in');
    shown.classList.add('is-out');
    setTimeout(() => {
      shown.textContent = pick;
      shown.classList.remove('is-out');
      next.classList.remove('is-in');
    }, CROP_FADE_MS);
  }, CROP_ROTATE_MS / slots.length);
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
  await Promise.all([loadUiCopy(), loadCrops()]); // Role 3's wording + crops
  initCropRotation();
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
