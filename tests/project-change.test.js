import test from 'node:test';
import assert from 'node:assert/strict';
import { CHANGE_SCHEMA, modelProjectContext, proposeProjectChange } from '../project-change.js';

const part = (id, name = id) => ({ id, name, category: 'Control', qty: 1, detail: `Exact ${id} module`, voltage: '5', unitCost: 9, sourceUrl: `https://example.test/${id}`, specUrl: `https://example.test/${id}/spec`, checkedAt: '2026-10-23', verified: true, pins: ['VCC', 'GND'], manualEvidence: { comment: `manual ${id}` } });
const wire = (from, to, signal) => ({ from, fromPin: 'VCC', to, toPin: 'VCC', signal, voltage: '5 V', note: '' });
function fixture() {
  return {
    id: 'project', title: 'Curated title', brief: 'Curated brief', summary: 'Curated summary', notes: 'Curated notes', createdAt: 'original', updatedAt: 'original',
    parts: [part('source'), part('a'), part('b'), { ...part('mount'), category: 'Mechanical', voltage: '' }],
    wires: [wire('source', 'a', 'A power'), wire('source', 'b', 'B power')],
    mechanicalConnections: [{ from: 'mount', to: 'a', label: 'Screw fit', note: 'Manual measured fit' }],
    powerRails: [{ id: 'rail', name: '5 V', voltageV: 5, supplyCurrentMa: 900, marginPercent: 25, sourcePartId: 'source', loads: [{ partId: 'a', currentMaEach: 90 }, { partId: 'b', currentMaEach: 120 }] }],
    steps: [{ id: 's-a', phase: 'Test', title: 'Test A', detail: 'Inspect A', partIds: ['a'], done: true }, { id: 's-b', phase: 'Test', title: 'Test B', detail: 'Inspect B', partIds: ['b'], done: true }, { id: 's-global', phase: 'Prepare', title: 'Prepare', detail: 'Prepare bench', partIds: [], done: true }],
    tools: ['Driver'], assumptions: ['Dry use'], review: { electrical: true, mechanical: true, sourcing: true },
    cadUrl: 'https://example.test/cad', wiringUrl: 'https://example.test/wiring', referenceImage: { dataUrl: 'binary-pixels', name: 'photo' },
    traySpec: { geometry: 'manual-tray' }, solidSpec: { geometry: 'manual-solid' }, source: { file: 'preserved.stl', bytes: [1, 2, 3] }
  };
}
function proposal() { return { summary: 'Proposed change only', ...Object.fromEntries(['parts', 'wires', 'mechanicalConnections', 'steps', 'powerRails'].map(section => [section, { add: [], replace: [], remove: [] }])), tools: { add: [], remove: [] }, assumptions: { add: [], remove: [] } }; }
const editablePart = value => Object.fromEntries(['id', 'name', 'category', 'qty', 'detail', 'voltage'].map(key => [key, value[key]]));
const editableStep = value => Object.fromEntries(['phase', 'title', 'detail', 'partIds'].map(key => [key, value[key]]));
const editableRail = value => ({ id: value.id, name: value.name, voltageV: value.voltageV, sourcePartId: value.sourcePartId, loads: value.loads.map(({ partId }) => ({ partId })) });
const apply = (base, raw) => proposeProjectChange(base, raw, 'Please make the requested adjustment.', 'local-model');

