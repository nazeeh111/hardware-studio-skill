import test from 'node:test';
import assert from 'node:assert/strict';
import { STARTERS, makeProject, stats, validate, bomCsv, safeProject, localAiDraft, powerBudget, partReviewRecorded } from '../core.js';

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

test('CSV export quotes names and notes safely', () => {
  const p = makeProject(STARTERS[0]);
  p.parts[0].name = 'Sensor, "special"';
  const csv = bomCsv(p);
  assert.match(csv, /"Sensor, ""special"""/);
  assert.match(csv, /"Unit estimate USD"/);
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

test('local model output cannot mark estimates or reviews as verified', () => {
  const raw = makeProject(STARTERS[0]);
  raw.parts[0].unitCost = 999;
  raw.parts[0].sourceUrl = 'https://example.com/unchecked';
  raw.parts[0].verified = true;
  raw.cadUrl = 'https://example.com/unverified-cad';
  raw.wiringUrl = 'https://example.com/unverified-wiring';
  raw.review = { electrical: true, mechanical: true, sourcing: true };
  const draft = localAiDraft(raw, 'USB plant monitor', 'qwen3:4b');
  assert.equal(draft.starterId, 'ai');
  assert.equal(draft.parts[0].unitCost, 0);
  assert.equal(draft.parts[0].sourceUrl, '');
  assert.equal(draft.parts[0].verified, false);
  assert.equal(draft.cadUrl, '');
  assert.equal(draft.wiringUrl, '');
  assert.equal(draft.review.electrical, false);
  assert.match(draft.summary, /unverified/);
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
