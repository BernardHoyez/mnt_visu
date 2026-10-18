'use strict';
const APP_VERSION = 'v3';
const ORIGIN = 20037508.342789244, WORLD = ORIGIN * 2;
const T = 256, N = 258, NODATA = -1000;
const WMS = 'https://data.geopf.fr/wms-r/wms';
const SOURCES = {
  alti:  'ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES',
  lidar: 'IGNF_LIDAR-HD_MNT_ELEVATION.ELEVATIONGRIDCOVERAGE.LAMB93'
};
const DEFAULTS = { base: 'ortho', dem: true, mode: 'hill', source: 'lidar',
  opacity: 70, contrast: 100, brightness: 100, azimuth: 315, exag: 1 };

const $ = (s) => document.querySelector(s);
const store = {
  get(k, d) { try { const v = localStorage.getItem('mnt_visu.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('mnt_visu.' + k, JSON.stringify(v)); } catch (e) {} }
};
const state = Object.assign({}, DEFAULTS, store.get('state', {}));
const save = () => store.set('state', state);

/* ---------- Carte & fonds ---------- */
const view = store.get('view', { c: [49.93, 1.1], z: 14 });
const map = L.map('map', { center: view.c, zoom: view.z, maxZoom: 19 });
map.on('moveend', () => store.set('view', { c: [map.getCenter().lat, map.getCenter().lng], z: map.getZoom() }));
L.control.scale({ imperial: false }).addTo(map);

const wmts = (layer, fmt, tms, attr) => L.tileLayer(
  'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=' + layer +
  '&STYLE=normal&FORMAT=' + fmt + '&TILEMATRIXSET=' + tms + '&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}',
  { maxZoom: 19, attribution: attr || '© IGN' });
const bases = {
  osm:   L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© contributeurs OpenStreetMap' }),
  plan:  wmts('GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2', 'image/png', 'PM'),
  ortho: wmts('ORTHOIMAGERY.ORTHOPHOTOS', 'image/jpeg', 'PM_0_19')
};
let baseLayer = null;
function setBase(k) {
  if (baseLayer) map.removeLayer(baseLayer);
  baseLayer = bases[k].addTo(map); baseLayer.setZIndex(1);
  state.base = k; save();
}

/* ---------- Couche MNT (canvas, altitudes brutes) ---------- */
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
const HYPSO = [[0, '#2f6f4e'], [.2, '#8fb35a'], [.4, '#e3d680'], [.6, '#c49a5a'], [.8, '#8c5e46'], [1, '#ffffff']];
const LUT = new Uint8ClampedArray(256 * 3);
for (let i = 0; i < 256; i++) {
  const t = i / 255; let k = 0;
  while (k < HYPSO.length - 2 && t > HYPSO[k + 1][0]) k++;
  const a = HYPSO[k], b = HYPSO[k + 1], u = (t - a[0]) / (b[0] - a[0]);
  const ca = hex(a[1]), cb = hex(b[1]);
  for (let c = 0; c < 3; c++) LUT[i * 3 + c] = ca[c] + (cb[c] - ca[c]) * Math.min(1, Math.max(0, u));
}

const Dem = L.GridLayer.extend({
  initialize(o) { L.GridLayer.prototype.initialize.call(this, o); this._cache = new Map(); this.range = [0, 100]; this._errs = 0; },

  createTile(c, done) {
    const cv = document.createElement('canvas'); cv.width = cv.height = T; cv._c = c;
    this._get(c).then((d) => { cv._d = d; this._paint(cv); done(null, cv); })
      .catch(() => { this._errs++; done(null, cv); });
    return cv;
  },

  _get(c) {
    const k = this.options.source + '/' + c.z + '/' + c.x + '/' + c.y;
    let p = this._cache.get(k);
    if (!p) {
      p = this._load(c).catch((e) => { this._cache.delete(k); throw e; });
      this._cache.set(k, p);
      if (this._cache.size > 400) this._cache.delete(this._cache.keys().next().value);
    }
    return p;
  },

  async _load({ x, y, z }) {
    const ts = WORLD / 2 ** z, pm = ts / T, x0 = -ORIGIN + x * ts, yt = ORIGIN - y * ts;
    const bbox = [x0 - pm, yt - ts - pm, x0 + ts + pm, yt + pm].join(',');
    const url = WMS + '?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=' + SOURCES[this.options.source] +
      '&STYLES=&FORMAT=' + encodeURIComponent('image/x-bil;bits=32') +
      '&CRS=EPSG:3857&BBOX=' + bbox + '&WIDTH=' + N + '&HEIGHT=' + N;
    const r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const b = await r.arrayBuffer();
    if (b.byteLength !== N * N * 4) throw new Error('format');
    return new Float32Array(b);
  },

  _paint(cv) {
    const d = cv._d; if (!d) return;
    const ctx = cv.getContext('2d'), img = ctx.createImageData(T, T), o = img.data;
    const mode = state.mode;
    const [lo, hi] = this.range, span = hi - lo || 1;
    let cell = 1, cosZ = 0, sinZ = 0, azM = 0, ex = state.exag;
    if (mode === 'hill') {
      const { x, y, z } = cv._c, n = 2 ** z;
      const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + .5) / n)));
      cell = (WORLD / n / T) * Math.cos(lat);
      const zen = (90 - 45) * Math.PI / 180; cosZ = Math.cos(zen); sinZ = Math.sin(zen);
      azM = (90 - state.azimuth) * Math.PI / 180;
    }
    for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) {
      const idx = (j + 1) * N + i + 1, z0 = d[idx], p = (j * T + i) * 4;
      if (!(z0 > NODATA)) { o[p + 3] = 0; continue; }
      if (mode === 'hill') {
        const g = (k) => { const v = d[k]; return v > NODATA ? v : z0; };
        const a = g(idx - N - 1), b = g(idx - N), c = g(idx - N + 1), l = g(idx - 1), r = g(idx + 1),
              e = g(idx + N - 1), f = g(idx + N), h = g(idx + N + 1);
        const dx = ((c + 2 * r + h) - (a + 2 * l + e)) / (8 * cell);
        const dy = ((a + 2 * b + c) - (e + 2 * f + h)) / (8 * cell);
        const slope = Math.atan(ex * Math.hypot(dx, dy)), asp = Math.atan2(dy, -dx);
        let hs = cosZ * Math.cos(slope) + sinZ * Math.sin(slope) * Math.cos(azM - asp);
        hs = hs < 0 ? 0 : hs; const v = hs * 255;
        o[p] = o[p + 1] = o[p + 2] = v; o[p + 3] = 255;
      } else {
        let t = (z0 - lo) / span; t = t < 0 ? 0 : t > 1 ? 1 : t;
        const k = (t * 255) | 0;
        if (mode === 'gray') o[p] = o[p + 1] = o[p + 2] = k;
        else { o[p] = LUT[k * 3]; o[p + 1] = LUT[k * 3 + 1]; o[p + 2] = LUT[k * 3 + 2]; }
        o[p + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  },

  _each(fn) { for (const k in this._tiles) { const t = this._tiles[k]; if (t.current && t.el._d) fn(t.el); } },

  updateRange() {
    const v = [];
    this._each((el) => { const d = el._d; for (let i = 0; i < d.length; i += 11) if (d[i] > NODATA) v.push(d[i]); });
    if (v.length < 20) return;
    v.sort((a, b) => a - b);
    let lo = v[Math.floor(v.length * .02)], hi = v[Math.floor(v.length * .98)];
    if (hi - lo < 1) hi = lo + 1;
    this.range = [lo, hi];
  },

  refresh() { if (state.mode !== 'hill') this.updateRange(); this._each((el) => this._paint(el)); legend(); }
});

const dem = new Dem({ tileSize: T, minZoom: 9, maxZoom: 19, source: state.source, updateWhenIdle: true, keepBuffer: 1, zIndex: 5 });
dem.on('load', () => {
  dem.refresh();
  status(dem._errs ? 'MNT indisponible sur une partie de la vue (hors couverture, réseau ou couche absente).' : '');
  dem._errs = 0;
});
dem.on('loading', () => status('Chargement du MNT…'));
dem.on('add', applyFilter);

function applyFilter() {
  const c = dem.getContainer && dem.getContainer();
  if (c) c.style.filter = 'contrast(' + state.contrast + '%) brightness(' + state.brightness + '%)';
}

/* ---------- Interface ---------- */
function status(t) { $('#status').textContent = t; }
function legend() {
  const lg = $('#legend'), show = state.dem && state.mode !== 'hill';
  lg.hidden = !show; if (!show) return;
  $('#bar').style.background = state.mode === 'gray'
    ? 'linear-gradient(90deg,#000,#fff)'
    : 'linear-gradient(90deg,' + HYPSO.map((s) => s[1] + ' ' + s[0] * 100 + '%').join(',') + ')';
  $('#lmin').textContent = Math.round(dem.range[0]) + ' m';
  $('#lmax').textContent = Math.round(dem.range[1]) + ' m';
}
function sync() {
  $('#base').value = state.base; $('#demOn').checked = state.dem; $('#source').value = state.source;
  document.querySelectorAll('input[name=mode]').forEach((r) => (r.checked = r.value === state.mode));
  [['opacity', '%'], ['contrast', '%'], ['brightness', '%'], ['azimuth', '°'], ['exag', '×']].forEach(([k, u]) => {
    $('#' + k).value = state[k]; $('#o-' + k).textContent = state[k] + u;
  });
  $('#hillOpts').hidden = state.mode !== 'hill';
  dem.setOpacity(state.opacity / 100); applyFilter(); legend();
}
function setDem(on) {
  state.dem = on;
  if (on) { dem.addTo(map); applyFilter(); } else map.removeLayer(dem);
  legend();
}

$('#base').onchange = (e) => setBase(e.target.value);
$('#demOn').onchange = (e) => { setDem(e.target.checked); save(); };
$('#source').onchange = (e) => {
  state.source = e.target.value; dem.options.source = state.source; save();
  dem._errs = 0; if (state.dem) dem.redraw();
};
document.querySelectorAll('input[name=mode]').forEach((r) => r.onchange = () => {
  state.mode = r.value; save(); $('#hillOpts').hidden = state.mode !== 'hill'; dem.refresh();
});
['opacity', 'contrast', 'brightness', 'azimuth', 'exag'].forEach((k) => {
  $('#' + k).oninput = (e) => {
    state[k] = parseFloat(e.target.value);
    $('#o-' + k).textContent = state[k] + { opacity: '%', contrast: '%', brightness: '%', azimuth: '°', exag: '×' }[k];
    if (k === 'opacity') dem.setOpacity(state.opacity / 100);
    else if (k === 'contrast' || k === 'brightness') applyFilter();
    else dem.refresh();
    save();
  };
});
$('#reset').onclick = () => {
  Object.assign(state, { opacity: 70, contrast: 100, brightness: 100, azimuth: 315, exag: 1 }); save(); sync(); dem.refresh();
};
$('#toggle').onclick = () => $('#panel').classList.toggle('hidden');
$('#ver').textContent = APP_VERSION;

map.on('zoomend', () => {
  if (state.dem && map.getZoom() < dem.options.minZoom) status('Zoomer (niveau ≥ ' + dem.options.minZoom + ') pour afficher le MNT.');
  else if ($('#status').textContent.startsWith('Zoomer')) status('');
});

/* Altitude au clic */
map.on('click', (e) => {
  if (!state.dem) return;
  const z = map.getZoom(); if (z < dem.options.minZoom) return;
  const p = map.project(e.latlng, z), tx = Math.floor(p.x / T), ty = Math.floor(p.y / T);
  const pr = dem._cache.get(state.source + '/' + z + '/' + tx + '/' + ty);
  if (!pr) return;
  pr.then((d) => {
    const v = d[(Math.floor(p.y - ty * T) + 1) * N + Math.floor(p.x - tx * T) + 1];
    L.popup().setLatLng(e.latlng)
      .setContent(v > NODATA ? '<b>' + v.toFixed(2) + ' m</b><br>' + e.latlng.lat.toFixed(5) + ', ' + e.latlng.lng.toFixed(5) : 'Pas de donnée')
      .openOn(map);
  }).catch(() => {});
});

setBase(state.base);
if (state.dem) dem.addTo(map);
sync();

/* ---------- Service worker brise-cache ---------- */
if ('serviceWorker' in navigator) {
  const had = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (had && !reloaded) { reloaded = true; location.reload(); }
  });
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((r) => r.update()).catch(() => {});
}
