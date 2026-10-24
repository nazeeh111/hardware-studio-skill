import { localAiDraft, mechanicalOnly, safeProject } from './core.js?v=43';

const text = (maxLength, minLength = 0) => ({ type: 'string', minLength, maxLength, ...(minLength ? { pattern: '\\S' } : {}) });
const id = () => ({ type: 'string', minLength: 1, maxLength: 80, pattern: '^[A-Za-z0-9][A-Za-z0-9_-]*$' });
const record = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const list = (items, minItems, maxItems) => ({ type: 'array', items, minItems, maxItems });
const shortEntries = () => list({ ...text(160, 1), pattern: '^[^\\r\\n]*\\S[^\\r\\n]*$' }, 1, 12);

// The model can propose a concept, but cannot supply evidence, prices, CAD,
// verified pin inventories, completed work, or numeric current ratings.
export const MODEL_PLAN_SCHEMA = record({
  title: text(100, 1),
  brief: text(5000, 1),
  summary: text(2000, 1),
  notes: text(6000),
  tools: shortEntries(),
  assumptions: shortEntries(),
  parts: list(record({
    id: id(), name: text(200, 1), category: text(80, 1),
    qty: { type: 'integer', minimum: 1, maximum: 10000 },
    detail: text(2000, 1), voltage: text(60)
  }), 1, 12),
  wires: list(record({
    from: id(), fromPin: text(100), to: id(), toPin: text(100),
    signal: text(160, 1), voltage: text(80), note: text(1000)
  }), 0, 32),
  mechanicalConnections: list(record({
    from: id(), to: id(), label: text(240, 1), note: text(1000)
  }), 0, 32),
  steps: list(record({
    phase: { type: 'string', enum: ['Prepare', 'Fabricate', 'Wire', 'Bring up', 'Assemble', 'Test'] },
    title: text(200, 1), detail: text(2000, 1),
    partIds: { ...list(id(), 0, 12), uniqueItems: true }
  }), 3, 12),
  powerRails: list(record({
    id: id(), name: text(100, 1),
    voltageV: { type: 'number', exclusiveMinimum: 0, maximum: 60 },
    sourcePartId: id(),
    loads: list(record({ partId: id() }), 1, 12)
  }), 0, 8)
});

function invalid(path, reason) {
  throw new Error(`Invalid AI plan: ${path} ${reason}.`);
}

// Enforce the same bounded shape locally even when a model or API ignores its
// requested response schema. Reference and coordination checks follow below.
function checkShape(value, schema, path = 'plan') {
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(path, 'must be an object');
    for (const key of Object.keys(value)) {
      if (!Object.hasOwn(schema.properties, key)) invalid(`${path}.${key}`, 'is an unknown field');
    }
    for (const key of schema.required) {
      if (!Object.hasOwn(value, key)) invalid(`${path}.${key}`, 'is required');
      checkShape(value[key], schema.properties[key], `${path}.${key}`);
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) invalid(path, 'must be an array');
    if (value.length < schema.minItems || value.length > schema.maxItems) invalid(path, `must have ${schema.minItems} to ${schema.maxItems} entries`);
    value.forEach((entry, index) => checkShape(entry, schema.items, `${path}[${index}]`));
    if (schema.uniqueItems && new Set(value).size !== value.length) invalid(path, 'must contain unique part IDs');
  } else if (schema.type === 'string') {
    if (typeof value !== 'string') invalid(path, 'must be text');
    if (schema.enum && !schema.enum.includes(value)) invalid(path, 'has an unsupported phase');
    if (schema.minLength != null && (value.length < schema.minLength || value.length > schema.maxLength)) invalid(path, `must have ${schema.minLength} to ${schema.maxLength} characters`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) invalid(path, 'has invalid or blank text');
  } else {
    if (typeof value !== 'number' || !Number.isFinite(value)) invalid(path, 'must be a finite number');
    if (schema.type === 'integer' && !Number.isInteger(value)) invalid(path, 'must be an integer');
    if ((schema.minimum != null && value < schema.minimum) ||
        (schema.exclusiveMinimum != null && value <= schema.exclusiveMinimum) || value > schema.maximum) invalid(path, 'is outside the allowed range');
  }
}

export function coordinatedAiDraft(raw, brief, model) {
  checkShape(raw, MODEL_PLAN_SCHEMA);
  const parts = new Map();
  for (const part of raw.parts) {
    if (parts.has(part.id)) invalid('parts', `has duplicate ID ${part.id}`);
    parts.set(part.id, part);
  }
  const requirePart = (partId, path) => {
    if (!parts.has(partId)) invalid(path, `refers to missing part ${partId}`);
  };
  for (const [index, wire] of raw.wires.entries()) {
    requirePart(wire.from, `wires[${index}].from`);
    requirePart(wire.to, `wires[${index}].to`);
    if (wire.from === wire.to) invalid(`wires[${index}]`, 'uses the same part at both ends');
  }
  for (const [index, link] of raw.mechanicalConnections.entries()) {
    requirePart(link.from, `mechanicalConnections[${index}].from`);
    requirePart(link.to, `mechanicalConnections[${index}].to`);
    if (link.from === link.to && parts.get(link.from).qty < 2) invalid(`mechanicalConnections[${index}]`, 'requires multiple units for a relationship within one part ID');
  }
  for (const [index, step] of raw.steps.entries()) {
    if (step.phase !== 'Prepare' && !step.partIds.length) invalid(`steps[${index}].partIds`, 'requires links to the affected parts');
    step.partIds.forEach(partId => requirePart(partId, `steps[${index}].partIds`));
  }
  if (!raw.steps.some(step => step.phase === 'Test' && step.partIds.length)) invalid('steps', 'requires a linked Test step');

  const railIds = new Set();
  for (const [index, rail] of raw.powerRails.entries()) {
    if (railIds.has(rail.id)) invalid('powerRails', `has duplicate ID ${rail.id}`);
    railIds.add(rail.id);
    requirePart(rail.sourcePartId, `powerRails[${index}].sourcePartId`);
    const loadIds = new Set();
    for (const load of rail.loads) {
      requirePart(load.partId, `powerRails[${index}].loads`);
      if (load.partId === rail.sourcePartId) invalid(`powerRails[${index}]`, 'uses the same part as source and load');
      if (loadIds.has(load.partId)) invalid(`powerRails[${index}].loads`, 'contains duplicate loads');
      loadIds.add(load.partId);
    }
  }
  if (!mechanicalOnly(raw) && (!raw.wires.length || !raw.powerRails.length)) invalid('electrical plan', 'requires at least one proposed power rail and wire');

  const project = localAiDraft(raw, brief, model);
  // Restore only proposed rail topology after the existing trust sanitizer.
  // Current measurements must be supplied independently before a budget passes.
  project.powerRails = safeProject({ ...project, powerRails: raw.powerRails.map(rail => ({
    ...rail, supplyCurrentMa: null, marginPercent: 20,
    loads: rail.loads.map(load => ({ partId: load.partId, currentMaEach: null }))
  })) }).powerRails;
  return project;
}