test('identity edits preserve all unrelated manual work and visibly invalidate affected evidence', () => {
  const base = fixture(), snapshot = structuredClone(base), raw = proposal();
  raw.parts.replace.push({ ...editablePart(base.parts[1]), name: 'Replacement A' });
  const { project, changes, warnings } = apply(base, raw);
  assert.deepEqual(base, snapshot);
  for (const key of ['title', 'brief', 'summary', 'createdAt', 'updatedAt', 'cadUrl', 'wiringUrl', 'referenceImage', 'traySpec', 'solidSpec', 'source']) assert.deepEqual(project[key], base[key]);
  for (const index of [0, 2, 3]) assert.deepEqual(project.parts[index], base.parts[index]);
  assert.deepEqual(project.parts[1], { ...base.parts[1], name: 'Replacement A', unitCost: 0, sourceUrl: '', specUrl: '', checkedAt: '', verified: false, pins: [] });
  assert.equal(project.wires[0].toPin, ''); assert.equal(project.wires[0].fromPin, 'VCC');
  assert.deepEqual(project.wires[1], base.wires[1]);
  assert.deepEqual(project.powerRails[0].loads, [{ partId: 'a', currentMaEach: null }, base.powerRails[0].loads[1]]);
  assert.equal(project.powerRails[0].supplyCurrentMa, 900);
  assert.deepEqual(project.steps.map(step => step.done), [false, true, false]);
  assert.deepEqual(project.review, { electrical: false, mechanical: false, sourcing: false });
  assert.ok(project.notes.startsWith(base.notes + '\n\nLOCAL MODEL CHANGE / UNVERIFIED'));
  assert.match(project.notes, /Captured request:\nPlease make/); assert.match(project.notes, /Requested record edits:\nparts: replace 1/);
  assert.ok(!project.notes.includes(raw.summary));
  assert.ok(warnings.length);
  assert.deepEqual(changes.map(change => change.section), ['parts', 'wires', 'steps', 'steps', 'powerRails', 'notes', 'review']);
  for (const section of ['parts', 'wires', 'steps', 'powerRails']) {
    const before = base[section], after = project[section];
    before.forEach((row, i) => {
      if (JSON.stringify(row) !== JSON.stringify(after[i])) assert.ok(changes.some(change => change.section === section && JSON.stringify(change.before) === JSON.stringify(row) && JSON.stringify(change.after) === JSON.stringify(after[i])));
    });
  }
});

test('quantity changes retain per-unit specification evidence but clear affected current and reviews', () => {
  const base = fixture(), raw = proposal(); raw.parts.replace.push({ ...editablePart(base.parts[1]), qty: 2 });
  const { project } = apply(base, raw);
  assert.deepEqual(project.parts[1], { ...base.parts[1], qty: 2 });
  assert.deepEqual(project.wires, base.wires);
  assert.equal(project.powerRails[0].loads[0].currentMaEach, null);
  assert.equal(project.powerRails[0].loads[1].currentMaEach, 120);
  assert.equal(project.powerRails[0].supplyCurrentMa, 900);
  assert.equal(project.steps[1].done, true);
  raw.parts.replace = [{ ...editablePart(base.parts[0]), qty: 2 }];
  const sourceChange = apply(base, raw).project;
  assert.equal(sourceChange.powerRails[0].supplyCurrentMa, null);
  assert.deepEqual(sourceChange.powerRails[0].loads, base.powerRails[0].loads);
});

test('wire replacement and addition can propose endpoint names after identity changes', () => {
  const base = fixture(), raw = proposal();
  raw.parts.replace.push({ ...editablePart(base.parts[1]), detail: 'A new exact module' });
  raw.wires.remove.push(1);
  raw.wires.replace.push({ index: 0, value: { ...base.wires[0], toPin: 'NEW' } });
  raw.wires.add.push({ ...base.wires[0], signal: 'Additional proposed link', toPin: 'NEW-2' });
  const { project } = apply(base, raw);
  assert.equal(project.wires[0].toPin, 'NEW'); assert.equal(project.wires[1].toPin, 'NEW-2');
});

test('completion invalidation follows direct fit and supply dependencies without crossing unrelated branches', () => {
  const base = fixture(), raw = proposal();
  base.steps.push({ id: 's-mount', phase: 'Test', title: 'Test bracket fit', detail: 'Inspect fit', partIds: ['mount'], done: true });
  base.steps.push({ id: 's-source', phase: 'Test', title: 'Test supply', detail: 'Inspect supply', partIds: ['source'], done: true });
  raw.parts.replace.push({ ...editablePart(base.parts[1]), detail: 'Changed size' });
  const { project } = apply(base, raw);
  assert.equal(project.steps.find(step => step.id === 's-mount').done, false);
  assert.equal(project.steps.find(step => step.id === 's-source').done, false);
  assert.equal(project.steps.find(step => step.id === 's-b').done, true);
  assert.equal(project.powerRails[0].loads[1].currentMaEach, 120);
  raw.parts.replace = [{ ...editablePart(base.parts[0]), detail: 'Different supply' }];
  const supplyChange = apply(base, raw).project;
  assert.equal(supplyChange.steps.find(step => step.id === 's-b').done, false);
  assert.equal(supplyChange.powerRails[0].loads[1].currentMaEach, 120);
});

