import {validateSolidIntentRequest,solidIntentPrompt,solidIntentSchema,validateSolidIntentResponse} from './solid-intent.js?v=1';
import {boundedModelJson} from './draft-intake.js?v=1';
import {createZip} from './zip.js?v=1';
const ENDPOINT='http://127.0.0.1:11434';
const remote=m=>/cloud/i.test(m.name||'')||!!m.remote_host||!!m.remote_model;
const local=()=>['127.0.0.1','localhost','[::1]'].includes(location.hostname);
const option=(value,label)=>{const node=document.createElement('option');node.value=value;node.textContent=label;return node;};

// All source/project reads and the checked write are supplied by the workbench.
// This controller never writes project records or engineering review marks.
export function installSolidIntent({readState,apply,project,storageKey}){
 const $=id=>document.getElementById('solid-'+id),instruction=$('instruction'),mode=$('mode'),target=$('target'),models=$('model');
 let available=new Map(),controller=null,pending=null,previous=null,retention=true;
 const status=text=>{$('ai-status').textContent=text;};
 function retain(){if(!retention)return;try{sessionStorage.setItem(storageKey,JSON.stringify({instruction:instruction.value,mode:mode.value,target:target.value,model:models.value}));}catch{retention=false;$('intent-retention').textContent='Tab storage unavailable. Copy this request before leaving.';}}
 function context(){
  if(!project)return null;
  const p=project(),part=p.parts.find(p=>p.id===target.value);
  if(!part)throw new Error('Select the part this CAD source should represent. Add it in the studio if needed.');
  return {project:{id:p.id,title:p.title,brief:p.brief,summary:p.summary},target:{id:part.id,name:part.name,category:part.category,detail:part.detail,qty:part.qty}};
 }
 function capture(){
  const state=readState();
  if(state.dirty)throw new Error('Apply or discard unapplied source before requesting or applying a proposal.');
  if(state.blocked)throw new Error('Resolve saved-source recovery before requesting or applying a proposal.');
  if(state.currentRaw!==state.expectedRaw)throw new Error('Saved source changed in another tab. Reload after exporting your work.');
  const request=validateSolidIntentRequest({mode:mode.value,instruction:instruction.value,context:context(),base:state.spec});
  return {request,identity:JSON.stringify({request,model:models.value,project:state.projectSignature,stored:state.expectedRaw})};
 }
 function current(record){try{return capture().identity===record.identity;}catch{return false;}}
 function refresh(){
  $('propose').disabled=!!controller||!local()||!available.has(models.value);
  $('cancel').hidden=!controller;
  $('accept').disabled=!!controller||!pending||pending.output?.status!=='ready'||!current(pending);
  $('stale').hidden=!pending||current(pending);
  $('stale').textContent=pending?.appliedAt?'This proposal was applied. The download retains its original captured input. Request a new proposal for further changes.':'Request, model, target, project or source changed. This captured proposal can be downloaded, but cannot be applied.';
  $('proposal-download').disabled=!pending||!!controller;
  $('propose').textContent=mode.value==='create'?'Propose a new part ↗':'Propose feature edits ↗';
 }
 function render(){
  $('proposal').hidden=!pending;
  if(pending){
   const output=pending.output,waiting=!!controller&&!pending.error;
   $('proposal-heading').textContent=output?.status==='ready'?'Review the complete new source':output?.status==='needs-input'?'Dimensions needed':output?.status==='unsupported'?'Outside the current modeler':waiting?'Request captured / waiting':'No proposal accepted';
   $('assumptions').textContent=output?(output.missing.length?'Open questions: '+output.missing.join('; '):'No missing input reported. Check every dimension against your request.')+(output.assumptions.length?' Model assumptions: '+output.assumptions.join('; '):' No assumptions listed.'):(pending.error||(waiting?'The local model is working on this captured input. Current source is retained.':'The request did not complete.'));
   $('proposed-source').textContent=output?.spec?JSON.stringify(output.spec,null,2):'No CAD source accepted.';
   $('accept').hidden=output?.status!=='ready';
  }
  $('earlier-proposal').hidden=!previous;
  refresh();
 }
 async function identity(model,signal){
  const response=await fetch(ENDPOINT+'/api/tags',{signal});if(!response.ok)throw new Error('Could not confirm the local model.');
  const data=await boundedModelJson(response,100000),found=data.models?.find(m=>m.name===model.name);
  if(!found||remote(found)||found.digest!==model.digest)throw new Error('Model identity changed. Reload model choices before trying again.');
 }
 async function discover(){
  models.replaceChildren();if(!local()){models.append(option('','Local version required'));status('Open the local modeler to use installed Ollama models. Source import, editing and export work here.');refresh();return;}
  try{
   const response=await fetch(ENDPOINT+'/api/tags',{signal:AbortSignal.timeout(5000)});if(!response.ok)throw new Error();
   const data=await boundedModelJson(response,100000);
   for(const model of (data.models||[]).filter(m=>typeof m.name==='string'&&m.name.length<=200&&!remote(m)&&m.size>0&&/^[0-9a-f]{64}$/i.test(m.digest||'')).sort((a,b)=>a.size-b.size)){available.set(model.name,model);models.append(option(model.name,model.name));}
   if(!available.size)throw new Error();
   if(available.has(restored?.model))models.value=restored.model;else if(available.has('qwen3-vl:4b-instruct'))models.value='qwen3-vl:4b-instruct';
   status('Local model ready. Input rules do not verify design intent or generated geometry.');
  }catch{status('Local Ollama unavailable. Import a source or use an explicit example.');}
  refresh();
 }
 let restored=null;
 try{const raw=sessionStorage.getItem(storageKey);if(raw!==null){if(raw.length>12000)throw new Error();restored=JSON.parse(raw);if(typeof restored.instruction!=='string'||restored.instruction.length>2000||!['create','edit'].includes(restored.mode))throw new Error();instruction.value=restored.instruction;mode.value=restored.mode;}}
 catch{retention=false;$('intent-retention').textContent='The retained request could not be read. It has not been replaced; new text stays in memory.';}
 try{
  const state=readState();if(!restored)mode.value=state.spec?'edit':'create';
  $('target-field').hidden=!project;
  if(project){target.append(option('','Choose a project part'));for(const part of project().parts)target.append(option(part.id,part.name));if(restored?.target&&[...target.options].some(o=>o.value===restored.target))target.value=restored.target;}
 }catch(error){status(error.message);}
 for(const node of [instruction,mode,target,models])node.addEventListener(node===instruction?'input':'change',()=>{retain();refresh();});
 $('propose').addEventListener('click',async()=>{
  if(controller||!local()||!available.has(models.value))return;
  let captured;try{captured=capture();}catch(error){status(error.message);return;}
  const model=available.get(models.value),active=new AbortController();controller=active;const timer=setTimeout(()=>active.abort(),300000);retain();
  const attempt={schema:'hardware-studio-solid-intent-v1',request:captured.request,identity:captured.identity,model:{name:model.name,digest:model.digest},capturedAt:new Date().toISOString(),output:null,rawResponse:null,error:null};
  // Keep a completed proposal downloadable through failed or cancelled retries.
  if(pending?.output)previous=pending;
  pending=attempt;render();status('Proposing '+(mode.value==='create'?'a new part from the captured request':'edits to the captured source')+'… Cancel is available.');
  try{
   const show=await fetch(ENDPOINT+'/api/show',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:model.name}),signal:active.signal});
   if(!show.ok)throw new Error('The local model could not be inspected.');
   const info=await boundedModelJson(show,1000000);if(remote(info))throw new Error('Cloud-backed models are excluded. Select an installed local model.');
   await identity(model,active.signal);
   const response=await fetch(ENDPOINT+'/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},signal:active.signal,body:JSON.stringify({model:model.name,stream:false,think:false,format:solidIntentSchema(),prompt:solidIntentPrompt(captured.request),options:{temperature:0,num_ctx:16384,num_predict:4500}})});
   if(!response.ok)throw new Error('Local CAD request failed.');
   const data=await boundedModelJson(response,150000);attempt.rawResponse={model:data.model,done:data.done,done_reason:data.done_reason,response:data.response,total_duration:data.total_duration,eval_count:data.eval_count};
   if(data.model!==model.name||data.done!==true||data.done_reason==='length'||typeof data.response!=='string'||data.response.length>65000)throw new Error('No complete bounded response returned by the selected model.');
   const output=validateSolidIntentResponse(captured.request,JSON.parse(data.response));
   await identity(model,active.signal);if(active.signal.aborted)throw new DOMException('Cancelled','AbortError');
   attempt.output=output;attempt.model.identityCheckedBeforeAndAfter=true;attempt.completedAt=new Date().toISOString();
   status(output.status==='ready'?'Proposal ready for source review. Build and inspect the shape after applying.':output.status==='needs-input'?'Supply the missing dimensions, then request again. Current source retained.':'The requested geometry is unsupported. Current source retained.');
  }catch(error){attempt.error=error.name==='AbortError'?'Cancelled or timed out. No source applied.':error.message;status(attempt.error);}
  finally{clearTimeout(timer);controller=null;render();}
 });
 $('cancel').addEventListener('click',()=>controller?.abort());
 $('discard').addEventListener('click',()=>{if(controller)return;pending=null;render();status('Proposal discarded. Current source retained.');});
 $('accept').addEventListener('click',()=>{
  if(controller||!pending||pending.output?.status!=='ready')return;
  try{if(!current(pending))throw new Error('Request, model, target, project or source changed. Request a fresh proposal.');apply(pending.output.spec);pending.appliedAt=new Date().toISOString();refresh();status('Proposed source saved. Generate CAD to check geometry. The selected part is request context, not an assembly binding.');}
  catch(error){status(error.message);refresh();}
 });
 function download(record,name){
  if(!record)return;
  // The private identity includes a full selected-project signature for stale
  // checks. Export only the explicitly captured, bounded design context.
  const {identity,...report}=record;
  const entries=[{name:'proposal.json',data:JSON.stringify(report,null,2)+'\n'},{name:'README.txt',data:'Local model proposal, not verified CAD. request retains the project brief and selected target part. It is context only: the project still has one shared solid source and no solved assembly or per-part CAD binding. Model text is untrusted. Review dimensions, apply explicitly, then generate and inspect a separate checked CAD package. No engineering evidence or review marks are set.\n'}];
  if(report.request.base)entries.push({name:'before-source.json',data:JSON.stringify(report.request.base,null,2)+'\n'});
  if(report.output?.spec)entries.push({name:'proposed-source.json',data:JSON.stringify(report.output.spec,null,2)+'\n'});
  const url=URL.createObjectURL(new Blob([createZip(entries)],{type:'application/zip'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
 }
 $('proposal-download').addEventListener('click',()=>{if(!controller)download(pending,'hardware-studio-cad-proposal.zip');});
 $('earlier-download').addEventListener('click',()=>download(previous,'hardware-studio-earlier-cad-proposal.zip'));
 addEventListener('storage',refresh);
 void discover();refresh();
 return {refresh};
}
