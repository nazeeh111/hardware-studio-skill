import { projectContentChanged } from './core.js?v=40';

const text = (maxLength, minLength = 0) => ({ type: 'string', minLength, maxLength, ...(minLength ? { pattern: '\\S' } : {}) });
// Imported projects may use human-readable IDs. Preserve those exact IDs in
// references and targets rather than restricting edits to generated slug IDs.
const id = () => ({ type: 'string', minLength: 1, maxLength: 80 });
const record = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const list = (items, maxItems = 32) => ({ type: 'array', items, minItems: 0, maxItems });
const index = { type: 'integer', minimum: 0, maximum: 499 };
const entry = () => ({ ...text(160, 1), pattern: '^[^\\r\\n]*\\S[^\\r\\n]*$' });
const shapes = {
  parts: record({ id: id(), name: text(200, 1), category: text(80, 1), qty: { type: 'integer', minimum: 1, maximum: 10000 }, detail: text(2000, 1), voltage: text(60) }),
  wires: record({ from: id(), fromPin: text(100), to: id(), toPin: text(100), signal: text(160, 1), voltage: text(80), note: text(1000) }),
  mechanicalConnections: record({ from: id(), to: id(), label: text(240, 1), note: text(1000) }),
  steps: record({ phase: { type: 'string', enum: ['Prepare', 'Fabricate', 'Wire', 'Bring up', 'Assemble', 'Test'] }, title: text(200, 1), detail: text(2000, 1), partIds: { ...list(id(), 40), uniqueItems: true } }),
  powerRails: record({ id: id(), name: text(100, 1), voltageV: { type: 'number', exclusiveMinimum: 0, maximum: 60 }, sourcePartId: id(), loads: list(record({ partId: id() }), 40) })
};
const byId = new Set(['parts', 'powerRails']);
const operationShape = (section, shape) => record({ add: list(shape), replace: list(byId.has(section) ? shape : record({ index, value: shape })), remove: list(byId.has(section) ? id() : index) });

// This is a proposal vocabulary, not an imported project. Evidence, completion,
// reviews, prices, pin inventories, CAD, links and current ratings have no setters.
export const CHANGE_SCHEMA = record({
  summary: text(1200, 1),
  ...Object.fromEntries(Object.entries(shapes).map(([section, shape]) => [section, operationShape(section, shape)])),
  tools: record({ add: list(entry()), remove: list(entry()) }),
  assumptions: record({ add: list(entry()), remove: list(entry()) })
});

function invalid(path, message) { throw new Error(`Invalid project change: ${path} ${message}.`); }
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = value => structuredClone(value);
const editable = (value, section) => Object.fromEntries(Object.keys(shapes[section].properties).map(key => [key,
  section === 'powerRails' && key === 'loads' ? value.loads.map(load => ({ partId: load.partId })) : value[key]
]));
const sameEditable = (before, value, section) => equal(editable(before, section), editable(value, section));

function check(value, schema, path = 'proposal') {
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(path, 'must be a plain object');
    for (const key of Object.keys(value)) if (!Object.hasOwn(schema.properties, key)) invalid(`${path}.${key}`, 'is an unknown field');
    for (const key of schema.required) {
      if (!Object.hasOwn(value, key)) invalid(`${path}.${key}`, 'is required');
      check(value[key], schema.properties[key], `${path}.${key}`);
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length < schema.minItems || value.length > schema.maxItems) invalid(path, `must contain up to ${schema.maxItems} entries`);
    Array.from(value).forEach((item, i) => check(item, schema.items, `${path}[${i}]`));
    if (schema.uniqueItems && new Set(value).size !== value.length) invalid(path, 'contains duplicates');
  } else if (schema.type === 'string') {
    if (typeof value !== 'string' || (schema.minLength != null && value.length < schema.minLength) || (schema.maxLength != null && value.length > schema.maxLength) || (schema.pattern && !new RegExp(schema.pattern).test(value)) || (schema.enum && !schema.enum.includes(value))) invalid(path, 'has invalid text');
  } else if (typeof value !== 'number' || !Number.isFinite(value) || (schema.type === 'integer' && !Number.isInteger(value)) || (schema.minimum != null && value < schema.minimum) || (schema.exclusiveMinimum != null && value <= schema.exclusiveMinimum) || value > schema.maximum) invalid(path, 'has an invalid number');
}

