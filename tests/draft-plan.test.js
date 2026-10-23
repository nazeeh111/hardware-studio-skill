import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MODEL_PLAN_SCHEMA, coordinatedAiDraft } from '../draft-plan.js';
import { powerBudget, validate } from '../core.js';

function electricalPlan() {
  return {
    title: 'Temperature indicator', brief: 'A model paraphrase of the request.',
    summary: 'Model claims the assembly is verified.', notes: 'Check every proposed connection against the selected modules.',
    tools: ['Multimeter', 'Calipers'], assumptions: ['Exact modules and current ratings still need independent review.'],
    parts: [
      { id: 'supply', name: 'Regulated power supply', category: 'Power', qty: 1, detail: 'Select an enclosed low-voltage source.', voltage: '5 V proposed' },
      { id: 'controller', name: 'Controller module', category: 'Control', qty: 1, detail: 'Select a module compatible with the proposed sensor.', voltage: '5 V input proposed' },
      { id: 'sensor', name: 'Temperature sensor module', category: 'Sensing', qty: 1, detail: 'Select a module with a compatible interface.', voltage: '5 V proposed' },
      { id: 'case', name: 'Enclosure', category: 'Enclosure', qty: 1, detail: 'Measure selected components before designing mounts.', voltage: '' }
    ],
    wires: [
      { from: 'supply', fromPin: '', to: 'controller', toPin: '', signal: 'Proposed positive supply', voltage: '5 V', note: 'Identify actual terminals before wiring.' },
      { from: 'supply', fromPin: '', to: 'controller', toPin: '', signal: 'Ground return', voltage: '0 V', note: '' },
      { from: 'supply', fromPin: '', to: 'sensor', toPin: '', signal: 'Proposed positive supply', voltage: '5 V', note: '' },
      { from: 'controller', fromPin: '', to: 'sensor', toPin: '', signal: 'Ground return', voltage: '0 V', note: '' },
      { from: 'controller', fromPin: '', to: 'sensor', toPin: '', signal: 'Sensor interface to be selected', voltage: '', note: 'Confirm protocol and signal levels.' }
    ],
    mechanicalConnections: [
      { from: 'controller', to: 'case', label: 'Insulated standoff mounting', note: 'Measure hole positions and keep connectors accessible.' },
      { from: 'sensor', to: 'case', label: 'Ventilated sensor mounting', note: 'Keep sensing area clear of controller heat.' }
    ],
    steps: [
      { phase: 'Prepare', title: 'Select and review components', detail: 'Check module documentation and resolve current ratings.', partIds: [] },
      { phase: 'Wire', title: 'Connect reviewed supply and sensor', detail: 'Use confirmed terminal assignments and test continuity with power disconnected.', partIds: ['supply', 'controller', 'sensor'] },
      { phase: 'Assemble', title: 'Check enclosure fit', detail: 'Measure clearances and secure the components.', partIds: ['controller', 'sensor', 'case'] },
      { phase: 'Test', title: 'Check sensing and supply', detail: 'Compare readings with a reference and measure current against the reviewed supply rating.', partIds: ['supply', 'controller', 'sensor'] }
    ],
    powerRails: [{ id: 'rail-input', name: 'Proposed input rail', voltageV: 5, sourcePartId: 'supply', loads: [{ partId: 'controller' }, { partId: 'sensor' }] }]
  };
}

function mechanicalPlan() {
  return {
    title: 'Bookend', brief: 'A bookend concept.', summary: 'A bent plate supports books.', notes: '',
    tools: ['Ruler', 'File'], assumptions: ['Material and thickness require load and edge review.'],
    parts: [{ id: 'plate', name: 'Bookend plate', category: 'Mechanical', qty: 1, detail: 'Measure the shelf and proposed book load before selecting stock.', voltage: '' }],
    wires: [], mechanicalConnections: [], powerRails: [],
    steps: [
      { phase: 'Prepare', title: 'Measure the shelf', detail: 'Record the available footprint and book height.', partIds: [] },
      { phase: 'Fabricate', title: 'Shape the plate', detail: 'Use a suitable fabrication method and remove sharp edges.', partIds: ['plate'] },
      { phase: 'Test', title: 'Check stability', detail: 'Apply the intended book load and inspect tipping and deformation.', partIds: ['plate'] }
    ]
  };
}

