import {needsCurvedRuntime} from '../solid-spec.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {validateSolidSpec} from '../solid-spec.js';
import {solidContext,assemblyKey} from '../project-geometry.js';
import {validateAssemblySpec,emptyAssembly,setAssemblyPartSource,assemblyIssues} from '../assembly-spec.js';
import {proposeProjectChange} from '../project-change.js';
import {parseSavedWorkspace,STORAGE_KEY,blankProject} from '../core.js';
import {writeWorkspace,WorkspaceConflictError} from '../workspace-store.js';
import {createProjectStore,PROJECT_STORE_KEY,ProjectStoreConflict} from '../project-store.js';

// Exercise the actual workbench orchestration. Rendering and model discovery
// are replaced at the module boundary, while validators, storage and every
// production event handler execute unchanged in an isolated VM context.
const source=await readFile(new URL('../solid-workbench.js',import.meta.url),'utf8');
const executable=source.replace(/^import .*?;\n/gm,'');
const solid=width=>({schema:'hardware-studio-solid-v1',title:'Plate',units:'mm',features:[{id:'body',operation:'add',shape:'box',origin:[0,0,0],size:[width,20,3]}],probes:[]});
function fixture(){
 const project=blankProject();project.id='project-1';project.title='Bound CAD';
 project.parts=[{id:'plate',name:'Plate',category:'Mechanical',detail:'Base',qty:1},{id:'spacer',name:'Spacer',category:'Mechanical',detail:'Spacer',qty:2}];
 let assembly=setAssemblyPartSource(null,'plate',solid(10),'Bound CAD');assembly=setAssemblyPartSource(assembly,'spacer',solid(4));
 assembly.instances=[{id:'plate-one',partId:'plate',position:[0,0,0],rotation:[0,0,0]},{id:'spacer-one',partId:'spacer',position:[11,12,13],rotation:[30,40,50]}];
 project.assemblySpec=structuredClone(assembly);return {project,assembly};
}
async function setup({malformed=false,sidecar=true}={}){
 const events=new Map(),{project,assembly}=fixture(),data=new Map([[STORAGE_KEY,JSON.stringify({projects:[project],currentId:project.id})]]),session=new Map(),nodes=new Map();
 const key=assemblyKey(project.id);if(sidecar)data.set(key,malformed?'unreadable original assembly bytes':JSON.stringify(assembly));
 class Element{
  constructor(){Object.assign(this,{value:'',textContent:'',hidden:true,disabled:false,children:[],handlers:new Map()});}
  append(...children){this.children.push(...children);}
  replaceChildren(...children){this.children=[...children];}
  addEventListener(type,handler){this.handlers.set(type,handler);}
  async click(){return this.handlers.get('click')?.();}
 }
 const get=selector=>{if(!nodes.has(selector))nodes.set(selector,new Element());return nodes.get(selector);};
 get('#solid-replace').disabled=true; // Matches solid.html's recovery control.
 const storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
 let intent;
 let releaseLock=null,gate=null;const locks={hold(){gate=new Promise(resolve=>{releaseLock=resolve;});},release(){releaseLock();gate=null;},request(_name,_options,fn){const wait=gate;return (wait||Promise.resolve()).then(fn);}};
 const sandbox={createProjectStore,PROJECT_STORE_KEY,ProjectStoreConflict,navigator:{locks},needsCurvedRuntime,validateSolidSpec,solidContext,validateAssemblySpec,emptyAssembly,setAssemblyPartSource,parseSavedWorkspace,STORAGE_KEY,writeWorkspace,WorkspaceConflictError,
  installSolidIntent:api=>{intent=api;return {refresh(){}};},createSolidEditor:()=>({setSource(){return true;}}),
  SOLID_PREVIEW_KEY:'preview',solidSnapshot(){throw new Error('Preview unused in this harness');},
  location:{search:'?project=project-1&part=plate',href:''},localStorage:storage,sessionStorage:{getItem:key=>session.get(key)??null,setItem:(key,value)=>session.set(key,value),removeItem:key=>session.delete(key)},
  document:{querySelector:get,querySelectorAll:()=>[get('header a.back'),get('header a.other')],createElement:()=>new Element()},
  fetch:async()=>({ok:true,json:async()=>({ok:true,features:['profile-solid-v1']})}),AbortSignal,structuredClone,URL,URLSearchParams,Blob,setTimeout(){},addEventListener:(type,fn)=>events.set(type,fn),console};
 vm.runInNewContext(executable,sandbox,{filename:'solid-workbench.js'});
 await new Promise(resolve=>setImmediate(resolve));
 if(!malformed)assert.ok(intent,'Workbench did not initialize its intent controller');
 const save=async width=>{get('#solid-source').value=JSON.stringify(solid(width));await get('#solid-apply').click();};
 const workspace=()=>JSON.parse(data.get(PROJECT_STORE_KEY)).workspace,stored=()=>workspace().projects[0].assemblySpec;
 const mutateProject=change=>{const current=JSON.parse(data.get(PROJECT_STORE_KEY));change(current.workspace.projects[0]);current.generation++;data.set(PROJECT_STORE_KEY,JSON.stringify(current));};
 return {data,key,nodes,get,intent,save,stored,workspace,mutateProject,assembly,project,session,locks,events};
}