test('rail replacements retain independent metadata and margin but never carry numeric evidence', () => {
  const base = fixture(), raw = proposal(); base.powerRails[0].manualNote = 'Keep source document';
  raw.powerRails.replace.push({ ...editableRail(base.powerRails[0]), voltageV: 3.3 });
  raw.powerRails.add.push({ id: 'rail-b', name: 'Second proposed rail', voltageV: 5, sourcePartId: 'source', loads: [{ partId: 'b' }] });
  const { project } = apply(base, raw);
  assert.equal(project.powerRails[0].marginPercent, 25); assert.equal(project.powerRails[0].manualNote, 'Keep source document');
  for (const rail of project.powerRails) { assert.equal(rail.supplyCurrentMa, null); rail.loads.forEach(load => assert.equal(load.currentMaEach, null)); }
});

test('indexes address original lists and replacement steps retain IDs with completion cleared', () => {
  const base = fixture(), raw = proposal();
  raw.steps.remove.push(0); raw.steps.replace.push({ index: 1, value: { ...editableStep(base.steps[1]), title: 'Retest B' } });
  raw.steps.add.push({ phase: 'Test', title: 'Test new fit', detail: 'Measure', partIds: ['mount'] });
  const { project, changes } = apply(base, raw);
  assert.equal(project.steps[0].id, 's-b'); assert.equal(project.steps[0].title, 'Retest B'); assert.equal(project.steps[0].done, false);
  assert.equal(project.steps[1].id, 's-global'); assert.equal(project.steps[2].done, false);
  assert.ok(project.steps[2].id); assert.equal(new Set(project.steps.map(step => step.id)).size, 3);
  assert.ok(changes.some(change => change.section === 'steps' && change.before?.id === 's-a' && change.after === null));
  assert.ok(changes.some(change => change.section === 'steps' && change.before === null && change.after?.title === 'Test new fit'));
});

test('adding parts supplies no prices, verification or current evidence', () => {
  const raw = proposal(); raw.parts.add.push({ id: 'new', name: 'New part', category: 'Sensor', qty: 1, detail: 'Proposal', voltage: '3.3' });
  const { project } = apply(fixture(), raw); const added = project.parts.at(-1);
  assert.equal(added.unitCost, 0); assert.equal(added.verified, false); assert.deepEqual(added.pins, []); assert.equal(added.specUrl, '');
});

test('tools and assumptions reset every completion and preserve curated notes', () => {
  const base = fixture(), raw = proposal(); raw.tools.add.push('Calipers'); raw.assumptions.remove.push('Dry use');
  const { project } = apply(base, raw);
  assert.ok(project.steps.every(step => !step.done)); assert.deepEqual(project.parts, base.parts);
  assert.deepEqual(project.tools, ['Driver', 'Calipers']); assert.deepEqual(project.assumptions, []);
  assert.ok(project.notes.startsWith(base.notes));
});

test('removal requires explicit repair of every remaining reference', () => {
  const base = fixture(), raw = proposal(); raw.parts.remove.push('a');
  assert.throws(() => apply(base, raw), /missing part a/);
  raw.wires.remove.push(0); raw.mechanicalConnections.remove.push(0); raw.steps.remove.push(0);
  raw.powerRails.replace.push({ ...editableRail(base.powerRails[0]), loads: [{ partId: 'b' }] });
  const { project } = apply(base, raw);
  assert.equal(project.parts.some(part => part.id === 'a'), false);
  assert.equal(project.wires.length, 1); assert.equal(project.wires[0].to, 'b');
});

