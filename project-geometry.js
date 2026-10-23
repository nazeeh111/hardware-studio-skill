import {validateTraySpec} from './tray-spec.js';
import {validateSolidSpec} from './solid-spec.js?v=2';
import {WorkspaceConflictError} from './workspace-store.js';

export const trayKey = id => `hardware-studio-tray-${id}`;
export const solidKey = id => `hardware-studio-solid-project-${id}`;
const fields = [
  {field:'traySpec', key:trayKey, validate:validateTraySpec},
  {field:'solidSpec', key:solidKey, validate:validateSolidSpec}
];

// Sidecars let a separate workbench retain edits while the studio is closed.
// Missing sidecars fall back to the source embedded in the project itself.
export function projectWithGeometry(project, storage, rawValues = null) {
  const next = {...project};
  let changed = false;
  for (const {field,key,validate} of fields) {
    let raw;
    try { raw = rawValues ? rawValues[key(project.id)] : storage.getItem(key(project.id)); }
    catch { continue; }
    if (raw === null) continue;
    if (raw.length > 65536) throw new Error(`Saved ${field} exceeds 64 KB.`);
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
  const entries = fields.map(({field,key,validate}) => ({
    key:key(project.id),
    next:project[field] == null ? null : JSON.stringify(validate(project[field])),
    before:storage.getItem(key(project.id))
  }));
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
  const title = (query.get('title') || '').slice(0,200);
  const suffix = id ? `?${new URLSearchParams({project:id,...(title ? {title} : {})})}` : '';
  return {
    id, title,
    key:id ? solidKey(id) : 'hardware-studio-solid-model-v1',
    draftKey:id ? `hardware-studio-solid-editor-project-${id}` : 'hardware-studio-solid-editor-v1',
    returnTo:`./solid.html${suffix}`,
    studioTo:`./index.html${id ? `?${new URLSearchParams({project:id})}` : ''}`
  };
}
