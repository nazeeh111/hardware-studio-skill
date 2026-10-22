import test from 'node:test';
import assert from 'node:assert/strict';
import { createZip } from '../zip.js';

test('ZIP export refuses unsafe and duplicate paths', () => {
  assert.throws(() => createZip([{ name: '../escape.txt', data: 'x' }]), /Unsafe/);
  assert.throws(() => createZip([{ name: '/absolute.txt', data: 'x' }]), /Unsafe/);
  assert.throws(() => createZip([{ name: 'one.txt', data: 'a' }, { name: 'one.txt', data: 'b' }]), /Unsafe/);
});
