import {needsCurvedRuntime} from '../solid-spec.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {validateAssemblySpec,emptyAssembly,setAssemblyPartSource,assemblyIssues,ASSEMBLY_MAX_BYTES} from '../assembly-spec.js';
import {assemblyKey} from '../project-geometry.js';
import {parseSavedWorkspace,STORAGE_KEY,blankProject} from '../core.js';
import {writeWorkspace,WorkspaceConflictError} from '../workspace-store.js';
import {createProjectStore,PROJECT_STORE_KEY,ProjectStoreConflict} from '../project-store.js';
import {assemblySnapshot,ASSEMBLY_PREVIEW_KEY} from '../assembly-preview.js';
import {editableAssembly,normalizeAssemblyDraft} from '../assembly-editor.js';

const executable=(await readFile(new URL('../assembly-workbench.js',import.meta.url),'utf8')).replace(/^import .*?;\n/gm,'');
const source={schema:'hardware-studio-solid-v1',title:'Block',units:'mm',features:[{id:'body',operation:'add',shape:'box',origin:[0,0,0],size:[10,20,3]}],probes:[]};
const walk=node=>[node,...node.children.flatMap(walk)];
async function setup({malformed=false,orphan=false,sharedData=null,sharedSession=null,sessionUnavailable=false}={}){
 const p=blankProject();p.id='assembly-project';p.title='Fixture';p.parts=[{id:'plate',name:'Plate',qty:1},{id:'spacer',name:'Spacer',qty:1}];
 p.assemblySpec=setAssemblyPartSource(null,'plate',source,'Fixture');p.assemblySpec.instances=[{id:'one',partId:'plate',position:[1,2,3],rotation:[0,0,0]}];
 if(orphan)p.parts=p.parts.filter(part=>part.id!=='plate');
 const key=assemblyKey(p.id),data=sharedData??new Map([[STORAGE_KEY,JSON.stringify({projects:[p],currentId:p.id})],[key,malformed?'unreadable bytes':JSON.stringify(p.assemblySpec)]]),nodes=new Map(),session=sharedSession??new Map(),downloads=[];
 class Element{
  constructor(tag='div'){Object.assign(this,{tagName:tag,children:[],handlers:new Map(),_value:'',textContent:'',disabled:false,hidden:true});}
  get value(){return this._value;}
  set value(v){this._value=this.tagName==='select'&&!this.children.some(c=>c.value===String(v))?'':String(v);}
  get options(){return this.children;}
  append(...children){const wasEmpty=!this.children.length;this.children.push(...children);if(this.tagName==='select'&&wasEmpty&&children.length)this._value=children[0].value;}
  replaceChildren(...children){this.children=[];if(this.tagName==='select')this._value='';this.append(...children);}
  addEventListener(name,handler){this.handlers.set(name,handler);}
  click(){if(this.tagName==='a')downloads.push({name:this.download,data:this.href});if(!this.disabled)return this.handlers.get('click')?.();}
  input(value){if(this.disabled)return;this.value=value;this.handlers.get(this.tagName==='select'?'change':'input')?.();}
 }
 const selectIds=['attach-part','place-part'];
 const get=id=>{if(!nodes.has(id))nodes.set(id,new Element(selectIds.includes(id)?'select':'div'));return nodes.get(id);};
 const storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
 let releaseLock=null,gate=null;const locks={hold(){gate=new Promise(resolve=>{releaseLock=resolve;});},release(){releaseLock();gate=null;},request(_name,_options,fn){const wait=gate;return (wait||Promise.resolve()).then(fn);}};
 const sandbox={createProjectStore,PROJECT_STORE_KEY,ProjectStoreConflict,navigator:{locks},needsCurvedRuntime,editableAssembly,normalizeAssemblyDraft,validateAssemblySpec,emptyAssembly,setAssemblyPartSource,assemblyIssues,ASSEMBLY_MAX_BYTES,assemblyKey,parseSavedWorkspace,STORAGE_KEY,writeWorkspace,WorkspaceConflictError,assemblySnapshot,ASSEMBLY_PREVIEW_KEY,
  document:{getElementById:id=>get(id.replace(/^assembly-/,'')),createElement:tag=>new Element(tag),querySelectorAll:()=>[]},
  localStorage:storage,sessionStorage:{getItem:key=>{if(sessionUnavailable)throw new Error('Storage unavailable');return session.get(key)??null;},setItem:(key,value)=>{if(sessionUnavailable)throw new Error('Storage unavailable');session.set(key,value);},removeItem:key=>session.delete(key)},
  location:{search:'?project=assembly-project'},URLSearchParams,URL:{createObjectURL:()=>String(downloads.length),revokeObjectURL(){}},Blob,TextEncoder,structuredClone,AbortSignal,addEventListener(){},setTimeout(){},
  fetch:async()=>({ok:true,json:async()=>({ok:true,features:['placed-assembly-v1','sampled-mesh-readback-v1']})}),console};
 vm.runInNewContext(executable,sandbox,{filename:'assembly-workbench.js'});
 await new Promise(resolve=>setImmediate(resolve));
 return {get,data,key,session,downloads,p,locks,read:()=>JSON.parse(get('source').value),saved:()=>JSON.parse(data.get(PROJECT_STORE_KEY)).workspace.projects[0].assemblySpec,mutateProject:change=>{const state=JSON.parse(data.get(PROJECT_STORE_KEY));change(state.workspace.projects[0]);state.generation++;data.set(PROJECT_STORE_KEY,JSON.stringify(state));},fields:()=>walk(get('instances')).filter(node=>node.tagName==='input'),buttons:()=>walk(get('instances')).filter(node=>node.tagName==='button')};
}

