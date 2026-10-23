import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STARTERS, makeProject, stats, validate, bomCsv, mountingCsv, wiringCsv, safeProject, safeReferenceImage, localAiDraft, powerBudget, partReviewRecorded, projectContentChanged, parseSavedWorkspace, restoreProjectFromRevision, setProjectTraySpec } from '../core.js';

const trayFixture = JSON.parse(readFileSync(new URL('../tools/tray-generator/examples/pico-neopixel-tray.json', import.meta.url)));

test('starter totals use quantity and keep cost as an estimate', () => {
  const p = makeProject(STARTERS[0]);
  const expected = p.parts.reduce((sum, part) => sum + part.qty * part.unitCost, 0);
  assert.equal(stats(p).estimate, expected);
  assert.ok(validate(p).some(issue => issue.text.includes('planning estimates')));
});

test('a removed part leaves a detectable broken connection', () => {
  const p = makeProject(STARTERS[0]);
  p.parts = p.parts.filter(part => part.id !== 'esp32');
  assert.ok(validate(p).some(issue => issue.kind === 'error' && issue.text.includes('missing part')));
});

test('lighting review catches a control-only LED connection', () => {
  const p = makeProject(STARTERS[1]);
  assert.equal(validate(p).some(issue => issue.text.includes('explicit supply and ground/return')), false);
  p.wires = p.wires.filter(wire => !(wire.from === 'usb' && wire.to === 'led'));
  assert.equal(validate(p).some(issue => issue.kind === 'todo' && issue.text.includes('a control or data connection alone')), true);
  p.wires.push({ from: 'shift', to: 'led', signal: '5 V data', voltage: '5 V', note: 'A data signal is not the LED supply.' });
  p.wires.push({ from: 'usb', to: 'led', signal: 'GND return', voltage: '0 V', note: '' });
  assert.equal(validate(p).some(issue => issue.text.includes('explicit supply and ground/return')), true);
});

test('CSV export quotes names and notes safely', () => {
  const p = makeProject(STARTERS[0]);
  p.parts[0].name = 'Sensor, "special"';
  const csv = bomCsv(p);
  assert.match(csv, /"Sensor, ""special"""/);
  assert.match(csv, /"Unit estimate USD"/);
});