test('bound manual save, undo and redo replace only their asset and preserve placement bytes',async()=>{
 const env=await setup(),before=env.stored();await env.save(48);
 assert.equal(env.stored().assets[0].source.features[0].size[0],48);
 assert.deepEqual(env.stored().assets[1],before.assets[1]);assert.deepEqual(env.stored().instances,before.instances);
 assert.deepEqual(env.workspace().projects[0].assemblySpec,env.stored(),'Bound workbench commits embedded source in the project');
 await env.get('#solid-undo').click();assert.deepEqual(env.stored(),before);
 await env.get('#solid-redo').click();assert.equal(env.stored().assets[0].source.features[0].size[0],48);
});

test('first bound save without a sidecar preserves embedded sources and placements',async()=>{
 const env=await setup({sidecar:false});await env.save(48);
 assert.equal(env.stored().assets[0].source.features[0].size[0],48);assert.deepEqual(env.stored().assets[1],env.assembly.assets[1]);assert.deepEqual(env.stored().instances,env.assembly.instances);
});

test('another part edit blocks stale saves and retains working source for export',async()=>{
 const env=await setup(),external=setAssemblyPartSource(env.assembly,'spacer',solid(9));env.data.set(env.key,JSON.stringify(external));await env.save(48);
 assert.deepEqual(env.stored(),env.assembly);assert.equal(env.data.get(env.key),JSON.stringify(external));assert.equal(env.intent.readState().blocked,true);assert.equal(env.intent.readState().spec.features[0].size[0],10);assert.equal(JSON.parse(env.get('#solid-source').value).features[0].size[0],48);
 assert.ok([...env.session.values()].some(value=>value.includes('48')),'Unpersisted working source must be retained in tab storage');
 assert.equal(env.get('#solid-recovery').hidden,false);assert.equal(env.get('#solid-replace').disabled,true);
});

test('removed BOM target and changed embedded assembly block direct proposal apply before source mutation',async()=>{
 for(const mutation of [p=>p.parts=p.parts.filter(part=>part.id!=='plate'),p=>p.parts[0].name='Different hardware',p=>p.assemblySpec.instances[0].position[0]=99,p=>p.parts.push({...p.parts[0],name:'Ambiguous duplicate'})]){
  const env=await setup(),bytes=env.data.get(env.key),before=JSON.stringify(env.intent.readState().spec);env.mutateProject(mutation);
  await assert.rejects(env.intent.apply(solid(48)),/no longer exists|changed|duplicated/);assert.equal(env.data.get(env.key),bytes);assert.equal(JSON.stringify(env.intent.readState().spec),before);
 }
});

test('unreadable legacy assembly prevents migration and preserves the bytes',async()=>{
 const env=await setup({malformed:true});assert.equal(env.data.get(env.key),'unreadable original assembly bytes');assert.equal(env.data.has(PROJECT_STORE_KEY),false);
 assert.match(env.get('#solid-status').textContent,/JSON|Unexpected|position/i);
});