test('strict schema rejects unsupported authority at every level', () => {
  const base = fixture();
  for (const forbidden of ['notes', 'title', 'cadUrl', 'referenceImage', 'review', 'sourceUrl']) {
    const raw = proposal(); raw[forbidden] = 'injected'; assert.throws(() => apply(base, raw), /unknown field/);
  }
  for (const forbidden of ['unitCost', 'pins', 'sourceUrl', 'specUrl', 'checkedAt', 'verified']) {
    const raw = proposal(); raw.parts.replace.push({ ...editablePart(base.parts[1]), name: 'Changed', [forbidden]: 123 }); assert.throws(() => apply(base, raw), /unknown field/);
  }
  for (const forbidden of ['supplyCurrentMa', 'marginPercent']) {
    const raw = proposal(); raw.powerRails.replace.push({ ...editableRail(base.powerRails[0]), name: 'Changed', [forbidden]: 123 }); assert.throws(() => apply(base, raw), /unknown field/);
  }
  const raw = proposal(); raw.steps.replace.push({ index: 0, value: { ...editableStep(base.steps[0]), done: true } }); assert.throws(() => apply(base, raw), /unknown field/);
  const load = proposal(); load.powerRails.add.push({ ...editableRail(base.powerRails[0]), id: 'new-rail', loads: [{ partId: 'b', currentMaEach: 7 }] }); assert.throws(() => apply(base, load), /unknown field/);
});

test('rejects no-ops, duplicate/conflicting targets, ID reuse and broken references', () => {
  const base = fixture();
  assert.throws(() => apply(base, proposal()), /1 to 32/);
  for (const section of ['parts', 'powerRails']) {
    const raw = proposal(), value = section === 'parts' ? editablePart(base.parts[1]) : editableRail(base.powerRails[0]);
    raw[section].replace.push(value); assert.throws(() => apply(base, raw), /no editable change/);
    raw[section].replace = []; raw[section].add.push(value); assert.throws(() => apply(base, raw), /reuse/);
    raw[section].remove.push(value.id); assert.throws(() => apply(base, raw), /reuse/);
  }
  const conflict = proposal(); conflict.wires.remove.push(0); conflict.wires.replace.push({ index: 0, value: { ...base.wires[0], signal: 'changed' } }); assert.throws(() => apply(base, conflict), /conflicting/);
  const duplicate = proposal(); duplicate.steps.remove.push(0, 0); assert.throws(() => apply(base, duplicate), /conflicting/);
  const badIndex = proposal(); badIndex.wires.remove.push(50); assert.throws(() => apply(base, badIndex), /missing original target/);
  const badId = proposal(); badId.parts.replace.push({ ...editablePart(base.parts[1]), id: 'changed-id' }); assert.throws(() => apply(base, badId), /missing original target/);
  const dangling = proposal(); dangling.wires.add.push({ ...base.wires[0], from: 'missing' }); assert.throws(() => apply(base, dangling), /missing part/);
  const selfLoad = proposal(); selfLoad.powerRails.add.push({ id: 'new', name: 'Bad', voltageV: 5, sourcePartId: 'source', loads: [{ partId: 'source' }] }); assert.throws(() => apply(base, selfLoad), /source load/);
  const duplicateLoad = proposal(); duplicateLoad.powerRails.add.push({ id: 'new', name: 'Bad', voltageV: 5, sourcePartId: 'source', loads: [{ partId: 'a' }, { partId: 'a' }] }); assert.throws(() => apply(base, duplicateLoad), /duplicate/);
});

test('bounded JSON, types, operation counts and notes overflow fail without mutation', () => {
  const base = fixture(), before = structuredClone(base);
  assert.throws(() => apply(base, '{'), /valid JSON/);
  assert.throws(() => apply(base, ' '.repeat(131073)), /size limit/);
  for (const qty of [NaN, Infinity, 0, -1, 1.5, '2']) { const raw = proposal(); raw.parts.replace.push({ ...editablePart(base.parts[1]), qty }); assert.throws(() => apply(base, raw), /invalid number/); }
  const tooMany = proposal(); tooMany.tools.add = Array.from({ length: 32 }, (_, i) => `tool ${i}`); tooMany.assumptions.add.push('another'); assert.throws(() => apply(base, tooMany), /1 to 32/);
  const sparse = proposal(); sparse.parts.add = Array(1); assert.throws(() => apply(base, sparse), /plain object/);
  const long = proposal(); long.tools.add.push('x'.repeat(161)); assert.throws(() => apply(base, long), /invalid text/);
  const notes = fixture(); notes.notes = 'x'.repeat(9999); const valid = proposal(); valid.tools.add.push('Calipers'); assert.throws(() => apply(notes, valid), /no room/); assert.equal(notes.notes.length, 9999);
  assert.deepEqual(base, before);
});

