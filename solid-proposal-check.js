import {validateSolidSpec} from './solid-spec.js?v=3';
import {solidMeshes} from './solid-preview.js?v=5';

export const SOLID_PROPOSAL_CHECK_SCHEMA='hardware-studio-solid-proposal-check-v1';
export const SOLID_PROPOSAL_SOURCE_MAX_BYTES=65536;
export const SOLID_PROPOSAL_RESPONSE_MAX_BYTES=32*1024*1024;
export const SOLID_PROPOSAL_ERROR_MAX_BYTES=16384;
export const SOLID_PROPOSAL_CHECK_TIMEOUT_MS=130000;
const encoder=new TextEncoder(),records=new WeakMap();
const loopback=()=>['localhost','127.0.0.1','[::1]','::1'].includes(globalThis.location?.hostname);
const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const limits=freeze({stepAvailable:false,stlAvailable:true,rawMeshAvailable:false,physicalValidation:false,semanticIntentValidation:false,browserCheck:'Source equality, declared CAD checks and STL hash/dimensions/triangle readback. Native topology and sampled STEP checks are verifier reports, not recomputed in the browser.'});
const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
const reason=(code,message)=>Object.assign(new Error(message),{checkCode:code});
function raced(promise,signal,onLate){
 return new Promise((resolve,reject)=>{
  let settled=false;
  const abort=()=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);reject(signal.reason);};
  if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
  Promise.resolve(promise).then(value=>{if(settled){try{onLate?.(value);}catch{}return;}settled=true;signal.removeEventListener('abort',abort);resolve(value);},error=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);reject(error);});
 });
}
async function bounded(response,limit,signal){
 const declared=response.headers?.get('Content-Length');
 if(declared!=null&&(!/^\d+$/.test(declared)||Number(declared)>limit))throw reason('invalid-response','CAD response exceeds its allowed size.');
 const reader=response.body?.getReader?.();if(!reader)throw reason('invalid-response','CAD response body is unreadable.');
 let length=0;const chunks=[];
 try{while(true){const {done,value}=await raced(reader.read(),signal);if(done)break;if(!(value instanceof Uint8Array))throw reason('invalid-response','CAD response contains unreadable bytes.');length+=value.byteLength;if(length>limit)throw reason('invalid-response','CAD response exceeds its allowed size.');chunks.push(value);}}
 catch(error){try{void Promise.resolve(reader.cancel()).catch(()=>{});}catch{}throw error;}
 finally{try{reader.releaseLock();}catch{}}
 if(declared!=null&&Number(declared)!==length)throw reason('invalid-response','CAD response was truncated.');
 const bytes=new Uint8Array(length);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}return bytes;
}
function makeRecord(spec,receipt,response,bytes,sourceJson,responseBytes=null){
 const stored=bytes?.slice()||null;
 const record=Object.freeze({spec:spec?freeze(spec):null,receipt:freeze(receipt),response:response?freeze(response):null,get stlBytes(){return stored?.slice()||null;}});
 records.set(record,{sourceJson,bytes:stored,responseBytes:responseBytes?.slice()||null});return record;
}
export class SolidProposalCheckError extends Error{
 constructor(code,message,record){super(message);this.name='SolidProposalCheckError';this.code=code;this.record=record;}
}