test('existing source is selected initially and Add instance creates an explicit unpersisted placement',async()=>{
 const env=await setup();assert.equal(env.get('place-part').value,'plate');assert.equal(env.get('add').disabled,false);env.get('add').click();
 assert.equal(env.read().instances.length,2);assert.deepEqual(env.read().instances[1].position,[0,0,0]);assert.equal(env.saved().instances.length,1);
 await env.get('apply').click();assert.equal(env.saved().instances.length,2);
 assert.ok(walk(env.get('issues')).some(node=>node.textContent.includes('records 1 units; the assembly places 2')));
});

test('structured placement edits cannot discard unread JSON or its retained draft',async()=>{
 const mutations=[env=>env.get('title').input('Changed title'),env=>env.fields()[0].input('new-id'),env=>env.fields()[1].input('42'),env=>env.buttons()[0].click(),env=>walk(env.get('instances')).find(node=>node.tagName==='select').input('plate')];
 for(const mutate of mutations){const env=await setup(),draft=JSON.stringify({...env.read(),title:'User JSON not yet read'},null,2);env.get('source').input(draft);mutate(env);assert.equal(env.get('source').value,draft);assert.ok([...env.session.values()].map(JSON.parse).some(value=>value.kind==='json'&&value.data===draft));}
});

test('concurrent assembly edits trigger recovery without losing the unapplied working source',async()=>{
 const env=await setup();env.fields()[1].input('42');const external=structuredClone(env.p.assemblySpec);external.instances[0].position[1]=99;env.data.set(env.key,JSON.stringify(external));await env.get('apply').click();
 assert.deepEqual(env.saved(),env.p.assemblySpec);assert.equal(env.data.get(env.key),JSON.stringify(external));assert.equal(env.read().instances[0].position[0],'42');assert.equal(env.get('recovery').hidden,false);assert.equal(env.get('replace').disabled,true);
 env.get('backup').click();assert.equal(env.get('replace').disabled,false);
 const newer=structuredClone(external);newer.title='Even newer';env.data.set(env.key,JSON.stringify(newer));await env.get('replace').click();assert.equal(env.data.get(env.key),JSON.stringify(newer));assert.deepEqual(env.saved(),env.p.assemblySpec);assert.equal(env.get('replace').disabled,true);
});