test('explicit mechanical scope can fit existing electronics without inventing them', () => {
  const raw = mechanicalPlan();
  raw.parts[0].category = 'Enclosure';
  const draft = coordinatedAiDraft(raw, 'A protective enclosure only for my existing OLED display. No electronics or wiring to add.', 'local');
  assert.equal(draft.parts.length, 1);
  assert.throws(() => coordinatedAiDraft(raw, 'Build a temperature display with a button.', 'local'), /omitted a requested/);
  assert.throws(() => coordinatedAiDraft(raw, 'An OLED display.', 'local'), /omitted a requested/);
});

test('electrical concept preserves coordination, original brief and source input', () => {
  const raw = electricalPlan();
  const before = structuredClone(raw);
  const brief = 'My original temperature indicator request, including unresolved questions.';
  const result = coordinatedAiDraft(raw, brief, 'local-model');
  assert.equal(result.brief, brief);
  assert.equal(result.starterId, 'ai');
  assert.deepEqual(result.tools, raw.tools);
  assert.deepEqual(result.assumptions, raw.assumptions);
  assert.deepEqual(result.mechanicalConnections, raw.mechanicalConnections);
  assert.deepEqual(result.steps.map(({ phase, title, detail, partIds }) => ({ phase, title, detail, partIds })), raw.steps);
  assert.deepEqual(raw, before);
  result.powerRails[0].loads[0].partId = 'changed';
  result.steps[1].partIds.push('changed');
  assert.deepEqual(raw, before);
});

test('proposed power topology never becomes a verified budget or review', () => {
  const raw = electricalPlan();
  const result = coordinatedAiDraft(raw, 'Temperature indicator', 'local-model');
  const rail = result.powerRails[0];
  assert.equal(rail.id, raw.powerRails[0].id);
  assert.equal(rail.voltageV, 5);
  assert.equal(rail.sourcePartId, 'supply');
  assert.equal(rail.supplyCurrentMa, null);
  assert.equal(rail.marginPercent, 20);
  assert.deepEqual(rail.loads, [{ partId: 'controller', currentMaEach: null }, { partId: 'sensor', currentMaEach: null }]);
  assert.equal(powerBudget(result, rail).status, 'incomplete');
  assert.deepEqual(result.review, { electrical: false, mechanical: false, sourcing: false });
  assert.ok(result.parts.every(part => part.unitCost === 0 && !part.verified && !part.checkedAt && !part.sourceUrl && !part.specUrl && part.pins.length === 0));
  assert.ok(result.steps.every(step => step.done === false));
  assert.equal(result.cadUrl, '');
  assert.equal(result.wiringUrl, '');
  assert.equal(result.solidSpec, null);
  assert.equal(result.traySpec, null);
  assert.match(result.summary, /unverified/);
  assert.doesNotMatch(result.summary, /assembly is verified/);
  assert.match(result.notes, /MODEL NOTES \/ UNVERIFIED/);
  assert.deepEqual(validate(result).filter(issue => issue.kind === 'error'), []);
  assert.ok(validate(result).some(issue => issue.text.includes('a supply rating')));
});

test('one-part mechanical concept accepts empty electrical and mounting lists', () => {
  const raw = mechanicalPlan();
  const before = structuredClone(raw);
  const result = coordinatedAiDraft(raw, 'A bookend for my shelf', 'local-model');
  assert.equal(result.parts.length, 1);
  assert.deepEqual(result.wires, []);
  assert.deepEqual(result.powerRails, []);
  assert.equal(result.steps[2].phase, 'Test');
  assert.deepEqual(validate(result).filter(issue => issue.kind === 'error'), []);
  assert.deepEqual(raw, before);
});

