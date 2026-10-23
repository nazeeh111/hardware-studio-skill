import { STARTERS, STORAGE_KEY, REVISIONS_KEY, MAX_REFERENCE_DATA_URL, safeReferenceImage, safePinList, makeProject, blankProject, stats, validate, bomCsv, mountingCsv, safeProject, localAiDraft, powerBudget, partReviewRecorded, projectContentChanged, parseSavedWorkspace, restoreProjectFromRevision, setProjectTraySpec } from './core.js?v=27';
import { validateTraySpec } from './tray-spec.js?v=2';
import { createZip } from './zip.js?v=1';
import { briefQuestions, composeBrief } from './brief.js?v=2';

const $ = selector => document.querySelector(selector);
const html = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeUrl = value => /^https?:\/\//i.test(String(value || '')) ? String(value) : '';
const money = value => '$' + Number(value || 0).toFixed(2);
let projects = [];
let currentId = '';
let activeTab = 'overview';
let editor = null;
let toastTimer;
let traySyncTimer;
let draftController = null;
let pendingDraft = null;
let pendingReference = null;
let briefAnswers = {};
let modelCapabilities = new Map();
let unreadableSavedData = null;
let storageUnavailable = false;
const OLLAMA_URL = 'http://127.0.0.1:11434';
const LOCAL_AI_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' }, brief: { type: 'string' }, summary: { type: 'string' }, notes: { type: 'string' },
    parts: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' }, category: { type: 'string' }, qty: { type: 'integer' }, unitCost: { type: 'number' }, detail: { type: 'string' }, voltage: { type: 'string' }, sourceUrl: { type: 'string' }, verified: { type: 'boolean' } }, required: ['id', 'name', 'category', 'qty', 'unitCost', 'detail', 'voltage', 'sourceUrl', 'verified'] } },
    wires: { type: 'array', items: { type: 'object', properties: { from: { type: 'string' }, fromPin: { type: 'string' }, to: { type: 'string' }, toPin: { type: 'string' }, signal: { type: 'string' }, voltage: { type: 'string' }, note: { type: 'string' } }, required: ['from', 'to', 'signal', 'voltage', 'note'] } },
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
    modelCapabilities = new Map((data.models || []).filter(model => typeof model.name === 'string').map(model => [model.name, new Set(model.capabilities || [])]));
    if (!names.length) throw new Error('No local models installed');
    const select = $('#local-model');
    select.innerHTML = names.map(name => `<option value="${html(name)}">${html(name)}${modelCapabilities.get(name)?.has('vision') ? ' · vision' : ''}</option>`).join('');
    select.value = names.includes('local-fast:latest') ? 'local-fast:latest' : names.includes('qwen3:4b') ? 'qwen3:4b' : names[0];
    select.hidden = false;
    $('#draft-local').hidden = false;
    $('#local-ai-status').textContent = 'Optional local model draft. No paid API.';
  } catch {
    $('#local-ai-status').textContent = 'Create a blank concept or choose a filled starter below.';
  } finally { clearTimeout(timer); }
}

async function prepareReferenceImage(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8_000_000) throw new Error('Choose a JPEG, PNG or WebP image under 8 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width * bitmap.height > 20_000_000) throw new Error('Image dimensions are too large. Choose one under 20 megapixels.');
    let limit = 1200;
    for (let attempt = 0; attempt < 7; attempt++) {
      const factor = Math.min(1, limit / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * factor));
      canvas.height = Math.max(1, Math.round(bitmap.height * factor));
      const context = canvas.getContext('2d');
      context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', .76);
      if (dataUrl.length <= MAX_REFERENCE_DATA_URL) return safeReferenceImage({ name: file.name.slice(0, 120), dataUrl });
      limit = Math.round(limit * .75);
    }
    throw new Error('This image could not be reduced enough for local storage.');
  } finally { bitmap.close(); }
}

function renderReferenceInput() {
  const preview = $('#reference-preview');
  preview.hidden = !pendingReference;
  preview.innerHTML = pendingReference ? `<img src="${html(pendingReference.dataUrl)}" alt="Selected visual reference"><span>${html(pendingReference.name)} · ready to save</span><button id="remove-reference" type="button" aria-label="Remove reference image">×</button>` : '';
}

function renderBriefGuidance() {
  const questions = briefQuestions($('#brief-input').value);
  const panel = $('#brief-guidance');
  panel.hidden = !questions.length;
  if (!questions.length) { $('#brief-question-list').replaceChildren(); return; }
  $('#brief-question-list').innerHTML = questions.map((item, index) => `<div class="brief-question"><span>${String(index + 1).padStart(2, '0')}</span><div><label for="brief-answer-${html(item.id)}">${html(item.title)}<small>${html(item.question)}</small></label><input id="brief-answer-${html(item.id)}" data-brief-answer="${html(item.id)}" maxlength="240" value="${html(briefAnswers[item.id] || '')}" placeholder="Add what you know, or leave open"></div></div>`).join('');
  const answered = questions.filter(item => String(briefAnswers[item.id] || '').trim()).length;
  $('#brief-progress').textContent = `${answered} / ${questions.length} ANSWERED`;
}

async function draftWithLocalAi() {
  if (draftController) { draftController.abort(); return; }
  const idea = $('#brief-input').value.trim();
  if (!idea) return showToast('Describe the build before drafting with local AI.');
  const brief = composeBrief(idea, briefAnswers).text;
  const model = $('#local-model').value;
  if (!model) return showToast('Choose a local model.');
  if (pendingReference && !modelCapabilities.get(model)?.has('vision')) return showToast('Choose a model marked vision to interpret this image.');
  const reference = pendingReference;
  const button = $('#draft-local');
  let failure = '';
  draftController = new AbortController();
  const controller = draftController;
  const timer = setTimeout(() => controller.abort(), 300000);
  button.textContent = 'Cancel local draft';
  $('#create-from-brief').disabled = true;
  $('#local-model').disabled = true;
  $('#choose-reference').disabled = true;
  $('#reference-file').disabled = true;
  if ($('#remove-reference')) $('#remove-reference').disabled = true;
  $('#local-ai-status').textContent = 'Drafting on this computer. This can take a few minutes.';
  try {
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({
        model, stream: false, format: LOCAL_AI_SCHEMA, think: false, keep_alive: '1m',
        ...(reference ? { images: [reference.dataUrl.split(',')[1]] } : {}),
        options: { temperature: 0.1, num_predict: 2400 },
        system: 'You draft conceptual low-voltage hobby hardware plans. Treat unanswered design questions as unknown; do not invent exact specifications. Every requested sensing, display, input, or actuation function needs a dedicated physical part; a controller alone does not measure temperature or humidity. Include power conversion, cables and enclosure parts where needed. Do not claim that parts, pinouts, prices, sourcing, dimensions, wiring, or safety are verified. Use unique short part IDs and ensure each wire refers to existing part IDs. Use fromPin and toPin only when exact terminals are known; otherwise leave them empty for review. For hazardous or regulated projects, return no actionable wiring or build instructions.',
        prompt: `Create a concise editable concept record for: ${brief}${reference ? '\nUse the attached image as a visual reference. Distinguish visible features from uncertain or hidden details. Do not infer exact dimensions, part numbers, pins, ratings or materials from appearance alone.' : ''}\nBefore writing JSON, mentally check each requested function against the physical parts list. Use 3–10 parts, 1–15 connections, and 3–10 preparation/build/test steps. Only include connections you can explain; put uncertainty in notes. Use zero for unknown cost, empty strings for unknown supplier URLs, and false for verified. Return only the JSON object matching this schema: ${JSON.stringify(LOCAL_AI_SCHEMA)}`
      })
    });
    if (!response.ok) {
      let detail = '';
      try { detail = String((await response.json()).error || '').slice(0, 220); } catch { /* Ollama did not return a JSON error. */ }
      throw new Error(`Local model request failed (${response.status})${detail ? `: ${detail}` : '.'}`);
    }
    const result = await response.json();
    const draft = localAiDraft(JSON.parse(result.response), brief, model);
    draft.referenceImage = reference;
    showDraftPreview(draft);
  } catch (error) {
    failure = controller.signal.aborted ? 'Local draft cancelled or timed out.' : /llama-server binary not found/i.test(error.message || '') ? 'Ollama cannot start this model: llama-server is missing. Repair the local Ollama installation.' : error.message || 'Local model could not produce a usable draft.';
    showToast(failure);
  } finally {
    clearTimeout(timer);
    draftController = null;
    button.innerHTML = 'Draft with local AI <span aria-hidden="true">✧</span>';
    $('#create-from-brief').disabled = false;
    $('#local-model').disabled = false;
    $('#choose-reference').disabled = false;
    $('#reference-file').disabled = false;
    if ($('#remove-reference')) $('#remove-reference').disabled = false;
    $('#local-ai-status').textContent = failure || 'Optional local model draft. No paid API.';
  }
}

