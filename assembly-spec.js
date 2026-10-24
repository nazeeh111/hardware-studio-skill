import {validateSolidSpec} from './solid-spec.js?v=3';

export const ASSEMBLY_SCHEMA = 'hardware-studio-assembly-v1';
export const ASSEMBLY_MAX_BYTES = 262144;
const allowed = (value, keys, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new Error(`${label} has unsupported fields.`);
};
const identifier = (value, label) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 80 || /[\u0000-\u001f\u007f]/u.test(value)) throw new Error(`${label} needs 1–80 characters without control characters.`);
  return value;
};
const dense = value => Array.isArray(value) && Object.keys(value).length === value.length && Array.from({length:value.length},(_,i) => Object.hasOwn(value,i)).every(Boolean);
const vector = (value, limit, label) => {
  if (!dense(value) || value.length !== 3 || value.some(n => typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > limit)) throw new Error(`${label} needs three finite numbers within ±${limit}.`);
  return [...value];
};

// Sources remain in their own coordinates. Placements are rigid transforms,
// not mating constraints, interference checks or evidence of physical fit.
export function validateAssemblySpec(raw, {requirePlaced = false} = {}) {
  let bytes;
  try { bytes = new TextEncoder().encode(JSON.stringify(raw)).byteLength; }
  catch { throw new Error('Assembly source must be JSON data.'); }
  if (bytes > ASSEMBLY_MAX_BYTES) throw new Error('Assembly source exceeds 256 KB.');
  allowed(raw, ['schema','title','units','assets','instances'], 'Assembly specification');
  if (raw.schema !== ASSEMBLY_SCHEMA || raw.units !== 'mm') throw new Error(`Use ${ASSEMBLY_SCHEMA} and millimeter units.`);
  if (typeof raw.title !== 'string' || !raw.title.trim() || raw.title.length > 100 || /[\u0000-\u001f\u007f]/u.test(raw.title)) throw new Error('Use an assembly title of 1–100 characters.');
  if (!dense(raw.assets) || raw.assets.length > 8) throw new Error('Use at most 8 assembly part sources.');
  if (!dense(raw.instances) || raw.instances.length > 16) throw new Error('Use at most 16 placed instances.');
  const partIds = new Set();
  let features = 0;
  const assets = raw.assets.map((asset, index) => {
    allowed(asset, ['partId','source'], `Assembly source ${index + 1}`);
    const partId = identifier(asset.partId, 'Source part ID');
    if (partIds.has(partId)) throw new Error('Assembly source part IDs must be unique.');
    partIds.add(partId);
    if (!dense(asset.source?.features) || (asset.source?.probes !== undefined && !dense(asset.source.probes))) throw new Error('Part source features and probes must be JSON arrays without missing entries.');
    const source = validateSolidSpec(asset.source);
    features += source.features.length;
    return {partId, source};
  });
  if (features > 128) throw new Error('Assembly sources exceed 128 total features.');
  const ids = new Set();
  const instances = raw.instances.map((instance, index) => {
    allowed(instance, ['id','partId','position','rotation'], `Assembly instance ${index + 1}`);
    const id = identifier(instance.id, 'Instance ID'), partId = identifier(instance.partId, 'Instance part ID');
    if (ids.has(id)) throw new Error('Assembly instance IDs must be unique.');
    ids.add(id);
    if (!partIds.has(partId)) throw new Error(`Instance ${id} references a missing assembly source.`);
    return {id, partId, position:vector(instance.position, 500, 'Instance position in mm'), rotation:vector(instance.rotation, 360, 'Instance rotation in degrees')};
  });
  if (requirePlaced && !instances.length) throw new Error('Place at least one instance before building an assembly.');
  return {schema:ASSEMBLY_SCHEMA,title:raw.title.trim(),units:'mm',assets,instances};
}

export function emptyAssembly(title = 'Assembly') {
  return validateAssemblySpec({schema:ASSEMBLY_SCHEMA,title,units:'mm',assets:[],instances:[]});
}

// Returning a fresh normalized value makes replacing one source atomic for the
// caller; the original specification and every existing placement are retained.
export function setAssemblyPartSource(spec, partId, source, title) {
  const next = spec == null ? emptyAssembly(title || 'Assembly') : validateAssemblySpec(spec);
  const asset = {partId:identifier(partId, 'Source part ID'),source:validateSolidSpec(source)};
  const index = next.assets.findIndex(value => value.partId === partId);
  if (index < 0) next.assets.push(asset);
  else next.assets[index] = asset;
  return validateAssemblySpec(next);
}

export function assemblyIssues(spec, parts = []) {
  const assembly = validateAssemblySpec(spec), byId = new Map(parts.map(part => [part.id,part]));
  const issues = [];
  for (const asset of assembly.assets) {
    const part = byId.get(asset.partId), count = assembly.instances.filter(instance => instance.partId === asset.partId).length;
    if (!part) issues.push({kind:'error',code:'missing-bom-part',partId:asset.partId,text:`CAD source ${asset.partId} has no matching part in the parts list. Its source and placements are preserved.`});
    if (!count) issues.push({kind:'todo',code:'unplaced-asset',partId:asset.partId,text:`${part?.name || asset.partId} has CAD source but no placed instance.`});
    if (part && Number(part.qty) !== count) issues.push({kind:'todo',code:'quantity-mismatch',partId:asset.partId,text:`${part.name || asset.partId} records ${part.qty} units; the assembly places ${count}.`});
  }
  return issues;
}

// Column-major matrix, for column vectors: T * Rz * Ry * Rx. Rotations are
// right handed about the source origin and applied X, then Y, then Z.
export function instanceMatrix(instance) {
  allowed(instance, ['id','partId','position','rotation'], 'Assembly instance');
  const [x,y,z] = vector(instance.position,500,'Instance position in mm');
  const [rx,ry,rz] = vector(instance.rotation,360,'Instance rotation in degrees').map(n => n * Math.PI / 180);
  const cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry), cz = Math.cos(rz), sz = Math.sin(rz);
  return [cz*cy,sz*cy,-sy,0, cz*sy*sx-sz*cx,sz*sy*sx+cz*cx,cy*sx,0, cz*sy*cx+sz*sx,sz*sy*cx-cz*sx,cy*cx,0, x,y,z,1];
}
