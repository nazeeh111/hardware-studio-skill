import { installTrayIntent } from './tray-intent.js?v=2';
import { validateTraySpec } from './tray-spec.js?v=4';
import { STORAGE_KEY } from './core.js?v=29';
import { writeWorkspace, WorkspaceConflictError } from './workspace-store.js?v=1';
import { PREVIEW_KEY, previewSnapshot } from './cad-preview.js?v=1';
const schema = 'hardware-studio-tray-v1';
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const $ = selector => document.querySelector(selector);
const rowField = (label, key, value, extra = '') => `<label>${label}<input data-key="${key}" value="${escapeHtml(value ?? '')}" ${extra}></label>`;
const select = (label, key, value, options) => `<label class="type-field">${label}<select data-key="${key}">${options.map(option => `<option value="${option}" ${option === value ? 'selected' : ''}>${option}</option>`).join('')}</select></label>`;
const idField = (label, key, value) => `<label class="wide-field">${label}<input data-key="${key}" maxlength="80" value="${escapeHtml(value ?? '')}"></label>`;
const num = 'type="number" step="0.1"';
let draft = null;
let storageKey = '';
let expectedTrayRaw = null, preservedTrayRaw = null, trayStorageBlocked = false;
let cadAvailable = false;
let previewAvailable = false;
let cadBusy = false;
let fitBusy = false;
let fitReport = null;
let fitRevision = 0;
const rotations = {
  identity: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  x90: [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
  y90: [[0, 0, 1], [0, 1, 0], [-1, 0, 0]],
  z90: [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  z180: [[-1, 0, 0], [0, -1, 0], [0, 0, 1]],
  pico: [[0, 0, 1], [1, 0, 0], [0, 1, 0]]
};

function updateCadButton() {
  $('#generate-cad').disabled = !draft || !cadAvailable || cadBusy;
  $('#preview-cad').disabled = !draft || !previewAvailable || cadBusy || fitBusy;
  $('#download').disabled = !draft;
  $('#check-fit').disabled = !draft || !cadAvailable || fitBusy || cadBusy;
}

async function detectCadService() {
  try {
    const response = await fetch('./api/health', { cache: 'no-store', signal: AbortSignal.timeout(3000) });
    const status = await response.json();
    cadAvailable = response.ok && status.ok === true && status.schema === schema;
    previewAvailable = cadAvailable && status.features?.includes('tray-preview-v1');
  } catch { cadAvailable = false; previewAvailable = false; }
  $('#cad-status').textContent = cadAvailable ? 'Local OpenCascade runtime ready. CAD builds stay on this computer.' + (previewAvailable ? '' : ' Restart the server from the current repository to enable direct 3D previews.') : 'Local CAD runtime unavailable here. Download the spec, then start the free local server shown below.';
  $('#fit-status').textContent = cadAvailable ? 'Choose maker STEP files and enter measured placements to compare their modeled solids.' : 'Start the local CAD runtime to check supplied models.';
  $('#cad-status').classList.toggle('error', !cadAvailable);
  updateCadButton();
}

function mountRow(mount, index) {
  const type = mount.holeRadius != null ? 'through-hole' : mount.locatorRadius != null ? 'locator' : 'plain';
  return `<div class="row-card" data-mount="${index}"><div class="row-top"><strong>BOSS / ${String(index + 1).padStart(2, '0')}</strong><button type="button" data-remove-mount="${index}" aria-label="Remove boss ${index + 1}">Remove ×</button></div><div class="row-fields">${idField('ID', 'id', mount.id)}${select('Top feature', 'type', type, ['locator', 'through-hole', 'plain'])}${rowField('Center X / mm', 'x', mount.x, num)}${rowField('Center Y / mm', 'y', mount.y, num)}${rowField('Boss radius / mm', 'bossRadius', mount.bossRadius, num)}${rowField('Boss top Z / mm', 'bossTopZ', mount.bossTopZ, num)}${type === 'locator' ? rowField('Locator radius / mm', 'locatorRadius', mount.locatorRadius ?? .8, num) + rowField('Locator height / mm', 'locatorHeight', mount.locatorHeight ?? 1.2, num) : type === 'through-hole' ? rowField('Hole radius / mm', 'holeRadius', mount.holeRadius ?? 1, num) : ''}</div></div>`;
}
function cutoutRow(cutout, index) {
  return `<div class="row-card" data-cutout="${index}"><div class="row-top"><strong>OPENING / ${String(index + 1).padStart(2, '0')}</strong><button type="button" data-remove-cutout="${index}" aria-label="Remove opening ${index + 1}">Remove ×</button></div><div class="row-fields">${select('Wall', 'edge', cutout.edge, ['left', 'right', 'front', 'back'])}${rowField('Start / mm', 'start', cutout.start, num)}${rowField('End / mm', 'end', cutout.end, num)}${rowField('Bottom Z / mm', 'bottom', cutout.bottom, num)}${rowField('Top Z / mm', 'top', cutout.top, num)}</div></div>`;
}
function readRows(selector) {
  return [...document.querySelectorAll(selector)].map(row => {
    const value = Object.fromEntries([...row.querySelectorAll('[data-key]')].map(input => [input.dataset.key, input.value]));
    const result = { ...value };
    if (selector === '[data-mount]') {
      delete result.type;
      if (value.type === 'plain') { delete result.locatorRadius; delete result.locatorHeight; delete result.holeRadius; }
      if (value.type === 'locator') delete result.holeRadius;
      if (value.type === 'through-hole') { delete result.locatorRadius; delete result.locatorHeight; }
    }
    return result;
  });
}
function readForm() {
  const form = new FormData($('#tray-form'));
  const lid = $('#lid-enabled').checked ? { thickness: form.get('lidThickness'), skirtDepth: form.get('lidSkirtDepth'), skirtWall: form.get('lidSkirtWall'), clearance: form.get('lidClearance'),
    window: $('#lid-window-enabled').checked ? { x: form.get('windowX'), y: form.get('windowY'), length: form.get('windowLength'), width: form.get('windowWidth') } : null } : null;
  return { schema, title: form.get('title'), units: 'mm', outer: { length: form.get('length'), width: form.get('width'), height: form.get('height') }, wall: form.get('wall'), floor: form.get('floor'), mounts: readRows('[data-mount]'), cutouts: readRows('[data-cutout]'), lid };
}
function svg(spec) {
  const { length, width, height } = spec.outer;
  const scale = Math.min(7, 520 / Math.max(length, width));
  const coverMargin = spec.lid ? (spec.lid.clearance + spec.lid.skirtWall) * scale : 0;
  const x0 = 72 + coverMargin, y0 = 66 + coverMargin, w = length * scale, h = width * scale, border = spec.wall * scale;
  const cover = spec.lid ? `<rect class="cover-outline" x="${x0 - coverMargin}" y="${y0 - coverMargin}" width="${w + 2 * coverMargin}" height="${h + 2 * coverMargin}"/>` : '';
  const openings = spec.cutouts.map(cut => {
    const a = cut.start * scale, b = cut.end * scale;
    const values = cut.edge === 'left' ? [x0 - 1, y0 + a, border + 2, b - a] : cut.edge === 'right' ? [x0 + w - border - 1, y0 + a, border + 2, b - a] : cut.edge === 'front' ? [x0 + a, y0 - 1, b - a, border + 2] : [x0 + a, y0 + h - border - 1, b - a, border + 2];
    return `<rect x="${values[0]}" y="${values[1]}" width="${values[2]}" height="${values[3]}" fill="#f0efe8" stroke="#a46748" stroke-width="1.5"/>`;
  }).join('');
  const mounts = spec.mounts.map(m => `<g><circle cx="${x0 + m.x * scale}" cy="${y0 + m.y * scale}" r="${m.bossRadius * scale}" fill="#b8ceb0" stroke="#496a4c" stroke-width="1.5"/>${m.holeRadius ? `<circle cx="${x0 + m.x * scale}" cy="${y0 + m.y * scale}" r="${m.holeRadius * scale}" fill="#f0efe8" stroke="#496a4c"/>` : m.locatorRadius ? `<circle cx="${x0 + m.x * scale}" cy="${y0 + m.y * scale}" r="${m.locatorRadius * scale}" fill="#496a4c"/>` : ''}<text x="${x0 + (m.x + m.bossRadius) * scale + 5}" y="${y0 + m.y * scale - 3}" fill="#335139" font-size="9" font-family="monospace">${escapeHtml(m.id)}</text></g>`).join('');
  const lightOpening = spec.lid?.window ? `<rect class="light-opening" x="${x0 + spec.lid.window.x * scale}" y="${y0 + spec.lid.window.y * scale}" width="${spec.lid.window.length * scale}" height="${spec.lid.window.width * scale}"/><text x="${x0 + spec.lid.window.x * scale + 7}" y="${y0 + spec.lid.window.y * scale + 15}" font-size="9" font-family="monospace" fill="#6b5b20">LIGHT OPENING</text>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w + 145 + 2 * coverMargin} ${h + 145 + 2 * coverMargin}" role="img" aria-label="Scaled tray top view${spec.lid ? ' with lift-off cover outline' : ''}${spec.lid?.window ? ' and light opening' : ''}; physical fit unverified"><rect width="100%" height="100%" fill="#edf2e7"/><text x="72" y="28" font-family="monospace" font-size="10" fill="#657d66">TOP PLAN / mm / FIT UNTESTED</text>${cover}<rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="#c8dbb2" stroke="#243c2e" stroke-width="2"/><rect x="${x0 + border}" y="${y0 + border}" width="${w - 2 * border}" height="${h - 2 * border}" fill="#edf2e7" stroke="#738d77"/>${openings}${mounts}${lightOpening}<path d="M${x0} ${y0 + h + 18}H${x0 + w}M${x0} ${y0 + h + 13}v10M${x0 + w} ${y0 + h + 13}v10" stroke="#395640"/><text x="${x0 + w / 2}" y="${y0 + h + 36}" font-size="10" font-family="monospace" text-anchor="middle" fill="#395640">${length} mm</text><path d="M${x0 - 20} ${y0}V${y0 + h}M${x0 - 25} ${y0}h10M${x0 - 25} ${y0 + h}h10" stroke="#395640"/><text x="${x0 - 30}" y="${y0 + h / 2}" transform="rotate(-90 ${x0 - 30} ${y0 + h / 2})" font-size="10" font-family="monospace" text-anchor="middle" fill="#395640">${width} mm</text><text x="72" y="${y0 + h + 60}" font-size="9" font-family="monospace" fill="#627c67">HEIGHT ${height} · WALL ${spec.wall} · FLOOR ${spec.floor} · ${spec.mounts.length} BOSSES · ${spec.cutouts.length} OPENINGS${spec.lid ? ` · COVER ${spec.lid.clearance} CLEARANCE` : ''}${spec.lid?.window ? ` · WINDOW ${spec.lid.window.length}×${spec.lid.window.width}` : ''}</text></svg>`;
}
function show() {
  fitRevision += 1;
  if (fitReport) { fitReport = null; $('#fit-result').replaceChildren(); $('#fit-status').textContent = 'Tray changed. Run the fit check again for this geometry.'; }
  try {
    const spec = validateTraySpec(readForm());
    draft = spec;
    $('#preview').innerHTML = svg(spec);
    let persisted = false;
    try { if (storageKey && !trayStorageBlocked) { expectedTrayRaw = writeWorkspace(localStorage, storageKey, expectedTrayRaw, JSON.stringify(spec)); persisted = true; } }
    catch (error) {
      if (error instanceof WorkspaceConflictError) {
        preservedTrayRaw = localStorage.getItem(storageKey); trayStorageBlocked = true;
        $('#tray-storage-recovery').hidden = false; $('#replace-tray-draft').disabled = true;
      }
      // Keep the form and spec export available when storage cannot be written.
    }
    $('#status').textContent = `Valid generator input. Cavity: ${(spec.outer.length - 2 * spec.wall).toFixed(1)} × ${(spec.outer.width - 2 * spec.wall).toFixed(1)} × ${(spec.outer.height - spec.floor).toFixed(1)} mm. ${spec.lid ? `Lift-off cover side clearance ${spec.lid.clearance.toFixed(1)} mm is nominal and untested. ` : ''}${spec.lid?.window ? `Opening ${spec.lid.window.length.toFixed(1)} × ${spec.lid.window.width.toFixed(1)} mm has no diffuser. ` : ''}${persisted ? 'Draft saved in this browser.' : trayStorageBlocked ? 'Saved draft preserved; this form has not replaced it. Download the current spec to keep these edits.' : 'Browser storage unavailable; download the spec now.'} Check exact parts and clearance separately.`;
    $('#status').classList.remove('error');
    $('#status-chip').textContent = 'SPEC READY'; $('#status-chip').classList.remove('invalid');
    updateCadButton();
  } catch (error) {
    draft = null; $('#preview').innerHTML = '<div class="placeholder">Adjust dimensions to see the scaled plan.</div>';
    $('#status').textContent = error.message; $('#status').classList.add('error');
    $('#status-chip').textContent = 'CHECK INPUT'; $('#status-chip').classList.add('invalid');
    updateCadButton();
  }
}
function fitRow(index, values = {}) {
  const id = values.id || `component-${index + 1}`;
  const xyz = values.translationMm || [0, 0, 0];
  const orientation = values.orientation || 'identity';
  return `<div class="fit-card"><div class="row-top"><strong>EXACT MODEL / ${String(index + 1).padStart(2, '0')}</strong><button type="button" data-remove-fit="${index}" aria-label="Remove STEP model ${index + 1}">Remove ×</button></div><label>Part ID<input data-fit="id" maxlength="80" value="${escapeHtml(id)}"></label><label>Maker STEP file<input data-fit="file" type="file" accept=".step,.stp"></label><div class="fit-coordinates">${['X', 'Y', 'Z'].map((axis, number) => `<label>${axis} / mm<input data-fit="${axis.toLowerCase()}" type="number" step="0.1" value="${escapeHtml(xyz[number])}"></label>`).join('')}</div><label>Source axes → tray axes<select data-fit="orientation">${Object.keys(rotations).map(key => `<option value="${key}" ${key === orientation ? 'selected' : ''}>${key === 'identity' ? 'As modeled' : key === 'pico' ? 'X←Z, Y←X, Z←Y' : key.toUpperCase()}</option>`).join('')}</select></label></div>`;
}
function resetFitReport() {
  fitRevision += 1;
  fitReport = null;
  $('#fit-result').replaceChildren();
  $('#fit-status').textContent = 'Placement or model changed. Run the fit check again.';
}
function downloadJson(name, data) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
async function fileBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1]);
    reader.onerror = () => reject(new Error('Could not read a STEP file.'));
    reader.readAsDataURL(file);
  });
}
async function runFit() {
  if (!draft || !cadAvailable || fitBusy || cadBusy) return;
  const spec = draft;
  const revision = fitRevision;
  const rows = [...document.querySelectorAll('.fit-card')];
  if (!rows.length || rows.length > 4) throw new Error('Choose one to four STEP models.');
  const ids = new Set();
  const components = [];
  let totalBytes = 0;
  for (const row of rows) {
    const value = key => row.querySelector(`[data-fit="${key}"]`).value;
    const id = value('id').trim();
    const file = row.querySelector('[data-fit="file"]').files?.[0];
    if (!id || ids.has(id)) throw new Error('Give every STEP model a unique part ID.');
    ids.add(id);
    if (!file || !/\.(step|stp)$/i.test(file.name) || file.size > 8_000_000) throw new Error(`Choose a .step or .stp file under 8 MB for ${id}.`);
    totalBytes += file.size;
    if (totalBytes > 17_000_000) throw new Error('Selected STEP files must total less than 17 MB.');
    const translationMm = ['x', 'y', 'z'].map(key => Number(value(key)));
    if (translationMm.some(number => !Number.isFinite(number) || Math.abs(number) > 10000)) throw new Error(`Enter finite placement coordinates for ${id}.`);
    components.push({ id, translationMm, rotation: rotations[value('orientation')], dataBase64: await fileBase64(file) });
  }
  fitBusy = true; updateCadButton();
  $('#fit-status').textContent = `Generating the current tray${spec.lid ? ' and cover' : ''} and checking supplied STEP solids locally…`;
  $('#fit-status').classList.remove('error');
  try {
    const response = await fetch('./api/fit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schema: 'hardware-studio-browser-fit-v1', traySpec: spec, components }), signal: AbortSignal.timeout(250000) });
    const report = await response.json();
    if (!response.ok) throw new Error(report.error || 'The fit check failed.');
    if (report.schema !== 'hardware-studio-fit-report-v1') throw new Error('The local service returned an unfamiliar fit report.');
    if (fitRevision !== revision || draft !== spec) throw new Error('Geometry or placement changed while checking. Run the check again.');
    fitReport = report;
    const collisions = [
      ...report.components.filter(item => item.tray_interference_above_threshold ?? item.tray_overlap_mm3 > report.overlap_limit_mm3).map(item => `${item.id} intersects tray by ${item.tray_overlap_mm3.toFixed(2)} mm³`),
      ...report.components.filter(item => item.lid_interference_above_threshold ?? (item.lid_overlap_mm3 != null && item.lid_overlap_mm3 > report.overlap_limit_mm3)).map(item => `${item.id} intersects cover by ${item.lid_overlap_mm3.toFixed(2)} mm³`),
      ...report.component_pairs.filter(item => item.interference_above_threshold).map(item => `${item.parts.join(' ↔ ')} overlap by ${item.overlap_mm3.toFixed(2)} mm³`)
    ];
    const result = $('#fit-result');
    result.innerHTML = `<strong class="${collisions.length ? 'fit-alert' : 'fit-clear'}">${collisions.length ? 'MODELED INTERFERENCE' : 'NO MODELED INTERSECTION'}</strong><p>${collisions.length ? collisions.map(escapeHtml).join('<br>') : `${report.components.length} supplied models checked against the tray${report.lid_bounds ? ' and seated cover' : ''} at the entered coordinates. Inspect source hashes, distances and cavity margins in the report.`}</p><button id="download-fit-report" type="button">Download fit report ↓</button><small>This is nominal model geometry. Tolerances, connectors, cables and physical assembly remain untested.</small>`;
    result.querySelector('button').addEventListener('click', () => downloadJson('hardware-studio-fit-report.json', fitReport));
    $('#fit-status').textContent = `Fit check complete. ${collisions.length} modeled collisions above ${report.overlap_limit_mm3} mm³.`;
  } finally { fitBusy = false; updateCadButton(); }
}
function populate(spec) {
  $('#title').value = spec.title;
  for (const [key, value] of Object.entries(spec.outer)) $(`[name="${key}"]`).value = value;
  $('[name="wall"]').value = spec.wall; $('[name="floor"]').value = spec.floor;
  $('#lid-enabled').checked = Boolean(spec.lid);
  for (const [key, value] of Object.entries({ lidThickness: spec.lid?.thickness ?? 2.5, lidSkirtDepth: spec.lid?.skirtDepth ?? 3, lidSkirtWall: spec.lid?.skirtWall ?? 2, lidClearance: spec.lid?.clearance ?? .5 })) $(`[name="${key}"]`).value = value;
  $('#lid-window-enabled').checked = Boolean(spec.lid?.window);
  for (const [key, value] of Object.entries({ windowX: spec.lid?.window?.x ?? 6, windowY: spec.lid?.window?.y ?? 27, windowLength: spec.lid?.window?.length ?? 54, windowWidth: spec.lid?.window?.width ?? 14 })) $(`[name="${key}"]`).value = value;
  syncCoverInputs();
  $('#mounts').innerHTML = spec.mounts.map(mountRow).join('') || '<div class="empty">No bosses. Add measured mounting points if needed.</div>';
  $('#cutouts').innerHTML = spec.cutouts.map(cutoutRow).join('') || '<div class="empty">No openings. Add access for connectors, airflow or cables if needed.</div>';
  show();
}
function syncCoverInputs() {
  const enabled = $('#lid-enabled').checked;
  $('#lid-fields').classList.toggle('is-disabled', !enabled);
  $('#lid-fields').querySelectorAll('input').forEach(input => { input.disabled = !enabled; });
  $('#lid-window-enabled').disabled = !enabled;
  const windowEnabled = enabled && $('#lid-window-enabled').checked;
  $('#lid-window-fields').classList.toggle('is-disabled', !windowEnabled);
  $('#lid-window-fields').querySelectorAll('input').forEach(input => { input.disabled = !windowEnabled; });
}
function appendRow(kind) {
  const container = kind === 'mount' ? $('#mounts') : $('#cutouts');
  const count = container.querySelectorAll(kind === 'mount' ? '[data-mount]' : '[data-cutout]').length;
  container.querySelector('.empty')?.remove();
  const row = kind === 'mount' ? { id: `boss-${count + 1}`, x: 12, y: 12, bossRadius: 2, bossTopZ: 7, locatorRadius: .8, locatorHeight: 1.2 } : { edge: 'left', start: 7, end: 20, bottom: 3, top: 18 };
  container.insertAdjacentHTML('beforeend', kind === 'mount' ? mountRow(row, count) : cutoutRow(row, count));
  show();
}
function initialize() {
  $('#fit-components').innerHTML = fitRow(0);
  const url = new URL(location.href);
  const projectId = (url.searchParams.get('project') || '').slice(0, 80);
  storageKey = projectId ? `hardware-studio-tray-${projectId}` : 'hardware-studio-tray-standalone';
  const projectTitle = (url.searchParams.get('title') || 'Prototype').slice(0, 80);
  let initial = { schema, title: `${projectTitle} tray study`, units: 'mm', outer: { length: 80, width: 55, height: 18 }, wall: 2.5, floor: 2.5, mounts: [], cutouts: [] };
  let loaded = false;
  try { expectedTrayRaw = localStorage.getItem(storageKey); if (expectedTrayRaw !== null) { initial = validateTraySpec(JSON.parse(expectedTrayRaw)); loaded = true; } }
  catch { if (expectedTrayRaw !== null) { preservedTrayRaw = expectedTrayRaw; trayStorageBlocked = true; $('#tray-storage-recovery').hidden = false; } }
  $('#backup-tray-draft').addEventListener('click', () => {
    const raw = preservedTrayRaw ?? ''; const blob = new Blob([raw], {type:'application/json'}), url = URL.createObjectURL(blob);
    const anchor = document.createElement('a'); anchor.href=url; anchor.download='hardware-studio-original-tray-draft.json'; anchor.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
    $('#replace-tray-draft').disabled=false;
  });
  $('#replace-tray-draft').addEventListener('click', () => {
    if (!draft || $('#replace-tray-draft').disabled) return;
    try { expectedTrayRaw = writeWorkspace(localStorage,storageKey,preservedTrayRaw,JSON.stringify(draft)); trayStorageBlocked=false;preservedTrayRaw=null;$('#tray-storage-recovery').hidden=true;show(); }
    catch { $('#replace-tray-draft').disabled=true;try { preservedTrayRaw=localStorage.getItem(storageKey); } catch {} $('#status').textContent='Saved draft changed again or could not be written. Back up the current saved bytes before replacing it.'; }
  });
  if (!loaded && projectId) {
    try {
      const workspace = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      const attached = workspace?.projects?.find(project => project.id === projectId)?.traySpec;
      if (attached) initial = validateTraySpec(attached);
    } catch { /* Keep the blank measured study. */ }
  }
  populate(initial);
  installTrayIntent({readSpec:readForm,applySpec:populate});
  void detectCadService();
  $('#tray-form').addEventListener('submit', event => event.preventDefault());
  $('#tray-form').addEventListener('input', event => { if (event.target.id === 'lid-enabled' || event.target.id === 'lid-window-enabled') syncCoverInputs(); show(); });
  $('#fit-components').addEventListener('input', resetFitReport);
  $('#fit-components').addEventListener('change', resetFitReport);
  $('#add-fit-component').addEventListener('click', () => {
    const count = document.querySelectorAll('.fit-card').length;
    if (count >= 4) return;
    $('#fit-components').insertAdjacentHTML('beforeend', fitRow(count));
    resetFitReport();
    $('#add-fit-component').disabled = count + 1 >= 4;
  });
  $('#fit-components').addEventListener('click', event => {
    const button = event.target.closest('[data-remove-fit]');
    if (!button) return;
    button.closest('.fit-card').remove();
    $('#add-fit-component').disabled = false;
    resetFitReport();
  });
  $('#check-fit').addEventListener('click', async () => {
    try { await runFit(); }
    catch (error) { $('#fit-status').textContent = error.name === 'TimeoutError' ? 'Fit check timed out. Inspect the local server terminal.' : error.message; $('#fit-status').classList.add('error'); }
  });
  $('#tray-form').addEventListener('change', event => { if (event.target.id === 'lid-enabled' || event.target.id === 'lid-window-enabled') syncCoverInputs(); if (event.target.dataset.key === 'type') { const raw = readForm(); const index = Number(event.target.closest('[data-mount]').dataset.mount); const mount = raw.mounts[index]; mount.type = event.target.value; if (mount.type === 'locator') { mount.locatorRadius = .8; mount.locatorHeight = 1.2; } if (mount.type === 'through-hole') mount.holeRadius = 1; $('#mounts').querySelector(`[data-mount="${index}"]`).outerHTML = mountRow(mount, index); } show(); });
  $('#add-mount').addEventListener('click', () => appendRow('mount'));
  $('#add-cutout').addEventListener('click', () => appendRow('cutout'));
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-remove-mount],[data-remove-cutout]');
    if (!button) return;
    const container = button.closest('.rows');
    button.closest('.row-card').remove();
    const remaining = container.id === 'mounts' ? readRows('[data-mount]') : readRows('[data-cutout]');
    container.innerHTML = remaining.length ? remaining.map(container.id === 'mounts' ? mountRow : cutoutRow).join('') : `<div class="empty">No ${container.id === 'mounts' ? 'bosses' : 'openings'} yet.</div>`;
    show();
  });
  $('#download').addEventListener('click', () => {
    if (!draft) return;
    const file = `${draft.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tray'}-spec.json`;
    const url = URL.createObjectURL(new Blob([JSON.stringify(draft, null, 2) + '\n'], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = file; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  });
  $('#preview-cad').addEventListener('click', () => {
    if(!draft||!cadAvailable||cadBusy||fitBusy)return;
    try {
      const frozen=previewSnapshot(draft,location.search),raw=JSON.stringify(frozen);
      if(raw.length>65536)throw new Error('This tray snapshot is too large for preview. Download the CAD package instead.');
      sessionStorage.setItem(PREVIEW_KEY,raw);
      location.href='./cad-viewer.html?generated=1';
    } catch(error) { $('#cad-status').textContent='Could not open 3D preview: '+error.message;$('#cad-status').classList.add('error'); }
  });
  $('#generate-cad').addEventListener('click', async () => {
    if (!draft || !cadAvailable || cadBusy) return;
    const spec = draft;
    cadBusy = true; updateCadButton();
    $('#cad-status').textContent = 'Generating and reopening STEP/STL locally. This may take a minute…';
    $('#cad-status').classList.remove('error');
    try {
      const response = await fetch('./api/tray', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(spec), signal: AbortSignal.timeout(130000)
      });
      if (!response.ok) {
        let detail = 'CAD generation failed.';
        try { detail = (await response.json()).error || detail; } catch { /* Keep the generic error. */ }
        throw new Error(detail);
      }
      if (!response.headers.get('Content-Type')?.startsWith('application/zip')) throw new Error('The local service did not return a CAD package.');
      const zip = await response.blob();
      const slug = spec.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tray';
      const url = URL.createObjectURL(zip);
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${slug}-cad.zip`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      $('#cad-status').textContent = 'CAD package downloaded. Inspect verification.json; exact part fit and fabrication remain untested.';
    } catch (error) {
      $('#cad-status').textContent = error.name === 'TimeoutError' ? 'CAD generation timed out. Check the local server terminal.' : error.message;
      $('#cad-status').classList.add('error');
    } finally { cadBusy = false; updateCadButton(); }
  });
  $('#load-example').addEventListener('click', async () => {
    try { const response = await fetch('./tools/tray-generator/examples/pico-neopixel-tray.json'); if (!response.ok) throw new Error('Example unavailable.'); populate(validateTraySpec(await response.json())); }
    catch (error) { $('#status').textContent = error.message; $('#status').classList.add('error'); }
  });
  $('#import-spec').addEventListener('change', async event => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    if (file.size > 65536) { $('#status').textContent = 'Choose a spec under 64 KB.'; $('#status').classList.add('error'); return; }
    try { populate(validateTraySpec(JSON.parse(await file.text()))); }
    catch (error) { $('#status').textContent = error.message; $('#status').classList.add('error'); }
  });
}
if (typeof document !== 'undefined') initialize();
