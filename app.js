import { STARTERS, STORAGE_KEY, makeProject, blankProject, stats, validate, bomCsv, safeProject, localAiDraft, powerBudget, partReviewRecorded } from './core.js?v=11';

const $ = selector => document.querySelector(selector);
const html = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeUrl = value => /^https?:\/\//i.test(String(value || '')) ? String(value) : '';
const money = value => '$' + Number(value || 0).toFixed(2);
let projects = [];
let currentId = '';
let activeTab = 'overview';
let editor = null;
let toastTimer;
let draftController = null;
let pendingDraft = null;
const OLLAMA_URL = 'http://127.0.0.1:11434';
const LOCAL_AI_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' }, brief: { type: 'string' }, summary: { type: 'string' }, notes: { type: 'string' },
    parts: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, category: { type: 'string' }, qty: { type: 'integer' }, unitCost: { type: 'number' }, detail: { type: 'string' }, voltage: { type: 'string' }, sourceUrl: { type: 'string' }, verified: { type: 'boolean' } }, required: ['id', 'name', 'category', 'qty', 'unitCost', 'detail', 'voltage', 'sourceUrl', 'verified'] } },
    wires: { type: 'array', items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' }, signal: { type: 'string' }, voltage: { type: 'string' }, note: { type: 'string' } }, required: ['from', 'to', 'signal', 'voltage', 'note'] } },
    steps: { type: 'array', items: { type: 'object', properties: { phase: { type: 'string' }, title: { type: 'string' }, detail: { type: 'string' } }, required: ['phase', 'title', 'detail'] } }
  },
  required: ['title', 'brief', 'summary', 'notes', 'parts', 'wires', 'steps']
};

async function detectLocalModels() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, { signal: controller.signal });
    if (!response.ok) throw new Error('Local model list unavailable');
    const data = await response.json();
    const names = (data.models || []).map(model => model.name).filter(name => typeof name === 'string');
    if (!names.length) throw new Error('No local models installed');
    const select = $('#local-model');
    select.innerHTML = names.map(name => `<option value="${html(name)}">${html(name)}</option>`).join('');
    select.value = names.includes('local-fast:latest') ? 'local-fast:latest' : names.includes('qwen3:4b') ? 'qwen3:4b' : names[0];
    select.hidden = false;
    $('#draft-local').hidden = false;
    $('#local-ai-status').textContent = 'Optional local model draft. No paid API.';
  } catch {
    $('#local-ai-status').textContent = 'Use a starter or create a blank, editable concept.';
  } finally { clearTimeout(timer); }
}

async function draftWithLocalAi() {
  if (draftController) { draftController.abort(); return; }
  const brief = $('#brief-input').value.trim();
  if (!brief) return showToast('Describe the build before drafting with local AI.');
  const model = $('#local-model').value;
  if (!model) return showToast('Choose a local model.');
  const button = $('#draft-local');
  draftController = new AbortController();
  const controller = draftController;
  const timer = setTimeout(() => controller.abort(), 300000);
  button.textContent = 'Cancel local draft';
  $('#create-from-brief').disabled = true;
  $('#local-model').disabled = true;
  $('#local-ai-status').textContent = 'Drafting on this computer. This can take a few minutes.';
  try {
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({
        model, stream: false, format: LOCAL_AI_SCHEMA, think: false, keep_alive: '1m',
        options: { temperature: 0.1, num_predict: 2400 },
        system: 'You draft conceptual low-voltage hobby hardware plans. Every requested sensing, display, input, or actuation function needs a dedicated physical part; a controller alone does not measure temperature or humidity. Include power conversion, cables and enclosure parts where needed. Do not claim that parts, pinouts, prices, sourcing, dimensions, wiring, or safety are verified. Use unique short part IDs and ensure each wire refers to existing part IDs. For hazardous or regulated projects, return no actionable wiring or build instructions.',
        prompt: `Create a concise editable concept record for: ${brief}\nBefore writing JSON, mentally check each requested function against the physical parts list. Use 3–10 parts, 1–15 connections, and 3–10 preparation/build/test steps. Only include connections you can explain; put uncertainty in notes. Use zero for unknown cost, empty strings for unknown supplier URLs, and false for verified. Return only the JSON object matching this schema: ${JSON.stringify(LOCAL_AI_SCHEMA)}`
      })
    });
    if (!response.ok) throw new Error(`Local model request failed (${response.status}).`);
    const result = await response.json();
    const draft = localAiDraft(JSON.parse(result.response), brief, model);
    showDraftPreview(draft);
  } catch (error) {
    showToast(controller.signal.aborted ? 'Local draft cancelled or timed out.' : error.message || 'Local model could not produce a usable draft.');
  } finally {
    clearTimeout(timer);
    draftController = null;
    button.innerHTML = 'Draft with local AI <span aria-hidden="true">✧</span>';
    $('#create-from-brief').disabled = false;
    $('#local-model').disabled = false;
    $('#local-ai-status').textContent = 'Optional local model draft. No paid API.';
  }
}

function showDraftPreview(draft) {
  pendingDraft = draft;
  $('#draft-title').textContent = draft.title;
  $('#draft-summary').textContent = draft.summary;
  $('#draft-preview-grid').innerHTML = `<div><h3>PARTS / ${draft.parts.length}</h3><ul>${draft.parts.map(part => `<li>${html(part.name)} · ${html(part.category)}</li>`).join('')}</ul></div><div><h3>BUILD RECORD</h3><ul><li>${draft.wires.length} proposed connections</li><li>${draft.steps.length} preparation and build steps</li><li>Prices and supplier links cleared</li><li>All verification marks reset</li></ul></div>`;
  $('#draft-dialog').showModal();
}

