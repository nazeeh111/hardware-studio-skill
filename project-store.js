// Canonical project revisions. All participating writers must hold the same
// Web Lock. Legacy source keys remain intact as migration/recovery evidence.
import {STORAGE_KEY,REVISIONS_KEY,parseSavedWorkspace,projectContentChanged,restoreProjectFromRevision} from './core.js?v=44';
import {readGeometryState} from './project-geometry.js?v=4';
import {invalidateManualEdit} from './manual-edit-effects.js?v=1';

export const PROJECT_STORE_KEY = 'hardware-studio-project-store-v2';
export const PROJECT_STORE_LOCK = 'hardware-studio-project-store-v2';
const MAX_BYTES = 6_000_000;
const encoder = new TextEncoder();
function legacyMatches(storage, legacy) { return Object.entries(legacy).every(([key,value])=>storage.getItem(key)===value); }
export class ProjectStoreConflict extends Error {
  constructor() { super('The project store changed in another tab.'); this.name='ProjectStoreConflict'; }
}
function validateDocument(value) {
  if (!value || value.schema !== 'hardware-studio-project-store-v2' || typeof value.storeId !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.storeId) || !Number.isSafeInteger(value.generation) || value.generation < 0 || !Array.isArray(value.revisions) || !value.legacy || typeof value.legacy !== 'object' || Array.isArray(value.legacy) || Object.values(value.legacy).some(v=>v!==null&&typeof v!=='string')) throw new Error('Invalid project store.');
  parseSavedWorkspace(JSON.stringify(value.workspace));
  if (value.revisions.length > 1000 || value.revisions.some(entry => !entry || typeof entry.id !== 'string' || typeof entry.projectId !== 'string' || !entry.snapshot || typeof entry.snapshot !== 'object')) throw new Error('Invalid project history.');
  return value;
}
function parse(raw) {
  if (typeof raw !== 'string' || encoder.encode(raw).length > MAX_BYTES) throw new Error('Project store exceeds its size limit.');
  return validateDocument(JSON.parse(raw));
}
export function createProjectStore({storage, locks, key=PROJECT_STORE_KEY}={}) {
  if (!storage || !locks || typeof locks.request !== 'function') throw new Error('Safe project storage requires Web Locks.');
  async function locked(fn) { return locks.request(PROJECT_STORE_LOCK, {mode:'exclusive'}, fn); }
  function assertCurrent(raw) {
    if(raw===null || storage.getItem(key)!==raw || !legacyMatches(storage,parse(raw).legacy))throw new ProjectStoreConflict();
  }
  async function open() {
    return locked(() => {
      const saved=storage.getItem(key); if(saved!==null) {const document=parse(saved);if(!legacyMatches(storage,document.legacy))throw new ProjectStoreConflict();return {document,raw:saved};}
      const legacy=storage.getItem(STORAGE_KEY); if(legacy===null) return {document:null,raw:null};
      const workspace=parseSavedWorkspace(legacy), legacySnapshot={[STORAGE_KEY]:legacy,[REVISIONS_KEY]:storage.getItem(REVISIONS_KEY)};
      workspace.projects=workspace.projects.map(p=>{const state=readGeometryState(p,storage);Object.assign(legacySnapshot,state.raw);return state.project;});
      const historyRaw=legacySnapshot[REVISIONS_KEY], revisions=historyRaw===null?[]:JSON.parse(historyRaw);
      const document=validateDocument({schema:'hardware-studio-project-store-v2',storeId:crypto.randomUUID(),generation:0,workspace,revisions,legacy:legacySnapshot});
      if(!legacyMatches(storage,legacySnapshot))throw new ProjectStoreConflict();
      const raw=JSON.stringify(document); if(encoder.encode(raw).length>MAX_BYTES)throw new Error('Project store exceeds its size limit.');
      storage.setItem(key,raw); return {document,raw};
    });
  }
  async function commit(expectedRaw, workspace, revisions, guard=null) {
    const capturedWorkspace=structuredClone(workspace), capturedRevisions=structuredClone(revisions);
    return locked(() => {
      const previous=storage.getItem(key); if(previous!==expectedRaw)throw new ProjectStoreConflict();
      if(guard)guard();
      const old=previous===null?null:parse(previous), legacy=old?.legacy??{[STORAGE_KEY]:storage.getItem(STORAGE_KEY),[REVISIONS_KEY]:storage.getItem(REVISIONS_KEY)};
      if(!legacyMatches(storage,legacy))throw new ProjectStoreConflict();
      const generation=old===null?0:old.generation+1;
      const document=validateDocument({schema:'hardware-studio-project-store-v2',storeId:old?.storeId??crypto.randomUUID(),generation,workspace:capturedWorkspace,revisions:capturedRevisions,legacy});
      const raw=JSON.stringify(document);if(encoder.encode(raw).length>MAX_BYTES)throw new Error('Project store exceeds its size limit.');
      storage.setItem(key,raw); return {document,raw};
    });
  }
  async function recover(expectedRaw, legacy, workspace) {
    const captured=structuredClone(workspace), expectedLegacy=structuredClone(legacy);
    return locked(()=>{
      if(storage.getItem(key)!==expectedRaw || !legacyMatches(storage,expectedLegacy))throw new ProjectStoreConflict();
      const document=validateDocument({schema:'hardware-studio-project-store-v2',storeId:crypto.randomUUID(),generation:0,workspace:captured,revisions:[],legacy:expectedLegacy});
      const raw=JSON.stringify(document);if(encoder.encode(raw).length>MAX_BYTES)throw new Error('Project store exceeds its size limit.');
      storage.setItem(key,raw);return {document,raw};
    });
  }
  async function revise(expectedRaw, projectId, nextProject, reason, {restore=false,guard=null}={}) {
    const next = structuredClone(nextProject);
    const prior = parse(expectedRaw);
    const index = prior.workspace.projects.findIndex(p => p.id === projectId);
    if (index < 0 || next.id !== projectId) throw new Error('The selected project is unavailable.');
    const before = prior.workspace.projects[index];
    const replacement = restore ? restoreProjectFromRevision(before, next) : next;
    if (!restore) invalidateManualEdit(before, replacement);
    if (['traySpec','solidSpec','assemblySpec'].some(k=>JSON.stringify(before[k]??null)!==JSON.stringify(replacement[k]??null))) replacement.review={...replacement.review,mechanical:false};
    if (!projectContentChanged(before,replacement)) return locked(() => {
      if (storage.getItem(key)!==expectedRaw || !legacyMatches(storage,prior.legacy)) throw new ProjectStoreConflict();
      if(guard)guard();
      return {document:prior,raw:expectedRaw};
    });
    const revisions = structuredClone(prior.revisions);
    revisions.push({id:crypto.randomUUID(),projectId,at:new Date().toISOString(),reason,snapshot:structuredClone(before)});
    while (revisions.filter(r=>r.projectId===projectId).length>12) revisions.splice(revisions.findIndex(r=>r.projectId===projectId),1);
    prior.workspace.projects[index]=replacement;
    return commit(expectedRaw,prior.workspace,revisions,guard);
  }
  return {open,commit,revise,recover,assertCurrent};
}