test('changed BOM blocks saves while preserving editable work and its draft',async()=>{
 const env=await setup(),before=JSON.stringify(env.saved());env.fields()[1].input('42');env.mutateProject(p=>p.parts=p.parts.filter(part=>part.id!=='plate'));await env.get('apply').click();
 assert.equal(JSON.stringify(env.saved()),before);assert.equal(env.read().instances[0].position[0],'42');assert.match(env.get('status').textContent,/Project parts or embedded CAD changed/);assert.ok(env.session.size);
});

test('malformed legacy assembly blocks migration without changing bytes',async()=>{
 const env=await setup({malformed:true});assert.equal(env.data.get(env.key),'unreadable bytes');assert.equal(env.data.has(PROJECT_STORE_KEY),false);
});

test('file import cannot replace newer structured edits or unread source typed during its read',async()=>{
 for(const mutate of [env=>env.fields()[1].input('42'),env=>env.get('source').input('Unread newer JSON bytes')]){
  const env=await setup();let finish;const text=new Promise(resolve=>{finish=resolve;});const event={target:{files:[{size:100,text:()=>text}],value:'chosen'}};
  const pending=env.get('file').handlers.get('change')(event);mutate(env);const latest=env.get('source').value;finish(JSON.stringify({...env.p.assemblySpec,title:'Earlier file'}));await pending;
  assert.equal(env.get('source').value,latest);assert.match(env.get('status').textContent,/Working source changed during import/);assert.equal(event.target.value,'');
 }
});

test('invalid import leaves current complete source, placement and saved bytes intact',async()=>{
 const env=await setup(),before=env.get('source').value,saved=JSON.stringify(env.saved());
 await env.get('file').handlers.get('change')({target:{files:[{size:20,text:async()=>'{invalid JSON'}],value:'chosen'}});
 assert.equal(env.get('source').value,before);assert.equal(JSON.stringify(env.saved()),saved);
});

test('explicit orphan rebinding preserves source and transforms while changing every matching reference',async()=>{
 const env=await setup({orphan:true}),before=env.saved();const action=walk(env.get('parts')).find(node=>node.tagName==='button'&&node.textContent==='Rebind source + placements');
 assert.ok(action);action.click();const working=env.read();assert.equal(working.assets[0].partId,'spacer');assert.deepEqual(working.assets[0].source,before.assets[0].source);assert.equal(working.instances[0].partId,'spacer');assert.deepEqual(working.instances[0].position,before.instances[0].position);assert.deepEqual(working.instances[0].rotation,before.instances[0].rotation);assert.deepEqual(env.saved(),before);
 await env.get('apply').click();assert.deepEqual(env.saved(),working);
});

test('one canonical assembly permits a second save, Undo and Redo',async()=>{
 const env=await setup(),sync=()=>assert.deepEqual(env.saved(),JSON.parse(env.data.get(PROJECT_STORE_KEY)).workspace.projects[0].assemblySpec);
 env.fields()[1].input('42');await env.get('apply').click();assert.equal(env.saved().instances[0].position[0],42);sync();
 env.fields()[2].input('53');await env.get('apply').click();assert.equal(env.saved().instances[0].position[1],53);assert.doesNotMatch(env.get('status').textContent,/changed/);sync();
 await env.get('undo').click();assert.equal(env.saved().instances[0].position[0],42);assert.equal(env.saved().instances[0].position[1],2);sync();
 await env.get('undo').click();assert.equal(env.saved().instances[0].position[0],1);sync();
 await env.get('redo').click();assert.equal(env.saved().instances[0].position[0],42);sync();await env.get('redo').click();assert.equal(env.saved().instances[0].position[1],53);
});

test('a third embedded geometry state is rejected after an own save without replacing sidecar or draft',async()=>{
 const env=await setup();env.fields()[1].input('42');await env.get('apply').click();
 env.mutateProject(p=>{p.assemblySpec.instances[0].rotation[0]=90;p.updatedAt='2026-10-23T20:01:00Z';});const saved=JSON.stringify(env.saved());
 env.fields()[2].input('53');assert.equal(env.get('apply').disabled,true);await env.get('apply').handlers.get('click')();assert.equal(JSON.stringify(env.saved()),saved);assert.equal(env.read().instances[0].position[1],'53');assert.match(env.get('status').textContent,/Project parts or embedded CAD changed/);assert.ok([...env.session.values()].some(text=>text.includes('53')));
});