// Checks one captured source. No workspace, model, storage or filesystem writes.
// A pass proves the bounded geometry checks below, not design intent or physical fit.
export async function checkSolidProposal(input,{signal,fetchImpl=globalThis.fetch,timeoutMs=SOLID_PROPOSAL_CHECK_TIMEOUT_MS,local=loopback()}={}){
 const startedAt=new Date().toISOString();let spec=null,sourceJson=null,sourceSha256=null,sourceBytes=0,httpStatus=null,responseSha256=null;
 let title=typeof input?.title==='string'?input.title.slice(0,120):'Untitled proposal';
 const controller=new AbortController();
 const cancelled=()=>controller.abort(reason('cancelled','Geometry check cancelled. The local server may continue its bounded build.'));
 let timer,response;
 try{
  try{spec=freeze(validateSolidSpec(input));sourceJson=JSON.stringify(spec);sourceBytes=encoder.encode(sourceJson).byteLength;title=spec.title;if(sourceBytes>SOLID_PROPOSAL_SOURCE_MAX_BYTES){spec=null;sourceJson=null;throw new Error('Captured source exceeds 64 KiB.');}}
  catch(error){throw reason('invalid-source',error.message||'Invalid captured CAD source.');}
  if(!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>SOLID_PROPOSAL_CHECK_TIMEOUT_MS)throw reason('invalid-source','Geometry check deadline must be greater than zero and at most 130000 ms.');
  if(signal?.aborted)cancelled();else signal?.addEventListener('abort',cancelled,{once:true});
  timer=setTimeout(()=>controller.abort(reason('timeout','Geometry check timed out. The local server may continue its bounded build.')),timeoutMs);
  // Hash the exact bounded JSON submitted below, including normalization defaults.
  sourceSha256=await raced(digest(encoder.encode(sourceJson)),controller.signal);
  if(!local)throw reason('unavailable','Geometry checks need the local studio server. Captured source is retained.');
  if(controller.signal.aborted)throw controller.signal.reason;
  try{response=await raced(fetchImpl('./api/solid-preview',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',cache:'no-store',redirect:'error',body:sourceJson,signal:controller.signal}),controller.signal,value=>{try{void Promise.resolve(value.body?.cancel?.()).catch(()=>{});}catch{}});}
  catch(error){if(controller.signal.aborted)throw controller.signal.reason;throw reason('unavailable',error.message||'Local CAD runtime unavailable.');}
  httpStatus=response.status;
  if(!response.ok){
   let message=response.status===422?'Captured CAD source was rejected by the local geometry build.':'Local CAD runtime did not complete the geometry check.';
   try{const raw=await bounded(response,SOLID_PROPOSAL_ERROR_MAX_BYTES,controller.signal),body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));if(typeof body.error==='string'&&body.error.trim())message=body.error.slice(0,1000);}
   catch(error){if(controller.signal.aborted)throw controller.signal.reason;}
   throw reason(response.status===422?'rejected':'unavailable',message);
  }
  if(response.headers?.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw reason('invalid-response','CAD runtime did not return a JSON preview.');
  let payload,responseBytes;
  try{responseBytes=await bounded(response,SOLID_PROPOSAL_RESPONSE_MAX_BYTES,controller.signal);payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(responseBytes));}
  catch(error){if(controller.signal.aborted)throw controller.signal.reason;throw reason('invalid-response',error.message||'CAD preview JSON is invalid.');}
  // Use the production viewer validator; do not create a weaker proposal check.
  let meshes;
  try{meshes=await raced(solidMeshes(payload,spec),controller.signal);}
  catch(error){if(controller.signal.aborted)throw controller.signal.reason;throw reason('invalid-response',error.message||'CAD preview failed production readback.');}
  const bytes=Uint8Array.from(atob(payload.meshes[0].dataBase64),c=>c.charCodeAt(0));
  responseSha256=await raced(digest(responseBytes),controller.signal);
  if(controller.signal.aborted)throw controller.signal.reason;
  const mesh=meshes[0];
  return makeRecord(spec,{schema:SOLID_PROPOSAL_CHECK_SCHEMA,status:'passed',code:'passed',title,sourceSha256,sourceBytes,startedAt,completedAt:new Date().toISOString(),endpoint:'./api/solid-preview',httpStatus,responseSha256,stlSha256:payload.verification.sha256['solid.stl'],stlBytes:bytes.length,error:null,checks:{triangles:mesh.triangles,min:mesh.min,max:mesh.max,volumeMm3:payload.verification.volume_mm3,probes:payload.verification.probes.length},limits},payload,bytes,sourceJson,responseBytes);
 }catch(error){
  const code=controller.signal.aborted?controller.signal.reason.checkCode:error.checkCode||'invalid-response';
  const message=controller.signal.aborted?controller.signal.reason.message:error.message||'Geometry check did not complete.';
  // A terminal failure must also stop an unread response body. Do not await
  // cancellation: an injected or stalled producer may never settle its promise.
  controller.abort(reason(code,message));
  try{void Promise.resolve(response?.body?.cancel?.()).catch(()=>{});}catch{}
  const record=makeRecord(spec,{schema:SOLID_PROPOSAL_CHECK_SCHEMA,status:code==='rejected'?'rejected':'not-run',code,title,sourceSha256,sourceBytes,startedAt,completedAt:new Date().toISOString(),endpoint:'./api/solid-preview',httpStatus,responseSha256,stlSha256:null,stlBytes:0,error:message,checks:null,limits:{...limits,stlAvailable:false}},null,null,sourceJson);
  throw new SolidProposalCheckError(code,message,record);
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',cancelled);}
}

// Entries fit the existing createZip API. Each call gives new binary bytes.
export function proposalCheckEntries(record){
 const stored=records.get(record);if(!stored)throw new Error('Geometry evidence needs a checker-created record.');
 const entries=[{name:'check.json',data:JSON.stringify(record.receipt,null,2)+'\n'}];
 if(stored.sourceJson!==null)entries.unshift({name:'source.json',data:stored.sourceJson});
 if(record.receipt.status==='passed')entries.push({name:'response.json',data:stored.responseBytes.slice()},{name:'solid.stl',data:stored.bytes.slice()});
 entries.push({name:'README.txt',data:'Captured proposal geometry evidence. source.json is the captured normalized JSON prepared for submission to the local CAD runtime. check.json records its SHA-256 when hashing completed and an HTTP status when a response was received. A source file or hash alone does not prove that a request was sent; public, unavailable or cancelled attempts may never reach the runtime. On pass, response.json preserves the original bounded HTTP response bytes, and solid.stl contains its verified mesh bytes. No STEP or raw pre-normalization STL file is supplied by this preview endpoint. Browser checks validate source equality, hashes, probes and mesh dimensions/triangle counts, plus the declared native sampled STEP readback report. This does not verify design intent, physical fit, manufacturability or electrical safety. A failed or cancelled attempt has no verified mesh. Later workspace edits do not change this capture.\n'});
 return entries;
}
