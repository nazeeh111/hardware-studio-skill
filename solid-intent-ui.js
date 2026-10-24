import {validateSolidIntentRequest,solidIntentPrompt,solidIntentSchema,validateSolidIntentResponse} from './solid-intent.js?v=2';
import {boundedModelJson} from './draft-intake.js?v=1';
import {createZip} from './zip.js?v=1';
import {checkSolidProposal,proposalCheckEntries} from './solid-proposal-check.js?v=2';
const ENDPOINT='http://127.0.0.1:11434';
const remote=m=>/cloud/i.test(m.name||'')||!!m.remote_host||!!m.remote_model;
const local=()=>['127.0.0.1','localhost','[::1]'].includes(location.hostname);
const option=(value,label)=>{const node=document.createElement('option');node.value=value;node.textContent=label;return node;};

// All source/project reads and the checked write are supplied by the workbench.
// This controller never writes project records or engineering review marks.
export function installSolidIntent({readState,apply,project,storageKey,boundPartId=null,checkProposal=checkSolidProposal,fetchImpl=(...args)=>fetch(...args)}){
 const $=id=>document.getElementById('solid-'+id),instruction=$('instruction'),mode=$('mode'),target=$('target'),models=$('model');
 let available=new Map(),controller=null,pending=null,previous=null,retention=true,checking=null;
 const status=text=>{$('ai-status').textContent=text;};
 function retain(){if(!retention)return;try{sessionStorage.setItem(storageKey,JSON.stringify({instruction:instruction.value,mode:mode.value,target:target.value,model:models.value}));}catch{retention=false;$('intent-retention').textContent='Tab storage unavailable. Copy this request before leaving.';}}
 function context(){
  if(!project)return null;
  const p=project(),matches=p.parts.filter(part=>part.id===(boundPartId||target.value));
  if(!matches.length)throw new Error('Select the part this CAD source should represent. Add it in the studio if needed.');
  if(matches.length!==1)throw new Error('The target part ID is duplicated. Resolve duplicate part IDs in the studio before requesting or applying CAD.');
  const [part]=matches;
  return {project:{id:p.id,title:p.title,brief:p.brief,summary:p.summary},target:{id:part.id,name:part.name,category:part.category,detail:part.detail,qty:part.qty}};
 }
 function capture(){
  const state=readState();
  if(state.contextError)throw new Error(state.contextError);
  if(state.dirty)throw new Error('Apply or discard unapplied source before requesting or applying a proposal.');
  if(state.blocked)throw new Error('Resolve saved-source recovery before requesting or applying a proposal.');
  if(state.currentRaw!==state.expectedRaw)throw new Error('Saved source changed in another tab. Reload after exporting your work.');
  const request=validateSolidIntentRequest({mode:mode.value,instruction:instruction.value,context:context(),base:state.spec});
  return {request,identity:JSON.stringify({request,model:models.value,project:state.projectSignature,stored:state.expectedRaw})};
 }
 function current(record){try{return capture().identity===record.identity;}catch{return false;}}
 function refresh(){
  $('propose').disabled=!!controller||!!checking||!local()||!available.has(models.value);
  $('cancel').hidden=!controller;
  $('accept').disabled=!!controller||!!checking||!pending||pending.output?.status!=='ready'||!current(pending);
  $('stale').hidden=!pending||current(pending);
  $('stale').textContent=pending?.appliedAt?'This proposal was applied. The download retains its original captured input. Request a new proposal for further changes.':'Request, model, target, project or source changed. This captured proposal can be downloaded, but cannot be applied.';
  $('proposal-download').disabled=!pending||!!controller||!!checking;
  $('discard').disabled=!!controller||!!checking;
  $('check').disabled=!!controller||!!checking||!local()||!pending||pending.output?.status!=='ready'||!current(pending);
  $('check-cancel').hidden=!checking;
  $('accept').textContent=!checking&&current(pending)&&pending?.geometryChecks?.at(-1)?.result?.receipt?.status==='passed'?'Apply proposed source':'Apply unchecked source';
  renderChecks();
  $('propose').textContent=mode.value==='create'?'Propose a new part ↗':'Propose feature edits ↗';
 }
 function renderChecks(){
  const attempts=pending?.geometryChecks||[],latest=attempts.at(-1),passed=attempts.findLast(attempt=>attempt.result?.receipt?.status==='passed');
  let message=!local()?'Geometry checks require the local CAD server. This public page does not contact local services.':'Optional: build and reopen the captured proposed source before applying it.';
  if(checking)message='Building captured proposed geometry… No source or review mark is being saved. Cancel stops waiting; the bounded server build may continue.';
  else if(latest)message=latest.result?.receipt?.status==='passed'?'Geometry check passed for this captured source.':(latest.result?.receipt?.status==='rejected'?'Geometry check failed: ':'Geometry check did not complete: ')+(latest.result?.receipt?.error||latest.error||'No verified geometry returned.')+' Current source is retained.';
  if(latest?.staleAtCompletion)message+=' Request, model, target, project or source changed during this check. This proposal cannot be applied.';
  $('check-status').textContent=message;
  $('check-status').className='check-result'+(!checking&&latest&&latest.result?.receipt?.status!=='passed'?' check-result-error':'');
  const receipt=passed?.result?.receipt,checks=receipt?.checks;
  const number=value=>Number(value).toLocaleString(undefined,{maximumFractionDigits:3});
  const dimensions=checks?.min?.length===3&&checks?.max?.length===3?checks.max.map((value,index)=>number(value-checks.min[index])).join(' × '):'—';
  $('check-summary').textContent=passed?(latest!==passed?'Earlier successful check retained. Figures below describe that capture.':'Geometry recorded for the captured proposed source.'):'';
  $('check-summary').hidden=!passed;
  $('check-stats').hidden=!checks;
  $('check-span').textContent=checks?dimensions:'—';
  $('check-volume').textContent=checks?number(checks.volumeMm3):'—';
  $('check-triangles').textContent=checks?number(checks.triangles):'—';
  const captured=passed||latest,capturedReceipt=captured?.result?.receipt;
  $('check-details').hidden=!captured;
  $('check-capture').textContent=captured?(passed&&latest!==passed?'Earlier successful check':'Check')+' captured '+new Date(captured.startedAt).toLocaleString()+'. Download the proposal ZIP to retain the exact source, model request and check evidence.':'';
  $('check-hash').textContent=capturedReceipt?.sourceSha256||'Source hash unavailable for this attempt.';

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
  const response=await fetchImpl(ENDPOINT+'/api/tags',{signal});if(!response.ok)throw new Error('Could not confirm the local model.');
  const data=await boundedModelJson(response,100000),found=data.models?.find(m=>m.name===model.name);
  if(!found||remote(found)||found.digest!==model.digest)throw new Error('Model identity changed. Reload model choices before trying again.');
 }
 async function discover(){
  models.replaceChildren();if(!local()){models.append(option('','Local version required'));status('Open the local modeler to use installed Ollama models. Source import, editing and export work here.');refresh();return;}
  try{
   const response=await fetchImpl(ENDPOINT+'/api/tags',{signal:AbortSignal.timeout(5000)});if(!response.ok)throw new Error();
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
  const state=readState();if(!restored||(boundPartId&&!state.spec))mode.value=state.spec?'edit':'create';
  $('target-field').hidden=!project;
  if(project){
   if(boundPartId){const matches=project().parts.filter(part=>part.id===boundPartId);if(matches.length!==1)throw new Error('The bound project part must have exactly one matching ID. Resolve missing or duplicate part IDs in the studio.');const [part]=matches;target.append(option(part.id,part.name+' / CAD attachment'));target.value=part.id;target.disabled=true;}
   else{target.append(option('','Choose a project part'));for(const part of project().parts)target.append(option(part.id,part.name));if(restored?.target&&[...target.options].some(o=>o.value===restored.target))target.value=restored.target;}
  }
 }catch(error){status(error.message);}
 for(const node of [instruction,mode,target,models])node.addEventListener(node===instruction?'input':'change',()=>{retain();refresh();});
 $('propose').addEventListener('click',async()=>{
  if(controller||checking||!local()||!available.has(models.value))return;
  let captured;try{captured=capture();}catch(error){status(error.message);return;}
  const model=available.get(models.value),active=new AbortController();controller=active;const timer=setTimeout(()=>active.abort(),300000);retain();
  const attempt={schema:'hardware-studio-solid-intent-v1',request:captured.request,identity:captured.identity,model:{name:model.name,digest:model.digest},capturedAt:new Date().toISOString(),output:null,rawResponse:null,error:null,...(boundPartId?{binding:{kind:'assembly-part',projectId:captured.request.context.project.id,partId:boundPartId}}:{})};
  // Keep a completed proposal downloadable through failed or cancelled retries.
  if(pending?.output)previous=pending;
  pending=attempt;render();status('Proposing '+(mode.value==='create'?'a new part from the captured request':'edits to the captured source')+'… Cancel is available.');
  try{
   const show=await fetchImpl(ENDPOINT+'/api/show',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:model.name}),signal:active.signal});
   if(!show.ok)throw new Error('The local model could not be inspected.');
   const info=await boundedModelJson(show,1000000);if(remote(info))throw new Error('Cloud-backed models are excluded. Select an installed local model.');
   await identity(model,active.signal);
   const response=await fetchImpl(ENDPOINT+'/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},signal:active.signal,body:JSON.stringify({model:model.name,stream:false,think:false,format:solidIntentSchema(),prompt:solidIntentPrompt(captured.request),options:{temperature:0,num_ctx:16384,num_predict:4500}})});
   if(!response.ok)throw new Error('Local CAD request failed.');
   const data=await boundedModelJson(response,150000);attempt.rawResponse={model:data.model,done:data.done,done_reason:data.done_reason,response:data.response,total_duration:data.total_duration,eval_count:data.eval_count};
   if(data.model!==model.name||data.done!==true||data.done_reason==='length'||typeof data.response!=='string'||data.response.length>65000)throw new Error('No complete bounded response returned by the selected model.');
   const output=validateSolidIntentResponse(captured.request,JSON.parse(data.response));
   await identity(model,active.signal);if(active.signal.aborted)throw new DOMException('Cancelled','AbortError');
   attempt.output=output;attempt.model.identityCheckedBeforeAndAfter=true;attempt.completedAt=new Date().toISOString();
   status(output.status==='ready'?'Proposal ready for source review. Optionally check its geometry before applying.':output.status==='needs-input'?'Supply the missing dimensions, then request again. Current source retained.':'The requested geometry is unsupported. Current source retained.');
  }catch(error){attempt.error=error.name==='AbortError'?'Cancelled or timed out. No source applied.':error.message;status(attempt.error);}
  finally{clearTimeout(timer);controller=null;render();}
 });
 $('cancel').addEventListener('click',()=>controller?.abort());
 $('discard').addEventListener('click',()=>{if(controller||checking)return;pending=null;render();status('Proposal discarded. Current source retained.');});
 $('accept').addEventListener('click',()=>{
  if(controller||checking||!pending||pending.output?.status!=='ready')return;
  try{if(!current(pending))throw new Error('Request, model, target, project or source changed. Request a fresh proposal.');apply(pending.output.spec);pending.appliedAt=new Date().toISOString();refresh();status(boundPartId?'Proposed source saved for the bound assembly part. Other sources and placements were retained. Generate CAD to check geometry.':'Proposed source saved. Generate CAD to check geometry. The selected part is request context, not an assembly binding.');}
  catch(error){status(error.message);refresh();}
 });
 $('check').addEventListener('click',async()=>{
  if(controller||checking||!local()||!pending||pending.output?.status!=='ready')return;
  const record=pending;
  if(!current(record)){status('Request, model, target, project or source changed. Request a fresh proposal.');refresh();return;}
  const capturedSpec=structuredClone(record.output.spec),active=new AbortController(),attempt={startedAt:new Date().toISOString(),result:null,error:null,staleAtCompletion:false};
  // Keep only the latest attempt and the most recent successful capture.
  const lastPassed=record.geometryChecks?.findLast(item=>item.result?.receipt?.status==='passed');
  record.geometryChecks=[...(lastPassed?[lastPassed]:[]),attempt];checking=active;refresh();
  try{attempt.result=await checkProposal(capturedSpec,{signal:active.signal,fetchImpl,local:local()});}
  catch(error){attempt.result=error.record||null;attempt.error=error.message||'Geometry check failed. Current source retained.';}
  finally{attempt.completedAt=new Date().toISOString();attempt.staleAtCompletion=!current(record);if(attempt.result?.receipt?.status==='passed')record.geometryChecks=[attempt];checking=null;render();}
 });
 $('check-cancel').addEventListener('click',()=>checking?.abort());
 function download(record,name){
  if(!record)return;
  // The private identity includes a full selected-project signature for stale
  // checks. Export only the explicitly captured, bounded design context.
  const {identity,geometryChecks,...report}=record;
  report.geometryChecks=(geometryChecks||[]).map((attempt,index)=>({entry:'geometry-checks/attempt-'+(index+1)+'/',startedAt:attempt.startedAt,completedAt:attempt.completedAt,staleAtCompletion:attempt.staleAtCompletion,status:attempt.result?.receipt?.status||'not-run',error:attempt.error}));
  const scope=boundPartId?'The captured target identifies the bound assembly part. Applying replaces only that part source, preserving other sources and placements. This ZIP does not prove the proposal was applied. Any geometry check is scoped to its captured source.':'It is context only: the project still has one shared solid source and no solved assembly or per-part CAD binding.';
  const entries=[{name:'proposal.json',data:JSON.stringify(report,null,2)+'\n'},{name:'README.txt',data:'Local model proposal with optional captured geometry checks. The request retains the project brief and selected target part. '+scope+' Model text is untrusted. Review dimensions and optional geometry reports, then apply explicitly. A geometry pass does not establish design intent, fit, strength or physical readiness. No engineering evidence or review marks are set.\n'}];
  for(const [index,attempt]of (geometryChecks||[]).entries()){
   const folder='geometry-checks/attempt-'+(index+1)+'/';
   const binding={proposalCapturedAt:report.capturedAt,request:report.request,model:report.model,binding:report.binding||null,startedAt:attempt.startedAt,completedAt:attempt.completedAt,staleAtCompletion:attempt.staleAtCompletion};
   entries.push({name:folder+'proposal-binding.json',data:JSON.stringify(binding,null,2)+'\n'});
   if(attempt.result)for(const {name,data}of proposalCheckEntries(attempt.result))entries.push({name:folder+name,data});
   else entries.push({name:folder+'check.json',data:JSON.stringify({status:'not-run',error:attempt.error},null,2)+'\n'});
  }
  if(report.request.base)entries.push({name:'before-source.json',data:JSON.stringify(report.request.base,null,2)+'\n'});
  if(report.output?.spec)entries.push({name:'proposed-source.json',data:JSON.stringify(report.output.spec,null,2)+'\n'});
  const url=URL.createObjectURL(new Blob([createZip(entries)],{type:'application/zip'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
 }
 $('proposal-download').addEventListener('click',()=>{if(!controller&&!checking)download(pending,'hardware-studio-cad-proposal.zip');});
 $('earlier-download').addEventListener('click',()=>download(previous,'hardware-studio-earlier-cad-proposal.zip'));
 addEventListener('storage',refresh);
 void discover();refresh();
 return {refresh};
}