test('reload restores unfinished controls as editable controls, preserving the applied assembly',async()=>{
 const original=await setup(),saved=JSON.stringify(original.saved());original.fields()[0].input('');original.fields()[1].input('');original.fields()[2].input('4e');original.get('title').input('');
 const retained=JSON.parse([...original.session.values()][0]);assert.equal(retained.kind,'controls');assert.equal(retained.data.instances[0].position[0],'');
 const env=await setup({sharedData:original.data,sharedSession:original.session});assert.equal(env.fields()[0].value,'');assert.equal(env.fields()[1].value,'');assert.equal(env.fields()[2].value,'4e');assert.equal(env.get('title').value,'');assert.equal(JSON.stringify(env.saved()),saved);assert.equal(env.get('add').disabled,false);
 await env.get('apply').click();assert.equal(JSON.stringify(env.saved()),saved);assert.match(env.get('status').textContent,/Complete every|invalid|title/i);
 env.fields()[0].input('restored-one');env.fields()[1].input('42');env.fields()[2].input('53');env.get('title').input('Restored controls');await env.get('apply').click();assert.equal(env.saved().instances[0].position[0],42);assert.equal(env.saved().title,'Restored controls');assert.equal(env.session.size,0);
});

test('reload preserves raw JSON kind and exact bytes until explicitly read or discarded',async()=>{
 const original=await setup(),text='  {"unfinished JSON":  ';original.get('source').input(text);const record=JSON.parse([...original.session.values()][0]);assert.equal(record.kind,'json');assert.equal(record.data,text);
 const env=await setup({sharedData:original.data,sharedSession:original.session});assert.equal(env.get('source').value,text);assert.match(env.get('status').textContent,/Unapplied assembly text restored/);env.get('title').input('Ignored change');assert.equal(env.get('source').value,text);env.get('revert').click();assert.deepEqual(env.read(),env.saved());
});

test('malformed stored draft bytes are exposed for export without replacing applied CAD or storage',async()=>{
 const original=await setup(),draftKey=original.key+'-draft-v1',bad='{broken retained bytes';original.session.set(draftKey,bad);const saved=JSON.stringify(original.saved());
 const env=await setup({sharedData:original.data,sharedSession:original.session});assert.equal(env.get('source').value,bad);assert.equal(env.session.get(draftKey),bad);assert.equal(JSON.stringify(env.saved()),saved);assert.match(env.get('status').textContent,/original bytes are shown for export/);
});

test('unavailable tab storage keeps working edits exportable and displays the retention failure',async()=>{
 const env=await setup({sessionUnavailable:true});assert.match(env.get('retention').textContent,/Tab storage unavailable/);env.fields()[1].input('42');assert.equal(env.read().instances[0].position[0],'42');assert.match(env.get('retention').textContent,/memory only/i);env.get('export').click();assert.equal(env.downloads.length,1);
 env.get('source').input('Unread draft');assert.equal(env.get('source').value,'Unread draft');assert.match(env.get('retention').textContent,/memory only/i);
});
test('placement edits made while a save waits remain as a draft and do not commit the older capture',async()=>{
 const env=await setup(),before=env.saved();env.fields()[1].input('42');env.locks.hold();const pending=env.get('apply').click();env.fields()[2].input('53');env.locks.release();await pending;
 assert.deepEqual(env.saved(),before);assert.equal(env.read().instances[0].position[0],'42');assert.equal(env.read().instances[0].position[1],'53');assert.match(env.get('status').textContent,/changed while saving/);
});
test('project revision during an assembly file read refuses the old import',async()=>{
 const env=await setup();let finish;const pendingText=new Promise(resolve=>{finish=resolve;});const before=env.get('source').value;
 const pending=env.get('file').handlers.get('change')({target:{files:[{size:100,text:()=>pendingText}],value:'selected'}});
 env.mutateProject(p=>{p.title='Newer project';});finish(JSON.stringify({...env.p.assemblySpec,title:'Older file'}));await pending;
 assert.equal(env.get('source').value,before);assert.match(env.get('status').textContent,/changed during import/);
});
