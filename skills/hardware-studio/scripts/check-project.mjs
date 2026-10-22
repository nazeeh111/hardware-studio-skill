#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const path = process.argv[2];
if (!path) { console.error('Usage: node check-project.mjs /absolute/path/to/project.json'); process.exit(2); }

try {
  const project = JSON.parse(await readFile(path, 'utf8'));
  const issues = [];
  if (!project || typeof project !== 'object') issues.push('Project must be a JSON object.');
  for (const field of ['parts', 'wires', 'steps']) if (!Array.isArray(project?.[field])) issues.push(`${field} must be an array.`);
  if (typeof project?.title !== 'string' || !project.title.trim()) issues.push('title is required.');
  const ids = new Set();
  for (const [i, part] of (Array.isArray(project?.parts) ? project.parts : []).entries()) {
    if (!part || typeof part !== 'object') { issues.push(`parts[${i}] must be an object.`); continue; }
    if (typeof part.id !== 'string' || !part.id) issues.push(`parts[${i}].id is required.`);
    else if (ids.has(part.id)) issues.push(`Duplicate part ID: ${part.id}`);
    ids.add(part.id);
    if (typeof part.name !== 'string' || !part.name.trim()) issues.push(`parts[${i}].name is required.`);
    if (!Number.isInteger(part.qty) || part.qty < 1) issues.push(`parts[${i}].qty must be a positive integer.`);
    if (typeof part.unitCost !== 'number' || !Number.isFinite(part.unitCost) || part.unitCost < 0) issues.push(`parts[${i}].unitCost must be a nonnegative number.`);
    if (part.sourceUrl && !/^https?:\/\//i.test(part.sourceUrl)) issues.push(`parts[${i}].sourceUrl must be HTTP(S).`);
  }
  for (const [i, wire] of (Array.isArray(project?.wires) ? project.wires : []).entries()) {
    if (!wire || typeof wire !== 'object') { issues.push(`wires[${i}] must be an object.`); continue; }
    if (!ids.has(wire.from) || !ids.has(wire.to)) issues.push(`wires[${i}] refers to a missing part.`);
    if (wire.from === wire.to) issues.push(`wires[${i}] loops to the same part.`);
    if (typeof wire.signal !== 'string' || !wire.signal.trim()) issues.push(`wires[${i}].signal is required.`);
  }
  for (const [i, step] of (Array.isArray(project?.steps) ? project.steps : []).entries()) {
    if (!step || typeof step !== 'object' || typeof step.title !== 'string' || !step.title.trim()) issues.push(`steps[${i}].title is required.`);
  }
  if (issues.length) { for (const issue of issues) console.error(`ERROR ${issue}`); process.exit(1); }
  console.log(`Structure OK: ${project.parts.length} parts, ${project.wires.length} connections, ${project.steps.length} steps.`);
  console.log('Engineering, sourcing and safety are not validated by this checker.');
} catch (error) { console.error(`ERROR ${error.message}`); process.exit(1); }
