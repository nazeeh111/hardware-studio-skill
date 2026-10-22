import test from 'node:test';
import assert from 'node:assert/strict';
import { briefQuestions, composeBrief } from '../brief.js';
import { blankProject, validate } from '../core.js';

test('guided brief asks about actual unknowns and keeps a success check', () => {
  const usb = briefQuestions('USB desk temperature display');
  assert.ok(usb.some(item => item.id === 'sensing'));
  assert.ok(usb.some(item => item.id === 'visual' && item.question.includes('readability')));
  assert.ok(!usb.some(item => item.id === 'power'));
  assert.equal(usb.at(-1).id, 'success');
  const portable = briefQuestions('Battery-powered robotic arm');
  assert.ok(portable.some(item => item.id === 'motion'));
  assert.ok(portable.some(item => item.id === 'runtime'));
  assert.equal(portable.at(-1).id, 'success');
});

test('answers become explicit conditions while unanswered details remain open', () => {
  const idea = 'Battery-powered robotic arm';
  const result = composeBrief(idea, { motion: 'Move 200 g through 90 degrees', runtime: 'Eight hours' });
  assert.match(result.text, /Motion or load: Move 200 g through 90 degrees/);
  assert.match(result.text, /Runtime: Eight hours/);
  assert.match(result.text, /Open design questions; do not invent exact specifications/);
  assert.equal(result.answered, 2);
  assert.ok(result.openQuestions.length >= 1);
  assert.ok(!result.text.includes('12 V'));
  const project = blankProject('Arm concept');
  project.brief = result.text;
  assert.ok(validate(project).some(issue => issue.kind === 'todo' && issue.text.includes('design questions')));
});
