import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {blankProject,STORAGE_KEY,projectContentChanged,restoreProjectFromRevision} from '../core.js';
import {createProjectStore,ProjectStoreConflict,PROJECT_STORE_KEY} from '../project-store.js';
const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
function func(name){const m=new RegExp(`^(?:async )?function ${name}\\(`,'m').exec(source);assert.ok(m);const next=/^(?:async )?function /gm;next.lastIndex=m.index+m[0].length;const end=next.exec(source);return source.slice(m.index,end?end.index:undefined);}
const production=['readRevisions','recordRevision','draftWorkspace','save','saveWithRollback','restoreRevision','recoverDeletedProject','handleClick'].map(func).join('\n');
test('actual studio handlers commit history atomically, preserve failed draft and restore',async()=>{
 const data=new Map(),p=blankProject('Before'),nodes=new Map();data.set(STORAGE_KEY,JSON.stringify({projects:[p],currentId:p.id}));let fail=false;
 const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>{if(fail&&k===PROJECT_STORE_KEY)throw Error('quota');data.set(k,v);}},locks={request(_n,_o,fn){return Promise.resolve().then(fn);}};
 const store=createProjectStore({storage,locks}),opened=await store.open(),get=k=>{if(!nodes.has(k))nodes.set(k,{open:false,disabled:false,textContent:'',showModal(){this.open=true;},close(){this.open=false;}});return nodes.get(k);};
 const box={notesDrafts:new Map(),projects:structuredClone(opened.document.workspace.projects),currentId:p.id,revisions:opened.document.revisions,projectStore:store,expectedWorkspaceRaw:opened.raw,storageUnavailable:false,unreadableSavedData:null,saving:false,conflictingWorkspace:null,ProjectStoreConflict,projectContentChanged,restoreProjectFromRevision,structuredClone,crypto:globalThis.crypto,$:get,render(){},showToast(){},showRecovery(){},activeTab:'overview'};
 box.current=()=>box.projects.find(q=>q.id===box.currentId);vm.runInNewContext(production,box);box.projects[0].title='After';assert.equal(await box.save('Before edit'),true);
 let doc=JSON.parse(storage.getItem(PROJECT_STORE_KEY));assert.equal(doc.workspace.projects[0].title,'After');assert.equal(doc.revisions[0].snapshot.title,'Before');
 const before=structuredClone(box.projects[0]),saved=storage.getItem(PROJECT_STORE_KEY);box.projects[0].title='Unsaved';box.notesDrafts.set(p.id,'Later unsaved notes');fail=true;assert.equal(await box.saveWithRollback(box.projects[0],before,'Before failing'),false);
 assert.equal(storage.getItem(PROJECT_STORE_KEY),saved);assert.equal(box.projects[0].title,'After');assert.equal(JSON.parse(box.conflictingWorkspace).projects[0].title,'Unsaved');assert.equal(JSON.parse(box.conflictingWorkspace).projects[0].notes,'Later unsaved notes');assert.equal(get('#conflict-dialog').open,true);
 fail=false;await box.restoreRevision(doc.revisions[0].id);doc=JSON.parse(storage.getItem(PROJECT_STORE_KEY));assert.equal(doc.workspace.projects[0].title,'Before');assert.equal(doc.revisions.length,2);assert.equal(doc.workspace.projects[0].review.mechanical,false);
});