function showDraftPreview(draft) {
  pendingDraft = draft;
  $('#draft-title').textContent = draft.title;
  $('#draft-summary').textContent = draft.summary;
  const names = new Map(draft.parts.map(part => [part.id, part.name]));
  const issues = validate(draft).filter(issue => issue.kind !== 'error');
  const list = (items, limit) => `${items.slice(0, limit).map(item => `<li>${html(item)}</li>`).join('')}${items.length > limit ? `<li>${items.length - limit} more in the saved project</li>` : ''}`;
  $('#draft-preview-grid').innerHTML = `<div><h3>PROPOSED PARTS / ${draft.parts.length}</h3><ul>${list(draft.parts.map(part => `${part.name} · ${part.category}`), 20)}</ul></div><div><h3>CONNECTION INTENT / ${draft.wires.length}</h3><ul>${list(draft.wires.map(wire => `${names.get(wire.from) || wire.from} → ${names.get(wire.to) || wire.to} · ${wire.signal}${wire.voltage ? ` · ${wire.voltage}` : ''}`), 16)}</ul></div><div><h3>BUILD SEQUENCE / ${draft.steps.length}</h3><ul>${list(draft.steps.map(step => `${step.phase}: ${step.title}`), 12)}</ul></div><div><h3>OPEN CHECKS / ${issues.length}</h3><ul>${list(issues.map(issue => issue.text), 5)}</ul><p>Prices, supplier links and verification marks were cleared. Exact pins and physical fit need independent checks.</p></div>`;
  $('#draft-dialog').showModal();
}

