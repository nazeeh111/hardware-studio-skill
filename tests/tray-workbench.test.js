import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateTraySpec } from '../tray-spec.js';

const fixture = JSON.parse(readFileSync(new URL('../tools/tray-generator/examples/pico-neopixel-tray.json', import.meta.url)));

test('the browser workbench accepts the CAD generator example without changing its geometry', () => {
  const spec = validateTraySpec(fixture);
  assert.deepEqual(spec.outer, { length: 66, width: 45, height: 14 });
  assert.equal(spec.mounts.length, 6);
  assert.equal(spec.cutouts.length, 1);
  assert.deepEqual(spec.mounts[0], fixture.mounts[0]);
});

test('the workbench rejects overlapping bosses and cutouts through the floor', () => {
  const overlap = structuredClone(fixture);
  overlap.mounts[1].x = overlap.mounts[0].x;
  overlap.mounts[1].y = overlap.mounts[0].y;
  assert.throws(() => validateTraySpec(overlap), /overlap/);
  const floor = structuredClone(fixture);
  floor.cutouts[0].bottom = 1;
  assert.throws(() => validateTraySpec(floor), /corner or floor/);
});
