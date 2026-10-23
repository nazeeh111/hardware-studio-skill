import {editableAssembly,normalizeAssemblyDraft} from './assembly-editor.js?v=1';
import {validateAssemblySpec,emptyAssembly,setAssemblyPartSource,assemblyIssues,ASSEMBLY_MAX_BYTES} from './assembly-spec.js?v=1';
import {assemblyKey} from './project-geometry.js?v=3';
import {parseSavedWorkspace,STORAGE_KEY} from './core.js?v=41';
import {writeWorkspace,WorkspaceConflictError} from './workspace-store.js?v=1';
import {assemblySnapshot,ASSEMBLY_PREVIEW_KEY} from './assembly-preview.js?v=1';
const $=id=>document.getElementById('assembly-'+id),query=new URLSearchParams(location.search),projectId=query.get('project');
const validProjectId=typeof projectId==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(projectId);
const KEY=validProjectId?assemblyKey(projectId):null,DRAFT=KEY+'-draft-v1';
let project=null,projectSignature=null,embeddedBaseline=null,applied=null,working=null,expectedRaw=null,preservedRaw=null,blocked=false,backedUp=false,jsonDirty=false,ready=false,busy=false,history=[],cursor=-1;
const element=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const note=text=>{$('status').textContent=text;};
const raw=()=>JSON.stringify(working,null,2);
const dirty=()=>jsonDirty||JSON.stringify(working)!==JSON.stringify(applied);
const selectedProject=()=>{const p=parseSavedWorkspace(localStorage.getItem(STORAGE_KEY)).projects.find(p=>p.id===projectId);if(!p)throw new Error('Project no longer available. Return to the studio.');return p;};
const signature=p=>JSON.stringify({id:p.id,parts:p.parts});
const matchesProject=p=>signature(p)===projectSignature&&[embeddedBaseline,JSON.stringify(applied)].includes(JSON.stringify(p.assemblySpec??null));
const partName=id=>project.parts.find(p=>p.id===id)?.name||id;
function download(name,data,type='application/json') {const url=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function retain(){try{sessionStorage.setItem(DRAFT,JSON.stringify({schema:'hardware-studio-assembly-editor-v1',kind:jsonDirty?'json':'controls',data:jsonDirty?$('source').value:working}));}catch{$('retention').textContent='Tab storage could not be written. Unapplied changes stay in memory only; export the working source before leaving.';}}
function isCurrent(){try{return localStorage.getItem(KEY)===expectedRaw&&matchesProject(selectedProject());}catch{return false;}}
function buttons(){
 let buildable=false;try{validateAssemblySpec(applied,{requirePlaced:true});buildable=true;}catch{}
 const usable=!!project&&!dirty()&&!blocked&&isCurrent();
 $('preview').disabled=!usable||!buildable||!ready||busy;$('package').disabled=!usable||!buildable||!ready||busy;
 $('apply').disabled=!project||busy||blocked||!isCurrent();$('revert').disabled=!dirty()||busy;
 $('undo').disabled=dirty()||cursor<=0||busy||blocked||!isCurrent();$('redo').disabled=dirty()||cursor>=history.length-1||busy||blocked||!isCurrent();
 $('add').disabled=!working?.assets.length||!working.assets.some(a=>a.partId===$('place-part').value)||working.instances.length>=16||busy||jsonDirty;
 $('replace').disabled=!backedUp||!working||busy;
 for(const control of document.querySelectorAll('#assembly-instances input,#assembly-instances select,#assembly-instances button,#assembly-title,#assembly-attach-part,#assembly-place-part'))control.disabled=jsonDirty;
 $('attach').disabled=jsonDirty||!$('attach-part').value;
 $('chip').textContent=blocked?'RECOVERY':!isCurrent()?'CHANGED ELSEWHERE':dirty()?'UNAPPLIED':(!applied?.assets.length&&expectedRaw===null&&!project?.assemblySpec?'NO CAD YET':'SOURCE SAVED');
}
function changed(){jsonDirty=false;$('source').value=raw();retain();buttons();note('Unapplied placement changes. Apply before generating.');}
function inputField(label,value,handler,type='text'){
 const wrap=element('label',undefined,'placement-field'),span=element('span',label),input=document.createElement('input');input.type=type;input.value=value;if(type==='number')input.step='any';else input.maxLength=80;input.addEventListener('input',()=>{if(jsonDirty)return note('Read edited JSON into controls before changing placement fields.');handler(input.value);changed();});wrap.append(span,input);return wrap;
}
function partOptions(select,values,chosen){select.replaceChildren();for(const id of values){const o=element('option',partName(id));o.value=id;select.append(o);}select.value=chosen!==undefined&&values.includes(chosen)?chosen:(values[0]??'');}
function renderParts(){
 const host=$('parts');host.replaceChildren();const sources=new Map(working.assets.map(a=>[a.partId,a]));
 for(const p of project.parts){
  const asset=sources.get(p.id),card=element('article',undefined,'cad-part'),head=element('div',undefined,'cad-part-head');head.append(element('h3',p.name),element('span','QTY '+p.qty));card.append(head,element('p',asset?`${asset.source.features.length} features · ${working.instances.filter(i=>i.partId===p.id).length} placed · ${asset.source.title}`:'No CAD source attached to this part.'));
  const actions=element('div',undefined,'cad-part-actions'),link=element('a',asset?'Edit part CAD ↗':'Create part CAD ↗');link.href='./solid.html?'+new URLSearchParams({project:projectId,title:project.title,part:p.id});link.target='_blank';link.rel='noopener noreferrer';actions.append(link);
  if(asset){const exportButton=element('button','Export part source ↓');exportButton.type='button';exportButton.addEventListener('click',()=>download('hardware-studio-part-source.json',JSON.stringify(asset.source,null,2)));actions.append(exportButton);}card.append(actions);host.append(card);
 }
 for(const asset of working.assets.filter(a=>!project.parts.some(p=>p.id===a.partId))){
  const card=element('article',undefined,'cad-part unbound');card.append(element('h3',asset.source.title),element('p','Preserved CAD has no matching part: '+asset.partId));
  const candidates=project.parts.filter(p=>!sources.has(p.id)),select=document.createElement('select'),label=element('label','Rebind preserved CAD to a part');partOptions(select,candidates.map(p=>p.id));label.append(select);card.append(label);
  const actions=element('div',undefined,'cad-part-actions'),rebind=element('button','Rebind source + placements'),exportButton=element('button','Export preserved source ↓');rebind.type=exportButton.type='button';rebind.disabled=!candidates.length;
  rebind.addEventListener('click',()=>{if(jsonDirty)return note('Read edited JSON into controls first.');if(!select.value)return;const old=asset.partId,next=select.value;asset.partId=next;working.instances.forEach(i=>{if(i.partId===old)i.partId=next;});render();changed();});exportButton.addEventListener('click',()=>download('hardware-studio-preserved-part-source.json',JSON.stringify(asset.source,null,2)));actions.append(rebind,exportButton);card.append(actions);host.append(card);
 }
 if(!project.parts.length)host.append(element('p','Add parts in the studio, then return here to give them CAD sources.','assembly-empty'));
 $('legacy').hidden=!project.solidSpec;partOptions($('attach-part'),project.parts.filter(p=>!sources.has(p.id)).map(p=>p.id));$('attach').disabled=!$('attach-part').value||jsonDirty;
 partOptions($('place-part'),working.assets.map(a=>a.partId),$('place-part').value);
}
function renderInstances(){
 const host=$('instances');host.replaceChildren();
 working.instances.forEach((instance,index)=>{
  const card=element('article',undefined,'instance-card'),head=element('div',undefined,'instance-head'),remove=element('button','Remove instance');remove.type='button';head.append(element('b',String(index+1).padStart(2,'0')+' / '+partName(instance.partId)),remove);remove.addEventListener('click',()=>{if(jsonDirty)return note('Read edited JSON into controls before removing an instance.');working.instances.splice(index,1);renderInstances();changed();});card.append(head);
  const body=element('div',undefined,'instance-body'),meta=element('div',undefined,'instance-meta');meta.append(inputField('Instance name / ID',instance.id,v=>{instance.id=v;}));
  const label=element('label',undefined,'placement-field');label.append(element('span','Part source'));const select=document.createElement('select');partOptions(select,working.assets.map(a=>a.partId),instance.partId);select.addEventListener('change',()=>{if(jsonDirty)return note('Read edited JSON into controls before changing a part source.');instance.partId=select.value;renderInstances();changed();});label.append(select);meta.append(label);body.append(meta);
  for(const [key,title]of [['position','Translation / millimeters'],['rotation','Rotation / degrees']]){const vector=element('fieldset',undefined,'instance-vector');vector.append(element('legend',title));['X','Y','Z'].forEach((axis,k)=>vector.append(inputField(axis+' / '+(key==='position'?'mm':'deg'),instance[key][k],v=>{instance[key][k]=v;},'number')));body.append(vector);}card.append(body);host.append(card);
 });
 if(!working.instances.length)host.append(element('p','No instances placed. Attach a part source, then add an instance.','assembly-empty'));
}
function renderSummary(){
 $('current-title').textContent=applied.title;const host=$('summary');host.replaceChildren();const metrics=element('div',undefined,'assembly-metrics');for(const [name,value]of [['PART SOURCES',applied.assets.length],['PLACED INSTANCES',applied.instances.length]]){const cell=element('div');cell.append(element('span',name),element('b',String(value)));metrics.append(cell);}host.append(metrics);
 const issues=$('issues');issues.replaceChildren();for(const issue of assemblyIssues(applied,project.parts))issues.append(element('p',issue.text,'assembly-issue'));
 if(applied.assets.length&&!issues.children.length)issues.append(element('p','Recorded CAD quantities match their parts. Build to check geometry and nominal interference.','assembly-complete'));
 if(!applied.assets.length)issues.append(element('p','No source bound yet. Existing shared/tray sources stay separate until you explicitly copy or model a part.','assembly-empty'));
}
function render(){if(!working||!applied)return;$('title').value=working.title;$('source').value=raw();renderParts();renderInstances();renderSummary();buttons();}
function normalized(){if(jsonDirty)throw new Error('Read edited JSON into controls before applying.');return normalizeAssemblyDraft(working);}
function preserveConflict(error){if(error instanceof WorkspaceConflictError){preservedRaw=localStorage.getItem(KEY);blocked=true;backedUp=false;$('recovery').hidden=false;}buttons();}
function commit(next,recordHistory=true,replacement=false){
 next=validateAssemblySpec(next);const currentProject=selectedProject();if(!matchesProject(currentProject))throw new Error('Project parts or embedded CAD changed. Export your working source and reload the latest project.');
 if(blocked&&!replacement)throw new Error('Resolve saved-byte recovery first.');
 try{expectedRaw=writeWorkspace(localStorage,KEY,replacement?preservedRaw:expectedRaw,JSON.stringify(next));}
 catch(error){preserveConflict(error);retain();throw error;}
 if(recordHistory&&JSON.stringify(next)!==JSON.stringify(applied)){history=history.slice(0,cursor+1);history.push(next);if(history.length>20)history.shift();cursor=history.length-1;}
 embeddedBaseline=JSON.stringify(currentProject.assemblySpec??null);applied=structuredClone(next);working=structuredClone(next);jsonDirty=false;blocked=false;preservedRaw=null;backedUp=false;$('recovery').hidden=true;try{sessionStorage.removeItem(DRAFT);}catch{}render();note('Assembly source and placements saved for this project. Generate to check geometry; physical fit remains untested.');
}
function load(){
 if(!validProjectId)throw new Error('Open the assembly workbench from an existing project’s Assembly tab.');
 project=selectedProject();if(new Set(project.parts.map(p=>p.id)).size!==project.parts.length)throw new Error('Project part IDs are duplicated. Repair the parts list before binding CAD.');projectSignature=signature(project);embeddedBaseline=JSON.stringify(project.assemblySpec??null);$('project').textContent='PROJECT / '+project.title;document.querySelectorAll('header a').forEach(a=>a.href='./index.html?'+new URLSearchParams({project:projectId}));
 expectedRaw=localStorage.getItem(KEY);blocked=false;backedUp=false;preservedRaw=null;let source=project.assemblySpec??emptyAssembly(project.title.slice(0,100)||'Assembly');
 if(expectedRaw!==null){try{source=validateAssemblySpec(JSON.parse(expectedRaw));}catch{blocked=true;preservedRaw=expectedRaw;$('recovery').hidden=false;}}
 applied=validateAssemblySpec(source);working=structuredClone(applied);history=[applied];cursor=0;jsonDirty=false;render();note(blocked?'Unreadable saved bytes preserved. Export them before selecting any complete replacement.':'Assembly source restored. Parts and placements are editable; geometry has not been built here.');
 let savedDraft=null;try{const saved=savedDraft=sessionStorage.getItem(DRAFT);if(saved!==null){
   if(new TextEncoder().encode(saved).length>ASSEMBLY_MAX_BYTES+8192)throw new Error();const draft=JSON.parse(saved);
   if(draft?.schema==='hardware-studio-assembly-editor-v1'&&draft.kind==='controls'){working=editableAssembly(draft.data);jsonDirty=false;render();note('Unapplied placement controls restored from this tab. Complete the fields and Apply, or export before closing.');}
   else{const text=draft?.schema==='hardware-studio-assembly-editor-v1'&&draft.kind==='json'?draft.data:saved;if(typeof text!=='string'||new TextEncoder().encode(text).length>ASSEMBLY_MAX_BYTES)throw new Error();$('source').value=text;jsonDirty=true;note('Unapplied assembly text restored from this tab. Read it into controls or export before closing.');buttons();}
  }}catch{if(savedDraft!==null){$('source').value=savedDraft;jsonDirty=true;buttons();note('The retained draft could not be read. Its original bytes are shown for export; they have not replaced applied CAD.');}else{$('retention').textContent='Tab storage unavailable. Unapplied changes stay in memory only; export before leaving.';note('Source is readable. Export pending changes before leaving.');}}
}
$('title').addEventListener('input',()=>{if(jsonDirty)return note('Read edited JSON into controls before changing the title.');working.title=$('title').value;changed();});
$('add').addEventListener('click',()=>{if(!working||jsonDirty||!$('place-part').value)return;let n=working.instances.length+1;while(working.instances.some(i=>i.id==='instance-'+n))n++;working.instances.push({id:'instance-'+n,partId:$('place-part').value,position:[0,0,0],rotation:[0,0,0]});renderInstances();changed();});
$('attach').addEventListener('click',()=>{if(jsonDirty||!project.solidSpec)return;try{working=setAssemblyPartSource(working,$('attach-part').value,project.solidSpec);render();changed();note('Shared source copied into the working assembly. Apply to retain the binding; add its intended placement.');}catch(error){note(error.message);}});
$('apply').addEventListener('click',()=>{try{commit(normalized());}catch(error){note(error.message);}});
$('revert').addEventListener('click',()=>{working=structuredClone(applied);jsonDirty=false;try{sessionStorage.removeItem(DRAFT);}catch{}render();note('Unapplied changes discarded. Latest applied assembly retained.');});
for(const [id,delta]of [['undo',-1],['redo',1]])$(id).addEventListener('click',()=>{const index=cursor+delta;if(index<0||index>=history.length||dirty())return;try{commit(history[index],false);cursor=index;buttons();}catch(error){note(error.message);}});
$('source').addEventListener('input',()=>{jsonDirty=true;retain();buttons();note('Edited source not yet read into controls. Read, inspect and apply it before generating.');});
function readJson(text){if(new TextEncoder().encode(text).length>ASSEMBLY_MAX_BYTES)throw new Error('Source exceeds 256 KB.');working=validateAssemblySpec(JSON.parse(text));jsonDirty=false;render();retain();note('Source loaded into working controls. Review bindings and placements, then Apply to save.');}
$('read-json').addEventListener('click',()=>{try{readJson($('source').value);}catch(error){note(error.message);}});
$('export').addEventListener('click',()=>download(dirty()?'hardware-studio-unapplied-assembly.json':'hardware-studio-assembly-source.json',jsonDirty?$('source').value:raw()));
$('import').addEventListener('click',()=>$('file').click());$('file').addEventListener('change',async event=>{const file=event.target.files?.[0];event.target.value='';if(!file)return;try{if(file.size>ASSEMBLY_MAX_BYTES)throw new Error('Import JSON under 256 KB.');const before=JSON.stringify({working,jsonDirty,text:$('source').value}),text=await file.text();if(before!==JSON.stringify({working,jsonDirty,text:$('source').value}))throw new Error('Working source changed during import. Your newer edits are retained; choose the file again if needed.');readJson(text);}catch(error){note(error.message);}});
$('backup').addEventListener('click',()=>{download('hardware-studio-original-assembly-bytes.json',preservedRaw??'');backedUp=true;buttons();});
$('replace').addEventListener('click',()=>{if(!backedUp)return;try{commit(normalized(),true,true);}catch(error){note(error.message);}});
$('reload').addEventListener('click',()=>{if(dirty())return note('Export or discard unapplied changes before reloading saved CAD.');try{load();}catch(error){note(error.message);}});
$('preview').addEventListener('click',()=>{if(dirty()||busy||blocked||!isCurrent()||!ready)return;try{sessionStorage.setItem(ASSEMBLY_PREVIEW_KEY,JSON.stringify(assemblySnapshot(applied,projectId)));location.href='./cad-viewer.html?generated=assembly';}catch(error){note(error.message);}});
$('package').addEventListener('click',async()=>{if(dirty()||busy||blocked||!isCurrent()||!ready)return;const frozen=validateAssemblySpec(applied,{requirePlaced:true});busy=true;buttons();note('Building local parts and transformed instances, then reopening STEP and checking nominal interference…');try{const response=await fetch('./api/assembly',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(frozen),signal:AbortSignal.timeout(190000)});if(!response.ok){let message='Assembly build failed.';try{message=(await response.json()).error||message;}catch{}throw new Error(message);}if(!response.headers.get('Content-Type')?.startsWith('application/zip'))throw new Error('The runtime did not return a CAD ZIP.');download('hardware-studio-assembly-cad.zip',await response.blob(),'application/zip');note('Assembly CAD ZIP downloaded for “'+frozen.title+'”. Inspect verification.json for overlap and distance results; geometry checks do not establish physical fit.');}catch(error){note(error.name==='TimeoutError'?'Assembly build timed out. Current source retained.':error.message);}finally{busy=false;buttons();}});
addEventListener('storage',event=>{if(event.key===KEY||event.key===STORAGE_KEY){buttons();if(!isCurrent())note('Saved source or project changed in another tab. Export any working edits, then reload the saved assembly.');}});
try{load();}catch(error){note(error.message);for(const control of document.querySelectorAll('.workspace button,.workspace input,.workspace textarea,.workspace select'))control.disabled=true;}
void(async()=>{try{const response=await fetch('./api/health',{cache:'no-store',signal:AbortSignal.timeout(4000)}),info=await response.json();ready=response.ok&&info.ok===true&&info.features?.includes('placed-assembly-v1');}catch{}$('runtime').textContent=ready?'Local placed-assembly runtime ready. CAD generation stays on this computer.':'Assembly runtime unavailable. Run the current local server to build; source and placement editing work here.';if(project)buttons();})();
