import {validateSolidSpec} from './solid-spec.js?v=2';
import {installSolidIntent} from './solid-intent-ui.js?v=2';
import {SOLID_PREVIEW_KEY,solidSnapshot} from './solid-preview.js?v=3';
import {createSolidEditor} from './solid-editor.js?v=3';
import {writeWorkspace,WorkspaceConflictError} from './workspace-store.js?v=1';
import {solidContext} from './project-geometry.js?v=2';
import {parseSavedWorkspace,STORAGE_KEY} from './core.js?v=37';
const context=solidContext(location.search);
const $=s=>document.querySelector(s),KEY=context.key,DRAFT=context.draftKey;
let spec=null,expectedRaw=null,preservedRaw=null,blocked=false,states=[],cursor=0,ready=false,busy=false,intent=null;
const note=text=>{$('#solid-status').textContent=text;};
const source=()=>spec?JSON.stringify(spec,null,2):'';
const dirty=()=>$('#solid-source').value!==source();
function buttons(){const usable=Boolean(spec)&&!dirty();$('#solid-preview').disabled=!usable||!ready||busy;$('#solid-package').disabled=!usable||!ready||busy;$('#solid-export').disabled=!$('#solid-source').value;$('#solid-undo').disabled=dirty()||cursor<=0;$('#solid-redo').disabled=dirty()||cursor>=states.length-1;$('#solid-revert').disabled=!dirty();}
function keepEditor(){try{if($('#solid-source').value.length<=65536)sessionStorage.setItem(DRAFT,$('#solid-source').value);}catch{note('Tab storage unavailable. Export the current source before reloading.');}}
function render(){
 $('#solid-source').value=source();if(!spec){$('#solid-dimensions').replaceChildren();const empty=document.createElement('p');empty.className='dimension-empty';empty.textContent='No part source yet. Describe a new part with dimensions, import a source, or explicitly load an example.';$('#solid-dimensions').append(empty);$('#solid-title').textContent='Your first part';$('#solid-chip').textContent='NO SOURCE';$('#solid-features').replaceChildren();buttons();intent?.refresh();return;}dimensionEditor.setSource(spec);$('#solid-title').textContent=spec.title;$('#solid-chip').textContent='SOURCE VALID';const list=$('#solid-features');list.replaceChildren();
 for(const [i,feature]of spec.features.entries()){const row=document.createElement('div');row.className='feature-item '+feature.operation;const index=document.createElement('span'),body=document.createElement('div'),title=document.createElement('b'),detail=document.createElement('small');index.className='feature-index';index.textContent=String(i+1).padStart(2,'0');title.textContent=`${feature.operation.toUpperCase()} / ${feature.id}`;detail.textContent=feature.shape==='box'?`BOX · ${feature.size.join(' × ')} mm · corner [${feature.origin.join(', ')}]`:feature.shape==='cylinder'?`CYLINDER · R ${feature.radius} × ${feature.height} mm · +${feature.axis.toUpperCase()} · base [${feature.origin.join(', ')}]`:`PROFILE · ${feature.points.length} corners × ${feature.height} mm · +${feature.axis.toUpperCase()} · base [${feature.origin.join(', ')}]`;body.append(title,detail);row.append(index,body);list.append(row);}
 const probes=document.createElement('div');probes.className='feature-probes';probes.textContent=`${spec.probes.length} selected region check${spec.probes.length===1?'':'s'}: ${spec.probes.map(p=>p.id+' = '+p.expect).join('; ')||'none supplied'}. These run on generated geometry, not on this source preview.`;list.append(probes);buttons();intent?.refresh();
}
function save(){
 if(blocked){keepEditor();return false;}
 try{expectedRaw=writeWorkspace(localStorage,KEY,expectedRaw,JSON.stringify(spec));try{sessionStorage.removeItem(DRAFT);}catch{}return true;}
 catch(error){if(error instanceof WorkspaceConflictError){try{preservedRaw=localStorage.getItem(KEY);}catch{}blocked=true;$('#solid-recovery').hidden=false;$('#solid-replace').disabled=true;}keepEditor();return false;}
}
function commit(next,history=true,mustSave=false){
 next=validateSolidSpec(next);if(mustSave){if(blocked)throw new Error('Resolve saved-source recovery first.');expectedRaw=writeWorkspace(localStorage,KEY,expectedRaw,JSON.stringify(next));try{sessionStorage.removeItem(DRAFT);}catch{}}if(history&&JSON.stringify(next)!==JSON.stringify(spec)){states=states.slice(0,cursor+1);states.push(next);if(states.length>20)states.shift();cursor=states.length-1;}
 spec=next;render();const saved=mustSave||save();note(`${spec.features.length} applied features; ${spec.probes.length} selected region checks. ${saved?context.id?'Source saved for this project in this browser.':'Source saved in this browser.':'Working copy is not saved over the stored source. Export it before closing.'} Generate CAD to check the solid.`);
}
function download(name,data,type='application/json'){const url=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
async function example(name='mounting-bracket'){const response=await fetch(`./tools/solid-generator/examples/${name}.json`);if(!response.ok)throw new Error('Bracket example unavailable. Import a feature JSON file.');return validateSolidSpec(await response.json());}
async function runtime(){try{const response=await fetch('./api/health',{cache:'no-store',signal:AbortSignal.timeout(4000)}),data=await response.json();ready=response.ok&&data.ok===true&&data.features?.includes('profile-solid-v1');}catch{}$('#solid-runtime').textContent=ready?'Local feature-solid runtime ready. Builds and readback stay on this computer.':'Feature CAD runtime unavailable. Run the current local server to generate; source editing and export work here.';buttons();}
function sourceChanged(){if(dirty()){keepEditor();note('Unapplied changes. Apply changes before generating or using Undo / Redo.');$('#solid-chip').textContent='UNAPPLIED';}else{try{sessionStorage.removeItem(DRAFT);}catch{}note('Working source matches the latest applied source.');$('#solid-chip').textContent='SOURCE VALID';}buttons();intent?.refresh();}
const dimensionEditor=createSolidEditor($('#solid-dimensions'),{change:raw=>{
 let text=JSON.stringify(raw,null,2);if(text.length>65536)text=JSON.stringify(raw);if(text.length>65536)throw new Error('Source exceeds 64 KB. Remove features or corners before adding more.');
 $('#solid-source').value=text;sourceChanged();
},error:note,openSource:()=>{$('#solid-json').open=true;$('#solid-source').focus();}});
$('#solid-source').addEventListener('input',()=>{dimensionEditor.setSource($('#solid-source').value);sourceChanged();});
$('#solid-revert').addEventListener('click',()=>{render();try{sessionStorage.removeItem(DRAFT);}catch{}note('Unapplied changes discarded. Last applied source retained.');});
$('#solid-choose-import').addEventListener('click',()=>$('#solid-import').click());
$('#solid-apply').addEventListener('click',()=>{try{if($('#solid-source').value.length>65536)throw new Error('Source must be under 64 KB.');commit(JSON.parse($('#solid-source').value));}catch(error){note(error.message);}});
for(const [id,delta]of [['solid-undo',-1],['solid-redo',1]])$('#'+id).addEventListener('click',()=>{const next=cursor+delta;if(next>=0&&next<states.length){cursor=next;commit(states[cursor],false);}});
$('#solid-example').addEventListener('click',async()=>{try{commit(await example());}catch(error){note(error.message);}});
$('#solid-profile-example').addEventListener('click',async()=>{try{commit(await example('profile-plate'));}catch(error){note(error.message);}});
$('#solid-import').addEventListener('change',async event=>{const file=event.target.files?.[0];event.target.value='';if(!file)return;try{if(file.size>65536)throw new Error('Import source under 64 KB.');commit(JSON.parse(await file.text()));}catch(error){note(error.message);}});
$('#solid-export').addEventListener('click',()=>download('hardware-studio-feature-source.json',$('#solid-source').value));
$('#solid-backup').addEventListener('click',()=>{download('hardware-studio-original-feature-source.json',preservedRaw??'');$('#solid-replace').disabled=false;});
$('#solid-replace').addEventListener('click',()=>{if($('#solid-replace').disabled||dirty()||!spec)return note('Apply edited source before replacing saved bytes.');try{expectedRaw=writeWorkspace(localStorage,KEY,preservedRaw,JSON.stringify(spec));blocked=false;preservedRaw=null;$('#solid-recovery').hidden=true;try{sessionStorage.removeItem(DRAFT);}catch{}note('Working source saved after original-byte backup.');}catch{try{preservedRaw=localStorage.getItem(KEY);}catch{}$('#solid-replace').disabled=true;note('Saved bytes changed again or could not be written. Download the current original bytes before replacing.');}});
$('#solid-preview').addEventListener('click',()=>{if(dirty()||!ready||busy)return;try{sessionStorage.setItem(SOLID_PREVIEW_KEY,JSON.stringify(solidSnapshot(spec,Date.now(),location.search)));location.href='./cad-viewer.html?generated=solid';}catch(error){note(error.message||'Preview snapshot could not be retained. Export source first.');}});
$('#solid-package').addEventListener('click',async()=>{if(dirty()||!ready||busy)return;const frozen=structuredClone(spec);busy=true;buttons();note('Building the frozen feature record and checking exported geometry…');try{const response=await fetch('./api/solid',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(frozen),signal:AbortSignal.timeout(130000)});if(!response.ok){let message='Solid build failed.';try{message=(await response.json()).error||message;}catch{}throw new Error(message);}if(!response.headers.get('Content-Type')?.startsWith('application/zip'))throw new Error('No CAD ZIP returned.');download('hardware-studio-feature-cad.zip',await response.blob(),'application/zip');note(`CAD ZIP downloaded for “${frozen.title}”. Inspect its source and verification report; the editor may now contain later changes.`);}catch(error){note(error.name==='TimeoutError'?'Build timed out. Source retained.':error.message);}finally{busy=false;buttons();}});
async function initialize(){
 $('#solid-project').textContent=context.id ? `PROJECT / ${context.title || context.id}` : 'STANDALONE / SOURCE';
 document.querySelectorAll('header a').forEach(link=>link.href=context.studioTo);
 let initial;try{expectedRaw=localStorage.getItem(KEY);if(expectedRaw!==null){try{initial=validateSolidSpec(JSON.parse(expectedRaw));}catch{blocked=true;preservedRaw=expectedRaw;$('#solid-recovery').hidden=false;}}}catch{}
 try{
 if(context.id&&!initial&&!blocked){
   const workspace=parseSavedWorkspace(localStorage.getItem(STORAGE_KEY));
   const project=workspace.projects.find(p=>p.id===context.id);
   if(!project)throw new Error('Project unavailable. Return to the studio and open the modeler from an existing project.');
   if(project.solidSpec)initial=validateSolidSpec(project.solidSpec);
 }
 spec=initial||null;states=spec?[spec]:[];cursor=spec?0:-1;render();note(initial?'Saved feature source restored. Generate to check geometry.':blocked?'Saved bytes preserved. Import or explicitly load a separate working source.':'No source inherited. Describe the first part and supply its dimensions.');try{const draft=sessionStorage.getItem(DRAFT);if(draft&&draft.length<=65536&&draft!==source()){$('#solid-source').value=draft;if(!dimensionEditor.setSource(draft))$('#solid-json').open=true;note('Unapplied source restored from this tab. Apply or export it before closing.');$('#solid-chip').textContent='UNAPPLIED';buttons();}}catch{}void runtime();intent=installSolidIntent({storageKey:DRAFT+'-intent-v1',project:context.id?()=>{const p=parseSavedWorkspace(localStorage.getItem(STORAGE_KEY)).projects.find(p=>p.id===context.id);if(!p)throw new Error('Project no longer available. Return to the studio.');return p;}:null,readState:()=>({spec,dirty:dirty(),blocked,expectedRaw,currentRaw:localStorage.getItem(KEY),projectSignature:context.id?JSON.stringify(parseSavedWorkspace(localStorage.getItem(STORAGE_KEY)).projects.find(p=>p.id===context.id)??null):null}),apply:next=>commit(next,true,true)});}
 catch(error){note(error.message);}
}
void initialize();
