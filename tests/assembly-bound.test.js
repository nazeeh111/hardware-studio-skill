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
function setup({malformed=false,sidecar=true}={}){
 const {project,assembly}=fixture(),data=new Map([[STORAGE_KEY,JSON.stringify({projects:[project],currentId:project.id})]]),session=new Map(),nodes=new Map();
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
 const sandbox={validateSolidSpec,solidContext,validateAssemblySpec,emptyAssembly,setAssemblyPartSource,parseSavedWorkspace,STORAGE_KEY,writeWorkspace,WorkspaceConflictError,
  installSolidIntent:api=>{intent=api;return {refresh(){}};},createSolidEditor:()=>({setSource(){return true;}}),
  SOLID_PREVIEW_KEY:'preview',solidSnapshot(){throw new Error('Preview unused in this harness');},
  location:{search:'?project=project-1&part=plate',href:''},localStorage:storage,sessionStorage:{getItem:key=>session.get(key)??null,setItem:(key,value)=>session.set(key,value),removeItem:key=>session.delete(key)},
  document:{querySelector:get,querySelectorAll:()=>[get('header a.back'),get('header a.other')],createElement:()=>new Element()},
  fetch:async()=>({ok:true,json:async()=>({ok:true,features:['profile-solid-v1']})}),AbortSignal,structuredClone,URL,URLSearchParams,Blob,setTimeout(){},console};
 vm.runInNewContext(executable,sandbox,{filename:'solid-workbench.js'});
 assert.ok(intent,'Workbench did not initialize its intent controller');
 const save=async width=>{get('#solid-source').value=JSON.stringify(solid(width));await get('#solid-apply').click();};
 const stored=()=>JSON.parse(data.get(key)),workspace=()=>JSON.parse(data.get(STORAGE_KEY));
 const mutateProject=change=>{const current=workspace();change(current.projects[0]);data.set(STORAGE_KEY,JSON.stringify(current));};
 return {data,key,nodes,get,intent,save,stored,workspace,mutateProject,assembly,project,session};
}

test('bound manual save, undo and redo replace only their asset and preserve placement bytes',async()=>{
 const env=setup(),before=env.stored();await env.save(48);
 assert.equal(env.stored().assets[0].source.features[0].size[0],48);
 assert.deepEqual(env.stored().assets[1],before.assets[1]);assert.deepEqual(env.stored().instances,before.instances);
 assert.deepEqual(env.workspace().projects[0].assemblySpec,before,'Bound workbench must not replace embedded project records');
 await env.get('#solid-undo').click();assert.deepEqual(env.stored(),before);
 await env.get('#solid-redo').click();assert.equal(env.stored().assets[0].source.features[0].size[0],48);
});

test('first bound save without a sidecar preserves embedded sources and placements',async()=>{
 const env=setup({sidecar:false});await env.save(48);
 assert.equal(env.stored().assets[0].source.features[0].size[0],48);assert.deepEqual(env.stored().assets[1],env.assembly.assets[1]);assert.deepEqual(env.stored().instances,env.assembly.instances);
});

test('another part edit blocks stale saves and retains working source for export',async()=>{
 const env=setup(),external=setAssemblyPartSource(env.assembly,'spacer',solid(9));env.data.set(env.key,JSON.stringify(external));await env.save(48);
 assert.deepEqual(env.stored(),external);assert.equal(env.intent.readState().blocked,true);assert.equal(env.intent.readState().spec.features[0].size[0],48);
 assert.ok([...env.session.values()].some(value=>value.includes('48')),'Unpersisted working source must be retained in tab storage');
 assert.equal(env.get('#solid-recovery').hidden,false);assert.equal(env.get('#solid-replace').disabled,true);
});

test('removed BOM target and changed embedded assembly block direct proposal apply before source mutation',()=>{
 for(const mutation of [p=>p.parts=p.parts.filter(part=>part.id!=='plate'),p=>p.parts[0].name='Different hardware',p=>p.assemblySpec.instances[0].position[0]=99,p=>p.parts.push({...p.parts[0],name:'Ambiguous duplicate'})]){
  const env=setup(),bytes=env.data.get(env.key),before=JSON.stringify(env.intent.readState().spec);env.mutateProject(mutation);
  assert.throws(()=>env.intent.apply(solid(48)),/no longer exists|changed|duplicated/);assert.equal(env.data.get(env.key),bytes);assert.equal(JSON.stringify(env.intent.readState().spec),before);
 }
});

test('unreadable assembly bytes cannot be replaced by a single bound source',async()=>{
 const env=setup({malformed:true}),original=env.data.get(env.key);assert.equal(env.intent.readState().blocked,true);await env.save(48);
 assert.equal(env.data.get(env.key),original);assert.equal(env.get('#solid-recovery').hidden,false);
 await env.get('#solid-backup').click();assert.equal(env.get('#solid-replace').disabled,true);
 assert.match(env.get('#solid-status').textContent,/repair or import the complete assembly/);
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

test('bound modeler accepts studio autosync of its own assembly across further saves and Undo',async()=>{
 for(const sidecar of [true,false]){
  const env=setup({sidecar}),sync=()=>env.mutateProject(p=>{p.assemblySpec=env.stored();p.updatedAt='2026-10-23T20:00:00Z';p.review.mechanical=false;});
  await env.save(48);const before=env.intent.readState().projectSignature;sync();assert.equal(env.intent.readState().blocked,false);assert.equal(env.intent.readState().projectSignature,before);
  env.intent.apply(solid(52));assert.equal(env.stored().assets[0].source.features[0].size[0],52);sync();
  await env.get('#solid-undo').click();assert.equal(env.stored().assets[0].source.features[0].size[0],48);sync();
  await env.get('#solid-undo').click();assert.equal(env.stored().assets[0].source.features[0].size[0],10);sync();
  await env.get('#solid-redo').click();assert.equal(env.stored().assets[0].source.features[0].size[0],48);
  assert.deepEqual(env.stored().assets[1],env.assembly.assets[1]);assert.deepEqual(env.stored().instances,env.assembly.instances);
 }
});

test('bound modeler rejects conflicting embedded source after its own saved source was synced',async()=>{
 const env=setup();await env.save(48);env.mutateProject(p=>{p.assemblySpec=env.stored();});
 env.intent.apply(solid(52));const bytes=env.data.get(env.key),before=JSON.stringify(env.intent.readState().spec);
 env.mutateProject(p=>{p.assemblySpec.instances[0].position[0]=99;});
 assert.equal(env.intent.readState().blocked,true);assert.throws(()=>env.intent.apply(solid(54)),/embedded assembly changed/);assert.equal(env.data.get(env.key),bytes);assert.equal(JSON.stringify(env.intent.readState().spec),before);
});