test('strict schema rejects model authority fields at every record boundary', () => {
  const edits = [
    raw => { raw.review = { electrical: true }; },
    raw => { raw.cadUrl = 'https://example.invalid/model'; },
    raw => { raw.solidSpec = {}; },
    raw => { raw.parts[0].verified = true; },
    raw => { raw.parts[0].unitCost = 20; },
    raw => { raw.parts[0].pins = ['VCC']; },
    raw => { raw.parts[0].sourceUrl = 'https://example.invalid/model'; },
    raw => { raw.wires[0].checked = true; },
    raw => { raw.mechanicalConnections[0].verified = true; },
    raw => { raw.steps[0].done = true; },
    raw => { raw.powerRails[0].supplyCurrentMa = 3000; },
    raw => { raw.powerRails[0].loads[0].currentMaEach = 1; }
  ];
  for (const edit of edits) {
    const raw = electricalPlan(); edit(raw);
    assert.throws(() => coordinatedAiDraft(raw, 'Temperature indicator', 'model'), /unknown field/);
  }
  assert.equal(MODEL_PLAN_SCHEMA.additionalProperties, false);
  assert.deepEqual(MODEL_PLAN_SCHEMA.properties.steps.items.properties.phase.enum, ['Prepare', 'Fabricate', 'Wire', 'Bring up', 'Assemble', 'Test']);
});

test('missing and malformed fields, unbounded text and counts fail before normalization', () => {
  const edits = [
    raw => { delete raw.assumptions; },
    raw => { raw.tools = []; },
    raw => { raw.tools = ['   ']; },
    raw => { raw.tools = ['One\nTwo']; },
    raw => { raw.title = 'x'.repeat(101); },
    raw => { raw.parts[0].qty = '1'; },
    raw => { raw.parts[0].qty = 1.5; },
    raw => { raw.parts[0].qty = 0; },
    raw => { raw.parts = Array.from({ length: 13 }, (_, i) => ({ ...raw.parts[0], id: `part-${i}` })); },
    raw => { raw.wires = Array(33).fill(raw.wires[0]); },
    raw => { raw.steps = raw.steps.slice(0, 2); },
    raw => { raw.steps[0].phase = 'Build'; },
    raw => { raw.powerRails[0].voltageV = Infinity; },
    raw => { raw.powerRails[0].voltageV = NaN; },
    raw => { raw.powerRails[0].voltageV = '5'; },
    raw => { raw.powerRails[0].voltageV = 0; },
    raw => { raw.powerRails[0].voltageV = 61; },
    raw => { raw.powerRails[0].loads = []; }
  ];
  for (const edit of edits) {
    const raw = electricalPlan(); edit(raw);
    assert.throws(() => coordinatedAiDraft(raw, 'Temperature indicator', 'model'), /Invalid AI plan:/);
  }
});

test('missing part references are rejected in each relationship and step', () => {
  const edits = [
    raw => { raw.wires[0].from = 'absent'; },
    raw => { raw.wires[0].to = 'absent'; },
    raw => { raw.mechanicalConnections[0].from = 'absent'; },
    raw => { raw.mechanicalConnections[0].to = 'absent'; },
    raw => { raw.steps[1].partIds = ['absent']; },
    raw => { raw.powerRails[0].sourcePartId = 'absent'; },
    raw => { raw.powerRails[0].loads[0].partId = 'absent'; }
  ];
  for (const edit of edits) {
    const raw = electricalPlan(); edit(raw);
    assert.throws(() => coordinatedAiDraft(raw, 'Temperature indicator', 'model'), /missing part absent/);
  }
});

