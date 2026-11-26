import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {blankProject,STORAGE_KEY} from '../core.js';
import {validateTraySpec} from '../tray-spec.js';
import {createProjectStore,ProjectStoreConflict,PROJECT_STORE_KEY} from '../project-store.js';
import {WorkspaceConflictError,writeWorkspace} from '../workspace-store.js';

const text=await readFile(new URL('../tray-workbench.js',import.meta.url),'utf8');
const start=text.indexOf('async function show('),end=text.indexOf('\nfunction fitRow(',start);
assert.ok(start>=0&&end>start);const buttonStart=text.indexOf('function updateCadButton()'),buttonEnd=text.indexOf('\nasync function detectCadService()',buttonStart);const production=text.slice(buttonStart,buttonEnd)+'\n'+text.slice(start,end);
const original=JSON.parse(await readFile(new URL('../tools/tray-generator/examples/pico-neopixel-tray.json',import.meta.url),'utf8'));

test('actual tray save keeps the later form while a prior commit waits',async()=>{
 const data=new Map(),storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)},project=blankProject('Tray');project.traySpec=original;
 data.set(STORAGE_KEY,JSON.stringify({projects:[project],currentId:project.id}));let release,hold=null,tail=Promise.resolve();
 const locks={request(_n,_o,fn){const gate=hold;const next=tail.then(()=>gate).then(fn);tail=next.catch(()=>{});return next;}};
 const owner=createProjectStore({storage,locks}),opened=await owner.open();hold=new Promise(resolve=>{release=resolve;});
 const nodes=new Map(),get=s=>{if(!nodes.has(s))nodes.set(s,{textContent:'',innerHTML:'',hidden:true,disabled:false,classList:{add(){},remove(){}},replaceChildren(){}});return nodes.get(s);};
 let form=structuredClone(original);const sandbox={owner,localStorage:storage,PROJECT_STORE_KEY,ProjectStoreConflict,WorkspaceConflictError,writeWorkspace,projectId:project.id,storageKey:'tray',storeRaw:opened.raw,expectedTrayRaw:JSON.stringify(original),trayStorageBlocked:false,preservedTrayRaw:null,saveSequence:0,traySaved:false,fitRevision:0,fitReport:null,draft:null,cadAvailable:true,previewAvailable:true,cadBusy:false,fitBusy:false,validateTraySpec,readForm:()=>form,svg:()=>'<svg></svg>',$:get,structuredClone,console};
 vm.runInNewContext(production,sandbox);form=structuredClone(original);form.outer.length+=1;const first=sandbox.show();form=structuredClone(form);form.outer.length+=1;const second=sandbox.show();release();await Promise.all([first,second]);
 const saved=JSON.parse(storage.getItem(PROJECT_STORE_KEY)).workspace.projects[0];assert.equal(saved.traySpec.outer.length,original.outer.length+2);assert.equal(sandbox.draft.outer.length,original.outer.length+2);assert.match(get('#status').textContent,/Draft saved/);assert.equal(get('#generate-cad').disabled,false);
 const external=JSON.parse(storage.getItem(PROJECT_STORE_KEY));external.generation++;storage.setItem(PROJECT_STORE_KEY,JSON.stringify(external));sandbox.updateCadButton();assert.equal(get('#generate-cad').disabled,true);assert.equal(get('#download').disabled,false);
});
