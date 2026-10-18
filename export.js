'use strict';
/* Export hors-ligne : tuiles PNG du MNT affiché → GeoPackage (EPSG:3857) ou MBTiles */
const MAX_TILES = 1500;
const WEBMERC_WKT = 'PROJCS["WGS 84 / Pseudo-Mercator",GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]],PROJECTION["Mercator_1SP"],PARAMETER["central_meridian",0],PARAMETER["scale_factor",1],PARAMETER["false_easting",0],PARAMETER["false_northing",0],UNIT["metre",1,AUTHORITY["EPSG","9001"]],AXIS["Easting",EAST],AXIS["Northing",NORTH],EXTENSION["PROJ4","+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs"],AUTHORITY["EPSG","3857"]]';

function buildDb(SQL, fmt, tiles, info) {
  const W = 20037508.342789244 * 2, O = 20037508.342789244;
  const db = new SQL.Database();
  const zs = [...new Set(tiles.map((t) => t.z))].sort((a, b) => a - b);
  if (fmt === 'mbtiles') {
    db.run('CREATE TABLE metadata (name TEXT, value TEXT);');
    db.run('CREATE TABLE tiles (zoom_level INTEGER, tile_column INTEGER, tile_row INTEGER, tile_data BLOB);');
    db.run('CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row);');
    const meta = { name: info.name, type: 'overlay', version: '1', format: 'png',
      description: info.description, attribution: '© IGN — LiDAR HD / RGE ALTI, Licence Ouverte',
      bounds: info.bounds.join(','), minzoom: String(zs[0]), maxzoom: String(zs[zs.length - 1]) };
    const m = db.prepare('INSERT INTO metadata VALUES (?,?)');
    for (const k in meta) m.run([k, meta[k]]);
    m.free();
    db.run('BEGIN');
    const s = db.prepare('INSERT INTO tiles VALUES (?,?,?,?)');
    for (const t of tiles) s.run([t.z, t.x, (2 ** t.z) - 1 - t.y, t.png]); // MBTiles = schéma TMS
    s.free(); db.run('COMMIT');
  } else {
    db.run('PRAGMA application_id = 1196444487; PRAGMA user_version = 10300;');
    db.run(`CREATE TABLE gpkg_spatial_ref_sys (srs_name TEXT NOT NULL, srs_id INTEGER PRIMARY KEY, organization TEXT NOT NULL, organization_coordsys_id INTEGER NOT NULL, definition TEXT NOT NULL, description TEXT);
CREATE TABLE gpkg_contents (table_name TEXT NOT NULL PRIMARY KEY, data_type TEXT NOT NULL, identifier TEXT UNIQUE, description TEXT DEFAULT '', last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE, srs_id INTEGER, CONSTRAINT fk_gc_r_srs_id FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id));
CREATE TABLE gpkg_tile_matrix_set (table_name TEXT NOT NULL PRIMARY KEY, srs_id INTEGER NOT NULL, min_x DOUBLE NOT NULL, min_y DOUBLE NOT NULL, max_x DOUBLE NOT NULL, max_y DOUBLE NOT NULL, CONSTRAINT fk_gtms_table_name FOREIGN KEY (table_name) REFERENCES gpkg_contents(table_name), CONSTRAINT fk_gtms_srs FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id));
CREATE TABLE gpkg_tile_matrix (table_name TEXT NOT NULL, zoom_level INTEGER NOT NULL, matrix_width INTEGER NOT NULL, matrix_height INTEGER NOT NULL, tile_width INTEGER NOT NULL, tile_height INTEGER NOT NULL, pixel_x_size DOUBLE NOT NULL, pixel_y_size DOUBLE NOT NULL, CONSTRAINT pk_ttm PRIMARY KEY (table_name, zoom_level), CONSTRAINT fk_tmm_table_name FOREIGN KEY (table_name) REFERENCES gpkg_contents(table_name));
CREATE TABLE mnt_visu (id INTEGER PRIMARY KEY AUTOINCREMENT, zoom_level INTEGER NOT NULL, tile_column INTEGER NOT NULL, tile_row INTEGER NOT NULL, tile_data BLOB NOT NULL, UNIQUE (zoom_level, tile_column, tile_row));`);
    const r = db.prepare('INSERT INTO gpkg_spatial_ref_sys VALUES (?,?,?,?,?,?)');
    r.run(['WGS 84 geodetic', 4326, 'EPSG', 4326, 'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]]', null]);
    r.run(['Undefined Cartesian SRS', -1, 'NONE', -1, 'undefined', 'undefined Cartesian coordinate reference system']);
    r.run(['Undefined geographic SRS', 0, 'NONE', 0, 'undefined', 'undefined geographic coordinate reference system']);
    r.run(['WGS 84 / Pseudo-Mercator', 3857, 'EPSG', 3857, WEBMERC_WKT, null]);
    r.free();
    let minx = 1e12, miny = 1e12, maxx = -1e12, maxy = -1e12;
    for (const t of tiles) {
      const ts = W / 2 ** t.z, x0 = -O + t.x * ts, y1 = O - t.y * ts;
      minx = Math.min(minx, x0); maxx = Math.max(maxx, x0 + ts); maxy = Math.max(maxy, y1); miny = Math.min(miny, y1 - ts);
    }
    db.run('INSERT INTO gpkg_contents (table_name,data_type,identifier,description,min_x,min_y,max_x,max_y,srs_id) VALUES (?,?,?,?,?,?,?,?,?)',
      ['mnt_visu', 'tiles', info.name, info.description, minx, miny, maxx, maxy, 3857]);
    db.run('INSERT INTO gpkg_tile_matrix_set VALUES (?,?,?,?,?,?)', ['mnt_visu', 3857, -O, -O, O, O]);
    const m = db.prepare('INSERT INTO gpkg_tile_matrix VALUES (?,?,?,?,?,?,?,?)');
    for (const z of zs) m.run(['mnt_visu', z, 2 ** z, 2 ** z, 256, 256, W / 2 ** z / 256, W / 2 ** z / 256]);
    m.free();
    db.run('BEGIN');
    const s = db.prepare('INSERT INTO mnt_visu (zoom_level,tile_column,tile_row,tile_data) VALUES (?,?,?,?)');
    for (const t of tiles) s.run([t.z, t.x, t.y, t.png]); // GeoPackage : ligne 0 = haut
    s.free(); db.run('COMMIT');
  }
  const out = db.export(); db.close(); return out;
}
if (typeof module !== 'undefined') module.exports = { buildDb };