test('AI project revision preserves orphan CAD and reports its removed BOM target',()=>{
 const {project,assembly}=fixture(),before=JSON.stringify(project),patch={summary:'Remove the plate record.'};
 for(const section of ['parts','wires','mechanicalConnections','steps','powerRails'])patch[section]={add:[],replace:[],remove:[]};
 for(const section of ['tools','assumptions'])patch[section]={add:[],remove:[]};
 patch.parts.remove=['plate'];
 const result=proposeProjectChange(project,patch,'Remove plate from the parts list.','local-model');
 assert.equal(JSON.stringify(project),before);assert.deepEqual(result.project.assemblySpec,assembly);
 assert.ok(assemblyIssues(result.project.assemblySpec,result.project.parts).some(issue=>issue.code==='missing-bom-part'&&issue.partId==='plate'));
 assert.equal(result.project.review.mechanical,false);assert.equal(result.project.parts.some(part=>part.id==='plate'),false);
});

test('bound modeler keeps one canonical assembly across further saves and Undo',async()=>{
 for(const sidecar of [true,false]){
  const env=await setup({sidecar}),sync=()=>assert.deepEqual(env.workspace().projects[0].assemblySpec,env.stored());
  await env.save(48);const before=env.intent.readState().projectSignature;sync();assert.equal(env.intent.readState().blocked,false);assert.equal(env.intent.readState().projectSignature,before);
  await await env.intent.apply(solid(52));assert.equal(env.stored().assets[0].source.features[0].size[0],52);sync();
  await env.get('#solid-undo').click();assert.equal(env.stored().assets[0].source.features[0].size[0],48);sync();
  await env.get('#solid-undo').click();assert.equal(env.stored().assets[0].source.features[0].size[0],10);sync();
  await env.get('#solid-redo').click();assert.equal(env.stored().assets[0].source.features[0].size[0],48);
  assert.deepEqual(env.stored().assets[1],env.assembly.assets[1]);assert.deepEqual(env.stored().instances,env.assembly.instances);
 }
});

test('bound modeler rejects conflicting embedded source after its own saved source was synced',async()=>{
 const env=await setup();await env.save(48);await env.intent.apply(solid(52));const bytes=env.data.get(env.key),before=JSON.stringify(env.intent.readState().spec);
 env.mutateProject(p=>{p.assemblySpec.instances[0].position[0]=99;});
 assert.equal(env.intent.readState().blocked,true);await assert.rejects(env.intent.apply(solid(54)),/embedded assembly changed|changed/);assert.equal(env.data.get(env.key),bytes);assert.equal(JSON.stringify(env.intent.readState().spec),before);
});
test('source typed while a bound save waits remains available rather than being overwritten',async()=>{
 const env=await setup(),before=env.stored();env.get('#solid-source').value=JSON.stringify(solid(48));env.locks.hold();const pending=env.get('#solid-apply').click();env.get('#solid-source').value=JSON.stringify(solid(52));env.locks.release();await pending;
 assert.deepEqual(env.stored(),before);assert.equal(JSON.parse(env.get('#solid-source').value).features[0].size[0],52);assert.match(env.get('#solid-status').textContent,/changed while saving/);
});
test('project revision during a bound source file read refuses the older import',async()=>{
 const env=await setup(),before=env.get('#solid-source').value;let finish;const pendingText=new Promise(resolve=>{finish=resolve;});
 const pending=env.get('#solid-import').handlers.get('change')({target:{files:[{size:100,text:()=>pendingText}],value:'selected'}});
 env.mutateProject(p=>{p.title='Newer project';});finish(JSON.stringify(solid(48)));await pending;
 assert.equal(env.get('#solid-source').value,before);assert.match(env.get('#solid-status').textContent,/changed while the file was read/);
});
test('external project change disables stale CAD generation without discarding source',async()=>{
 const env=await setup(),before=env.get('#solid-source').value;env.mutateProject(p=>{p.title='Other tab revision';});env.events.get('storage')({key:PROJECT_STORE_KEY});
 assert.equal(env.get('#solid-preview').disabled,true);assert.equal(env.get('#solid-package').disabled,true);assert.equal(env.get('#solid-source').value,before);assert.match(env.get('#solid-status').textContent,/changed elsewhere/);
});
