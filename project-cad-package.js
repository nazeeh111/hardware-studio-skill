import {validateTraySpec} from './tray-spec.js';
import {validateSolidSpec,needsCurvedRuntime} from './solid-spec.js?v=3';
import {validateAssemblySpec} from './assembly-spec.js?v=2';

export const PROJECT_CAD_REQUEST_SCHEMA='hardware-studio-project-cad-v1';
export const PROJECT_CAD_SOURCE_MAX_BYTES=12*1024*1024;
export const PROJECT_CAD_RESPONSE_MAX_BYTES=64*1024*1024;
const abortError=()=>new DOMException('Client request cancelled.','AbortError');
const loopback=()=>['localhost','127.0.0.1','[::1]','::1'].includes(globalThis.location?.hostname);
const freeze=(value,seen=new WeakSet())=>{if(value&&typeof value==='object'&&!seen.has(value)){seen.add(value);Object.values(value).forEach(child=>freeze(child,seen));Object.freeze(value);}return value;};
const filename=title=>'hardware-studio-'+(title.normalize('NFKD').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,70).toLowerCase()||'project')+'-checked-cad.zip';
function inspectProject(project){
 if(!project||typeof project!=='object'||typeof project.title!=='string'||!project.title.trim())throw new Error('Choose a named project before exporting checked CAD.');
 let count=0,curved=false;
 if(project.traySpec!=null){validateTraySpec(project.traySpec);count++;}
 if(project.solidSpec!=null){const source=validateSolidSpec(project.solidSpec);curved=needsCurvedRuntime(source);count++;}
 if(project.assemblySpec!=null){const assembly=validateAssemblySpec(project.assemblySpec,{requirePlaced:true});curved=curved||assembly.assets.some(asset=>needsCurvedRuntime(asset.source));count++;}
 if(!count)throw new Error('Add a tray, shared solid or placed assembly before exporting checked CAD.');
 return {title:project.title,curved,count};
}
function signalPromise(promise,signal){
 if(signal.aborted){void Promise.resolve(promise).catch(()=>{});return Promise.reject(signal.reason||abortError());}
 return new Promise((resolve,reject)=>{
  const abort=()=>{signal.removeEventListener('abort',abort);reject(signal.reason||abortError());};
  signal.addEventListener('abort',abort,{once:true});
  Promise.resolve(promise).then(value=>{signal.removeEventListener('abort',abort);resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
 });
}
async function boundedBytes(response,limit,signal){
 const declared=response.headers.get('Content-Length');
 if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>limit))throw new Error('The runtime response exceeds the allowed package size.');
 const reader=response.body?.getReader?.();
 if(!reader)throw new Error('The runtime returned an unreadable package.');
 const chunks=[];let length=0;
 try{
  while(true){const {value,done}=await signalPromise(reader.read(),signal);if(done)break;if(!(value instanceof Uint8Array))throw new Error('The runtime returned unreadable package bytes.');length+=value.byteLength;if(length>limit)throw new Error('The runtime response exceeds the allowed package size.');chunks.push(value);}
 }catch(error){void reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 if(declared!==null&&Number(declared)!==length)throw new Error('The runtime response was truncated.');
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
function zipEnvelope(bytes){
 if(bytes.length<22||bytes[0]!==80||bytes[1]!==75||bytes[2]!==3||bytes[3]!==4)throw new Error('The runtime did not return a complete CAD ZIP.');
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 for(let at=bytes.length-22;at>=Math.max(0,bytes.length-65557);at--){
  if(view.getUint32(at,true)!==0x06054b50||at+22+view.getUint16(at+20,true)!==bytes.length)continue;
  const count=view.getUint16(at+10,true),size=view.getUint32(at+12,true),offset=view.getUint32(at+16,true);
  if(view.getUint16(at+4,true)||view.getUint16(at+6,true)||!count||view.getUint16(at+8,true)!==count||offset+size!==at||offset<30||size<46||view.getUint32(offset,true)!==0x02014b50)break;
  return;
 }
 throw new Error('The runtime did not return a complete CAD ZIP.');
}
function base64(bytes){let text='';for(let at=0;at<bytes.length;at+=32768)text+=String.fromCharCode(...bytes.subarray(at,at+32768));return btoa(text);}

// The controller only captures and downloads. It never saves CAD, modifies a
// workspace or marks a project reviewed. The server performs CAD verification.
export function createProjectCadController({getProject,makeSourceArchive,fetchImpl=globalThis.fetch,download,onChange=()=>{},local=loopback(),cryptoImpl=globalThis.crypto,cloneImpl=structuredClone,timeoutMs=500000,healthTimeoutMs=4000,setTimeoutImpl=setTimeout,clearTimeoutImpl=clearTimeout}={}){
 if(typeof getProject!=='function'||typeof makeSourceArchive!=='function'||typeof download!=='function')throw new Error('Project CAD export needs project, source archive and download callbacks.');
 let runtime={checked:false,ready:false,curved:false},active=null,healthSequence=0,last=null,phase='idle',message=local?'Check the local CAD runtime to build a project package.':'Checked project CAD needs the local studio server. Source export remains available.';
 function current(){try{return {...inspectProject(getProject()),error:null};}catch(error){return {title:null,curved:false,count:0,error:error.message};}}
 function state(){const info=current();return {busy:active!==null,phase,message,runtime:{...runtime},canBuild:!!local&&runtime.ready&&!active&&!info.error&&(!info.curved||runtime.curved),projectTitle:info.title,hasCad:info.count>0,projectError:info.error,last:last?{title:last.title,sourceSha256:last.sourceSha256,filename:last.filename,size:last.blob.size,cadStatus:last.cadStatus}:null};}
 function changed(){try{onChange(state());}catch{/* UI callbacks cannot invalidate completed bytes. */}}
 async function refreshRuntime(){
  const sequence=++healthSequence;
  if(!local){runtime={checked:true,ready:false,curved:false};changed();return false;}
  const controller=new AbortController(),timer=setTimeoutImpl(()=>controller.abort(new DOMException('Health check timed out.','TimeoutError')),healthTimeoutMs);
  let next={checked:true,ready:false,curved:false};
  try{const response=await signalPromise(fetchImpl('./api/health',{cache:'no-store',credentials:'same-origin',redirect:'error',signal:controller.signal}),controller.signal),bytes=await boundedBytes(response,16384,controller.signal),info=JSON.parse(new TextDecoder().decode(bytes));next.ready=response.ok&&info.ok===true&&Array.isArray(info.features)&&info.features.includes('project-cad-package-v1');next.curved=next.ready&&info.features.includes('curved-solid-v1');}catch{}finally{clearTimeoutImpl(timer);}
  if(sequence!==healthSequence)return runtime.ready;
  runtime=next;if(!active){message=next.ready?'Local project CAD runtime ready.':'Project CAD runtime unavailable. Run the current local server; project source is retained.';phase=next.ready?'ready':'unavailable';}changed();return runtime.ready;
 }
 function cancel(){if(!active)return false;const title=active.title;active.controller.abort(abortError());active=null;phase='cancelled';message='Client request cancelled for “'+title+'”. The local server may continue its bounded build. Earlier completed package retained.';changed();return true;}
 async function build(){
  if(active)return false;
  let frozen,info;
  try{if(!local)throw new Error('Checked project CAD needs the local studio server.');if(!runtime.ready)throw new Error('Check the current local project CAD runtime before building.');frozen=freeze(cloneImpl(getProject()));info=inspectProject(frozen);if(info.curved&&!runtime.curved)throw new Error('This project needs the curved CAD runtime. Install it and restart the local server.');}
  catch(error){phase='error';message=error.message;changed();return false;}
  const run={controller:new AbortController(),title:info.title};active=run;phase='building';message='Building checked CAD for “'+run.title+'” from its captured source. Later edits do not change this package.';changed();
  const signal=run.controller.signal,timer=setTimeoutImpl(()=>run.controller.abort(new DOMException('Project CAD request timed out.','TimeoutError')),timeoutMs);
  try{
   const raw=await signalPromise(makeSourceArchive(frozen),signal);
   if(!(raw instanceof Uint8Array)||raw.byteLength===0||raw.byteLength>PROJECT_CAD_SOURCE_MAX_BYTES)throw new Error('Project source ZIP must be nonempty and at most 12 MiB.');
   const source=raw.slice(); // Preserve exact bytes even if an injected exporter reuses its buffer.
   const digest=await signalPromise(cryptoImpl.subtle.digest('SHA-256',source),signal),hash=[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');
   const response=await signalPromise(fetchImpl('./api/project-cad',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',cache:'no-store',redirect:'error',body:JSON.stringify({schema:PROJECT_CAD_REQUEST_SCHEMA,sourceZipBase64:base64(source)}),signal}),signal);
   if(!response.ok){let detail='The project CAD build failed.';try{const error=JSON.parse(new TextDecoder().decode(await boundedBytes(response,16384,signal)));if(typeof error.error==='string')detail=error.error.slice(0,500);}catch{}throw new Error(detail);}
   if(response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/zip')throw new Error('The runtime did not return a CAD ZIP.');
   const cadStatus=response.headers.get('X-Hardware-Studio-CAD-Status');
   if(!['passed','interference'].includes(cadStatus))throw new Error('The runtime did not return a recognized CAD check status.');
   if(response.headers.get('X-Hardware-Studio-Source-SHA256')!==hash)throw new Error('The CAD package source hash does not match the captured source ZIP.');
   const bytes=await boundedBytes(response,PROJECT_CAD_RESPONSE_MAX_BYTES,signal);zipEnvelope(bytes);
   if(active!==run||signal.aborted)return false;
   const completed={title:run.title,sourceSha256:hash,filename:filename(run.title),cadStatus,blob:new Blob([bytes],{type:'application/zip'})};
   last=completed;active=null;phase='complete';message=completed.cadStatus==='interference'?'INTERFERENCE recorded for “'+completed.title+'”. Inspect reports before using geometry.':'Checked CAD package ready for “'+completed.title+'”. Inspect its verification reports; physical fit remains untested.';changed();
   try{await download(completed.filename,completed.blob,'application/zip');}catch{message='Checked package retained for “'+completed.title+'”, but the download could not start. Use Download last package to retry.';changed();}
   return true;
  }catch(error){
   if(active===run){active=null;phase=signal.aborted?(signal.reason?.name==='TimeoutError'?'timeout':'cancelled'):'error';message=phase==='timeout'?'Client request timed out for “'+run.title+'”. The local server may continue its bounded build. Earlier completed package retained.':phase==='cancelled'?'Client request cancelled for “'+run.title+'”. The local server may continue its bounded build. Earlier completed package retained.':'Could not build “'+run.title+'”: '+error.message;changed();}
   return false;
  }finally{clearTimeoutImpl(timer);}
 }
 async function downloadLast(){if(!last)return false;const completed=last;try{await download(completed.filename,completed.blob,'application/zip');return true;}catch{message='The completed package for “'+completed.title+'” is retained, but its download could not start.';changed();return false;}}
 return {state,refreshRuntime,build,cancel,downloadLast};
}