/* ---------- Partie navigateur ---------- */
if (typeof document !== 'undefined') (function () {
  let SQLP = null, abort = false, running = false, touched = false;

  function range(b, z) {
    const n = 2 ** z, cl = (v) => Math.min(n - 1, Math.max(0, v));
    const X = (lng) => Math.floor((lng + 180) / 360 * n);
    const Y = (lat) => { const r = Math.max(-85.05, Math.min(85.05, lat)) * Math.PI / 180;
      return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n); };
    return { x0: cl(X(b.getWest())), x1: cl(X(b.getEast())), y0: cl(Y(b.getNorth())), y1: cl(Y(b.getSouth())) };
  }
  function listTiles(z0, z1) {
    const b = map.getBounds(), out = [];
    for (let z = z0; z <= z1; z++) { const r = range(b, z);
      for (let x = r.x0; x <= r.x1; x++) for (let y = r.y0; y <= r.y1; y++) out.push({ z, x, y }); }
    return out;
  }
  const zr = () => { let a = +$('#zmin').value || 9, b = +$('#zmax').value || a; a = Math.min(19, Math.max(9, a)); b = Math.min(19, Math.max(a, b)); return [a, b]; };

  function info() {
    const [z0, z1] = zr(), n = listTiles(z0, z1).length, go = $('#expGo');
    $('#expInfo').textContent = n + ' tuiles (≈ ' + Math.round(n * 0.27) + ' Mo à télécharger)' +
      (n > MAX_TILES ? ' — trop : réduisez la zone ou le zoom max (limite ' + MAX_TILES + ').' : '');
    go.disabled = running || n > MAX_TILES || n === 0;
  }
  function autoZoom() { if (touched) return; const z = Math.max(9, Math.min(19, Math.round(map.getZoom())));
    $('#zmin').value = z; $('#zmax').value = Math.min(19, z + 1); }
  ['zmin', 'zmax'].forEach((k) => $('#' + k).addEventListener('input', () => { touched = true; info(); }));
  map.on('moveend', () => { autoZoom(); if (!running) info(); });
  autoZoom(); info();

  function bake(cv) {
    const c = state.contrast / 100, br = state.brightness / 100, op = $('#bakeOp').checked ? state.opacity / 100 : 1;
    if (c === 1 && br === 1 && op === 1) return;
    const ctx = cv.getContext('2d'), im = ctx.getImageData(0, 0, 256, 256), d = im.data;
    for (let i = 0; i < d.length; i += 4) {
      for (let k = 0; k < 3; k++) { const v = (((d[i + k] / 255 - .5) * c + .5) * br) * 255; d[i + k] = v < 0 ? 0 : v > 255 ? 255 : v; }
      d[i + 3] *= op;
    }
    ctx.putImageData(im, 0, 0);
  }
  const hasData = (d) => { for (let i = 0; i < d.length; i += 7) if (d[i] > NODATA) return true; return false; };
  function download(bytes, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }

  async function run() {
    const [z0, z1] = zr(), fmt = $('#fmt').value, tasks = listTiles(z0, z1);
    if (!tasks.length || tasks.length > MAX_TILES) return;
    running = true; abort = false;
    $('#expGo').disabled = true; $('#expCancel').hidden = false; $('#expProg').hidden = false; $('#expProg').value = 0;
    if (state.mode !== 'hill') dem.updateRange(); // échelle fixée pour tout l'export
    const bounds = map.getBounds(), res = [], total = tasks.length;
    let done = 0, failed = 0, i = 0;
    try {
      SQLP = SQLP || await initSqlJs({ locateFile: (f) => 'vendor/sqljs/' + f });
      const worker = async () => {
        while (!abort) {
          const t = tasks[i++]; if (!t) return;
          try {
            const d = await dem._get(t);
            if (hasData(d)) {
              const cv = document.createElement('canvas'); cv.width = cv.height = 256; cv._c = t; cv._d = d;
              dem._paint(cv); bake(cv);
              const blob = await new Promise((r) => cv.toBlob(r, 'image/png'));
              res.push({ ...t, png: new Uint8Array(await blob.arrayBuffer()) });
            }
          } catch (e) { failed++; }
          $('#expProg').value = ++done / total; status('Export : ' + done + ' / ' + total + ' tuiles…');
        }
      };
      await Promise.all(Array.from({ length: 6 }, worker));
      if (abort) { status('Export annulé.'); return; }
      if (!res.length) { status('Aucune donnée MNT dans la zone choisie.'); return; }
      status('Écriture du fichier…');
      await new Promise((r) => setTimeout(r, 30));
      const label = { gray: 'gris', hill: 'ombrage', hypso: 'hypso' }[state.mode];
      const bytes = buildDb(SQLP, fmt, res, {
        name: 'mnt_visu_' + label, description: 'MNT ' + (state.source === 'lidar' ? 'LiDAR HD' : 'RGE ALTI') + ' — rendu ' + label + ' — mnt_visu',
        bounds: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()].map((v) => +v.toFixed(6))
      });
      const stamp = new Date().toISOString().slice(0, 10);
      download(bytes, 'mnt_visu_' + label + '_' + state.source + '_z' + z0 + '-' + z1 + '_' + stamp + (fmt === 'gpkg' ? '.gpkg' : '.mbtiles'));
      status('Export terminé : ' + res.length + ' tuiles, ' + (bytes.length / 1048576).toFixed(1) + ' Mo' + (failed ? ' (' + failed + ' tuiles en échec)' : '') + '.');
    } catch (e) {
      status('Échec de l’export : ' + (e && e.message || e));
    } finally {
      running = false; $('#expCancel').hidden = true; $('#expProg').hidden = true; info();
    }
  }
  $('#expGo').onclick = run;
  $('#expCancel').onclick = () => { abort = true; };
})();