test('connection register exposes unresolved endpoints and keeps spreadsheet formulas inert', () => {
  const p = makeProject(STARTERS[0]);
  p.parts[0].name = '=HYPERLINK("https://example.invalid", "trap")';
  p.parts[0].pins = ['GPIO21'];
  p.parts[1].pins = ['SDA'];
  p.wires = [
    { from: p.parts[0].id, fromPin: 'GPIO21', to: p.parts[1].id, toPin: 'SDA', signal: 'I²C data', voltage: '3.3 V', note: 'Recorded names only' },
    { from: p.parts[0].id, fromPin: '', to: p.parts[1].id, toPin: 'SDA', signal: 'Shared rail', voltage: '3.3 V', note: '' }
  ];
  const csv = wiringCsv(p);
  assert.match(csv, /"RECORDED NAMES ONLY"/);
  assert.match(csv, /"PIN ENDPOINT MISSING"/);
  assert.match(csv, /"'=HYPERLINK\(""https:\/\/example.invalid"", ""trap""\)"/);
  assert.match(bomCsv(p), /"'=HYPERLINK/);
  p.parts[0].pins = ['+'];
  p.wires[0].fromPin = '+';
  assert.match(wiringCsv(p), /"\+"/);
  assert.doesNotMatch(wiringCsv(p), /"'\+"/);
  p.wires[0].note = '+SUM(1,1)';
  assert.match(wiringCsv(p), /"'\+SUM\(1,1\)"/);
});

test('JSON import rejects malformed shape and removes untrusted source schemes', () => {
  assert.throws(() => safeProject({ parts: [], wires: [] }), /not a Hardware Studio project/);
  const p = makeProject(STARTERS[0]);
  p.parts[0].sourceUrl = 'javascript:alert(1)';
  p.cadUrl = 'javascript:alert(1)';
  p.wiringUrl = 'javascript:alert(1)';
  p.parts[0].specUrl = 'https://example.com/spec';
  p.parts[0].checkedAt = new Date().toISOString();
  p.parts[0].verified = true;
  p.review = { electrical: true, mechanical: true, sourcing: true };
  const imported = safeProject(p);
  assert.equal(imported.parts[0].sourceUrl, '');
  assert.equal(imported.cadUrl, '');
  assert.equal(imported.wiringUrl, '');
  assert.equal(imported.starterId, 'imported');
  assert.equal(imported.parts[0].specUrl, 'https://example.com/spec');
  assert.equal(imported.parts[0].verified, false);
  assert.equal(imported.parts[0].checkedAt, '');
  assert.deepEqual(imported.review, { electrical: false, mechanical: false, sourcing: false });
});

test('tray geometry survives project JSON import and revision restore while new geometry resets mechanical review', () => {
  const project = makeProject(STARTERS[0]);
  project.review.mechanical = true;
  assert.equal(setProjectTraySpec(project, trayFixture), true);
  assert.equal(project.review.mechanical, false);
  assert.deepEqual(project.traySpec.outer, { length: 66, width: 45, height: 14 });
  const imported = safeProject(JSON.parse(JSON.stringify(project)));
  assert.equal(imported.traySpec.mounts.length, 6);
  const restored = restoreProjectFromRevision(project, project);
  assert.equal(restored.traySpec.cutouts.length, 1);
  const broken = JSON.parse(JSON.stringify(project));
  broken.traySpec.wall = 50;
  assert.throws(() => safeProject(broken), /Wall/);
  assert.throws(() => parseSavedWorkspace(JSON.stringify({ projects: [broken], currentId: broken.id })), /Wall/);
});

test('build preparation and part-linked steps survive import and catch broken references', () => {
  const project = makeProject(STARTERS[0]);
  project.tools = ['Multimeter', 'Wire stripper'];
  project.assumptions = ['USB supply ratings need review'];
  project.steps[0].partIds = ['esp32', 'bme280'];
  const imported = safeProject(project);
  assert.deepEqual(imported.tools, project.tools);
  assert.deepEqual(imported.assumptions, project.assumptions);
  assert.deepEqual(imported.steps[0].partIds, ['esp32', 'bme280']);
  const saved = parseSavedWorkspace(JSON.stringify({ projects: [imported], currentId: imported.id }));
  assert.deepEqual(saved.projects[0].steps[0].partIds, ['esp32', 'bme280']);
  imported.parts = imported.parts.filter(part => part.id !== 'bme280');
  assert.ok(validate(imported).some(issue => issue.kind === 'error' && issue.text.includes('step') && issue.text.includes('missing part')));
  const invalid = structuredClone(project);
  invalid.steps[0].partIds = ['esp32', 'esp32'];
  assert.throws(() => safeProject(invalid), /unique part IDs/);
  invalid.steps[0].partIds = ['esp32'];
  invalid.tools = [''];
  assert.throws(() => safeProject(invalid), /Tools/);
  const older = structuredClone(project);
  delete older.tools; delete older.assumptions; delete older.steps[0].partIds;
  assert.deepEqual(safeProject(older).steps[0].partIds, []);
});

test('local model output cannot mark estimates or reviews as verified', () => {
  const raw = makeProject(STARTERS[0]);
  raw.summary = 'Manufacturer fit validated in CAD';
  raw.notes = 'Exact fit and pinouts confirmed by the model';
  raw.parts[0].unitCost = 999;
  raw.parts[0].sourceUrl = 'https://example.com/unchecked';
  raw.parts[0].verified = true;
  raw.parts[0].pins = ['MODEL_GUESS'];
  raw.steps[0].done = true;
  raw.cadUrl = 'https://example.com/unverified-cad';
  raw.wiringUrl = 'https://example.com/unverified-wiring';
  raw.traySpec = trayFixture;
  raw.review = { electrical: true, mechanical: true, sourcing: true };
  const draft = localAiDraft(raw, 'USB plant monitor', 'qwen3:4b');
  assert.equal(draft.starterId, 'ai');
  assert.equal(draft.parts[0].unitCost, 0);
  assert.equal(draft.parts[0].sourceUrl, '');
  assert.equal(draft.parts[0].verified, false);
  assert.deepEqual(draft.parts[0].pins, []);
  assert.equal(draft.steps[0].done, false);
  assert.equal(draft.cadUrl, '');
  assert.equal(draft.wiringUrl, '');
  assert.equal(draft.traySpec, null);
  assert.equal(draft.review.electrical, false);
  assert.match(draft.summary, /unverified/);
  assert.doesNotMatch(draft.summary, /validated in CAD/);
  assert.match(draft.notes, /MODEL NOTES \/ UNVERIFIED/);
});

test('local model output with broken references is rejected', () => {
  const raw = makeProject(STARTERS[0]);
  raw.wires[0].to = 'missing';
  assert.throws(() => localAiDraft(raw, 'USB plant monitor', 'qwen3:4b'), /broken part references/);
});

test('local model output missing the requested temperature sensor is rejected', () => {
  const raw = makeProject(STARTERS[0]);
  raw.parts = raw.parts.filter(part => part.id !== 'bme280');
  raw.wires = raw.wires.filter(wire => wire.from !== 'bme280' && wire.to !== 'bme280');
  assert.throws(() => localAiDraft(raw, 'A temperature display', 'qwen3:4b'), /requested temperature sensor/);
});

test('local model cannot present a Pico and 5 V NeoPixel draft without LED power and level shifting', () => {
  const raw = makeProject(STARTERS[1]);
  raw.parts = [
    { id: 'pico', name: 'Raspberry Pi Pico', category: 'Control', qty: 1, unitCost: 0 },
    { id: 'pixels', name: 'NeoPixel stick', category: 'Light', qty: 1, unitCost: 0 },
    { id: 'usb', name: 'USB cable', category: 'Other', qty: 1, unitCost: 0 }
  ];
  raw.wires = [{ id: 'data', from: 'pico', to: 'pixels', label: 'data' }];
  raw.steps = [{ id: 'a', text: 'Mount controller' }, { id: 'b', text: 'Wire pixels' }, { id: 'c', text: 'Test' }];
  raw.powerRails = [];
  const brief = 'Build a Raspberry Pi Pico and 5 V NeoPixel tray';
  assert.throws(() => localAiDraft(raw, brief, 'local-fast:latest'), /rated LED power source and a logic-level interface/);
  assert.throws(() => localAiDraft(raw, 'Build a Raspberry Pi Pico and NeoPixel tray', 'local-fast:latest'), /rated LED power source/);
  raw.parts.push({ id: 'supply', name: 'Rated 5 V power supply', category: 'Power', qty: 1, unitCost: 0 });
  assert.throws(() => localAiDraft(raw, brief, 'local-fast:latest'), /logic-level interface/);
  raw.parts.push({ id: 'shift', name: '74AHCT125 logic buffer', category: 'Interface', qty: 1, unitCost: 0 });
  assert.equal(localAiDraft(raw, brief, 'local-fast:latest').parts.length, 5);
  raw.parts = raw.parts.filter(part => part.id !== 'pixels');
  raw.wires = [{ id: 'data', from: 'pico', to: 'shift', label: 'data' }];
  assert.throws(() => localAiDraft(raw, brief, 'local-fast:latest'), /requested addressable LED/);
});

test('unpriced AI parts export as blank costs', () => {
  const draft = localAiDraft(makeProject(STARTERS[0]), 'A plant monitor', 'qwen3:4b');
  assert.match(bomCsv(draft), /"ESP32 DevKit board","Control","1","",""/);
});

test('unknown zero costs stay blank for imported custom projects', () => {
  const p = safeProject(makeProject(STARTERS[0]));
  p.parts[0].unitCost = 0;
  assert.match(bomCsv(p), /"ESP32 DevKit board","Control","1","",""/);
});

test('power budget multiplies part quantities and distinguishes incomplete, low margin and overload', () => {
  const p = makeProject(STARTERS[1]);
  const rail = p.powerRails[0];
  assert.equal(powerBudget(p, rail).status, 'incomplete');
  p.parts.find(part => part.id === 'led').qty = 2;
  rail.loads[0].currentMaEach = 1100;
  rail.loads[1].currentMaEach = 200;
  assert.equal(powerBudget(p, rail).knownDemandMa, 2400);
  assert.equal(powerBudget(p, rail).status, 'within-margin');
  rail.loads[0].currentMaEach = 1200;
  assert.equal(powerBudget(p, rail).status, 'below-margin');
  rail.loads[0].currentMaEach = 1500;
  assert.equal(powerBudget(p, rail).status, 'overload');
  assert.ok(validate(p).some(issue => issue.kind === 'error' && issue.text.includes('exceeds its recorded supply')));
});

test('power rail import preserves the worksheet but resets review marks', () => {
  const p = makeProject(STARTERS[1]);
  p.powerRails[0].loads[0].currentMaEach = 1000;
  p.review.electrical = true;
  const imported = safeProject(p);
  assert.equal(imported.powerRails[0].loads[0].currentMaEach, 1000);
  assert.equal(imported.review.electrical, false);
  imported.powerRails[0].loads[0].partId = 'missing';
  assert.ok(validate(imported).some(issue => issue.kind === 'error' && issue.text.includes('missing part')));
});

test('invalid power rail shape is rejected during import', () => {
  const p = makeProject(STARTERS[0]);
  p.powerRails = [{ name: 'bad', loads: null }];
  assert.throws(() => safeProject(p), /invalid load list/);
});

test('a checked part needs a specification link and a check date', () => {
  const p = makeProject(STARTERS[0]);
  const item = p.parts[0];
  item.verified = true;
  assert.equal(partReviewRecorded(item), false);
  assert.ok(validate(p).some(issue => issue.kind === 'error' && issue.text.includes('check date')));
  item.specUrl = 'https://example.com/datasheet';
  item.checkedAt = '2026-10-22T18:00:00.000Z';
  assert.equal(partReviewRecorded(item), true);
  assert.match(bomCsv(p), /"https:\/\/example.com\/datasheet","2026-10-22T18:00:00.000Z","yes"/);
});

test('revision comparison ignores save timestamps and restoration resets claims', () => {
  const current = makeProject(STARTERS[0]);
  const previous = structuredClone(current);
  previous.updatedAt = '2026-01-01T00:00:00.000Z';
  assert.equal(projectContentChanged(previous, current), false);
  previous.parts[0].name = 'Earlier controller';
  previous.parts[0].verified = true;
  previous.parts[0].checkedAt = '2026-01-01T00:00:00.000Z';
  previous.review.electrical = true;
  previous.steps[0].done = true;
  previous.wiringUrl = 'javascript:alert(1)';
  assert.equal(projectContentChanged(previous, current), true);
  const restored = restoreProjectFromRevision(current, previous);
  assert.equal(restored.id, current.id);
  assert.equal(restored.parts[0].name, 'Earlier controller');
  assert.equal(restored.parts[0].verified, false);
  assert.equal(restored.review.electrical, false);
  assert.equal(restored.steps[0].done, false);
  assert.equal(restored.wiringUrl, '');
});

test('unreadable workspace bytes are rejected before startup can save over them', () => {
  assert.throws(() => parseSavedWorkspace('{not-json'), SyntaxError);
  assert.throws(() => parseSavedWorkspace('{"projects":[]}'), /Invalid saved workspace/);
  const project = makeProject(STARTERS[0]);
  assert.equal(parseSavedWorkspace(JSON.stringify({ projects: [project], currentId: project.id })).currentId, project.id);
});

test('local visual reference survives import while unsafe image payloads are rejected', () => {
  const p = makeProject(STARTERS[0]);
  p.referenceImage = { name: 'bench sketch.png', dataUrl: 'data:image/jpeg;base64,/9j/2Q==' };
  const imported = safeProject(p);
  assert.deepEqual(imported.referenceImage, p.referenceImage);
  assert.deepEqual(safeReferenceImage(imported.referenceImage), p.referenceImage);
  p.referenceImage.dataUrl = 'data:image/svg+xml;base64,PHN2Zz4=';
  assert.throws(() => safeProject(p), /small JPEG/);
  assert.throws(() => parseSavedWorkspace(JSON.stringify({ projects: [p], currentId: p.id })), /small JPEG/);
});

test('pin-level connection fields survive import and missing endpoints remain open checks', () => {
  const p = makeProject(STARTERS[0]);
  assert.ok(validate(p).some(issue => issue.text.includes('exact pin or terminal')));
  p.wires[0].fromPin = 'GPIO21 / SDA';
  p.wires[0].toPin = 'SDA';
  const imported = safeProject(p);
  assert.equal(imported.wires[0].fromPin, 'GPIO21 / SDA');
  assert.equal(imported.wires[0].toPin, 'SDA');
  assert.ok(validate(imported).some(issue => issue.text.includes('4 connections need')));
});

test('recorded pin inventories cross-check exact wire endpoints', () => {
  const project = makeProject(STARTERS[0]);
  const controller = project.parts.find(part => part.id === 'esp32');
  const sensor = project.parts.find(part => part.id === 'bme280');
  controller.pins = ['GPIO21', 'GND'];
  sensor.pins = ['SDA', 'GND'];
  project.wires[0].fromPin = 'GPIO21';
  project.wires[0].toPin = 'SDA';
  assert.ok(!validate(project).some(issue => issue.kind === 'error' && issue.text.includes('pin inventory')));
  assert.deepEqual(safeProject(project).parts.find(part => part.id === 'esp32').pins, ['GPIO21', 'GND']);
  project.wires[0].fromPin = 'GPIO22';
  assert.ok(validate(project).some(issue => issue.kind === 'error' && issue.text.includes('GPIO22')));
  const invalid = structuredClone(project);
  invalid.parts[0].pins = ['GND', 'GND'];
  assert.throws(() => safeProject(invalid), /unique/);
  assert.throws(() => parseSavedWorkspace(JSON.stringify({ projects: [invalid], currentId: invalid.id })), /unique/);
});

test('mounting relationships retain linked parts and reject broken references', () => {
  const p = makeProject(STARTERS[0]);
  assert.ok(validate(p).some(issue => issue.text.includes('Record how mechanical parts mount')));
  p.mechanicalConnections.push({ from: 'case', to: 'esp32', label: 'Standoffs to board mounting holes', note: 'Measure the chosen board and case first.' });
  const imported = safeProject(p);
  assert.equal(imported.mechanicalConnections[0].label, 'Standoffs to board mounting holes');
  assert.match(mountingCsv(imported), /"case","Ventilated enclosure","esp32","ESP32 DevKit board"/);
  assert.ok(!validate(imported).some(issue => issue.text.includes('Record how mechanical parts mount')));
  imported.mechanicalConnections[0].to = 'missing';
  assert.ok(validate(imported).some(issue => issue.kind === 'error' && issue.text.includes('relationship refers to a missing part')));
});
