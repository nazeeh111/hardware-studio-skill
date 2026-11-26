// Canonical project revisions. All participating writers must hold the same
// Web Lock. Legacy source keys remain intact as migration/recovery evidence.
import {STORAGE_KEY,REVISIONS_KEY,parseSavedWorkspace,safeProjectForStorage,projectContentChanged,restoreProjectFromRevision} from './core.js?v=45';
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
export class ProjectIdentityConflict extends Error {
  constructor() { super('Some saved projects share an ID, so this change cannot be assigned safely. Download the backup, then import each original project JSON as its own copy in a separate clean workspace. The original saved workspace is unchanged.'); this.name='ProjectIdentityConflict'; }
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
  async function commit(expectedRaw, workspace, options={}) {
    if(!options || typeof options!=='object' || Array.isArray(options))throw new Error('Project commits require reason and guard options. Reload the current studio.');
    // History retention counts serialized string characters; MAX_BYTES bounds the UTF-8 document separately.
    const {reason='edit',guard=null,historyLimitChars=Infinity}=options;
    if(historyLimitChars!==Infinity && (!Number.isSafeInteger(historyLimitChars)||historyLimitChars<0))throw new Error('Invalid history limit.');
    const capturedWorkspace=structuredClone(workspace);
    return locked(() => {
      const previous=storage.getItem(key); if(previous!==expectedRaw)throw new ProjectStoreConflict();
      if(guard)guard();
      const old=previous===null?null:parse(previous), legacy=old?.legacy??{[STORAGE_KEY]:storage.getItem(STORAGE_KEY),[REVISIONS_KEY]:storage.getItem(REVISIONS_KEY)};
      if(!legacyMatches(storage,legacy))throw new ProjectStoreConflict();
      if(old===null && legacy[STORAGE_KEY]!==null)throw new ProjectStoreConflict();
      const oldProjects=old?.workspace.projects??[],ambiguousIds=new Set();
      for(const id of new Set([...oldProjects,...capturedWorkspace.projects].map(project=>project.id))){
        const before=oldProjects.filter(project=>project.id===id),after=capturedWorkspace.projects.filter(project=>project.id===id);
        if(before.length<2 && after.length<2)continue;
        if(before.length!==after.length || before.some((project,index)=>projectContentChanged(safeProjectForStorage(project),safeProjectForStorage(after[index]))))throw new ProjectIdentityConflict();
        ambiguousIds.add(id);
      }
      const revisions=structuredClone(old?.revisions??[]);
      let checkpoints=0;
      for(const before of oldProjects) {
        if(ambiguousIds.has(before.id))continue;
        const after=capturedWorkspace.projects.find(project=>project.id===before.id);
        if(after && !projectContentChanged(safeProjectForStorage(before),safeProjectForStorage(after)))continue;
        checkpoints++;
        revisions.push({id:crypto.randomUUID(),projectId:before.id,at:new Date().toISOString(),reason:after?reason:'Deleted project',snapshot:structuredClone(before)});
        while(revisions.filter(entry=>entry.projectId===before.id).length>12)revisions.splice(revisions.findIndex(entry=>entry.projectId===before.id),1);
      }
      if(checkpoints){
        while(revisions.length>checkpoints && JSON.stringify(revisions).length>historyLimitChars)revisions.shift();
        if(JSON.stringify(revisions).length>historyLimitChars)throw new Error('Revision exceeds the local history limit.');
      }
      const generation=old===null?0:old.generation+1;
      const document=validateDocument({schema:'hardware-studio-project-store-v2',storeId:old?.storeId??crypto.randomUUID(),generation,workspace:capturedWorkspace,revisions,legacy});
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
    if (!projectContentChanged(safeProjectForStorage(before),safeProjectForStorage(replacement))) return locked(() => {
      if (storage.getItem(key)!==expectedRaw || !legacyMatches(storage,prior.legacy)) throw new ProjectStoreConflict();
      if(guard)guard();
      return {document:prior,raw:expectedRaw};
    });
    prior.workspace.projects[index]=replacement;
    return commit(expectedRaw,prior.workspace,{reason,guard});
  }
  return {open,commit,revise,recover,assertCurrent};
}