test('context carries original indexes and safe design fields with no source evidence or CAD binary', () => {
  const base = fixture(), context = modelProjectContext(base), encoded = JSON.stringify(context);
  assert.equal(context.parts[1].id, 'a'); assert.equal(context.wires[1].index, 1); assert.equal(context.steps[1].index, 1);
  assert.deepEqual(context.powerRails[0].loads, [{ partId: 'a' }, { partId: 'b' }]);
  for (const forbidden of ['binary-pixels', 'manual-solid', 'preserved.stl', 'example.test', 'checkedAt', 'verified', 'currentMaEach', 'supplyCurrentMa', 'unitCost', 'done']) assert.ok(!encoded.includes(forbidden), forbidden);
  context.parts[1].name = 'Mutated'; assert.equal(base.parts[1].name, 'a');
  const raw = proposal(); raw.tools.add.push('Calipers'); assert.deepEqual(apply(base, JSON.stringify(raw)).project.tools, ['Driver', 'Calipers']);
  assert.equal(CHANGE_SCHEMA.additionalProperties, false);
});

test('retained incomplete manual rails allow an empty source but reject dangling nonempty sources', () => {
  const base = fixture(), raw = proposal(); base.powerRails[0].sourcePartId = ''; raw.tools.add.push('Calipers');
  const { project } = apply(base, raw);
  assert.deepEqual(project.powerRails, base.powerRails);
  base.powerRails[0].sourcePartId = 'missing source';
  assert.throws(() => apply(base, raw), /missing part missing source/);
  base.powerRails[0].sourcePartId = '';
  const proposed = proposal(); proposed.powerRails.add.push({ ...editableRail(base.powerRails[0]), id: 'new rail' });
  assert.throws(() => apply(base, proposed), /sourcePartId.*invalid text/);
  const replacement = proposal(); replacement.powerRails.replace.push({ ...editableRail(base.powerRails[0]), name: 'Changed' });
  assert.throws(() => apply(base, replacement), /sourcePartId.*invalid text/);
});

test('human-readable imported IDs work in replacements, removals and all reference fields', () => {
  const base = fixture(), importedId = 'sensor board 1';
  base.parts[1].id = importedId; base.wires[0].to = importedId; base.mechanicalConnections[0].to = importedId;
  base.powerRails[0].loads[0].partId = importedId; base.powerRails[0].id = 'power rail 1'; base.steps[0].partIds = [importedId];
  const raw = proposal(); raw.parts.replace.push({ ...editablePart(base.parts[1]), qty: 2 });
  raw.wires.add.push({ ...base.wires[0], signal: 'Extra proposed connection' });
  raw.mechanicalConnections.replace.push({ index: 0, value: { ...base.mechanicalConnections[0], label: 'Revised fit' } });
  raw.steps.replace.push({ index: 0, value: { ...editableStep(base.steps[0]), title: 'Retest imported module' } });
  raw.powerRails.replace.push({ ...editableRail(base.powerRails[0]), name: 'Renamed rail' });
  const { project } = apply(base, raw);
  assert.equal(project.parts[1].id, importedId); assert.equal(project.parts[1].qty, 2); assert.equal(project.powerRails[0].id, 'power rail 1');
  assert.equal(modelProjectContext(base).parts[1].id, importedId);
  const removal = proposal(); removal.parts.remove.push(importedId); removal.wires.remove.push(0); removal.mechanicalConnections.remove.push(0);
  removal.steps.remove.push(0); removal.powerRails.remove.push('power rail 1');
  assert.ok(!apply(base, removal).project.parts.some(part => part.id === importedId));
});

