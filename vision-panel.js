import { parseVisionRequirements, visionObservationSchema, visionObservationPrompt, validateVisionObservations } from './vision-observation.js?v=1';
import { boundedModelJson } from './draft-intake.js?v=1';
import { createZip } from './zip.js?v=1';
const ENDPOINT='http://127.0.0.1:11434',REQUEST_KEY='hardware-studio-vision-request-v1';
const localPage=()=>['127.0.0.1','localhost','[::1]'].includes(location.hostname);
const remoteModel=model=>/cloud/i.test(model.name||'')||!!model.remote_host||!!model.remote_model;
const encode=bytes=>{let value='';for(let i=0;i<bytes.length;i+=8192)value+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(value);};
function element(tag,text,className){const node=document.createElement(tag);node.textContent=text;if(className)node.className=className;return node;}
export function installVisionPanel({capture,viewerVersion,hasGeometry}){
  const $=id=>document.getElementById('vision-'+id),features=$('features'),models=$('model');
  let available=new Map(),controller=null,record=null,snapshot=null,rawResponse=null,previous=null,storageReady=true;
  const status=text=>{$('status').textContent=text;};
  try{const text=sessionStorage.getItem(REQUEST_KEY);if(text!==null){features.value=text; if(text.length>1600){storageReady=false;$('retention').textContent='The retained request exceeds this editor’s limit. It is shown intact; shorten it or copy it before leaving. New text will stay in memory.';}}}
  catch{storageReady=false;$('retention').textContent='Tab storage unavailable. Keep a copy of this request before leaving.';}
  function retain(){if(!storageReady)return;try{sessionStorage.setItem(REQUEST_KEY,features.value);}catch{storageReady=false;$('retention').textContent='The request stays in memory, but tab storage could not be written. Copy it before leaving.';}}
  function context(){return {request:features.value,model:models.value,viewerVersion:viewerVersion()};}
  function current(){return !record||JSON.stringify(context())===JSON.stringify(record.context);}
  function refresh(){
    $('observe').disabled=!!controller||!localPage()||!available.has(models.value)||!hasGeometry();
    $('stale').hidden=!record||current();
    $('download').disabled=!record||!!controller;
  }
  function renderRecord(box,record){
    box.replaceChildren();if(!record)return;
    const head=element('div','', 'vision-record-head');head.append(element('b',record.status==='observations'?'MODEL OBSERVATIONS / UNVERIFIED':record.status==='pending'?'CAPTURED / WAITING FOR LOCAL MODEL':'NOT RUN / NO OBSERVATIONS'),element('span',record.model.name+' · '+record.capturedAt));box.append(head);
    if(record.status!=='observations'){box.append(element('p',record.status==='pending'?'The input image and request are captured. No observations have been accepted.':record.error,'vision-empty'));}
    else for(const observation of record.observations){const item=element('article','', 'vision-observation');const requirement=record.requirements.find(r=>r.id===observation.id);item.append(element('span',{'visible':'MODEL SAYS VISIBLE','not-visible':'MODEL SAYS NOT VISIBLE','unclear':'MODEL IS UNCERTAIN'}[observation.state]),element('h3',requirement.text),element('small',observation.views.length?'CITED VIEWS / '+observation.views.join(', '):'NO VIEW CITED'),element('p',observation.detail));box.append(item);}
    box.append(element('p','Model observations are unverified. Exact dimensions, hidden features and physical engineering need independent checks.','tool-note'));
  }
  function render(){
    renderRecord($('result'),record);
    $('earlier').hidden=!previous;
    if(previous){renderRecord($('earlier-result'),previous.record);$('earlier').open=record.status!=='observations';}
    refresh();
  }
  features.addEventListener('input',()=>{retain();refresh();});models.addEventListener('change',refresh);
  async function show(model,signal){
    if(remoteModel(model))throw new Error('Select an installed local model. Cloud models are excluded.');
    const response=await fetch(ENDPOINT+'/api/show',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:model.name}),signal});
    if(!response.ok)throw new Error('The selected model could not be inspected. Check local Ollama.');
    const data=await boundedModelJson(response,1000000);
    if(remoteModel(data)||!Array.isArray(data.capabilities)||!data.capabilities.includes('vision'))throw new Error('Select a local model with confirmed vision support.');
    return data;
  }
  async function checkIdentity(model,signal){
    const response=await fetch(ENDPOINT+'/api/tags',{signal});
    if(!response.ok)throw new Error('Local model identity could not be confirmed.');
    const data=await boundedModelJson(response,100000),current=(data.models||[]).find(item=>item.name===model.name);
    if(!current||remoteModel(current)||current.digest!==model.digest)throw new Error('The selected model changed after discovery. Reload model choices before trying again.');
  }
  async function discover(){
    models.replaceChildren();if(!localPage()){models.append(element('option','Local version required'));features.disabled=true;status('Not run. Open the local version on this computer to use installed Ollama vision models.');refresh();return;}
    try{
      const response=await fetch(ENDPOINT+'/api/tags',{signal:AbortSignal.timeout(5000)});if(!response.ok)throw new Error();const data=await boundedModelJson(response,100000);
      const candidates=(data.models||[]).filter(m=>typeof m.name==='string'&&m.name.length<=200&&!remoteModel(m)&&typeof m.digest==='string'&&/^[0-9a-f]{64}$/i.test(m.digest)&&m.size>0).sort((a,b)=>a.size-b.size);
      for(let i=0;i<candidates.length;i+=4){
        const checked=await Promise.allSettled(candidates.slice(i,i+4).map(async model=>{const info=await show(model,AbortSignal.timeout(8000));return {...model,details:info.details};}));
        for(const result of checked)if(result.status==='fulfilled'){const model=result.value;available.set(model.name,model);const option=element('option',model.name);option.value=model.name;models.append(option);}
        if(available.size)models.disabled=false;
        if(!controller&&!record)status('Checking installed model capabilities: '+Math.min(i+4,candidates.length)+' / '+candidates.length+'.');
        refresh();
      }
      if(!available.size)throw new Error();models.disabled=false;if(!controller&&!record)status('Not run. Loaded vision-capable local models. Capture a short qualitative feature list.');
    }catch{models.append(element('option','Local vision unavailable'));status('Not run. Local vision models are unavailable. The mesh viewer and inspection export still work.');}
    refresh();
  }
  $('observe').addEventListener('click',async()=>{
    if(controller||!localPage()||!available.has(models.value)||!hasGeometry())return;
    let requirements;try{requirements=parseVisionRequirements(features.value);}catch(error){status(error.message);return;}
    retain();const capturedContext=context(),model=available.get(capturedContext.model);
    // Keep the last captured result intact until its replacement has actual images.
    const activeController=new AbortController();controller=activeController;const timer=setTimeout(()=>activeController.abort(),300000);$('cancel').hidden=false;refresh();status('Capturing the current visible meshes and all three views…');
    let attempt=null;
    try{
      const image=await capture();
      if(activeController.signal.aborted)throw new DOMException('Cancelled','AbortError');
      if(image.viewerVersion!==capturedContext.viewerVersion)throw new Error('Viewer changed during capture. Capture its current geometry again.');
      if(image.imageBytes.length>4000000)throw new Error('The image exceeds the local observation limit. Try fewer visible meshes.');
      attempt={schema:'hardware-studio-vision-observation-v1',status:'pending',capturedAt:new Date().toISOString(),context:capturedContext,requirements,model:{name:model.name,digest:model.digest},imageSha256:image.imageSha256,geometry:image.manifest,observations:[],error:'Not run.',limits:['Model text is advisory and may misidentify visible features.','No CAD source, project fields or review marks are changed.','Images cannot verify exact dimensions, material, strength, safety, hidden features or physical fit.']};
      if(record?.status==='observations')previous={record,snapshot,rawResponse};
      record=attempt;snapshot=image;rawResponse=null;render();
      await show(model,activeController.signal);
      await checkIdentity(model,activeController.signal);
      status('Observing the captured image with '+model.name+'… Cancel is available.');
      const response=await fetch(ENDPOINT+'/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},signal:activeController.signal,body:JSON.stringify({model:model.name,stream:false,think:false,images:[encode(image.imageBytes)],format:visionObservationSchema(requirements),prompt:visionObservationPrompt(requirements),options:{temperature:0,num_predict:1400,num_ctx:8192}})});
      if(!response.ok)throw new Error('Local vision request failed. Check Ollama. No observations were accepted.');
      const data=await boundedModelJson(response,120000);
      rawResponse={model:data.model,done:data.done,done_reason:data.done_reason,response:data.response,total_duration:data.total_duration,eval_count:data.eval_count};
      if(data.done!==true||data.done_reason==='length'||typeof data.response!=='string'||data.response.length>32000)throw new Error('Local vision did not return a complete bounded observation record.');
      if(data.model!==model.name)throw new Error('The returned model identity differs from the selected model. No observations were accepted.');
      const output=validateVisionObservations(data.response,requirements);
      await checkIdentity(model,activeController.signal);
      attempt.model.identityCheckedBeforeAndAfter=true;
      attempt.status='observations';attempt.observations=output.observations;attempt.error=null;attempt.completedAt=new Date().toISOString();render();
      status(current()?'Captured model observations are ready. They remain unverified.':'Captured observations are ready for the earlier request/viewer state. Download retains that exact input.');
    }catch(error){
      const message=(error.name==='AbortError'?'Cancelled or timed out. No model observations were accepted.':error.message||'Local vision unavailable. No observations were accepted.').replace(/^NOT RUN:\s*/,'');
      if(attempt){attempt.status='not-run';attempt.error=message;attempt.observations=[];render();}
      status('NOT RUN: '+message);
    }finally{clearTimeout(timer);controller=null;$('cancel').hidden=true;refresh();}
  });
  $('cancel').addEventListener('click',()=>controller?.abort());
  function downloadBundle(bundle,filename){
    if(!bundle?.record||!bundle.snapshot)return;
    const {record,snapshot,rawResponse}=bundle;
    try{
      const archive=createZip([{name:'observation.json',data:JSON.stringify(record,null,2)+'\n'},{name:'inspection.png',data:snapshot.imageBytes},{name:'geometry.json',data:JSON.stringify(snapshot.manifest,null,2)+'\n'},...(rawResponse?[{name:'raw-model-response.json',data:JSON.stringify(rawResponse,null,2)+'\n'}]:[]),{name:'README.txt',data:'This package retains a captured mesh image, geometry identity and user-owned qualitative feature list. observation.json records either advisory model observations or NOT RUN. raw-model-response.json, when present, is untrusted model text and may contain false statements. It does not alter CAD or project review marks. Geometry hashes identify parsed Float32 render data; the image SHA-256 identifies the exact PNG supplied to Ollama. No physical or dimensional verification is claimed.\n'}]);
      const url=URL.createObjectURL(new Blob([archive],{type:'application/zip'})),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
    }catch{status('The observation ZIP could not be prepared. Keep this result open before leaving.');}
  }
  $('download').addEventListener('click',()=>{if(!controller)downloadBundle({record,snapshot,rawResponse},'hardware-studio-vision-observation.zip');});
  $('earlier-download').addEventListener('click',()=>downloadBundle(previous,'hardware-studio-earlier-vision-observation.zip'));
  void discover();
  return {geometryChanged:refresh};
}
