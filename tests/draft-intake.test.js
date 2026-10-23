import test from 'node:test';
import assert from 'node:assert/strict';
import {requestRecord, parseRequest, requestSignature, boundedModelJson} from '../draft-intake.js';
import {briefQuestions} from '../brief.js';

test('explicit mechanical scope keeps physical questions without electronics prompts', () => {
  const questions = briefQuestions('A protective enclosure only for my existing OLED temperature display.');
  assert.deepEqual(questions.map(q => q.id), ['environment', 'size', 'success']);
  assert.ok(briefQuestions('A temperature display').some(q => q.id === 'sensing'));
});

test('request retains raw text and answers with a stable signature', () => {
  const record = requestRecord('  mounting plate\n', {size:'60 mm', environment:'Indoor'});
  assert.deepEqual(parseRequest(JSON.stringify(record)), record);
  const before = requestSignature(record.idea, record.answers, {dataUrl:'image-a'});
  assert.equal(before, requestSignature(record.idea, {environment:'Indoor', size:'60 mm'}, {dataUrl:'image-a'}));
  record.answers.size = '80 mm';
  assert.notEqual(before, requestSignature(record.idea, record.answers, {dataUrl:'image-a'}));
  assert.notEqual(before, requestSignature('new request', {}, null));
  assert.notEqual(before, requestSignature('  mounting plate\n', {size:'60 mm', environment:'Indoor'}, {dataUrl:'image-b'}));
});

test('malformed and excessive saved requests reject without changing original bytes', () => {
  for (const raw of ['{bad', 'null', JSON.stringify({schema:'other',idea:'',answers:{}}), JSON.stringify({schema:'hardware-studio-request-v1',idea:'x',answers:{},extra:1}), JSON.stringify({schema:'hardware-studio-request-v1',idea:'x',answers:JSON.parse('{"__proto__":"bad"}')}), JSON.stringify({schema:'hardware-studio-request-v1',idea:'x'.repeat(2001),answers:{}})]) {
    const original = raw;
    assert.throws(() => parseRequest(raw));
    assert.equal(raw, original);
  }
  assert.throws(() => requestRecord('', {size:'x'.repeat(241)}));
});

test('model response accepts chunked UTF-8 and rejects oversized or malformed data', async () => {
  const bytes = new TextEncoder().encode('{"response":"café"}');
  const response = new Response(new ReadableStream({start(c){for (const byte of bytes)c.enqueue(Uint8Array.of(byte));c.close();}}));
  assert.deepEqual(await boundedModelJson(response), {response:'café'});
  let cancelled = false;
  await assert.rejects(boundedModelJson(new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(21));},cancel(){cancelled=true;}})),20), /size limit/);
  assert.equal(cancelled, true);
  await assert.rejects(boundedModelJson(new Response('{invalid')), SyntaxError);
});
