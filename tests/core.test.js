import test from 'node:test';
import assert from 'node:assert/strict';
import { STARTERS, makeProject, stats, validate, bomCsv, safeProject } from '../core.js';

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
  p.review = { electrical: true, mechanical: true, sourcing: true };
  const imported = safeProject(p);
  assert.equal(imported.parts[0].sourceUrl, '');
  assert.deepEqual(imported.review, { electrical: false, mechanical: false, sourcing: false });
});