const limits = { parts: 200, wires: 500, mechanicalConnections: 500, steps: 200, powerRails: 20, tools: 30, assumptions: 30 };
function checkBase(base) {
  if (!base || typeof base !== 'object' || !Array.isArray(base.parts) || !Array.isArray(base.wires) || !Array.isArray(base.steps)) invalid('project', 'is missing its design lists');
  for (const [section, max] of Object.entries(limits)) {
    const rows = base[section] ?? [];
    if (!Array.isArray(rows) || rows.length > max || rows.some(row => section === 'tools' || section === 'assumptions' ? typeof row !== 'string' : !row || typeof row !== 'object' || Array.isArray(row))) invalid(section, 'has invalid or excessive existing records');
  }
  for (const section of byId) {
    const ids = (base[section] || []).map(row => row.id);
    if (ids.some(value => typeof value !== 'string' || !value) || new Set(ids).size !== ids.length) invalid(section, 'needs unique existing IDs');
  }
  if (base.steps.some(step => step.partIds != null && !Array.isArray(step.partIds)) || (base.powerRails || []).some(rail => !Array.isArray(rail.loads) || rail.loads.length > 200 || rail.loads.some(load => !load || typeof load !== 'object'))) invalid('project', 'has malformed existing links');
}

function checkReferences(project) {
  const parts = new Map(project.parts.map(part => [part.id, part]));
  const requirePart = (partId, path) => { if (!parts.has(partId)) invalid(path, `refers to missing part ${partId}`); };
  for (const [i, wire] of project.wires.entries()) {
    requirePart(wire.from, `wires[${i}].from`); requirePart(wire.to, `wires[${i}].to`);
    if (wire.from === wire.to) invalid(`wires[${i}]`, 'has the same part at both ends');
  }
  for (const [i, link] of (project.mechanicalConnections || []).entries()) {
    requirePart(link.from, `mechanicalConnections[${i}].from`); requirePart(link.to, `mechanicalConnections[${i}].to`);
    if (link.from === link.to && parts.get(link.from).qty < 2) invalid(`mechanicalConnections[${i}]`, 'requires multiple units for a self relationship');
  }
  for (const [i, step] of project.steps.entries()) for (const partId of step.partIds || []) requirePart(partId, `steps[${i}]`);
  for (const [i, rail] of (project.powerRails || []).entries()) {
    // An existing manually entered rail may still await source selection.
    // Proposed rails cannot introduce this state because their schema requires
    // a nonempty source ID; nonempty dangling source IDs always remain errors.
    if (rail.sourcePartId !== '') requirePart(rail.sourcePartId, `powerRails[${i}].sourcePartId`);
    const seen = new Set();
    for (const load of rail.loads) {
      requirePart(load.partId, `powerRails[${i}].loads`);
      if (load.partId === rail.sourcePartId || seen.has(load.partId)) invalid(`powerRails[${i}].loads`, 'has a duplicate or source load');
      seen.add(load.partId);
    }
  }
}

/** IDs and original indexes are supplied together; reference pixels, CAD and
 * source/evidence metadata are deliberately not sent to the model. */
export function modelProjectContext(project) {
  checkBase(project);
  const context = { id: project.id, title: String(project.title || '').slice(0, 100), brief: String(project.brief || '').slice(0, 5000), summary: String(project.summary || '').slice(0, 2000) };
  for (const section of Object.keys(shapes)) context[section] = (project[section] || []).map((row, index) => ({ index, ...editable(row, section) }));
  context.tools = clone(project.tools || []); context.assumptions = clone(project.assumptions || []);
  if (JSON.stringify(context).length > 350000) invalid('context', 'is too large for a bounded local model request');
  return clone(context);
}

/** Apply an untrusted proposal to a detached snapshot. Every changed record,
 * including derived invalidation, is returned for the confirmation preview. */
