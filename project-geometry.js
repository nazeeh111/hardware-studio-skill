import {validateTraySpec} from './tray-spec.js';
import {validateSolidSpec} from './solid-spec.js?v=2';
import {validateAssemblySpec,ASSEMBLY_MAX_BYTES} from './assembly-spec.js?v=1';
import {WorkspaceConflictError} from './workspace-store.js';

export const trayKey = id => `hardware-studio-tray-${id}`;
export const solidKey = id => `hardware-studio-solid-project-${id}`;
export const assemblyKey = id => `hardware-studio-assembly-project-${id}`;
const fields = [
  {field:'traySpec', key:trayKey, validate:validateTraySpec, maxBytes:65536},
  {field:'solidSpec', key:solidKey, validate:validateSolidSpec, maxBytes:65536},
  {field:'assemblySpec', key:assemblyKey, validate:validateAssemblySpec, maxBytes:ASSEMBLY_MAX_BYTES}
];

// Sidecars let a separate workbench retain edits while the studio is closed.
// Missing sidecars fall back to the source embedded in the project itself.
export function projectWithGeometry(project, storage, rawValues = null) {
  const next = {...project};
  let changed = false;
  for (const {field,key,validate,maxBytes} of fields) {
    let raw;
    try { raw = rawValues ? rawValues[key(project.id)] : storage.getItem(key(project.id)); }
    catch { continue; }
    if (raw == null) continue;
    if (new TextEncoder().encode(raw).byteLength > maxBytes) throw new Error(`Saved ${field} exceeds ${maxBytes / 1024} KB.`);
    const value = validate(JSON.parse(raw));
    if (JSON.stringify(value) !== JSON.stringify(project[field] ?? null)) {
      next[field] = value; changed = true;
    }
  }
  if (!changed) return project;
  next.review = {...project.review, mechanical:false};
  return next;
}

export function readGeometryState(project, storage) {
  const raw = Object.fromEntries(fields.map(({key}) => [key(project.id),storage.getItem(key(project.id))]));
  return {project:projectWithGeometry(project,storage,raw),raw};
}

// localStorage has no multi-key transaction. Preserve prior bytes and undo
// only our own writes on failure, never a newer write from another tab.
export function replaceGeometryCache(project, storage, expectedRaw = null) {
  const entries = fields.map(({field,key,validate,maxBytes}) => {
    const before = storage.getItem(key(project.id));
    // A malformed assembly sidecar may be the only copy of someone's edits.
    // Keep those actual bytes for recovery instead of overwriting them.
    if (field === 'assemblySpec' && before !== null) {
      if (new TextEncoder().encode(before).byteLength > maxBytes) throw new Error('Saved assemblySpec exceeds 256 KB.');
      validate(JSON.parse(before));
    }
    return {key:key(project.id),next:project[field] == null ? null : JSON.stringify(validate(project[field])),before};
  });
  if (expectedRaw && entries.some(entry => entry.before !== expectedRaw[entry.key])) throw new WorkspaceConflictError();
  const written = [];
  function rollback() {
    const failures = [];
    for (const entry of [...written].reverse()) {
      try {
        if (storage.getItem(entry.key) !== entry.next) throw new WorkspaceConflictError();
        if (entry.before === null) storage.removeItem(entry.key);
        else storage.setItem(entry.key, entry.before);
      } catch { failures.push(entry); }
    }
    if (failures.length) {
      const error = new Error('Geometry cache recovery needs attention. Prior bytes are available in the recovery download.');
      error.recovery = failures.map(({key,before}) => ({key,originalRaw:before}));
      throw error;
    }
  }
  try {
    for (const entry of entries) {
      if (storage.getItem(entry.key) !== entry.before) throw new WorkspaceConflictError();
      if (entry.next === entry.before) continue;
      if (entry.next === null) storage.removeItem(entry.key);
      else storage.setItem(entry.key, entry.next);
      written.push(entry);
    }
  } catch (error) {
    try { rollback(); } catch (recoveryError) { throw recoveryError; }
    throw error;
  }
  return {rollback};
}

export function solidContext(search = '') {
  const query = new URLSearchParams(search);
  const id = query.get('project');
  if (id !== null && !/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new Error('Invalid project link. Open the modeler from the studio.');
  const partId = query.get('part');
  if (partId !== null && (!id || !partId.trim() || partId.length > 80 || /[\u0000-\u001f\u007f]/u.test(partId))) throw new Error('Invalid part link. Open the modeler from the studio.');
  const title = (query.get('title') || '').slice(0,200);
  const suffix = id ? `?${new URLSearchParams({project:id,...(partId !== null ? {part:partId} : {}),...(title ? {title} : {})})}` : '';
  return {
    id, title, partId,
    key:id ? (partId !== null ? assemblyKey(id) : solidKey(id)) : 'hardware-studio-solid-model-v1',
    draftKey:id ? `hardware-studio-solid-editor-project-${id}${partId !== null ? `-part-${encodeURIComponent(partId)}` : ''}` : 'hardware-studio-solid-editor-v1',
    returnTo:`./solid.html${suffix}`,
    studioTo:`./index.html${id ? `?${new URLSearchParams({project:id})}` : ''}`
  };
}