test('model-authored wire pins must match retained inventories after identity invalidation', () => {
  const base = fixture(), before = structuredClone(base);
  for (const operation of ['add', 'replace']) {
    const raw = proposal(), value = { ...base.wires[0], toPin: 'NOT-A-PIN', signal: 'Proposed signal' };
    raw.wires[operation].push(operation === 'add' ? value : { index: 0, value });
    assert.throws(() => apply(base, raw), /absent from the recorded pin inventory/);
    raw.parts.replace.push({ ...editablePart(base.parts[1]), qty: 2 });
    assert.throws(() => apply(base, raw), /absent from the recorded pin inventory/);
    raw.parts.replace = [{ ...editablePart(base.parts[1]), name: 'Replacement module' }];
    const { project } = apply(base, raw);
    assert.deepEqual(project.parts[1].pins, []);
    assert.equal(operation === 'add' ? project.wires.at(-1).toPin : project.wires[0].toPin, 'NOT-A-PIN');
  }
  const missingInventory = fixture(); missingInventory.parts[1].pins = [];
  const raw = proposal(); raw.wires.add.push({ ...missingInventory.wires[0], toPin: 'PROPOSED', signal: 'New signal' });
  assert.equal(apply(missingInventory, raw).project.wires.at(-1).toPin, 'PROPOSED');
  assert.deepEqual(base, before);
});

test('unmodified manual wire pin conflicts remain untouched during unrelated changes', () => {
  const base = fixture(); base.wires[0].toPin = 'MANUAL-CONFLICT';
  const raw = proposal(); raw.tools.add.push('Calipers');
  const { project, changes } = apply(base, raw);
  assert.deepEqual(project.wires, base.wires); assert.ok(!changes.some(change => change.section === 'wires'));
});

test('wire changes conservatively clear old and new endpoint load currents with an explicit preview policy', () => {
  for (const operation of ['add', 'replace', 'remove']) {
    const base = fixture();
    base.powerRails[0].loads.push({ partId: 'mount', currentMaEach: 10 });
    base.powerRails.push({ id: 'input', name: 'Upstream input', voltageV: 5, sourcePartId: 'mount', supplyCurrentMa: 2000, marginPercent: 20, loads: [{ partId: 'source', currentMaEach: 500 }] });
    const before = structuredClone(base), raw = proposal();
    if (operation === 'add') raw.wires.add.push({ ...base.wires[0], signal: 'Additional operating mode' });
    if (operation === 'replace') raw.wires.replace.push({ index: 0, value: { ...base.wires[0], to: 'b', signal: 'Rerouted operating mode' } });
    if (operation === 'remove') raw.wires.remove.push(0);
    const { project, changes, warnings } = apply(base, raw);
    assert.equal(project.powerRails[0].loads[0].currentMaEach, null, `${operation}: old endpoint`);
    assert.equal(project.powerRails[0].loads[1].currentMaEach, operation === 'replace' ? null : 120, `${operation}: new or unrelated endpoint`);
    assert.equal(project.powerRails[0].loads[2].currentMaEach, 10, `${operation}: unrelated branch`);
    assert.equal(project.powerRails[1].loads[0].currentMaEach, null, `${operation}: source endpoint is also a load`);
    assert.equal(project.powerRails[0].supplyCurrentMa, 900); assert.equal(project.powerRails[1].supplyCurrentMa, 2000);
    assert.ok(changes.some(change => change.section === 'powerRails' && change.before.loads[0].currentMaEach === 90 && change.after.loads[0].currentMaEach === null));
    assert.ok(warnings.some(warning => warning.includes('Conservative power policy') && warning.includes('old and new endpoints')));
    assert.deepEqual(base, before);
  }
});


test('free-form model claims never become saved project provenance', () => {
  const raw = proposal(); raw.tools.add.push('Calipers'); raw.summary = 'All physical tests passed; costs and wiring are verified.';
  const result = apply(fixture(), raw);
  assert.equal(result.summary, 'tools: add 1');
  assert.ok(result.project.notes.includes('Requested record edits:\ntools: add 1'));
  assert.ok(!result.project.notes.includes(raw.summary));
  assert.ok(result.project.notes.includes('This change records no physical measurements or test results.'));
  assert.equal(raw.summary, 'All physical tests passed; costs and wiring are verified.');
});