function showToast(message) {
  const el = $('#toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}
function editorError(message) { const el = $('#dialog-error'); el.textContent = message; el.hidden = false; }
function current() { return projects.find(p => p.id === currentId) || projects[0]; }
function save() {
  const p = current(); if (p) p.updatedAt = new Date().toISOString();
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ projects, currentId })); }
  catch { showToast('Local storage is full. Export your project to keep a copy.'); }
}
function download(name, contents, type) {
  const blob = new Blob([contents], { type }); const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const filename = p => (p.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project');
function addProject(p) { projects.unshift(p); currentId = p.id; activeTab = 'overview'; save(); render(); showToast('Project created. Review the design before building.'); }

function render() {
  const p = current(); if (!p) return;
  $('#project-count').textContent = String(projects.length).padStart(2, '0');
  $('#project-list').innerHTML = projects.map(item => `<button class="project-item ${item.id === p.id ? 'active' : ''}" data-project="${html(item.id)}" type="button"><span class="item-icon">${html(STARTERS.find(s => s.id === item.starterId)?.icon || '◇')}</span><span><strong>${html(item.title)}</strong><small>${html(item.starterId === 'ai' ? 'LOCAL AI DRAFT' : item.starterId === 'blank' ? 'CUSTOM CONCEPT' : item.starterId === 'imported' ? 'IMPORTED CONCEPT' : 'DESIGN PROJECT')}</small></span></button>`).join('');
  $('#starter-buttons').innerHTML = STARTERS.map(s => `<button class="starter-pill" data-starter="${html(s.id)}" type="button">${html(s.icon)} &nbsp; ${html(s.name)} ↗</button>`).join('');
  $('#project-kicker').textContent = `CURRENT DESIGN / ${p.starterId === 'ai' ? 'LOCAL AI DRAFT' : p.starterId === 'blank' ? 'CUSTOM' : p.starterId === 'imported' ? 'IMPORTED' : 'STARTER'}`;
  $('#project-title').textContent = p.title; $('#project-summary').textContent = p.summary;
  const st = stats(p);
  const costLabel = !p.parts.length || p.parts.some(part => Number(part.unitCost) === 0) ? 'UNPRICED' : money(st.estimate);
  $('#stats').innerHTML = [[st.distinctParts, 'DISTINCT PARTS'], [st.wires, 'CONNECTIONS'], [costLabel, 'COST ESTIMATE'], [`${st.completed}/${p.steps.length}`, 'STEPS DONE']].map(([value, label]) => `<div class="stat"><strong>${html(value)}</strong><span>${label}</span></div>`).join('');
  for (const tab of document.querySelectorAll('[data-tab]')) tab.setAttribute('aria-selected', String(tab.dataset.tab === activeTab));
  const panels = { overview: renderOverview, parts: renderParts, wiring: renderWiring, power: renderPower, assembly: renderAssembly, build: renderBuild };
  $('#panel').innerHTML = panels[activeTab](p);
  renderReview(p);
}

function panelHead(kicker, title, description, actions = '') { return `<div class="panel-head"><div><div class="eyebrow accent">${kicker}</div><h3>${title}</h3><p>${description}</p></div>${actions}</div>`; }
function renderOverview(p) {
  return panelHead('DESIGN RECORD', 'Working concept', 'Keep the goal, open decisions and review status in one place.') +
    `<div class="overview-grid"><div class="overview-card dark"><h4>DESIGN INTENT</h4><p>${html(p.brief || 'Add a brief to describe the function, operating environment and constraints.')}</p><div class="phase-line"><b>1</b> Specify the job and constraints</div><div class="phase-line"><b>2</b> Lay out parts and connections</div><div class="phase-line"><b>3</b> Verify against exact components</div></div><div class="overview-card"><h4>WORKING NOTES</h4><textarea id="project-notes" aria-label="Working notes" placeholder="Dimensions, decisions, questions to resolve...">${html(p.notes)}</textarea></div></div><div class="notice">This workspace produces a design plan, not a certified schematic, purchase quote or manufacturing CAD. Exact part ratings, pinouts, clearances and supplier listings need verification.</div>`;
}
function renderParts(p) {
  const rows = p.parts.map((part, i) => { const checked = partReviewRecorded(part); return `<tr><td><div class="part-name">${html(part.name)}</div><div class="part-detail">${html(part.detail)}</div>${safeUrl(part.sourceUrl) ? `<a class="source-link" href="${html(safeUrl(part.sourceUrl))}" target="_blank" rel="noopener noreferrer">Supplier ↗</a>` : ''}${safeUrl(part.specUrl) ? ` <a class="source-link" href="${html(safeUrl(part.specUrl))}" target="_blank" rel="noopener noreferrer">Specification ↗</a>` : ''}</td><td><span class="badge">${html(part.category)}</span></td><td>${html(part.qty)}</td><td>${Number(part.unitCost) === 0 ? '—' : money(part.unitCost)}</td><td><span class="badge ${checked ? '' : 'warn'}">${checked ? `Checked ${html(part.checkedAt.slice(0, 10))}` : part.verified ? 'Evidence missing' : 'Review'}</span></td><td><button class="text-link" data-edit-part="${i}" type="button">Edit</button></td></tr>`; }).join('');
  return panelHead('MATERIALS / BOM', 'Parts list', 'Costs are editable planning estimates. Open each part to record a current supplier and verify its specifications.', '<div><button id="add-part" class="small-button" type="button">＋ Add part</button> <button id="export-bom" class="small-button" type="button">Export CSV ↗</button></div>') + (p.parts.length ? `<div class="table-wrap"><table class="parts-table"><thead><tr><th>PART</th><th>TYPE</th><th>QTY</th><th>UNIT EST.</th><th>STATUS</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty"><strong>No parts yet</strong>Add the physical components required by your brief.</div>`);
}
function wiringSvg(p) {
  const parts = p.parts.slice(0, 14), points = new Map();
  const cols = window.innerWidth < 500 ? 1 : window.innerWidth < 750 ? 2 : 3;
  const stepX = cols === 3 ? 245 : 225;
  const width = cols === 3 ? 700 : cols === 2 ? 465 : 220;
  parts.forEach((part, i) => { const col = i % cols, row = Math.floor(i / cols); points.set(part.id, { x: 25 + col * stepX, y: 35 + row * 100, cx: 110 + col * stepX, cy: 70 + row * 100 }); });
  const height = Math.max(250, Math.ceil(parts.length / cols) * 100 + 45);
  const paths = p.wires.filter(w => points.has(w.from) && points.has(w.to)).map((w, i) => { const a = points.get(w.from), b = points.get(w.to); const offset = ((i % 5) - 2) * 12; return `<path d="M${a.cx} ${a.cy} Q${(a.cx + b.cx) / 2 + offset} ${(a.cy + b.cy) / 2 - 25} ${b.cx} ${b.cy}" fill="none" stroke="#78944b" stroke-width="1.6" marker-end="url(#arrow)" opacity=".8"><title>${html(w.signal)}</title></path>`; }).join('');
  const nodes = parts.map(part => { const pos = points.get(part.id); const shortName = part.name.length > 19 ? part.name.slice(0, 18) + '…' : part.name; return `<g><rect x="${pos.x}" y="${pos.y}" width="170" height="70" rx="2" fill="#fffefa" stroke="#bfcbbd"/><rect x="${pos.x}" y="${pos.y}" width="5" height="70" fill="#c6d959"/><text x="${pos.x + 14}" y="${pos.y + 27}" font-size="10" font-family="Arial" font-weight="bold" fill="#14211f">${html(shortName)}</text><text x="${pos.x + 14}" y="${pos.y + 47}" font-size="9" font-family="monospace" fill="#6d806d">${html(part.category.toUpperCase())}</text></g>`; }).join('');
  return `<svg class="flow-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Concept wiring diagram"><defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7" fill="#78944b"/></marker></defs><path d="M0 0H${width}M0 100H${width}M0 200H${width}M0 300H${width}M0 400H${width}" stroke="#e5ebdf" stroke-width=".5"/>${paths}${nodes}</svg>`;
}
function renderWiring(p) {
  const labels = Object.fromEntries(p.parts.map(part => [part.id, part.name]));
  const rows = p.wires.map((w, i) => `<div class="wire-row"><b>${html(labels[w.from] || 'Missing part')}</b><span class="arrow">→</span><b>${html(labels[w.to] || 'Missing part')}</b><span>${html(w.signal)} · ${html(w.voltage)}</span><button class="text-link" data-edit-wire="${i}" type="button">Edit</button></div>`).join('');
  return panelHead('ELECTRICAL / CONNECTIONS', 'Wiring map', 'A relationship diagram for planning. Confirm the exact connector, pin number, ground path and current capacity before assembly.', '<div><button id="add-wire" class="small-button" type="button">＋ Add connection</button> <button id="export-diagram" class="small-button" type="button">Export SVG ↗</button></div>') + (p.parts.length ? wiringSvg(p) : `<div class="empty"><strong>Add parts first</strong>Wiring will appear when components are in the design.</div>`) + (rows ? `<div class="wire-list">${rows}</div>` : '');
}
function renderPower(p) {
  const cards = (p.powerRails || []).map((rail, railIndex) => {
    const budget = powerBudget(p, rail);
    const sourceChoices = [['', 'Choose a supply part'], ...p.parts.map(part => [part.id, part.name])];
    const sourceSelect = `<select data-rail-index="${railIndex}" data-rail-field="sourcePartId" aria-label="Supply part for ${html(rail.name)}">${sourceChoices.map(([id, name]) => `<option value="${html(id)}" ${id === rail.sourcePartId ? 'selected' : ''}>${html(name)}</option>`).join('')}</select>`;
    const used = new Set((rail.loads || []).map(load => load.partId));
    const available = p.parts.filter(part => !used.has(part.id) && part.id !== rail.sourcePartId);
    const loadRows = (rail.loads || []).map((load, loadIndex) => {
      const part = p.parts.find(item => item.id === load.partId);
      const current = load.currentMaEach == null ? '' : load.currentMaEach;
      const total = budget.loads[loadIndex]?.totalMa;
      return `<div class="power-load"><div><strong>${html(part?.name || 'Missing part')}</strong><small>QTY ${html(part?.qty ?? '?')}</small></div><label><span>PEAK mA / UNIT</span><input type="number" min="0" step="any" value="${html(current)}" data-load-rail="${railIndex}" data-load-index="${loadIndex}" aria-label="Peak current per ${html(part?.name || 'missing part')}"></label><b>${total == null ? 'UNKNOWN' : `${Number(total).toFixed(0)} mA`}</b><button class="text-link" type="button" data-remove-load="${railIndex}:${loadIndex}" aria-label="Remove ${html(part?.name || 'load')} from rail">Remove</button></div>`;
    }).join('');
    const statusText = { incomplete: 'NEEDS INPUT', overload: 'OVER CAPACITY', 'below-margin': 'BELOW TARGET', 'within-margin': 'WITHIN TARGET' }[budget.status];
    const headroom = budget.complete ? `${budget.headroomMa.toFixed(0)} mA / ${budget.headroomPercent.toFixed(1)}%` : 'UNKNOWN';
    return `<section class="power-card"><div class="power-card-head"><div><div class="eyebrow">RAIL / ${String(railIndex + 1).padStart(2, '0')}</div><h4>${html(rail.name)}</h4></div><span class="power-status ${budget.status}">${statusText}</span></div><div class="power-fields"><label><span>RAIL NAME</span><input data-rail-index="${railIndex}" data-rail-field="name" value="${html(rail.name)}" aria-label="Rail name"></label><label><span>VOLTAGE / V</span><input type="number" min="0.01" step="any" data-rail-index="${railIndex}" data-rail-field="voltageV" value="${html(rail.voltageV)}" aria-label="Rail voltage"></label><label><span>SUPPLY RATING / mA</span><input type="number" min="0.01" step="any" data-rail-index="${railIndex}" data-rail-field="supplyCurrentMa" value="${html(rail.supplyCurrentMa ?? '')}" aria-label="Supply current rating"></label><label><span>HEADROOM TARGET / %</span><input type="number" min="0" max="99" step="any" data-rail-index="${railIndex}" data-rail-field="marginPercent" value="${html(rail.marginPercent)}" aria-label="Headroom target"></label><label class="wide"><span>SUPPLY PART</span>${sourceSelect}</label></div><div class="power-metrics"><div><span>KNOWN LOAD</span><strong>${budget.knownDemandMa.toFixed(0)} mA</strong></div><div><span>RATED SUPPLY</span><strong>${budget.supplyMa == null ? 'UNKNOWN' : `${budget.supplyMa.toFixed(0)} mA`}</strong></div><div><span>HEADROOM</span><strong>${headroom}</strong></div></div><div class="power-list-head">ASSIGNED LOADS <span>Part quantity is included in the total.</span></div>${loadRows || '<div class="power-empty">Add a part and record its documented peak current.</div>'}<div class="power-actions">${available.length ? `<select id="add-load-${railIndex}" aria-label="Part to add to ${html(rail.name)}">${available.map(part => `<option value="${html(part.id)}">${html(part.name)}</option>`).join('')}</select><button class="small-button" type="button" data-add-load="${railIndex}">＋ Add load</button>` : '<span>All available parts are assigned.</span>'}<button class="text-link" type="button" data-remove-rail="${railIndex}">Remove rail</button></div></section>`;
  }).join('');
  return panelHead('ELECTRICAL / BUDGET', 'Power worksheet', 'Record one rail at a time. Use peak load current from exact component data and the rated supply output.', '<button id="add-rail" class="small-button" type="button">＋ Add rail</button>') + (cards || '<div class="empty"><strong>No power rail recorded</strong>Add a rail to compare rated supply current with assigned loads.</div>') + '<div class="notice">A result covers only the loads entered for that rail. It does not verify voltage compatibility, startup surges, cable or connector ratings, regulator heat, or unassigned parts.</div>';
}
function assemblySvg(p) {
  const parts = p.parts.slice(0, 10);
  const cols = window.innerWidth < 530 ? 1 : 2;
  const width = cols === 1 ? 370 : 720;
  const height = 60 + Math.ceil(parts.length / cols) * 150;
  const top = `<polygon points="0,28 71,3 126,28 55,54" fill="#9bb5a1"/><polygon points="0,28 55,54 55,70 0,44" fill="#638270"/><polygon points="55,54 126,28 126,45 55,70" fill="#779781"/>`;
  const icon = (part) => {
    const kind = part.category.toLowerCase();
    if (/power/.test(kind)) return `${top}<rect x="54" y="16" width="35" height="17" rx="2" fill="#dcef75" transform="skewY(-18)"/><path d="M125 31h15m-15 8h15" stroke="#6d805f" stroke-width="3"/>`;
    if (/mechanical|structural/.test(kind)) return `<polygon points="0,34 70,8 129,35 58,61" fill="#a3bbad"/><path d="M0 34v31l58 28V61M129 35v31L58 93" fill="#789985"/><polygon points="24,42 70,25 106,42 58,59" fill="#e6eee3" stroke="#66836f"/><path d="M0 34l58 27 71-26M58 61v32" stroke="#526f5c" fill="none"/>`;
    if (/assembly|wire/.test(kind)) return `<path d="M8 62c0-30 75-31 75-2s-75 29-75 0c0-30 75-31 75-2" stroke="#7e9a75" stroke-width="7" fill="none"/><path d="M81 60c20-22 30-35 48-28" stroke="#b9ce72" stroke-width="7" fill="none"/><circle cx="130" cy="32" r="5" fill="#dcef75"/>`;
    if (/display/.test(kind)) return `${top}<polygon points="18,27 71,9 108,27 55,45" fill="#203b33" stroke="#b4ccba"/><path d="M37 26l35-12m-40 19l49-17" stroke="#dcef75" stroke-width="2" opacity=".7"/>`;
    if (/sensor/.test(kind)) return `${top}<circle cx="64" cy="29" r="11" fill="#dcef75" stroke="#48644c" stroke-width="3"/><path d="M11 31l28-10m51 4l25 9" stroke="#e2eee0" stroke-width="2"/>`;
    return `${top}<rect x="48" y="24" width="31" height="17" fill="#193429" transform="skewY(-18)"/><path d="M12 22v-12m18 6V4m75 7V1m15 17V7" stroke="#b8cd75" stroke-width="3"/>`;
  };
  const splitName = name => { const words = name.split(' '), lines = ['']; for (const word of words) { const index = lines.length - 1; if ((lines[index] + ' ' + word).trim().length > 22 && lines.length === 1) lines.push(word); else lines[index] = (lines[index] + ' ' + word).trim(); } return lines.map(line => line.length > 24 ? line.slice(0, 23) + '…' : line); };
  const cards = parts.map((part, i) => {
    const x = 18 + (i % cols) * 350, y = 46 + Math.floor(i / cols) * 150;
    const [line1, line2] = splitName(part.name);
    return `<g><title>${html(part.name)}</title><rect x="${x}" y="${y}" width="332" height="137" fill="#fffefa" stroke="#c8d6c5"/><rect x="${x}" y="${y}" width="4" height="137" fill="${/power/.test(part.category.toLowerCase()) ? '#b8cf64' : '#82a78e'}"/><text x="${x + 17}" y="${y + 25}" font-size="10" font-family="monospace" fill="#73906d">${String(i + 1).padStart(2, '0')} / ${html(part.category.toUpperCase())}</text><text x="${x + 17}" y="${y + 65}" font-size="15" font-family="Arial" font-weight="bold" fill="#14211f">${html(line1)}</text>${line2 ? `<text x="${x + 17}" y="${y + 83}" font-size="15" font-family="Arial" font-weight="bold" fill="#14211f">${html(line2)}</text>` : ''}<text x="${x + 17}" y="${y + 113}" font-size="9" font-family="monospace" fill="#89978a">QTY ${html(part.qty)} · CONCEPT ONLY</text><g transform="translate(${x + 190} ${y + 37}) scale(.93)">${icon(part)}</g></g>`;
  }).join('');
  return `<svg class="assembly-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Conceptual part inventory, not dimensioned CAD"><rect width="${width}" height="${height}" fill="#f5f7f0"/><text x="20" y="28" font-size="10" font-family="monospace" font-weight="bold" letter-spacing="2" fill="#607b66">COMPONENT INDEX</text><text x="${width - 108}" y="28" font-size="9" font-family="monospace" fill="#79917c">NOT TO SCALE</text>${cards}</svg>`;
}
function renderAssembly(p) {
  const evidence = safeUrl(p.cadUrl) ? `<div class="notice">Attached dimensioned work: <a href="${html(safeUrl(p.cadUrl))}" target="_blank" rel="noopener noreferrer">Open CAD source and checks ↗</a>. Review its stated scope before relying on it.</div>` : '';
  const next = evidence ? 'Next check: compare the linked CAD with physical parts, then test mounting, access, cable fit, thermal clearance and wire routing. Revise the model when hardware changes.' : 'Next check: measure the actual components, create a dimensioned model, then test mounting, access, motion, thermal clearance and wire routing. Revise the model when hardware changes.';
  return panelHead('MECHANICAL / LAYOUT', 'Assembly concept', 'This view inventories the physical parts. It is not dimensioned CAD and does not prove that parts fit.', '<button id="export-diagram" class="small-button" type="button">Export SVG ↗</button>') + evidence + (p.parts.length ? assemblySvg(p) : `<div class="empty"><strong>No assembly yet</strong>Add parts to view a conceptual layout.</div>`) + `<p class="assembly-legend">${next}</p>`;
}
function renderBuild(p) {
  const rows = p.steps.map((step, i) => `<div class="step-card ${step.done ? 'done' : ''}"><input data-done-step="${i}" type="checkbox" ${step.done ? 'checked' : ''} aria-label="Mark ${html(step.title)} complete"><div><small>${html(step.phase.toUpperCase())} / ${String(i + 1).padStart(2, '0')}</small><strong>${html(step.title)}</strong><p>${html(step.detail)}</p></div><button class="text-link" data-edit-step="${i}" type="button">Edit</button></div>`).join('');
  return panelHead('SEQUENCE / TEST', 'Build plan', 'Use the steps as a checklist after validating each operation against the exact parts and tools.', '<button id="add-step" class="small-button" type="button">＋ Add step</button>') + (rows ? `<div class="step-list">${rows}</div>` : `<div class="empty"><strong>No build steps yet</strong>Add preparation, wiring, bring-up and assembly steps.</div>`);
}
function renderReview(p) {
  const issues = validate(p); const errors = issues.filter(i => i.kind === 'error').length;
  $('#review-rail').innerHTML = `<div class="rail-heading">DESIGN REVIEW</div><h3>${errors ? `${errors} data issue${errors === 1 ? '' : 's'}` : issues.length ? 'Review needed' : 'Review recorded'}</h3><p class="rail-summary">${issues.length} open ${issues.length === 1 ? 'item' : 'items'}. Review marks are local notes, not certification.</p>${issues.slice(0, 6).map(i => `<div class="rail-issue ${i.kind}"><i>${i.kind === 'error' ? '!' : i.kind === 'todo' ? '+' : '·'}</i><span>${html(i.text)}</span></div>`).join('')}${issues.length > 6 ? `<div class="rail-issue"><i>…</i><span>${issues.length - 6} more items. Inspect the project data and exact components.</span></div>` : ''}<div class="rail-note"><strong>REVIEW RECORD</strong><br>Mark a check only after reviewing independent evidence.</div>${[['electrical', 'Ratings, pinouts and current'], ['mechanical', 'Dimensions, fit and materials'], ['sourcing', 'Listings, stock and prices']].map(([key, label]) => `<label class="review-check"><input data-review="${key}" type="checkbox" ${p.review[key] ? 'checked' : ''}><span>${label}</span></label>`).join('')}`;
}

const field = (name, label, value = '', options = {}) => `<div class="field ${options.wide ? 'wide' : ''}"><label for="f-${name}">${label}</label>${options.type === 'textarea' ? `<textarea id="f-${name}" name="${name}" ${options.required ? 'required' : ''}>${html(value)}</textarea>` : options.type === 'select' ? `<select id="f-${name}" name="${name}" ${options.required ? 'required' : ''}>${options.choices.map(([id, text]) => `<option value="${html(id)}" ${String(id) === String(value) ? 'selected' : ''}>${html(text)}</option>`).join('')}</select>` : `<input id="f-${name}" name="${name}" type="${options.type || 'text'}" value="${html(value)}" ${options.required ? 'required' : ''} ${options.min != null ? `min="${options.min}"` : ''} ${options.step ? `step="${options.step}"` : ''}>`}</div>`;
function openEditor(kind, index = -1) {
  const p = current(); editor = { kind, index };
  const isNew = index < 0; const item = !isNew ? (kind === 'part' ? p.parts[index] : kind === 'wire' ? p.wires[index] : kind === 'step' ? p.steps[index] : p) : {};
  $('#dialog-kicker').textContent = kind.toUpperCase() + (isNew ? ' / NEW' : ' / EDIT');
  $('#dialog-title').textContent = `${isNew ? 'Add' : 'Edit'} ${kind === 'wire' ? 'connection' : kind === 'title' ? 'project' : kind}`;
  $('#delete-entry').hidden = isNew || kind === 'title';
  $('#dialog-error').hidden = true;
  const choices = p.parts.map(part => [part.id, part.name]);
  let fields = '';
  if (kind === 'part') fields = field('name', 'Part name', item.name, { required: true, wide: true }) + field('category', 'Category', item.category || 'Other') + field('qty', 'Quantity', item.qty ?? 1, { type: 'number', min: 1, step: 1 }) + field('unitCost', 'Unit estimate (USD)', item.unitCost ?? 0, { type: 'number', min: 0, step: '.01' }) + field('voltage', 'Operating voltage', item.voltage || '') + field('sourceUrl', 'Supplier listing URL', item.sourceUrl || '', { type: 'url', wide: true }) + field('specUrl', 'Manufacturer specification or independent evidence URL', item.specUrl || '', { type: 'url', wide: true }) + field('detail', 'Specification, datasheet and open questions', item.detail || '', { type: 'textarea', wide: true }) + `<div class="field wide"><label class="verify-label"><input type="checkbox" name="verified"> I checked this exact part against the linked specification now</label></div>`;
  if (kind === 'wire') fields = field('from', 'From', item.from || choices[0]?.[0] || '', { type: 'select', choices }) + field('to', 'To', item.to || choices[1]?.[0] || choices[0]?.[0] || '', { type: 'select', choices }) + field('signal', 'Signal or connection', item.signal || '', { required: true }) + field('voltage', 'Voltage / range', item.voltage || '') + field('note', 'Pinout or verification note', item.note || '', { type: 'textarea', wide: true });
  if (kind === 'step') fields = field('phase', 'Phase', item.phase || 'Build', { type: 'select', choices: [['Prepare', 'Prepare'], ['Wire', 'Wire'], ['Bring up', 'Bring up'], ['Assemble', 'Assemble'], ['Test', 'Test']] }) + field('title', 'Step title', item.title || '', { required: true }) + field('detail', 'Action and acceptance check', item.detail || '', { type: 'textarea', wide: true });
  if (kind === 'title') fields = field('title', 'Project title', p.title, { required: true, wide: true }) + field('brief', 'Design brief', p.brief, { type: 'textarea', wide: true }) + field('summary', 'Summary', p.summary, { type: 'textarea', wide: true }) + field('cadUrl', 'Dimensioned CAD or verification package URL', p.cadUrl || '', { type: 'url', wide: true });
  $('#dialog-fields').innerHTML = fields; $('#editor-dialog').showModal();
}
function closeEditor() { $('#editor-dialog').close(); editor = null; }
function saveEditor(event) {
  event.preventDefault(); if (!editor) return;
  const p = current(); const form = new FormData($('#editor-form')); const { kind, index } = editor;
  if (kind === 'part') {
    const newPart = { id: index < 0 ? `part-${crypto.randomUUID().slice(0, 8)}` : p.parts[index].id, name: String(form.get('name') || '').trim(), category: String(form.get('category') || 'Other').trim(), qty: Number(form.get('qty')), unitCost: Number(form.get('unitCost')), voltage: String(form.get('voltage') || '').trim(), sourceUrl: String(form.get('sourceUrl') || '').trim(), specUrl: String(form.get('specUrl') || '').trim(), detail: String(form.get('detail') || '').trim(), verified: form.has('verified'), checkedAt: form.has('verified') ? new Date().toISOString() : '' };
    if (!newPart.name || newPart.qty <= 0 || newPart.unitCost < 0 || !Number.isFinite(newPart.unitCost)) return editorError('Enter a name, positive quantity and valid cost.');
    if (newPart.sourceUrl && !/^https?:\/\//i.test(newPart.sourceUrl)) return editorError('Supplier URL must start with https:// or http://.');
    if (newPart.specUrl && !/^https?:\/\//i.test(newPart.specUrl)) return editorError('Specification URL must start with https:// or http://.');
    if (newPart.verified && !newPart.specUrl) return editorError('Link the exact specification before marking this part checked.');
    if (index < 0) p.parts.push(newPart); else p.parts[index] = newPart;
    p.review.sourcing = false; p.review.electrical = false; p.review.mechanical = false;
  }
  if (kind === 'wire') {
    const wire = { from: String(form.get('from')), to: String(form.get('to')), signal: String(form.get('signal') || '').trim(), voltage: String(form.get('voltage') || '').trim(), note: String(form.get('note') || '').trim() };
    if (!wire.from || !wire.to || wire.from === wire.to || !wire.signal) return editorError('Choose two different parts and name the connection.');
    if (index < 0) p.wires.push(wire); else p.wires[index] = wire; p.review.electrical = false;
  }
  if (kind === 'step') {
    const step = { id: index < 0 ? `step-${crypto.randomUUID().slice(0, 8)}` : p.steps[index].id, phase: String(form.get('phase')), title: String(form.get('title') || '').trim(), detail: String(form.get('detail') || '').trim(), done: index < 0 ? false : p.steps[index].done };
    if (!step.title) return editorError('Give the step a title.');
    if (index < 0) p.steps.push(step); else p.steps[index] = step;
  }
  if (kind === 'title') { const title = String(form.get('title') || '').trim().slice(0, 100), cadUrl = String(form.get('cadUrl') || '').trim(); if (!title) return editorError('Give the project a title.'); if (cadUrl && !/^https?:\/\//i.test(cadUrl)) return editorError('CAD URL must start with https:// or http://.'); if (cadUrl !== (p.cadUrl || '')) p.review.mechanical = false; p.title = title; p.brief = String(form.get('brief') || '').trim(); p.summary = String(form.get('summary') || '').trim(); p.cadUrl = cadUrl; }
  closeEditor(); save(); render(); showToast('Saved locally.');
}
function deleteEntry() {
  if (!editor || editor.index < 0) return;
  const p = current(), { kind, index } = editor;
  if (!window.confirm(`Delete this ${kind} from the project?`)) return;
  if (kind === 'part') { const id = p.parts[index].id; p.parts.splice(index, 1); p.wires = p.wires.filter(w => w.from !== id && w.to !== id); for (const rail of p.powerRails || []) { rail.loads = rail.loads.filter(load => load.partId !== id); if (rail.sourcePartId === id) rail.sourcePartId = ''; } p.review = { electrical: false, mechanical: false, sourcing: false }; }
  if (kind === 'wire') { p.wires.splice(index, 1); p.review.electrical = false; }
  if (kind === 'step') p.steps.splice(index, 1);
  closeEditor(); save(); render(); showToast('Entry removed.');
}
function handleClick(event) {
  const button = event.target.closest('button'); if (!button) return;
  const p = current();
  if (button.dataset.project) { currentId = button.dataset.project; activeTab = 'overview'; save(); render(); }
  else if (button.dataset.starter) addProject(makeProject(STARTERS.find(s => s.id === button.dataset.starter)));
  else if (button.dataset.tab) { activeTab = button.dataset.tab; render(); }
  else if (button.dataset.editPart != null) openEditor('part', Number(button.dataset.editPart));
  else if (button.dataset.editWire != null) openEditor('wire', Number(button.dataset.editWire));
  else if (button.dataset.editStep != null) openEditor('step', Number(button.dataset.editStep));
  else if (button.id === 'new-project') addProject(blankProject());
  else if (button.id === 'create-from-brief') {
    const brief = $('#brief-input').value.trim(); if (!brief) return showToast('Describe your idea first.');
    const starter = /plant|soil|garden|greenhouse/i.test(brief) ? STARTERS[0] : /light|lamp|led|glow/i.test(brief) ? STARTERS[1] : null;
    const title = brief.split(/[.!?]/)[0].slice(0, 55);
    const next = starter ? makeProject(starter, title) : blankProject(title); next.brief = brief;
    if (!starter) next.summary = 'Custom concept. Add the parts, connections and build steps. No automatic design was generated for this idea.';
    addProject(next); $('#brief-input').value = '';
  }
  else if (button.id === 'draft-local') void draftWithLocalAi();
  else if (button.id === 'accept-draft' && pendingDraft) { const draft = pendingDraft; pendingDraft = null; $('#draft-dialog').close(); addProject(draft); $('#brief-input').value = ''; }
  else if (button.id === 'discard-draft' || button.id === 'discard-draft-x') { pendingDraft = null; $('#draft-dialog').close(); showToast('Draft discarded. Your brief is still here.'); }
  else if (button.id === 'rename-project') openEditor('title', 0);
  else if (button.id === 'import-project') $('#import-file').click();
  else if (button.id === 'delete-project') { if (!window.confirm(`Delete “${p.title}” from local storage? Export it first if you need a copy.`)) return; projects = projects.filter(x => x.id !== p.id); if (!projects.length) projects = [makeProject(STARTERS[0])]; currentId = projects[0].id; activeTab = 'overview'; save(); render(); showToast('Project deleted from this browser.'); }
  else if (button.id === 'export-project') { download(`${filename(p)}.json`, JSON.stringify(p, null, 2), 'application/json'); showToast('Project JSON downloaded.'); }
  else if (button.id === 'export-bom') { download(`${filename(p)}-bom.csv`, bomCsv(p), 'text/csv'); showToast('Parts list downloaded.'); }
  else if (button.id === 'export-diagram') { const svg = $('#panel svg'); if (svg) { download(`${filename(p)}-${activeTab}.svg`, new XMLSerializer().serializeToString(svg), 'image/svg+xml'); showToast('Diagram downloaded.'); } }
  else if (button.id === 'add-part') openEditor('part');
  else if (button.id === 'add-rail') { p.powerRails ||= []; p.powerRails.push({ id: `rail-${crypto.randomUUID().slice(0, 8)}`, name: 'New rail', voltageV: 5, supplyCurrentMa: null, marginPercent: 20, sourcePartId: '', loads: [] }); p.review.electrical = false; save(); render(); }
  else if (button.dataset.addLoad != null) { const index = Number(button.dataset.addLoad), rail = p.powerRails?.[index], partId = $(`#add-load-${index}`)?.value; if (rail && partId && !rail.loads.some(load => load.partId === partId)) { rail.loads.push({ partId, currentMaEach: null }); p.review.electrical = false; save(); render(); } }
  else if (button.dataset.removeLoad) { const [railIndex, loadIndex] = button.dataset.removeLoad.split(':').map(Number); p.powerRails?.[railIndex]?.loads.splice(loadIndex, 1); p.review.electrical = false; save(); render(); }
  else if (button.dataset.removeRail != null) { const index = Number(button.dataset.removeRail); if (!window.confirm(`Remove “${p.powerRails?.[index]?.name || 'this rail'}” and its budget from this project?`)) return; p.powerRails.splice(index, 1); p.review.electrical = false; save(); render(); }
  else if (button.id === 'add-wire') { if (p.parts.length < 2) return showToast('Add at least two parts first.'); openEditor('wire'); }
  else if (button.id === 'add-step') openEditor('step');
  else if (button.id === 'close-dialog' || button.id === 'cancel-dialog') closeEditor();
  else if (button.id === 'delete-entry') deleteEntry();
}
function handleChange(event) {
  const p = current(); const target = event.target;
  if (target.dataset.railField) {
    const rail = p.powerRails?.[Number(target.dataset.railIndex)]; if (!rail) return;
    const key = target.dataset.railField;
    const value = ['voltageV', 'supplyCurrentMa', 'marginPercent'].includes(key) ? (target.value === '' ? null : Number(target.value)) : target.value.trim();
    if (key === 'voltageV' && (!Number.isFinite(value) || value <= 0)) return showToast('Enter a positive rail voltage.');
    if (key === 'supplyCurrentMa' && value != null && (!Number.isFinite(value) || value <= 0)) return showToast('Enter a positive supply rating.');
    if (key === 'marginPercent' && (!Number.isFinite(value) || value < 0 || value >= 100)) return showToast('Enter a margin target from 0 to 99%.');
    if (key === 'name' && !value) return showToast('Give the rail a name.');
    rail[key] = value; p.review.electrical = false; save(); render(); return;
  }
  if (target.dataset.loadRail != null) {
    const load = p.powerRails?.[Number(target.dataset.loadRail)]?.loads?.[Number(target.dataset.loadIndex)]; if (!load) return;
    const value = target.value === '' ? null : Number(target.value);
    if (value != null && (!Number.isFinite(value) || value < 0)) return showToast('Enter a nonnegative peak current or leave it blank.');
    load.currentMaEach = value; p.review.electrical = false; save(); render(); return;
  }
  if (target.dataset.doneStep != null) { p.steps[Number(target.dataset.doneStep)].done = target.checked; save(); render(); }
  if (target.dataset.review) { p.review[target.dataset.review] = target.checked; save(); renderReview(p); }
  if (target.id === 'import-file') {
    const file = target.files?.[0]; if (!file) return;
    if (file.size > 2_000_000) { showToast('Choose a project smaller than 2 MB.'); target.value = ''; return; }
    file.text().then(text => { try { addProject(safeProject(JSON.parse(text))); } catch (error) { showToast(error.message); } }).finally(() => { target.value = ''; });
  }
}
function initialize() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (saved?.projects?.length) { projects = saved.projects.map(safeProjectForStorage); currentId = saved.currentId; }
  } catch { showToast('Saved data could not be read. A starter project was opened.'); }
  if (!projects.length) { projects = [makeProject(STARTERS[0])]; currentId = projects[0].id; save(); }
  if (!projects.some(p => p.id === currentId)) currentId = projects[0].id;
  document.addEventListener('click', handleClick);
  document.addEventListener('change', handleChange);
  let diagramLayout = window.innerWidth < 500 ? 0 : window.innerWidth < 530 ? 1 : window.innerWidth < 750 ? 2 : 3;
  window.addEventListener('resize', () => {
    const next = window.innerWidth < 500 ? 0 : window.innerWidth < 530 ? 1 : window.innerWidth < 750 ? 2 : 3;
    if (next !== diagramLayout) { diagramLayout = next; if (activeTab === 'wiring' || activeTab === 'assembly') render(); }
  });
  $('#editor-form').addEventListener('submit', saveEditor);
  $('#draft-dialog').addEventListener('close', () => { pendingDraft = null; });
  $('#panel').addEventListener('change', event => { if (event.target.id === 'project-notes') { current().notes = event.target.value; save(); showToast('Notes saved locally.'); } });
  render();
  void detectLocalModels();
}
function safeProjectForStorage(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.parts) || !Array.isArray(input.wires) || !Array.isArray(input.steps)) throw new Error('Invalid stored project');
  return { ...input, powerRails: Array.isArray(input.powerRails) ? input.powerRails : [], review: { electrical: false, mechanical: false, sourcing: false, ...(input.review || {}) } };
}
initialize();