function showToast(message) {
  const el = $('#toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}
function editorError(message) { const el = $('#dialog-error'); el.textContent = message; el.hidden = false; }
function current() { return projects.find(p => p.id === currentId) || projects[0]; }
function readRevisions() {
  const raw = localStorage.getItem(REVISIONS_KEY);
  if (!raw) return [];
  const entries = JSON.parse(raw);
  if (!Array.isArray(entries) || entries.some(entry => !entry || typeof entry.id !== 'string' || typeof entry.projectId !== 'string' || !entry.snapshot || typeof entry.snapshot !== 'object')) throw new Error('Revision history is unreadable.');
  return entries;
}
function recordRevision(snapshot, reason) {
  const entries = readRevisions();
  entries.push({ id: crypto.randomUUID(), projectId: snapshot.id, at: new Date().toISOString(), reason, snapshot });
  while (entries.filter(entry => entry.projectId === snapshot.id).length > 12) entries.splice(entries.findIndex(entry => entry.projectId === snapshot.id), 1);
  while (entries.length > 1 && JSON.stringify(entries).length > 2_000_000) entries.shift();
  if (JSON.stringify(entries).length > 2_000_000) throw new Error('Revision exceeds the local history limit.');
  localStorage.setItem(REVISIONS_KEY, JSON.stringify(entries));
}
function showRecovery() { if (!$('#recovery-dialog').open) $('#recovery-dialog').showModal(); }
function save(reason = 'edit', { skipRevision = false } = {}) {
  if (storageUnavailable) { showToast('Browser storage is unavailable. Export JSON to keep this project.'); return false; }
  if (unreadableSavedData !== null) { showRecovery(); showToast('Download the unreadable saved data before starting a new workspace.'); return false; }
  const p = current(); if (p) p.updatedAt = new Date().toISOString();
  let before = null;
  try {
    const saved = localStorage.getItem(STORAGE_KEY) === null ? null : parseSavedWorkspace(localStorage.getItem(STORAGE_KEY));
    before = saved?.projects?.find(item => item.id === p?.id) || null;
  } catch {
    try { unreadableSavedData = localStorage.getItem(STORAGE_KEY); }
    catch { storageUnavailable = true; showToast('Browser storage is unavailable. Export JSON to keep this project.'); return false; }
    showRecovery(); showToast('Saved workspace data became unreadable. Download it before editing further.'); return false;
  }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ projects, currentId })); }
  catch { showToast('Local storage is full. Export your project to keep a copy.'); return false; }
  if (!skipRevision && before && projectContentChanged(before, p)) {
    try { recordRevision(before, reason); }
    catch { queueMicrotask(() => showToast('Project saved, but revision history could not be stored. Export JSON for a backup.')); }
  }
  return true;
}
function download(name, contents, type) {
  const blob = new Blob([contents], { type }); const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const filename = p => (p.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project');
const trayKey = id => `hardware-studio-tray-${id}`;
function traySpecForProject(p) {
  let raw;
  try { raw = localStorage.getItem(trayKey(p.id)); }
  catch { return p.traySpec || null; }
  return raw ? validateTraySpec(JSON.parse(raw)) : p.traySpec || null;
}
function projectWithTraySpec(p) {
  const spec = traySpecForProject(p);
  if (JSON.stringify(spec) === JSON.stringify(p.traySpec ?? null)) return p;
  return { ...p, traySpec: spec, review: { ...p.review, mechanical: false } };
}
function syncCurrentTrayDraft(p) {
  let spec;
  try { spec = traySpecForProject(p); }
  catch { showToast('The saved tray draft is unreadable. Export the project before changing it.'); return false; }
  if (!spec) return true;
  const previous = p.traySpec ?? null, priorReview = p.review.mechanical;
  if (!setProjectTraySpec(p, spec)) return true;
  if (save('Before updating tray geometry')) return true;
  p.traySpec = previous; p.review.mechanical = priorReview;
  return false;
}
function writeTraySidecar(p) {
  try {
    if (p.traySpec) localStorage.setItem(trayKey(p.id), JSON.stringify(p.traySpec));
    else localStorage.removeItem(trayKey(p.id));
    return true;
  } catch { return false; }
}
function exportPackage(p) {
  p = projectWithTraySpec(p);
  const generatedAt = new Date().toISOString();
  const issues = validate(p);
  const report = `Hardware Studio review record\nGenerated: ${generatedAt}\n\nThese checks are planning prompts, not a safety, sourcing or engineering certification.\n\n${issues.length ? issues.map(issue => `[${issue.kind.toUpperCase()}] ${issue.text}`).join('\n') : 'No tracked open items in this editor. Independent verification is still required.'}\n`;
  const title = String(p.title).replace(/[\r\n]+/g, ' ');
  const reference = safeReferenceImage(p.referenceImage);
  const traySpec = p.traySpec;
  const partNames = new Map(p.parts.map(part => [part.id, part.name]));
  const buildPlan = `${title}\nBuild plan exported ${generatedAt}\n\nTOOLS AND CONSUMABLES\n${(p.tools || []).length ? p.tools.map(tool => `- ${tool}`).join('\n') : '(not recorded)'}\n\nASSUMPTIONS AND PREREQUISITES\n${(p.assumptions || []).length ? p.assumptions.map(item => `- ${item}`).join('\n') : '(not recorded)'}\n\nSTEPS\n${p.steps.map((step, index) => `${index + 1}. [${step.phase}] ${step.title}${step.done ? ' (checked in this browser)' : ''}\n   ${step.detail}\n   Parts: ${(step.partIds || []).map(id => partNames.get(id) || `Missing: ${id}`).join(', ') || '(not linked)'}`).join('\n\n')}\n\nThis is a planning record, not a verified build procedure.\n`;
  const readme = `# ${title}\n\nExported from Hardware Studio on ${generatedAt}.\n\n- [Project data](project.json): edit or re-import this JSON. Imported verification marks reset.\n- [Parts list](bill-of-materials.csv): planning estimates; blank costs mean unknown.\n- [Build plan](build-plan.txt): tools, assumptions and part-linked checklist; verify each operation.\n- [Mounting notes](mounting.csv): proposed mechanical relationships, not verified fit.\n- [Wiring map](wiring.svg): conceptual relationships, not a verified schematic.\n- [Assembly index](assembly.svg): conceptual part inventory, not dimensioned CAD.\n- [Open checks](review.txt): current editor findings.${traySpec ? '\n- [Tray CAD input](tray-spec.json): editable millimeter spec for the local generator; physical fit unverified.' : ''}${reference ? '\n- [Visual reference](reference.jpg): resized local sketch or photo; visual interpretation is unverified.' : ''}\n\nExternal evidence links remain URLs in project.json; their contents are not copied into this package.${safeUrl(p.wiringUrl) ? `\nElectrical plan: ${p.wiringUrl}` : ''}${safeUrl(p.cadUrl) ? `\nCAD package: ${p.cadUrl}` : ''}\n\nCheck exact parts, pinouts, power, fit and supplier listings before buying or building.\n`;
  const standaloneSvg = markup => markup.replace(/^<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
  const archive = createZip([
    { name: 'README.md', data: readme },
    { name: 'project.json', data: JSON.stringify(p, null, 2) + '\n' },
    { name: 'bill-of-materials.csv', data: bomCsv(p) },
    { name: 'build-plan.txt', data: buildPlan },
    { name: 'mounting.csv', data: mountingCsv(p) },
    { name: 'wiring.svg', data: standaloneSvg(wiringSvg(p)) },
    { name: 'assembly.svg', data: standaloneSvg(assemblySvg(p)) },
    { name: 'review.txt', data: report },
    ...(traySpec ? [{ name: 'tray-spec.json', data: JSON.stringify(traySpec, null, 2) + '\n' }] : []),
    ...(reference ? [{ name: 'reference.jpg', data: Uint8Array.from(atob(reference.dataUrl.split(',')[1]), char => char.charCodeAt(0)) }] : [])
  ]);
  download(`${filename(p)}-package.zip`, archive, 'application/zip');
  showToast('Project package downloaded. Diagrams are conceptual and checks remain open.');
}
function openHistory() {
  const p = current(); let allEntries;
  try { allEntries = readRevisions(); }
  catch { $('#history-list').innerHTML = '<div class="history-empty">Revision history could not be read. Export the current JSON before making more changes.</div>'; $('#history-trash').innerHTML = ''; $('#history-dialog').showModal(); return; }
  const entries = allEntries.filter(entry => entry.projectId === p.id).reverse();
  $('#history-list').innerHTML = entries.length ? entries.map(entry => `<div class="history-entry"><div><strong>${html(entry.reason)}</strong><small>${html(new Date(entry.at).toLocaleString())} · ${html(entry.snapshot.parts?.length ?? '?')} parts · ${html(entry.snapshot.wires?.length ?? '?')} connections</small></div><button class="button button-outline" type="button" data-restore-revision="${html(entry.id)}">Restore</button></div>`).join('') : '<div class="history-empty">No earlier edits recorded for this project yet.</div>';
  const activeIds = new Set(projects.map(item => item.id)), seen = new Set();
  const deleted = allEntries.slice().reverse().filter(entry => {
    if (entry.reason !== 'Deleted project' || activeIds.has(entry.projectId) || seen.has(entry.projectId)) return false;
    seen.add(entry.projectId); return true;
  });
  $('#history-trash').innerHTML = deleted.length ? `<div class="history-section-title">RECENTLY DELETED</div><div class="history-list">${deleted.map(entry => `<div class="history-entry"><div><strong>${html(entry.snapshot.title || 'Untitled project')}</strong><small>${html(new Date(entry.at).toLocaleString())} · ${html(entry.snapshot.parts?.length ?? '?')} parts</small></div><button class="button button-outline" type="button" data-recover-project="${html(entry.id)}">Recover</button></div>`).join('')}</div>` : '';
  $('#history-dialog').showModal();
}
function restoreRevision(id) {
  const p = current(); let entry;
  try { entry = readRevisions().find(item => item.id === id && item.projectId === p.id); }
  catch { return showToast('Revision history could not be read.'); }
  if (!entry) return showToast('That revision is no longer available.');
  let restored;
  try { restored = restoreProjectFromRevision(p, entry.snapshot); }
  catch { return showToast('This revision is invalid and was not restored.'); }
  try { recordRevision(p, 'Before restoring an older revision'); }
  catch { return showToast('Current state could not be preserved in history. Export JSON before restoring.'); }
  let priorSidecar;
  try {
    priorSidecar = localStorage.getItem(trayKey(p.id));
    if (!writeTraySidecar(restored)) throw new Error('Tray draft could not be updated');
  } catch { return showToast('Tray draft could not be restored. Current project remains unchanged.'); }
  const index = projects.findIndex(item => item.id === p.id);
  projects[index] = restored;
  if (!save('Restored revision', { skipRevision: true })) {
    projects[index] = p;
    try { if (priorSidecar == null) localStorage.removeItem(trayKey(p.id)); else localStorage.setItem(trayKey(p.id), priorSidecar); } catch { showToast('Tray draft recovery failed. Export the current project JSON.'); }
    return;
  }
  $('#history-dialog').close(); activeTab = 'overview'; render(); showToast('Older state restored. Verification marks were reset.');
}
function recoverDeletedProject(id) {
  let entry;
  try { entry = readRevisions().find(item => item.id === id && item.reason === 'Deleted project' && !projects.some(project => project.id === item.projectId)); }
  catch { return showToast('Deleted-project history could not be read.'); }
  if (!entry) return showToast('That deleted project is no longer available.');
  let recovered;
  try { recovered = restoreProjectFromRevision(entry.snapshot, entry.snapshot); }
  catch { return showToast('This saved project is invalid and was not recovered.'); }
  let priorSidecar;
  try {
    priorSidecar = localStorage.getItem(trayKey(recovered.id));
    if (!writeTraySidecar(recovered)) throw new Error('Tray draft could not be updated');
  } catch { return showToast('Tray draft could not be recovered. Saved history remains available.'); }
  const priorProjects = projects, priorId = currentId;
  projects = [recovered, ...projects]; currentId = recovered.id;
  if (!save('Recover deleted project', { skipRevision: true })) {
    projects = priorProjects; currentId = priorId;
    try { if (priorSidecar == null) localStorage.removeItem(trayKey(recovered.id)); else localStorage.setItem(trayKey(recovered.id), priorSidecar); } catch { showToast('Tray draft recovery failed. Export the current project JSON.'); }
    return;
  }
  $('#history-dialog').close(); activeTab = 'overview'; render(); showToast('Project recovered. Verification and step marks were reset.');
}
function addProject(p) {
  const priorProjects = projects, priorId = currentId;
  projects = [p, ...projects]; currentId = p.id; activeTab = 'overview';
  if (!save('Before creating project')) { projects = priorProjects; currentId = priorId; render(); return false; }
  const trayCached = !p.traySpec || writeTraySidecar(p);
  render(); showToast(trayCached ? 'Project created. Review the design before building.' : 'Project saved, but the tray workbench could not cache its draft. Export JSON to keep the geometry.'); return true;
}

function render() {
  const p = current(); if (!p) return;
  syncCurrentTrayDraft(p);
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
  const reference = safeReferenceImage(p.referenceImage);
  return panelHead('DESIGN RECORD', 'Working concept', 'Keep the goal, open decisions and review status in one place.') +
    `<div class="overview-grid"><div class="overview-card dark"><h4>DESIGN INTENT</h4><p>${html(p.brief || 'Add a brief to describe the function, operating environment and constraints.')}</p><div class="phase-line"><b>1</b> Specify the job and constraints</div><div class="phase-line"><b>2</b> Lay out parts and connections</div><div class="phase-line"><b>3</b> Verify against exact components</div></div><div class="overview-card"><h4>WORKING NOTES</h4><textarea id="project-notes" aria-label="Working notes" placeholder="Dimensions, decisions, questions to resolve...">${html(p.notes)}</textarea></div></div>${reference ? `<div class="project-reference"><div><span class="eyebrow accent">VISUAL REFERENCE / UNVERIFIED</span><p>${html(reference.name)} · Sketches and photos do not establish dimensions or electrical details.</p><button id="remove-project-reference" class="text-link" type="button">Remove image</button></div><img src="${html(reference.dataUrl)}" alt="Project visual reference"></div>` : ''}<div class="notice">This workspace produces a design plan, not a certified schematic, purchase quote or manufacturing CAD. Exact part ratings, pinouts, clearances and supplier listings need verification.</div>`;
}
function renderParts(p) {
  const rows = p.parts.map((part, i) => { const checked = partReviewRecorded(part); return `<tr><td><div class="part-name">${html(part.name)}</div><div class="part-detail">${html(part.detail)}</div>${part.pins?.length ? `<div class="part-pin-count">${part.pins.length} recorded pin${part.pins.length === 1 ? '' : 's'}</div>` : ''}${safeUrl(part.sourceUrl) ? `<a class="source-link" href="${html(safeUrl(part.sourceUrl))}" target="_blank" rel="noopener noreferrer">Supplier ↗</a>` : ''}${safeUrl(part.specUrl) ? ` <a class="source-link" href="${html(safeUrl(part.specUrl))}" target="_blank" rel="noopener noreferrer">Specification ↗</a>` : ''}</td><td><span class="badge">${html(part.category)}</span></td><td>${html(part.qty)}</td><td>${Number(part.unitCost) === 0 ? '—' : money(part.unitCost)}</td><td><span class="badge ${checked ? '' : 'warn'}">${checked ? `Checked ${html(part.checkedAt.slice(0, 10))}` : part.verified ? 'Evidence missing' : 'Review'}</span></td><td><button class="text-link" data-edit-part="${i}" type="button">Edit</button></td></tr>`; }).join('');
  return panelHead('MATERIALS / BOM', 'Parts list', 'Costs are editable planning estimates. Open each part to record a current supplier and verify its specifications.', '<div><button id="add-part" class="small-button" type="button">＋ Add part</button> <button id="export-bom" class="small-button" type="button">Export CSV ↗</button></div>') + (p.parts.length ? `<div class="table-wrap"><table class="parts-table"><thead><tr><th>PART</th><th>TYPE</th><th>QTY</th><th>UNIT EST.</th><th>STATUS</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : `<div class="empty"><strong>No parts yet</strong>Add the physical components required by your brief.</div>`);
}
function wiringSvg(p) {
  const connected = new Set(p.wires.flatMap(wire => [wire.from, wire.to]));
  const parts = connected.size ? p.parts.filter(part => connected.has(part.id)) : p.parts;
  const points = new Map();
  const cols = window.innerWidth < 500 ? 1 : window.innerWidth < 750 ? 2 : 3;
  const stepX = cols === 3 ? 245 : 225;
  const width = cols === 3 ? 700 : cols === 2 ? 465 : 220;
  parts.forEach((part, i) => { const col = i % cols, row = Math.floor(i / cols); points.set(part.id, { x: 25 + col * stepX, y: 35 + row * 100, cx: 110 + col * stepX, cy: 70 + row * 100 }); });
  const height = Math.max(250, Math.ceil(parts.length / cols) * 100 + 45);
  const paths = p.wires.filter(w => points.has(w.from) && points.has(w.to)).map((w, i) => { const a = points.get(w.from), b = points.get(w.to); const offset = ((i % 5) - 2) * 12; return `<path d="M${a.cx} ${a.cy} Q${(a.cx + b.cx) / 2 + offset} ${(a.cy + b.cy) / 2 - 25} ${b.cx} ${b.cy}" fill="none" stroke="#78944b" stroke-width="1.6" marker-end="url(#arrow)" opacity=".8"><title>${html(`${w.fromPin || '?'} → ${w.toPin || '?'} · ${w.signal}`)}</title></path>`; }).join('');
  const nodes = parts.map(part => { const pos = points.get(part.id); const shortName = part.name.length > 19 ? part.name.slice(0, 18) + '…' : part.name; return `<g><rect x="${pos.x}" y="${pos.y}" width="170" height="70" rx="2" fill="#fffefa" stroke="#bfcbbd"/><rect x="${pos.x}" y="${pos.y}" width="5" height="70" fill="#c6d959"/><text x="${pos.x + 14}" y="${pos.y + 27}" font-size="10" font-family="Arial" font-weight="bold" fill="#14211f">${html(shortName)}</text><text x="${pos.x + 14}" y="${pos.y + 47}" font-size="9" font-family="monospace" fill="#6d806d">${html(part.category.toUpperCase())}</text></g>`; }).join('');
  return `<svg class="flow-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Concept wiring diagram"><defs><marker id="arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0 L7 3.5 L0 7" fill="#78944b"/></marker></defs><path d="M0 0H${width}M0 100H${width}M0 200H${width}M0 300H${width}M0 400H${width}" stroke="#e5ebdf" stroke-width=".5"/>${paths}${nodes}</svg>`;
}
function renderWiring(p) {
  const labels = Object.fromEntries(p.parts.map(part => [part.id, part.name]));
  const rows = p.wires.map((w, i) => `<div class="wire-row"><b>${html(labels[w.from] || 'Missing part')}<small>${html(w.fromPin || 'PIN ?')}</small></b><span class="arrow">→</span><b>${html(labels[w.to] || 'Missing part')}<small>${html(w.toPin || 'PIN ?')}</small></b><span>${html(w.signal)} · ${html(w.voltage)}</span><button class="text-link" data-edit-wire="${i}" type="button">Edit</button></div>`).join('');
  const evidence = safeUrl(p.wiringUrl) ? `<div class="notice">Attached electrical work: <a href="${html(safeUrl(p.wiringUrl))}" target="_blank" rel="noopener noreferrer">Open wiring plan and evidence ↗</a>. Confirm its open checks before connecting power.</div>` : '';
  return panelHead('ELECTRICAL / CONNECTIONS', 'Wiring map', 'A relationship diagram for planning. Confirm the exact connector, pin number, ground path and current capacity before assembly.', '<div><button id="add-wire" class="small-button" type="button">＋ Add connection</button> <button id="export-diagram" class="small-button" type="button">Export SVG ↗</button></div>') + evidence + (p.parts.length ? wiringSvg(p) : `<div class="empty"><strong>Add parts first</strong>Wiring will appear when components are in the design.</div>`) + (rows ? `<div class="wire-list">${rows}</div>` : '');
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
  const tray = p.traySpec ? `<div class="notice">Editable tray study: ${html(p.traySpec.outer.length)} × ${html(p.traySpec.outer.width)} × ${html(p.traySpec.outer.height)} mm, ${html(p.traySpec.mounts.length)} boss${p.traySpec.mounts.length === 1 ? '' : 'es'}, ${html(p.traySpec.cutouts.length)} opening${p.traySpec.cutouts.length === 1 ? '' : 's'}. Saved with project JSON; physical fit remains unverified.</div>` : '';
  const labels = Object.fromEntries(p.parts.map(part => [part.id, part.name]));
  const mounts = (p.mechanicalConnections || []).map((link, index) => `<div class="mount-row"><div><strong>${html(labels[link.from] || 'Missing part')} → ${html(labels[link.to] || 'Missing part')}</strong><span>${html(link.label)}</span>${link.note ? `<small>${html(link.note)}</small>` : ''}</div><button class="text-link" data-edit-mount="${index}" type="button">Edit</button></div>`).join('');
  const trayWorkbench = `./tray.html?project=${encodeURIComponent(p.id)}&title=${encodeURIComponent(p.title)}`;
  return panelHead('MECHANICAL / LAYOUT', 'Assembly concept', 'This view inventories physical parts and mounting intent. It is not dimensioned CAD and does not prove that parts fit.', '<div><button id="add-mount" class="small-button" type="button">＋ Add mounting</button> <button id="export-diagram" class="small-button" type="button">Export SVG ↗</button></div>') + evidence + tray + (p.parts.length ? assemblySvg(p) : `<div class="empty"><strong>No assembly yet</strong>Add parts to view a conceptual layout.</div>`) + `<div class="mount-list"><div class="power-list-head">MOUNTING / FIT RELATIONSHIPS <span>Intent only; test against exact dimensions and hardware.</span></div>${mounts || '<div class="power-empty">Add a relationship between two parts to record how they should attach or fit.</div>'}</div><p class="assembly-legend">${next} <a href="${trayWorkbench}" target="_blank" rel="noopener noreferrer">Open the tray workbench to create a measured CAD spec ↗</a>.</p>`;
}
function renderBuild(p) {
  const names = new Map(p.parts.map(part => [part.id, part.name]));
  const rows = p.steps.map((step, i) => `<div class="step-card ${step.done ? 'done' : ''}"><input data-done-step="${i}" type="checkbox" ${step.done ? 'checked' : ''} aria-label="Mark ${html(step.title)} complete"><div><small>${html(step.phase.toUpperCase())} / ${String(i + 1).padStart(2, '0')}</small><strong>${html(step.title)}</strong><p>${html(step.detail)}</p>${step.partIds?.length ? `<div class="step-parts">${step.partIds.map(id => `<span class="${names.has(id) ? '' : 'missing'}">${html(names.get(id) || `Missing: ${id}`)}</span>`).join('')}</div>` : ''}</div><button class="text-link" data-edit-step="${i}" type="button">Edit</button></div>`).join('');
  const prep = `<div class="build-prep"><div><span>TOOLS / MATERIALS</span>${(p.tools || []).length ? `<ul>${p.tools.map(item => `<li>${html(item)}</li>`).join('')}</ul>` : '<p>List the tools and consumables needed for this build.</p>'}</div><div><span>ASSUMPTIONS / PREREQUISITES</span>${(p.assumptions || []).length ? `<ul>${p.assumptions.map(item => `<li>${html(item)}</li>`).join('')}</ul>` : '<p>Record required skills, setup and unresolved starting conditions.</p>'}</div></div>`;
  return panelHead('SEQUENCE / TEST', 'Build plan', 'Use the steps as a checklist after validating each operation against the exact parts and tools.', '<div><button id="edit-prep" class="small-button" type="button">Edit preparation</button> <button id="add-step" class="small-button" type="button">＋ Add step</button></div>') + prep + (rows ? `<div class="step-list">${rows}</div>` : `<div class="empty"><strong>No build steps yet</strong>Add preparation, wiring, bring-up and assembly steps.</div>`);
}
function renderReview(p) {
  const issues = validate(p); const errors = issues.filter(i => i.kind === 'error').length;
  $('#review-rail').innerHTML = `<div class="rail-heading">DESIGN REVIEW</div><h3>${errors ? `${errors} data issue${errors === 1 ? '' : 's'}` : issues.length ? 'Review needed' : 'Review recorded'}</h3><p class="rail-summary">${issues.length} open ${issues.length === 1 ? 'item' : 'items'}. Review marks are local notes, not certification.</p>${issues.slice(0, 6).map(i => `<div class="rail-issue ${i.kind}"><i>${i.kind === 'error' ? '!' : i.kind === 'todo' ? '+' : '·'}</i><span>${html(i.text)}</span></div>`).join('')}${issues.length > 6 ? `<div class="rail-issue"><i>…</i><span>${issues.length - 6} more items. Inspect the project data and exact components.</span></div>` : ''}<div class="rail-note"><strong>REVIEW RECORD</strong><br>Mark a check only after reviewing independent evidence.</div>${[['electrical', 'Ratings, pinouts and current'], ['mechanical', 'Dimensions, fit and materials'], ['sourcing', 'Listings, stock and prices']].map(([key, label]) => `<label class="review-check"><input data-review="${key}" type="checkbox" ${p.review[key] ? 'checked' : ''}><span>${label}</span></label>`).join('')}`;
}

const field = (name, label, value = '', options = {}) => `<div class="field ${options.wide ? 'wide' : ''}"><label for="f-${name}">${label}</label>${options.type === 'textarea' ? `<textarea id="f-${name}" name="${name}" ${options.required ? 'required' : ''}>${html(value)}</textarea>` : options.type === 'select' ? `<select id="f-${name}" name="${name}" ${options.required ? 'required' : ''}>${options.choices.map(([id, text]) => `<option value="${html(id)}" ${String(id) === String(value) ? 'selected' : ''}>${html(text)}</option>`).join('')}</select>` : `<input id="f-${name}" name="${name}" type="${options.type || 'text'}" value="${html(value)}" ${options.required ? 'required' : ''} ${options.min != null ? `min="${options.min}"` : ''} ${options.step ? `step="${options.step}"` : ''}>`}</div>`;
const pinField = (name, label, value) => `<div class="field"><label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" list="${name}-pin-options" value="${html(value)}" maxlength="100"><datalist id="${name}-pin-options"></datalist></div>`;
function updatePinHints() {
  if (editor?.kind !== 'wire') return;
  for (const [side, selector] of [['from', '#fromPin-pin-options'], ['to', '#toPin-pin-options']]) {
    const part = current().parts.find(item => item.id === $(`#f-${side}`)?.value);
    const list = $(selector);
    if (list) list.innerHTML = (part?.pins || []).map(pin => `<option value="${html(pin)}"></option>`).join('');
  }
}
function openEditor(kind, index = -1) {
  const p = current(); editor = { kind, index };
  const isNew = index < 0; const item = !isNew ? (kind === 'part' ? p.parts[index] : kind === 'wire' ? p.wires[index] : kind === 'mount' ? p.mechanicalConnections?.[index] : kind === 'step' ? p.steps[index] : p) : {};
  $('#dialog-kicker').textContent = kind.toUpperCase() + (isNew ? ' / NEW' : ' / EDIT');
  $('#dialog-title').textContent = kind === 'prep' ? 'Edit preparation' : `${isNew ? 'Add' : 'Edit'} ${kind === 'wire' ? 'connection' : kind === 'mount' ? 'mounting relationship' : kind === 'title' ? 'project' : kind}`;
  $('#delete-entry').hidden = isNew || kind === 'title' || kind === 'prep';
  $('#dialog-error').hidden = true;
  const choices = p.parts.map(part => [part.id, part.name]);
  let fields = '';
  if (kind === 'part') fields = field('name', 'Part name', item.name, { required: true, wide: true }) + field('category', 'Category', item.category || 'Other') + field('qty', 'Quantity', item.qty ?? 1, { type: 'number', min: 1, step: 1 }) + field('unitCost', 'Unit estimate (USD)', item.unitCost ?? 0, { type: 'number', min: 0, step: '.01' }) + field('voltage', 'Operating voltage', item.voltage || '') + field('pins', 'Known pin or terminal names, one per line', (item.pins || []).join('\n'), { type: 'textarea', wide: true }) + field('sourceUrl', 'Supplier listing URL', item.sourceUrl || '', { type: 'url', wide: true }) + field('specUrl', 'Manufacturer specification or independent evidence URL', item.specUrl || '', { type: 'url', wide: true }) + field('detail', 'Specification, datasheet and open questions', item.detail || '', { type: 'textarea', wide: true }) + `<div class="field wide"><label class="verify-label"><input type="checkbox" name="verified"> I checked this exact part against the linked specification now</label></div>`;
  if (kind === 'wire') fields = field('from', 'From part', item.from || choices[0]?.[0] || '', { type: 'select', choices }) + pinField('fromPin', 'From pin or terminal', item.fromPin || '') + field('to', 'To part', item.to || choices[1]?.[0] || choices[0]?.[0] || '', { type: 'select', choices }) + pinField('toPin', 'To pin or terminal', item.toPin || '') + field('signal', 'Signal or connection', item.signal || '', { required: true }) + field('voltage', 'Voltage / range', item.voltage || '') + field('note', 'Pinout source or verification note', item.note || '', { type: 'textarea', wide: true });
  if (kind === 'mount') fields = field('from', 'First part', item.from || choices[0]?.[0] || '', { type: 'select', choices }) + field('to', 'Second part', item.to || choices[1]?.[0] || choices[0]?.[0] || '', { type: 'select', choices }) + field('label', 'Mounting or fit intent', item.label || '', { required: true, wide: true }) + field('note', 'Dimension, fastener or open check', item.note || '', { type: 'textarea', wide: true });
  if (kind === 'step') fields = field('phase', 'Phase', item.phase || 'Build', { type: 'select', choices: [['Prepare', 'Prepare'], ['Fabricate', 'Fabricate'], ['Wire', 'Wire'], ['Bring up', 'Bring up'], ['Assemble', 'Assemble'], ['Test', 'Test']] }) + field('title', 'Step title', item.title || '', { required: true }) + field('detail', 'Action and acceptance check', item.detail || '', { type: 'textarea', wide: true }) + `<fieldset class="step-part-picker field wide"><legend>Parts used in this step</legend>${p.parts.length ? p.parts.map(part => `<label><input type="checkbox" name="stepPartId" value="${html(part.id)}" ${(item.partIds || []).includes(part.id) ? 'checked' : ''}> ${html(part.name)}</label>`).join('') : '<p>Add parts before linking them to a step.</p>'}</fieldset>`;
  if (kind === 'prep') fields = field('tools', 'Tools and consumables, one per line', (p.tools || []).join('\n'), { type: 'textarea', wide: true }) + field('assumptions', 'Assumptions and prerequisites, one per line', (p.assumptions || []).join('\n'), { type: 'textarea', wide: true });
  if (kind === 'title') fields = field('title', 'Project title', p.title, { required: true, wide: true }) + field('brief', 'Design brief', p.brief, { type: 'textarea', wide: true }) + field('summary', 'Summary', p.summary, { type: 'textarea', wide: true }) + field('wiringUrl', 'Electrical plan and evidence URL', p.wiringUrl || '', { type: 'url', wide: true }) + field('cadUrl', 'Dimensioned CAD or verification package URL', p.cadUrl || '', { type: 'url', wide: true });
  $('#dialog-fields').innerHTML = fields; updatePinHints(); $('#editor-dialog').showModal();
}
function closeEditor() { $('#editor-dialog').close(); editor = null; }
function saveEditor(event) {
  event.preventDefault(); if (!editor) return;
  const p = current(); const form = new FormData($('#editor-form')); const { kind, index } = editor;
  if (kind === 'part') {
    let pins;
    try { pins = safePinList(String(form.get('pins') || '').split(/\r?\n/).map(value => value.trim()).filter(Boolean)); }
    catch (error) { return editorError(error.message); }
    const newPart = { id: index < 0 ? `part-${crypto.randomUUID().slice(0, 8)}` : p.parts[index].id, name: String(form.get('name') || '').trim(), category: String(form.get('category') || 'Other').trim(), qty: Number(form.get('qty')), unitCost: Number(form.get('unitCost')), voltage: String(form.get('voltage') || '').trim(), pins, sourceUrl: String(form.get('sourceUrl') || '').trim(), specUrl: String(form.get('specUrl') || '').trim(), detail: String(form.get('detail') || '').trim(), verified: form.has('verified'), checkedAt: form.has('verified') ? new Date().toISOString() : '' };
    if (!newPart.name || newPart.qty <= 0 || newPart.unitCost < 0 || !Number.isFinite(newPart.unitCost)) return editorError('Enter a name, positive quantity and valid cost.');
    if (newPart.sourceUrl && !/^https?:\/\//i.test(newPart.sourceUrl)) return editorError('Supplier URL must start with https:// or http://.');
    if (newPart.specUrl && !/^https?:\/\//i.test(newPart.specUrl)) return editorError('Specification URL must start with https:// or http://.');
    if (newPart.verified && !newPart.specUrl) return editorError('Link the exact specification before marking this part checked.');
    if (index < 0) p.parts.push(newPart); else p.parts[index] = newPart;
    p.review.sourcing = false; p.review.electrical = false; p.review.mechanical = false;
  }
  if (kind === 'wire') {
    const wire = { from: String(form.get('from')), fromPin: String(form.get('fromPin') || '').trim().slice(0, 100), to: String(form.get('to')), toPin: String(form.get('toPin') || '').trim().slice(0, 100), signal: String(form.get('signal') || '').trim(), voltage: String(form.get('voltage') || '').trim(), note: String(form.get('note') || '').trim() };
    if (!wire.from || !wire.to || wire.from === wire.to || !wire.signal) return editorError('Choose two different parts and name the connection.');
    for (const [partId, pin] of [[wire.from, wire.fromPin], [wire.to, wire.toPin]]) {
      const part = p.parts.find(item => item.id === partId);
      if (part?.pins?.length && pin && !part.pins.includes(pin)) return editorError(`“${pin}” is absent from ${part.name}'s recorded pin inventory.`);
    }
    if (index < 0) p.wires.push(wire); else p.wires[index] = wire; p.review.electrical = false;
  }
  if (kind === 'mount') {
    const link = { from: String(form.get('from')), to: String(form.get('to')), label: String(form.get('label') || '').trim().slice(0, 240), note: String(form.get('note') || '').trim().slice(0, 1000) };
    if (!link.from || !link.to || !link.label) return editorError('Choose two parts and describe how they attach or fit.');
    if (link.from === link.to && Number(p.parts.find(part => part.id === link.from)?.qty || 0) < 2) return editorError('Choose two different parts, or use a part with multiple units.');
    p.mechanicalConnections ||= [];
    if (index < 0) p.mechanicalConnections.push(link); else p.mechanicalConnections[index] = link;
    p.review.mechanical = false;
  }
  if (kind === 'step') {
    const step = { id: index < 0 ? `step-${crypto.randomUUID().slice(0, 8)}` : p.steps[index].id, phase: String(form.get('phase')), title: String(form.get('title') || '').trim(), detail: String(form.get('detail') || '').trim(), partIds: form.getAll('stepPartId').map(String), done: index < 0 ? false : p.steps[index].done };
    if (!step.title) return editorError('Give the step a title.');
    if (index < 0) p.steps.push(step); else p.steps[index] = step;
  }
  if (kind === 'prep') {
    const lines = value => String(value || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const tools = lines(form.get('tools')), assumptions = lines(form.get('assumptions'));
    if ([tools, assumptions].some(items => items.length > 30 || items.some(item => item.length > 160))) return editorError('Use at most 30 entries per list and 160 characters per entry.');
    p.tools = tools; p.assumptions = assumptions;
  }
  if (kind === 'title') {
    const title = String(form.get('title') || '').trim().slice(0, 100);
    const cadUrl = String(form.get('cadUrl') || '').trim();
    const wiringUrl = String(form.get('wiringUrl') || '').trim();
    if (!title) return editorError('Give the project a title.');
    if (cadUrl && !/^https?:\/\//i.test(cadUrl)) return editorError('CAD URL must start with https:// or http://.');
    if (wiringUrl && !/^https?:\/\//i.test(wiringUrl)) return editorError('Electrical plan URL must start with https:// or http://.');
    if (cadUrl !== (p.cadUrl || '')) p.review.mechanical = false;
    if (wiringUrl !== (p.wiringUrl || '')) p.review.electrical = false;
    p.title = title; p.brief = String(form.get('brief') || '').trim(); p.summary = String(form.get('summary') || '').trim(); p.cadUrl = cadUrl; p.wiringUrl = wiringUrl;
  }
  closeEditor(); const saved = save(`Before ${kind} edit`); render(); if (saved) showToast('Saved locally.');
}
function deleteEntry() {
  if (!editor || editor.index < 0) return;
  const p = current(), { kind, index } = editor;
  if (!window.confirm(`Delete this ${kind} from the project?`)) return;
  if (kind === 'part') { const id = p.parts[index].id; p.parts.splice(index, 1); p.wires = p.wires.filter(w => w.from !== id && w.to !== id); p.mechanicalConnections = (p.mechanicalConnections || []).filter(link => link.from !== id && link.to !== id); p.steps.forEach(step => { step.partIds = (step.partIds || []).filter(partId => partId !== id); }); for (const rail of p.powerRails || []) { rail.loads = rail.loads.filter(load => load.partId !== id); if (rail.sourcePartId === id) rail.sourcePartId = ''; } p.review = { electrical: false, mechanical: false, sourcing: false }; }
  if (kind === 'wire') { p.wires.splice(index, 1); p.review.electrical = false; }
  if (kind === 'mount') { p.mechanicalConnections.splice(index, 1); p.review.mechanical = false; }
  if (kind === 'step') p.steps.splice(index, 1);
  closeEditor(); const saved = save(`Before deleting ${kind}`); render(); if (saved) showToast('Entry removed.');
}
function handleClick(event) {
  const button = event.target.closest('button'); if (!button) return;
  const p = current();
  if (button.dataset.project) { currentId = button.dataset.project; activeTab = 'overview'; save(); render(); }
  else if (button.dataset.starter) addProject(makeProject(STARTERS.find(s => s.id === button.dataset.starter)));
  else if (button.dataset.tab) { activeTab = button.dataset.tab; render(); }
  else if (button.dataset.editPart != null) openEditor('part', Number(button.dataset.editPart));
  else if (button.dataset.editWire != null) openEditor('wire', Number(button.dataset.editWire));
  else if (button.dataset.editMount != null) openEditor('mount', Number(button.dataset.editMount));
  else if (button.dataset.editStep != null) openEditor('step', Number(button.dataset.editStep));
  else if (button.id === 'new-project') addProject(blankProject());
  else if (button.id === 'create-from-brief') {
    const idea = $('#brief-input').value.trim(); if (!idea) return showToast('Describe your idea first.');
    const composed = composeBrief(idea, briefAnswers);
    const firstSentence = idea.split(/[.!?]/)[0];
    const title = firstSentence.length > 80 ? firstSentence.slice(0, 80).replace(/\s+\S*$/, '') : firstSentence;
    const next = blankProject(title); next.brief = composed.text; next.referenceImage = pendingReference;
    const openSummary = composed.openQuestions.length ? `${composed.openQuestions.length} design question${composed.openQuestions.length === 1 ? '' : 's'} ${composed.openQuestions.length === 1 ? 'remains' : 'remain'} open.` : 'Intake questions answered.';
    next.summary = `Custom concept. Add parts, connections and build steps. ${openSummary} No automatic design was generated.`;
    if (addProject(next)) { $('#brief-input').value = ''; briefAnswers = {}; pendingReference = null; renderReferenceInput(); renderBriefGuidance(); }
  }
  else if (button.id === 'draft-local') void draftWithLocalAi();
  else if (button.id === 'choose-reference') $('#reference-file').click();
  else if (button.id === 'accept-draft' && pendingDraft) { if (addProject(pendingDraft)) { pendingDraft = null; $('#draft-dialog').close(); $('#brief-input').value = ''; briefAnswers = {}; pendingReference = null; renderReferenceInput(); renderBriefGuidance(); } }
  else if (button.id === 'clear-brief-answers') { briefAnswers = {}; renderBriefGuidance(); }
  else if (button.id === 'discard-draft' || button.id === 'discard-draft-x') { pendingDraft = null; $('#draft-dialog').close(); showToast('Draft discarded. Your brief is still here.'); }
  else if (button.id === 'remove-reference' && !draftController) { pendingReference = null; renderReferenceInput(); }
  else if (button.id === 'remove-project-reference') { const previous = p.referenceImage; p.referenceImage = null; if (save('Before removing visual reference')) { render(); showToast('Visual reference removed.'); } else p.referenceImage = previous; }
  else if (button.id === 'rename-project') openEditor('title', 0);
  else if (button.id === 'history-project') { if (syncCurrentTrayDraft(p)) openHistory(); }
  else if (button.id === 'close-history' || button.id === 'history-done') $('#history-dialog').close();
  else if (button.id === 'history-export') { try { download(`${filename(p)}.json`, JSON.stringify(projectWithTraySpec(p), null, 2), 'application/json'); showToast('Current project JSON downloaded.'); } catch { showToast('Tray draft could not be read. Export the tray spec separately from its workbench.'); } }
  else if (button.dataset.restoreRevision) restoreRevision(button.dataset.restoreRevision);
  else if (button.dataset.recoverProject) recoverDeletedProject(button.dataset.recoverProject);
  else if (button.id === 'download-unreadable' && unreadableSavedData !== null) { download('hardware-studio-unreadable-saved-data.json', unreadableSavedData, 'application/json'); $('#start-clean').disabled = false; showToast('Original saved bytes downloaded. Keep that file before starting clean.'); }
  else if (button.id === 'start-clean' && unreadableSavedData !== null && !$('#start-clean').disabled) {
    if (!window.confirm('Replace the unreadable workspace only after keeping its downloaded backup?')) return;
    const fresh = makeProject(STARTERS[0]);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ projects: [fresh], currentId: fresh.id })); }
    catch { return showToast('Could not start a new workspace. Original saved data remains in place.'); }
    unreadableSavedData = null; projects = [fresh]; currentId = fresh.id; activeTab = 'overview'; $('#recovery-dialog').close(); render(); showToast('New workspace started. Keep the downloaded original for recovery.');
  }
  else if (button.id === 'import-project') $('#import-file').click();
  else if (button.id === 'delete-project') {
    if (!syncCurrentTrayDraft(p)) return;
    if (!window.confirm(`Move “${p.title}” to Recently deleted? It can be recovered while this browser keeps its bounded history.`)) return;
    try { recordRevision(p, 'Deleted project'); }
    catch { return showToast('Project was not deleted because its recovery snapshot could not be saved. Export JSON first.'); }
    const priorProjects = projects, priorId = currentId;
    projects = projects.filter(item => item.id !== p.id);
    if (!projects.length) projects = [makeProject(STARTERS[0])];
    currentId = projects[0].id; activeTab = 'overview';
    if (!save('Deleted project', { skipRevision: true })) { projects = priorProjects; currentId = priorId; render(); return; }
    render(); showToast('Project moved to Recently deleted. Open History to recover it.');
  }
  else if (button.id === 'export-project') { try { download(`${filename(p)}.json`, JSON.stringify(projectWithTraySpec(p), null, 2), 'application/json'); showToast('Project JSON downloaded, including any saved tray geometry.'); } catch { showToast('Tray draft could not be read. Export the tray spec separately from its workbench.'); } }
  else if (button.id === 'export-package') { try { exportPackage(p); } catch { showToast('Package export failed. Export JSON to preserve the project.'); } }
  else if (button.id === 'export-bom') { download(`${filename(p)}-bom.csv`, bomCsv(p), 'text/csv'); showToast('Parts list downloaded.'); }
  else if (button.id === 'export-diagram') { const svg = $('#panel svg'); if (svg) { download(`${filename(p)}-${activeTab}.svg`, new XMLSerializer().serializeToString(svg), 'image/svg+xml'); showToast('Diagram downloaded.'); } }
  else if (button.id === 'add-part') openEditor('part');
  else if (button.id === 'add-rail') { p.powerRails ||= []; p.powerRails.push({ id: `rail-${crypto.randomUUID().slice(0, 8)}`, name: 'New rail', voltageV: 5, supplyCurrentMa: null, marginPercent: 20, sourcePartId: '', loads: [] }); p.review.electrical = false; save('Before adding power rail'); render(); }
  else if (button.dataset.addLoad != null) { const index = Number(button.dataset.addLoad), rail = p.powerRails?.[index], partId = $(`#add-load-${index}`)?.value; if (rail && partId && !rail.loads.some(load => load.partId === partId)) { rail.loads.push({ partId, currentMaEach: null }); p.review.electrical = false; save('Before adding rail load'); render(); } }
  else if (button.dataset.removeLoad) { const [railIndex, loadIndex] = button.dataset.removeLoad.split(':').map(Number); p.powerRails?.[railIndex]?.loads.splice(loadIndex, 1); p.review.electrical = false; save('Before removing rail load'); render(); }
  else if (button.dataset.removeRail != null) { const index = Number(button.dataset.removeRail); if (!window.confirm(`Remove “${p.powerRails?.[index]?.name || 'this rail'}” and its budget from this project?`)) return; p.powerRails.splice(index, 1); p.review.electrical = false; save('Before removing power rail'); render(); }
  else if (button.id === 'add-wire') { if (p.parts.length < 2) return showToast('Add at least two parts first.'); openEditor('wire'); }
  else if (button.id === 'add-mount') { if (p.parts.length < 2) return showToast('Add at least two parts first.'); openEditor('mount'); }
  else if (button.id === 'add-step') openEditor('step');
  else if (button.id === 'edit-prep') openEditor('prep');
  else if (button.id === 'close-dialog' || button.id === 'cancel-dialog') closeEditor();
  else if (button.id === 'delete-entry') deleteEntry();
}
function handleChange(event) {
  const p = current(); const target = event.target;
  if (target.id === 'reference-file') {
    const file = target.files?.[0]; target.value = ''; if (!file || draftController) return;
    prepareReferenceImage(file).then(reference => { pendingReference = reference; renderReferenceInput(); showToast('Visual reference ready and kept on this device.'); }).catch(error => showToast(error.message || 'Could not read that image.'));
    return;
  }
  if (target.dataset.railField) {
    const rail = p.powerRails?.[Number(target.dataset.railIndex)]; if (!rail) return;
    const key = target.dataset.railField;
    const value = ['voltageV', 'supplyCurrentMa', 'marginPercent'].includes(key) ? (target.value === '' ? null : Number(target.value)) : target.value.trim();
    if (key === 'voltageV' && (!Number.isFinite(value) || value <= 0)) return showToast('Enter a positive rail voltage.');
    if (key === 'supplyCurrentMa' && value != null && (!Number.isFinite(value) || value <= 0)) return showToast('Enter a positive supply rating.');
    if (key === 'marginPercent' && (!Number.isFinite(value) || value < 0 || value >= 100)) return showToast('Enter a margin target from 0 to 99%.');
    if (key === 'name' && !value) return showToast('Give the rail a name.');
    rail[key] = value; p.review.electrical = false; save('Before changing power rail'); render(); return;
  }
  if (target.dataset.loadRail != null) {
    const load = p.powerRails?.[Number(target.dataset.loadRail)]?.loads?.[Number(target.dataset.loadIndex)]; if (!load) return;
    const value = target.value === '' ? null : Number(target.value);
    if (value != null && (!Number.isFinite(value) || value < 0)) return showToast('Enter a nonnegative peak current or leave it blank.');
    load.currentMaEach = value; p.review.electrical = false; save('Before changing load current'); render(); return;
  }
  if (target.dataset.doneStep != null) { p.steps[Number(target.dataset.doneStep)].done = target.checked; save('Before changing step progress'); render(); }
  if (target.dataset.review) { p.review[target.dataset.review] = target.checked; save('Before changing review mark'); renderReview(p); }
  if (target.id === 'import-file') {
    const file = target.files?.[0]; if (!file) return;
    if (file.size > 2_000_000) { showToast('Choose a project smaller than 2 MB.'); target.value = ''; return; }
    file.text().then(text => { try { addProject(safeProject(JSON.parse(text))); } catch (error) { showToast(error.message); } }).finally(() => { target.value = ''; });
  }
}
function initialize() {
  let rawSavedData = null;
  try { rawSavedData = localStorage.getItem(STORAGE_KEY); }
  catch { storageUnavailable = true; showToast('Browser storage is unavailable. Export JSON to keep projects.'); }
  try {
    if (!storageUnavailable && rawSavedData !== null) {
      const saved = parseSavedWorkspace(rawSavedData);
      projects = saved.projects.map(safeProjectForStorage); currentId = saved.currentId;
    }
  } catch { unreadableSavedData = rawSavedData; showToast('Saved data could not be read. The original bytes are preserved.'); }
  if (!projects.length) { projects = [makeProject(STARTERS[0])]; currentId = projects[0].id; if (unreadableSavedData === null && !storageUnavailable) save('Initial workspace'); }
  if (!projects.some(p => p.id === currentId)) currentId = projects[0].id;
  document.addEventListener('click', handleClick);
  document.addEventListener('change', handleChange);
  $('#brief-input').addEventListener('input', renderBriefGuidance);
  $('#brief-question-list').addEventListener('input', event => {
    const key = event.target.dataset.briefAnswer;
    if (!key) return;
    briefAnswers[key] = event.target.value;
    const questions = briefQuestions($('#brief-input').value);
    $('#brief-progress').textContent = `${questions.filter(item => String(briefAnswers[item.id] || '').trim()).length} / ${questions.length} ANSWERED`;
  });
  window.addEventListener('storage', event => {
    if (event.key === trayKey(current()?.id)) {
      clearTimeout(traySyncTimer);
      traySyncTimer = setTimeout(() => render(), 800);
    }
  });
  let diagramLayout = window.innerWidth < 500 ? 0 : window.innerWidth < 530 ? 1 : window.innerWidth < 750 ? 2 : 3;
  window.addEventListener('resize', () => {
    const next = window.innerWidth < 500 ? 0 : window.innerWidth < 530 ? 1 : window.innerWidth < 750 ? 2 : 3;
    if (next !== diagramLayout) { diagramLayout = next; if (activeTab === 'wiring' || activeTab === 'assembly') render(); }
  });
  $('#editor-form').addEventListener('submit', saveEditor);
  $('#editor-form').addEventListener('change', event => { if (event.target.name === 'from' || event.target.name === 'to') updatePinHints(); });
  $('#draft-dialog').addEventListener('close', () => { pendingDraft = null; });
  $('#panel').addEventListener('change', event => { if (event.target.id === 'project-notes') { current().notes = event.target.value; if (save('Before editing notes')) showToast('Notes saved locally.'); } });
  render();
  renderBriefGuidance();
  if (unreadableSavedData !== null) showRecovery();
  void detectLocalModels();
}
function safeProjectForStorage(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.parts) || !Array.isArray(input.wires) || !Array.isArray(input.steps)) throw new Error('Invalid stored project');
  return { ...input, powerRails: Array.isArray(input.powerRails) ? input.powerRails : [], mechanicalConnections: Array.isArray(input.mechanicalConnections) ? input.mechanicalConnections : [], traySpec: input.traySpec == null ? null : validateTraySpec(input.traySpec), review: { electrical: false, mechanical: false, sourcing: false, ...(input.review || {}) } };
}
initialize();
