import { validateTraySpec } from './tray-spec.js?v=2';
const schema = 'hardware-studio-tray-v1';
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const $ = selector => document.querySelector(selector);
const rowField = (label, key, value, extra = '') => `<label>${label}<input data-key="${key}" value="${escapeHtml(value ?? '')}" ${extra}></label>`;
const select = (label, key, value, options) => `<label class="type-field">${label}<select data-key="${key}">${options.map(option => `<option value="${option}" ${option === value ? 'selected' : ''}>${option}</option>`).join('')}</select></label>`;
const idField = (label, key, value) => `<label class="wide-field">${label}<input data-key="${key}" maxlength="80" value="${escapeHtml(value ?? '')}"></label>`;
const num = 'type="number" step="0.1"';
let draft = null;
let storageKey = '';
let cadAvailable = false;
let cadBusy = false;

function updateCadButton() {
  $('#generate-cad').disabled = !draft || !cadAvailable || cadBusy;
  $('#download').disabled = !draft;
}

async function detectCadService() {
  try {
    const response = await fetch('./api/health', { cache: 'no-store', signal: AbortSignal.timeout(3000) });
    const status = await response.json();
    cadAvailable = response.ok && status.ok === true && status.schema === schema;
  } catch { cadAvailable = false; }
  $('#cad-status').textContent = cadAvailable ? 'Local OpenCascade runtime ready. CAD builds stay on this computer.' : 'Local CAD runtime unavailable here. Download the spec, then start the free local server shown below.';
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
  return { schema, title: form.get('title'), units: 'mm', outer: { length: form.get('length'), width: form.get('width'), height: form.get('height') }, wall: form.get('wall'), floor: form.get('floor'), mounts: readRows('[data-mount]'), cutouts: readRows('[data-cutout]') };
}
function svg(spec) {
  const { length, width, height } = spec.outer;
  const scale = Math.min(7, 520 / Math.max(length, width));
  const x0 = 72, y0 = 66, w = length * scale, h = width * scale, border = spec.wall * scale;
  const openings = spec.cutouts.map(cut => {
    const a = cut.start * scale, b = cut.end * scale;
    const values = cut.edge === 'left' ? [x0 - 1, y0 + a, border + 2, b - a] : cut.edge === 'right' ? [x0 + w - border - 1, y0 + a, border + 2, b - a] : cut.edge === 'front' ? [x0 + a, y0 - 1, b - a, border + 2] : [x0 + a, y0 + h - border - 1, b - a, border + 2];
    return `<rect x="${values[0]}" y="${values[1]}" width="${values[2]}" height="${values[3]}" fill="#f0efe8" stroke="#a46748" stroke-width="1.5"/>`;
  }).join('');
  const mounts = spec.mounts.map(m => `<g><circle cx="${x0 + m.x * scale}" cy="${y0 + m.y * scale}" r="${m.bossRadius * scale}" fill="#b8ceb0" stroke="#496a4c" stroke-width="1.5"/>${m.holeRadius ? `<circle cx="${x0 + m.x * scale}" cy="${y0 + m.y * scale}" r="${m.holeRadius * scale}" fill="#f0efe8" stroke="#496a4c"/>` : m.locatorRadius ? `<circle cx="${x0 + m.x * scale}" cy="${y0 + m.y * scale}" r="${m.locatorRadius * scale}" fill="#496a4c"/>` : ''}<text x="${x0 + (m.x + m.bossRadius) * scale + 5}" y="${y0 + m.y * scale - 3}" fill="#335139" font-size="9" font-family="monospace">${escapeHtml(m.id)}</text></g>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w + 145} ${h + 145}" role="img" aria-label="Scaled tray top view; physical fit unverified"><rect width="100%" height="100%" fill="#edf2e7"/><text x="72" y="28" font-family="monospace" font-size="10" fill="#657d66">TOP PLAN / mm / FIT UNTESTED</text><rect x="${x0}" y="${y0}" width="${w}" height="${h}" fill="#c8dbb2" stroke="#243c2e" stroke-width="2"/><rect x="${x0 + border}" y="${y0 + border}" width="${w - 2 * border}" height="${h - 2 * border}" fill="#edf2e7" stroke="#738d77"/>${openings}${mounts}<path d="M${x0} ${y0 + h + 18}H${x0 + w}M${x0} ${y0 + h + 13}v10M${x0 + w} ${y0 + h + 13}v10" stroke="#395640"/><text x="${x0 + w / 2}" y="${y0 + h + 36}" font-size="10" font-family="monospace" text-anchor="middle" fill="#395640">${length} mm</text><path d="M${x0 - 20} ${y0}V${y0 + h}M${x0 - 25} ${y0}h10M${x0 - 25} ${y0 + h}h10" stroke="#395640"/><text x="${x0 - 30}" y="${y0 + h / 2}" transform="rotate(-90 ${x0 - 30} ${y0 + h / 2})" font-size="10" font-family="monospace" text-anchor="middle" fill="#395640">${width} mm</text><text x="72" y="${h + 126}" font-size="9" font-family="monospace" fill="#627c67">HEIGHT ${height} · WALL ${spec.wall} · FLOOR ${spec.floor} · ${spec.mounts.length} BOSSES · ${spec.cutouts.length} OPENINGS</text></svg>`;
}
function show() {
  try {
    const spec = validateTraySpec(readForm());
    draft = spec;
    $('#preview').innerHTML = svg(spec);
    let persisted = false;
    try { if (storageKey) { localStorage.setItem(storageKey, JSON.stringify(spec)); persisted = true; } } catch { /* The file download still works. */ }
    $('#status').textContent = `Valid generator input. Cavity: ${(spec.outer.length - 2 * spec.wall).toFixed(1)} × ${(spec.outer.width - 2 * spec.wall).toFixed(1)} × ${(spec.outer.height - spec.floor).toFixed(1)} mm. ${persisted ? 'Draft saved in this browser.' : 'Browser storage unavailable; download the spec now.'} Check exact parts and clearance separately.`;
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
function populate(spec) {
  $('#title').value = spec.title;
  for (const [key, value] of Object.entries(spec.outer)) $(`[name="${key}"]`).value = value;
  $('[name="wall"]').value = spec.wall; $('[name="floor"]').value = spec.floor;
  $('#mounts').innerHTML = spec.mounts.map(mountRow).join('') || '<div class="empty">No bosses. Add measured mounting points if needed.</div>';
  $('#cutouts').innerHTML = spec.cutouts.map(cutoutRow).join('') || '<div class="empty">No openings. Add access for connectors, airflow or cables if needed.</div>';
  show();
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
  const url = new URL(location.href);
  const projectId = (url.searchParams.get('project') || '').slice(0, 80);
  storageKey = projectId ? `hardware-studio-tray-${projectId}` : 'hardware-studio-tray-standalone';
  const projectTitle = (url.searchParams.get('title') || 'Prototype').slice(0, 80);
  let initial = { schema, title: `${projectTitle} tray study`, units: 'mm', outer: { length: 80, width: 55, height: 18 }, wall: 2.5, floor: 2.5, mounts: [], cutouts: [] };
  try { const saved = localStorage.getItem(storageKey); if (saved) initial = validateTraySpec(JSON.parse(saved)); } catch { /* Start from defaults if a draft is unavailable. */ }
  populate(initial);
  void detectCadService();
  $('#tray-form').addEventListener('submit', event => event.preventDefault());
  $('#tray-form').addEventListener('input', show);
  $('#tray-form').addEventListener('change', event => { if (event.target.dataset.key === 'type') { const raw = readForm(); const index = Number(event.target.closest('[data-mount]').dataset.mount); const mount = raw.mounts[index]; mount.type = event.target.value; if (mount.type === 'locator') { mount.locatorRadius = .8; mount.locatorHeight = 1.2; } if (mount.type === 'through-hole') mount.holeRadius = 1; $('#mounts').querySelector(`[data-mount="${index}"]`).outerHTML = mountRow(mount, index); } show(); });
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