test('duplicate identities, duplicate links and source-as-load cannot hide in a plan', () => {
  const cases = [
    [raw => { raw.parts[1].id = 'supply'; }, /duplicate ID supply/],
    [raw => { raw.powerRails.push(structuredClone(raw.powerRails[0])); }, /duplicate ID rail-input/],
    [raw => { raw.steps[1].partIds = ['supply', 'supply']; }, /unique part IDs/],
    [raw => { raw.powerRails[0].loads.push({ partId: 'sensor' }); }, /duplicate loads/],
    [raw => { raw.powerRails[0].loads.push({ partId: 'supply' }); }, /same part as source and load/],
    [raw => { raw.wires[0].to = 'supply'; }, /same part at both ends/],
    [raw => { raw.mechanicalConnections[0].to = 'controller'; }, /requires multiple units/]
  ];
  for (const [edit, message] of cases) {
    const raw = electricalPlan(); edit(raw);
    assert.throws(() => coordinatedAiDraft(raw, 'Temperature indicator', 'model'), message);
  }
});

test('only Prepare can be global and at least one Test must be linked', () => {
  for (const phase of ['Fabricate', 'Wire', 'Bring up', 'Assemble', 'Test']) {
    const raw = electricalPlan();
    raw.steps[0].phase = phase;
    assert.throws(() => coordinatedAiDraft(raw, 'Temperature indicator', 'model'), /requires links/);
  }
  const noTest = electricalPlan(); noTest.steps.at(-1).phase = 'Prepare';
  assert.throws(() => coordinatedAiDraft(noTest, 'Temperature indicator', 'model'), /requires a linked Test/);
});

test('electrical records require proposed rails and wires, including uncertain categories', () => {
  for (const field of ['wires', 'powerRails']) {
    const raw = electricalPlan(); raw[field] = [];
    assert.throws(() => coordinatedAiDraft(raw, 'Temperature indicator', 'model'), /requires at least one proposed power rail and wire/);
  }
  for (const edit of [raw => { raw.parts[0].category = 'Other'; }, raw => { raw.parts[0].voltage = '5 V'; }]) {
    const raw = mechanicalPlan(); edit(raw);
    assert.throws(() => coordinatedAiDraft(raw, 'Bookend', 'model'), /requires at least one proposed power rail and wire/);
  }
});

test('existing requested-component checks still reject a coherent but irrelevant plan', () => {
  assert.throws(() => coordinatedAiDraft(electricalPlan(), 'Temperature indicator with an OLED display', 'model'), /requested display/);
});


test('actual electrical draft exposes missing sensor data, interconnect source and voltage ambiguity', () => {
  const raw = JSON.parse(readFileSync(new URL('../examples/coordinated-drafts/electrical-trial.json', import.meta.url), 'utf8'));
  const project = structuredClone(raw);
  const issues = validate(project);
  assert.ok(issues.some(i => /BME280.*no clearly recorded signal\/data path/.test(i.text)));
  assert.ok(issues.some(i => /USB Power Rail.*interconnect/.test(i.text)));
  assert.ok(issues.some(i => /USB Power Rail is 5 V but OLED Display records 3.3V/.test(i.text)));
  assert.ok(project.powerRails.every(rail => powerBudget(project, rail).status === 'incomplete'));
  assert.deepEqual(project, raw);
  project.wires.push({from:'board', to:'sensor', fromPin:'', toPin:'', signal:'I2C data and clock', voltage:'3.3V', note:'Proposed, not checked.'});
  project.parts.find(p => p.id === 'cable').name = 'Upstream supply to select';
  project.powerRails[0].voltageV = 3.3;
  const updated = validate(project);
  assert.ok(!updated.some(i => /no clearly recorded signal\/data path/.test(i.text)));
  assert.ok(!updated.some(i => /interconnect does not establish/.test(i.text)));
  assert.ok(!updated.some(i => /USB Power Rail is 5 V/.test(i.text)));
  assert.ok(updated.some(i => /need independent review/.test(i.text)));
});