test('actual delete and recovery publish project and history in the same generation',async()=>{
 const data=new Map(),a=blankProject('A'),b=blankProject('B');data.set(STORAGE_KEY,JSON.stringify({projects:[a,b],currentId:a.id}));
 const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)},locks={request(_n,_o,fn){return Promise.resolve().then(fn);}};
 const store=createProjectStore({storage,locks}),opened=await store.open(),nodes=new Map(),get=k=>{if(!nodes.has(k))nodes.set(k,{open:false,disabled:false,textContent:'',showModal(){this.open=true;},close(){this.open=false;}});return nodes.get(k);};
 const box={notesDrafts:new Map(),projects:structuredClone(opened.document.workspace.projects),currentId:a.id,revisions:opened.document.revisions,projectStore:store,expectedWorkspaceRaw:opened.raw,storageUnavailable:false,unreadableSavedData:null,saving:false,conflictingWorkspace:null,ProjectStoreConflict,projectContentChanged,restoreProjectFromRevision,structuredClone,crypto:globalThis.crypto,$:get,render(){},showToast(){},showRecovery(){},activeTab:'overview',syncCurrentGeometry(){return true;},window:{confirm:()=>true}};
 box.current=()=>box.projects.find(q=>q.id===box.currentId);vm.runInNewContext(production,box);
 await box.handleClick({target:{closest:()=>({id:'delete-project',dataset:{}})}});let doc=JSON.parse(storage.getItem(PROJECT_STORE_KEY));assert.equal(doc.workspace.projects.some(p=>p.id===a.id),false);const deleted=doc.revisions.find(r=>r.reason==='Deleted project');assert.equal(deleted.snapshot.id,a.id);
 await box.recoverDeletedProject(deleted.id);doc=JSON.parse(storage.getItem(PROJECT_STORE_KEY));assert.equal(doc.workspace.projects.some(p=>p.id===a.id),true);assert.equal(doc.workspace.projects.find(p=>p.id===a.id).review.mechanical,false);
});
test('revision changed during delete confirmation is refused and attempted deletion remains exportable',async()=>{
 const data=new Map(),a=blankProject('A'),b=blankProject('B');data.set(STORAGE_KEY,JSON.stringify({projects:[a,b],currentId:a.id}));
 const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)},locks={request(_n,_o,fn){return Promise.resolve().then(fn);}},store=createProjectStore({storage,locks}),opened=await store.open(),nodes=new Map(),get=k=>{if(!nodes.has(k))nodes.set(k,{open:false,disabled:false,textContent:'',showModal(){this.open=true;},close(){this.open=false;}});return nodes.get(k);};
 const box={notesDrafts:new Map(),projects:structuredClone(opened.document.workspace.projects),currentId:a.id,revisions:opened.document.revisions,projectStore:store,expectedWorkspaceRaw:opened.raw,storageUnavailable:false,unreadableSavedData:null,saving:false,conflictingWorkspace:null,ProjectStoreConflict,projectContentChanged,restoreProjectFromRevision,structuredClone,crypto:globalThis.crypto,$:get,render(){},showToast(){},showRecovery(){},activeTab:'overview',syncCurrentGeometry(){return true;},window:{confirm(){const d=JSON.parse(data.get(PROJECT_STORE_KEY));d.generation++;d.workspace.projects[0].title='Newer external';data.set(PROJECT_STORE_KEY,JSON.stringify(d));return true;}}};
 box.current=()=>box.projects.find(q=>q.id===box.currentId);vm.runInNewContext(production,box);await box.handleClick({target:{closest:()=>({id:'delete-project',dataset:{}})}});
 const doc=JSON.parse(data.get(PROJECT_STORE_KEY));assert.equal(doc.workspace.projects[0].title,'Newer external');assert.equal(box.projects.length,2);assert.equal(JSON.parse(box.conflictingWorkspace).projects.some(p=>p.id===a.id),false);assert.equal(get('#conflict-dialog').open,true);
});
test('lock-unavailable edit remains exportable instead of silently disappearing',async()=>{
 const p=blankProject('Before'),nodes=new Map(),get=k=>{if(!nodes.has(k))nodes.set(k,{open:false,disabled:false,textContent:'',showModal(){this.open=true;},close(){this.open=false;}});return nodes.get(k);};
 const box={notesDrafts:new Map(),projects:[p],currentId:p.id,revisions:[],projectStore:null,expectedWorkspaceRaw:null,storageUnavailable:true,unreadableSavedData:null,saving:false,conflictingWorkspace:null,ProjectStoreConflict,projectContentChanged,restoreProjectFromRevision,structuredClone,crypto:globalThis.crypto,$:get,render(){},showToast(){},showRecovery(){},activeTab:'overview'};
 box.current=()=>box.projects[0];vm.runInNewContext(production,box);const before=structuredClone(p);p.title='Attempted';assert.equal(await box.saveWithRollback(p,before,'edit'),false);
 assert.equal(p.title,'Before');assert.equal(JSON.parse(box.conflictingWorkspace).projects[0].title,'Attempted');assert.equal(get('#conflict-dialog').open,true);
});
