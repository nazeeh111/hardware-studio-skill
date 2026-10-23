#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { validateTraySpec } from './tray-spec.mjs';
import { validateSolidSpec } from './solid-spec.mjs';
import {validateAssemblySpec,assemblyIssues} from './assembly-spec.mjs';

const path = process.argv[2];
if (!path) { console.error('Usage: node check-project.mjs /absolute/path/to/project.json'); process.exit(2); }

try {
  const project = JSON.parse(await readFile(path, 'utf8'));
  const issues = [];
  if (!project || typeof project !== 'object') issues.push('Project must be a JSON object.');
  for (const field of ['parts', 'wires', 'steps']) if (!Array.isArray(project?.[field])) issues.push(`${field} must be an array.`);
  if (typeof project?.title !== 'string' || !project.title.trim()) issues.push('title is required.');
  if (project?.cadUrl && !/^https?:\/\//i.test(project.cadUrl)) issues.push('cadUrl must be HTTP(S).');
  if (project?.wiringUrl && !/^https?:\/\//i.test(project.wiringUrl)) issues.push('wiringUrl must be HTTP(S).');
  for (const key of ['tools', 'assumptions']) if (project?.[key] != null && (!Array.isArray(project[key]) || project[key].length > 30 || project[key].some(item => typeof item !== 'string' || !item.trim() || item.length > 160 || /[\r\n]/.test(item)))) issues.push(`${key} must contain up to 30 short text entries.`);
  if (project?.traySpec != null) {
    try { validateTraySpec(project.traySpec); }
    catch (error) { issues.push(`traySpec: ${error.message}`); }
  }
  if (project?.solidSpec != null) {
    try { validateSolidSpec(project.solidSpec); }
    catch (error) { issues.push(`solidSpec: ${error.message}`); }
  }
  if(project?.assemblySpec!=null){try{validateAssemblySpec(project.assemblySpec);issues.push(...assemblyIssues(project.assemblySpec,Array.isArray(project.parts)?project.parts:[]).map(i=>'assemblySpec: '+i.text));}catch(error){issues.push('assemblySpec: '+error.message);}}
  const ids = new Set();
  const pinLists = new Map();
  for (const [i, part] of (Array.isArray(project?.parts) ? project.parts : []).entries()) {
    if (!part || typeof part !== 'object') { issues.push(`parts[${i}] must be an object.`); continue; }
    if (typeof part.id !== 'string' || !part.id) issues.push(`parts[${i}].id is required.`);
    else if (ids.has(part.id)) issues.push(`Duplicate part ID: ${part.id}`);
    ids.add(part.id);
    if (part.pins != null && (!Array.isArray(part.pins) || part.pins.length > 80 || part.pins.some(pin => typeof pin !== 'string' || !pin.trim() || pin.length > 80 || /[\r\n]/.test(pin)) || new Set(part.pins.map(pin => typeof pin === 'string' ? pin.trim() : pin)).size !== part.pins.length)) issues.push(`parts[${i}].pins must contain unique short pin names.`);
    if (Array.isArray(part.pins)) pinLists.set(part.id, part.pins);
    if (typeof part.name !== 'string' || !part.name.trim()) issues.push(`parts[${i}].name is required.`);
    if (!Number.isInteger(part.qty) || part.qty < 1) issues.push(`parts[${i}].qty must be a positive integer.`);
    if (typeof part.unitCost !== 'number' || !Number.isFinite(part.unitCost) || part.unitCost < 0) issues.push(`parts[${i}].unitCost must be a nonnegative number.`);
    if (part.sourceUrl && !/^https?:\/\//i.test(part.sourceUrl)) issues.push(`parts[${i}].sourceUrl must be HTTP(S).`);
    if (part.specUrl && !/^https?:\/\//i.test(part.specUrl)) issues.push(`parts[${i}].specUrl must be HTTP(S).`);
    if (part.verified && (!/^https?:\/\//i.test(String(part.specUrl || '')) || typeof part.checkedAt !== 'string' || !Number.isFinite(Date.parse(part.checkedAt)))) issues.push(`parts[${i}] cannot be marked verified without a specification URL and check date.`);
  }
  for (const [i, wire] of (Array.isArray(project?.wires) ? project.wires : []).entries()) {
    if (!wire || typeof wire !== 'object') { issues.push(`wires[${i}] must be an object.`); continue; }
    if (!ids.has(wire.from) || !ids.has(wire.to)) issues.push(`wires[${i}] refers to a missing part.`);
    if (wire.from === wire.to) issues.push(`wires[${i}] loops to the same part.`);
    if (typeof wire.signal !== 'string' || !wire.signal.trim()) issues.push(`wires[${i}].signal is required.`);
    for (const pin of ['fromPin', 'toPin']) if (wire[pin] != null && (typeof wire[pin] !== 'string' || wire[pin].length > 100)) issues.push(`wires[${i}].${pin} must be text under 100 characters.`);
    for (const [partId, pin] of [[wire.from, wire.fromPin], [wire.to, wire.toPin]]) if (pin && pinLists.get(partId)?.length && !pinLists.get(partId).includes(pin)) issues.push(`wires[${i}] uses pin ${pin} absent from ${partId}'s inventory.`);
  }
  if (project?.mechanicalConnections != null && !Array.isArray(project.mechanicalConnections)) issues.push('mechanicalConnections must be an array when supplied.');
  for (const [i, link] of (Array.isArray(project?.mechanicalConnections) ? project.mechanicalConnections : []).entries()) {
    if (!link || typeof link !== 'object') { issues.push(`mechanicalConnections[${i}] must be an object.`); continue; }
    if (!ids.has(link.from) || !ids.has(link.to)) issues.push(`mechanicalConnections[${i}] refers to a missing part.`);
    if (link.from === link.to && (project.parts.find(part => part.id === link.from)?.qty || 0) < 2) issues.push(`mechanicalConnections[${i}] needs two units for a same-part relationship.`);
    if (typeof link.label !== 'string' || !link.label.trim()) issues.push(`mechanicalConnections[${i}].label is required.`);
  }
  if (project?.powerRails != null && !Array.isArray(project.powerRails)) issues.push('powerRails must be an array when supplied.');
  for (const [i, rail] of (Array.isArray(project?.powerRails) ? project.powerRails : []).entries()) {
    if (!rail || typeof rail !== 'object') { issues.push(`powerRails[${i}] must be an object.`); continue; }
    if (typeof rail.name !== 'string' || !rail.name.trim()) issues.push(`powerRails[${i}].name is required.`);
    if (typeof rail.voltageV !== 'number' || !Number.isFinite(rail.voltageV) || rail.voltageV <= 0) issues.push(`powerRails[${i}].voltageV must be positive.`);
    if (rail.supplyCurrentMa != null && (typeof rail.supplyCurrentMa !== 'number' || !Number.isFinite(rail.supplyCurrentMa) || rail.supplyCurrentMa <= 0)) issues.push(`powerRails[${i}].supplyCurrentMa must be positive or null.`);
    if (typeof rail.marginPercent !== 'number' || !Number.isFinite(rail.marginPercent) || rail.marginPercent < 0 || rail.marginPercent >= 100) issues.push(`powerRails[${i}].marginPercent must be from 0 to below 100.`);
    if (rail.sourcePartId && !ids.has(rail.sourcePartId)) issues.push(`powerRails[${i}] refers to a missing supply part.`);
    if (!Array.isArray(rail.loads)) { issues.push(`powerRails[${i}].loads must be an array.`); continue; }
    const assigned = new Set();
    for (const [j, load] of rail.loads.entries()) {
      if (!load || typeof load !== 'object') { issues.push(`powerRails[${i}].loads[${j}] must be an object.`); continue; }
      if (!ids.has(load.partId)) issues.push(`powerRails[${i}].loads[${j}] refers to a missing part.`);
      if (assigned.has(load.partId)) issues.push(`powerRails[${i}] counts ${load.partId} twice.`);
      assigned.add(load.partId);
      if (load.currentMaEach != null && (typeof load.currentMaEach !== 'number' || !Number.isFinite(load.currentMaEach) || load.currentMaEach < 0)) issues.push(`powerRails[${i}].loads[${j}].currentMaEach must be nonnegative or null.`);
    }
  }
  for (const [i, step] of (Array.isArray(project?.steps) ? project.steps : []).entries()) {
    if (!step || typeof step !== 'object' || typeof step.title !== 'string' || !step.title.trim()) issues.push(`steps[${i}].title is required.`);
    if (step?.partIds != null) {
      if (!Array.isArray(step.partIds) || step.partIds.length > 40 || step.partIds.some(id => typeof id !== 'string' || !id || id.length > 80) || new Set(step.partIds).size !== step.partIds.length) issues.push(`steps[${i}].partIds must be unique short part IDs.`);
      else for (const id of step.partIds) if (!ids.has(id)) issues.push(`steps[${i}] refers to a missing part: ${id}`);
    }
  }
  if (issues.length) { for (const issue of issues) console.error(`ERROR ${issue}`); process.exit(1); }
  console.log(`Structure OK: ${project.parts.length} parts, ${project.wires.length} connections, ${project.steps.length} steps.`);
  const unnamed = project.wires.filter(wire => !String(wire.fromPin || '').trim() || !String(wire.toPin || '').trim()).length;
  const assemblyLabels = project.wires.filter(wire => /^ASSIGNED\b/i.test(String(wire.fromPin || '')) || /^ASSIGNED\b/i.test(String(wire.toPin || ''))).length;
  if (unnamed || assemblyLabels) console.log(`Review mapping: ${unnamed} connections lack a named endpoint; ${assemblyLabels} use project-assigned positions or rails that still need a physical hole map.`);
  console.log('Engineering, sourcing and safety are not validated by this checker.');
} catch (error) { console.error(`ERROR ${error.message}`); process.exit(1); }