export function proposeProjectChange(base, raw, request, model) {
  checkBase(base);
  if (typeof request !== 'string' || !request.trim() || request.length > 5000) invalid('request', 'must contain 1 to 5000 characters');
  if (typeof model !== 'string' || !model.trim() || model.length > 80) invalid('model', 'must contain 1 to 80 characters');
  let serialized;
  try { serialized = typeof raw === 'string' ? raw : JSON.stringify(raw); } catch { invalid('proposal', 'must be JSON'); }
  if (!serialized || serialized.length > 131072) invalid('proposal', 'exceeds the JSON size limit');
  if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch { invalid('proposal', 'must be valid JSON'); } }
  check(raw, CHANGE_SCHEMA);
  const count = Object.keys(limits).reduce((sum, section) => sum + Object.values(raw[section]).reduce((n, rows) => n + rows.length, 0), 0);
  if (!count || count > 32) invalid('operations', 'must contain 1 to 32 changes');
  const project = clone(base);
  const origins = {};
  const affected = new Set(), changedParts = new Set(), identityParts = new Set(), wireChangedParts = new Set();
  const explicitWires = new Set();
  const touch = (section, row) => {
    if (!row) return;
    if (section === 'parts') affected.add(row.id);
    if (section === 'wires' || section === 'mechanicalConnections') { affected.add(row.from); affected.add(row.to); }
    if (section === 'steps') for (const partId of row.partIds || []) affected.add(partId);
    if (section === 'powerRails') { affected.add(row.sourcePartId); for (const load of row.loads) affected.add(load.partId); }
  };
  for (const section of Object.keys(shapes)) {
    const original = base[section] || [], ops = raw[section];
    const targets = new Set(), replacements = new Map(), removals = new Set();
    const target = key => {
      const i = byId.has(section) ? original.findIndex(row => row.id === key) : key;
      if (!Number.isInteger(i) || i < 0 || i >= original.length) invalid(section, `has missing original target ${key}`);
      if (targets.has(i)) invalid(section, `has a duplicate or conflicting target ${key}`);
      targets.add(i); return i;
    };
    for (const key of ops.remove) removals.add(target(key));
    for (const replacement of ops.replace) {
      const i = target(byId.has(section) ? replacement.id : replacement.index);
      const value = byId.has(section) ? replacement : replacement.value;
      if (sameEditable(original[i], value, section)) invalid(section, `replacement ${i} makes no editable change`);
      replacements.set(i, value);
    }
    const usedIds = new Set(original.map(row => row.id));
    for (const addition of ops.add) if (byId.has(section)) {
      if (usedIds.has(addition.id)) invalid(section, `cannot reuse existing or added ID ${addition.id}`);
      usedIds.add(addition.id);
    }
    const rows = [], rowOrigins = [];
    const prepare = (value, old) => {
      touch(section, old); touch(section, value);
      if (section === 'wires') for (const wire of [old, value]) if (wire) { wireChangedParts.add(wire.from); wireChangedParts.add(wire.to); }
      let next = { ...old, ...clone(value) };
      if (section === 'parts') {
        changedParts.add(value.id);
        if (!old || ['name', 'category', 'detail', 'voltage'].some(key => old[key] !== value[key])) {
          identityParts.add(value.id);
          Object.assign(next, { unitCost: 0, pins: [], sourceUrl: '', specUrl: '', checkedAt: '', verified: false });
        }
      }
      if (section === 'powerRails') {
        next.supplyCurrentMa = null; next.marginPercent = old?.marginPercent ?? 20;
        next.loads = value.loads.map(load => ({ ...(old?.loads.find(previous => previous.partId === load.partId) || {}), partId: load.partId, currentMaEach: null }));
      }
      if (section === 'steps') {
        if (!old) {
          let number = 1;
          while (usedIds.has(`step-ai-${number}`)) number++;
          next.id = `step-ai-${number}`; usedIds.add(next.id);
        }
        next.done = false;
      }
      if (section === 'wires') explicitWires.add(next);
      return next;
    };
    original.forEach((row, i) => {
      if (removals.has(i)) {
        touch(section, row);
        if (section === 'parts') changedParts.add(row.id);
        if (section === 'wires') { wireChangedParts.add(row.from); wireChangedParts.add(row.to); }
        return;
      }
      rows.push(replacements.has(i) ? prepare(replacements.get(i), row) : project[section][i]); rowOrigins.push(i);
    });
    ops.add.forEach(row => { rows.push(prepare(row, null)); rowOrigins.push(null); });
    if (rows.length > limits[section]) invalid(section, 'exceeds the project record limit');
    if (ops.add.length || ops.replace.length || ops.remove.length) project[section] = rows;
    origins[section] = rowOrigins;
  }
  let globalChange = false;
  for (const section of ['tools', 'assumptions']) {
    const original = base[section] || [], ops = raw[section];
    const removals = new Set(ops.remove), additions = new Set(ops.add);
    if (removals.size !== ops.remove.length || additions.size !== ops.add.length) invalid(section, 'has duplicate operations');
    for (const value of removals) if (original.filter(item => item === value).length !== 1 || additions.has(value)) invalid(section, 'has a missing, ambiguous or conflicting removal');
    for (const value of additions) if (original.includes(value)) invalid(section, 'adds an existing entry');
    if (ops.add.length || ops.remove.length) {
      project[section] = original.filter(value => !removals.has(value)).concat(ops.add);
      if (project[section].length > limits[section]) invalid(section, 'exceeds the project record limit');
      globalChange = true;
    }
  }
  if (!projectContentChanged(base, project)) invalid('proposal', 'makes no change');
  checkReferences(project); // Deletion never silently deletes dependent records.

  // One connection away is affected by a changed part. Do not walk transitively
  // through a shared source and invalidate every unrelated branch of the build.
  for (const section of ['wires', 'mechanicalConnections']) for (const row of project[section] || []) {
    if (changedParts.has(row.from) || changedParts.has(row.to)) touch(section, row);
  }
  project.wires.forEach(wire => {
    if (explicitWires.has(wire)) return;
    if (identityParts.has(wire.from)) wire.fromPin = '';
    if (identityParts.has(wire.to)) wire.toPin = '';
  });
  // Check only model-authored connections, against the actual post-invalidation
  // inventories. Unchanged manual pin errors are neither rewritten nor promoted
  // into a requirement to repair unrelated work before applying this proposal.
  const nextParts = new Map(project.parts.map(part => [part.id, part]));
  project.wires.forEach((wire, i) => {
    if (!explicitWires.has(wire)) return;
    for (const [partId, pin] of [[wire.from, wire.fromPin], [wire.to, wire.toPin]]) {
      const part = nextParts.get(partId);
      if (pin.trim() && Array.isArray(part.pins) && part.pins.length && !part.pins.includes(pin)) invalid(`wires[${i}]`, `names pin ${pin} absent from the recorded pin inventory for ${partId}`);
    }
  });
  (project.powerRails || []).forEach(rail => {
    if (changedParts.has(rail.sourcePartId)) {
      rail.supplyCurrentMa = null;
      for (const load of rail.loads) affected.add(load.partId);
    }
    for (const load of rail.loads) if (changedParts.has(load.partId) || wireChangedParts.has(load.partId)) {
      load.currentMaEach = null; affected.add(rail.sourcePartId);
    }
  });
  project.steps.forEach(step => {
    if (globalChange || !(step.partIds || []).length || step.partIds.some(partId => affected.has(partId))) step.done = false;
  });
  project.review = { ...(project.review || {}), electrical: false, mechanical: false, sourcing: false };
  for (const key of Object.keys(project.review)) if (typeof project.review[key] === 'boolean') project.review[key] = false;
  const summary = Object.keys(limits).filter(section => Object.values(raw[section]).some(rows => rows.length)).map(section => {
    const ops = raw[section];
    return `${section}: ${Object.entries(ops).filter(([,rows]) => rows.length).map(([action,rows]) => `${action} ${rows.length}`).join(', ')}`;
  }).join('; ');
  // The free-form model explanation is not evidence. Keep it in the raw patch
  // export, but derive saved provenance only from the operations we applied.
  const appendix = `LOCAL MODEL CHANGE / UNVERIFIED\nModel: ${model}\nCaptured request:\n${request}\nRequested record edits:\n${summary}\nThis change records no physical measurements or test results.`;
  project.notes = `${base.notes || ''}${base.notes ? '\n\n' : ''}${appendix}`;
  if (project.notes.length > 10000) invalid('notes', 'has no room to preserve existing notes and append this request');

  const changes = [];
  const addChange = (section, label, before, after) => { if (!equal(before, after)) changes.push({ section, label, before: before == null ? null : clone(before), after: after == null ? null : clone(after) }); };
  for (const section of Object.keys(shapes)) {
    const original = base[section] || [], next = project[section] || [];
    const lineage = origins[section];
    original.forEach((row, i) => {
      const nextIndex = lineage.indexOf(i);
      addChange(section, `${section} original #${i}${row.id ? ` (${row.id})` : ''}`, row, nextIndex < 0 ? null : next[nextIndex]);
    });
    lineage.forEach((origin, i) => { if (origin === null) addChange(section, `${section} added #${i}`, null, next[i]); });
  }
  for (const key of new Set([...Object.keys(base), ...Object.keys(project)])) if (!Object.hasOwn(shapes, key)) addChange(key, key, base[key], project[key]);
  return { project, changes, summary, warnings: ['Local model changes and any proposed endpoint names are unverified. Review specifications, wiring, fit and power before building.', 'Affected completion, review and current evidence have been cleared; inspect every before/after record.', 'Conservative power policy: wire additions, replacements and removals clear per-unit current evidence for loads at both old and new endpoints because operating conditions may change. Unchanged supply hardware keeps its rating; unrelated load branches keep their current evidence.'] };
}
