import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {blankProject,safeProject,parseSavedWorkspace,setProjectSolidSpec,setProjectAssemblySpec,restoreProjectFromRevision} from '../core.js';
import {projectWithGeometry,readGeometryState,replaceGeometryCache,trayKey,solidKey,assemblyKey,solidContext} from '../project-geometry.js';
import {emptyAssembly,setAssemblyPartSource} from '../assembly-spec.js';
import {solidSnapshot,readSolidSnapshot} from '../solid-preview.js';
const solid=JSON.parse(await readFile(new URL('../tools/solid-generator/examples/mounting-bracket.json',import.meta.url),'utf8'));
function storage(){const data=new Map();return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};}
test('project geometry survives import, storage and history while clearing mechanical review',()=>{
 const project=blankProject();project.review.mechanical=true;
 assert.equal(setProjectSolidSpec(project,solid),true);assert.equal(project.review.mechanical,false);
 project.review.mechanical=true;assert.equal(setProjectSolidSpec(project,solid),false);assert.equal(project.review.mechanical,true);
 const imported=safeProject(project);assert.deepEqual(imported.solidSpec,project.solidSpec);assert.notEqual(imported.id,project.id);assert.equal(imported.review.mechanical,false);
 assert.deepEqual(parseSavedWorkspace(JSON.stringify({projects:[project],currentId:project.id})).projects[0].solidSpec,project.solidSpec);
 const restored=restoreProjectFromRevision(project,imported);assert.equal(restored.id,project.id);assert.deepEqual(restored.solidSpec,project.solidSpec);
 const bad=structuredClone(project);bad.solidSpec.features[0].size[0]=-1;
 assert.throws(()=>safeProject(bad));assert.throws(()=>parseSavedWorkspace(JSON.stringify({projects:[bad]})));
});
test('latest per-project source merges without attaching standalone examples or replacing unreadable bytes',()=>{
 const project=blankProject(),store=storage();store.setItem('hardware-studio-solid-model-v1',JSON.stringify(solid));
 assert.equal(projectWithGeometry(project,store),project);assert.equal(project.solidSpec,null);
 store.setItem(solidKey(project.id),JSON.stringify(solid));project.review.mechanical=true;
 const merged=projectWithGeometry(project,store);assert.deepEqual(merged.solidSpec,solid);assert.equal(merged.review.mechanical,false);assert.equal(project.solidSpec,null);
 store.setItem(solidKey(project.id),'bad bytes');assert.throws(()=>projectWithGeometry(project,store));assert.equal(store.getItem(solidKey(project.id)),'bad bytes');
 store.removeItem(solidKey(project.id));assert.deepEqual(projectWithGeometry(merged,store).solidSpec,solid);
});
test('partial cache failures restore actual prior bytes, and rollback refuses newer external edits',()=>{
 const p=blankProject();p.solidSpec=solid;const store=storage();store.setItem(trayKey(p.id),'prior tray bytes');
 const originalSet=store.setItem;store.setItem=(k,v)=>{if(k===solidKey(p.id))throw new Error('quota');originalSet(k,v);};
 assert.throws(()=>replaceGeometryCache(p,store),/quota/);assert.equal(store.getItem(trayKey(p.id)),'prior tray bytes');assert.equal(store.getItem(solidKey(p.id)),null);
 store.setItem=originalSet;const tx=replaceGeometryCache(p,store);assert.equal(store.getItem(trayKey(p.id)),null);
 store.setItem(solidKey(p.id),'new external bytes');
 assert.throws(()=>tx.rollback(),error=>{assert.deepEqual(error.recovery,[{key:solidKey(p.id),originalRaw:null}]);return true;});
 assert.equal(store.getItem(solidKey(p.id)),'new external bytes');assert.equal(store.getItem(trayKey(p.id)),'prior tray bytes');
});
test('project snapshot round trip retains only constrained local return context',()=>{
 const context=solidContext('?project=abc-123&title=Bracket%20study&unknown=x');
 assert.equal(context.key,'hardware-studio-solid-project-abc-123');assert.notEqual(context.draftKey,solidContext().draftKey);
 const frozen=solidSnapshot(solid,100000,'?project=abc-123&title=Bracket%20study');
 assert.equal(readSolidSnapshot(JSON.stringify(frozen),100001).returnTo,context.returnTo);
 assert.equal(context.studioTo,'./index.html?project=abc-123');
 for(const returnTo of ['https://example.com','//example.com','./solid.html/../../bad','./solid.html?project=../bad'])assert.throws(()=>readSolidSnapshot(JSON.stringify({...frozen,returnTo}),100001));
});

test('restoration refuses cache edits made after its geometry snapshot',()=>{
 const p=blankProject(),store=storage();p.solidSpec=solid;
 const state=readGeometryState(p,store);
 const newer=structuredClone(solid);newer.features[0].size[0]=75;
 store.setItem(solidKey(p.id),JSON.stringify(newer));
 assert.throws(()=>replaceGeometryCache(p,store,state.raw),/changed/);
 assert.equal(JSON.parse(store.getItem(solidKey(p.id))).features[0].size[0],75);
});

test('part-bound context uses an assembly sidecar and a collision-free encoded draft key',()=>{
 const partId='Left plate / A & B';
 const context=solidContext(`?project=abc-123&part=${encodeURIComponent(partId)}&title=Assembly%20study`);
 assert.equal(context.partId,partId);assert.equal(context.key,assemblyKey('abc-123'));
 assert.equal(solidContext(new URL(context.returnTo,'https://local.invalid').search).partId,partId);
 assert.equal(context.studioTo,'./index.html?project=abc-123');
 assert.notEqual(context.draftKey,solidContext('?project=abc-123&part=Left%20plate').draftKey);
 assert.notEqual(solidContext('?project=abc-123&part=a%2Fb').draftKey,solidContext('?project=abc-123&part=a%252Fb').draftKey);
 for(const search of ['?part=a','?project=abc&part=','?project=abc&part=%00','?project=abc&part='+encodeURIComponent('x'.repeat(81))])assert.throws(()=>solidContext(search),/Invalid part/);
 assert.equal(solidContext('?project=abc').key,solidKey('abc'));
 const frozen=solidSnapshot(solid,100000,`?project=abc-123&part=${encodeURIComponent(partId)}`);
 assert.equal(readSolidSnapshot(JSON.stringify(frozen),100001).returnTo,frozen.returnTo);
});

test('assembly sources survive import and history independently of legacy CAD and removed BOM rows',()=>{
 const p=blankProject(),legacy=structuredClone(solid);legacy.title='Legacy';p.solidSpec=legacy;
 let assembly=setAssemblyPartSource(null,'deleted-part',solid,'Assembly');assembly.instances.push({id:'one',partId:'deleted-part',position:[1,2,3],rotation:[0,0,90]});
 p.review.mechanical=true;assert.equal(setProjectAssemblySpec(p,assembly),true);assert.equal(p.review.mechanical,false);
 p.review.mechanical=true;assert.equal(setProjectAssemblySpec(p,assembly),false);assert.equal(p.review.mechanical,true);
 const imported=safeProject(p),saved=parseSavedWorkspace(JSON.stringify({projects:[p],currentId:p.id})),restored=restoreProjectFromRevision(p,imported);
 for(const result of [imported,saved.projects[0],restored]){assert.deepEqual(result.assemblySpec,assembly);assert.deepEqual(result.solidSpec,legacy);assert.deepEqual(result.parts,[]);}
 const bad=structuredClone(p);bad.assemblySpec.instances[0].position[0]=501;
 assert.throws(()=>safeProject(bad));assert.throws(()=>parseSavedWorkspace(JSON.stringify({projects:[bad]})));
});

test('assembly cache normalization invalidates mechanical review and preserves unreadable bytes',()=>{
 const p=blankProject(),store=storage(),assembly=setAssemblyPartSource(null,'part',solid,'Assembly');
 p.review.mechanical=true;store.setItem(assemblyKey(p.id),JSON.stringify({...assembly,title:' Assembly '}));
 const state=readGeometryState(p,store);assert.equal(state.project.assemblySpec.title,'Assembly');assert.equal(state.project.review.mechanical,false);assert.equal(p.assemblySpec,null);
 store.setItem(assemblyKey(p.id),'unreadable assembly bytes');
 assert.throws(()=>readGeometryState(p,store));assert.throws(()=>replaceGeometryCache(p,store));
 assert.equal(store.getItem(assemblyKey(p.id)),'unreadable assembly bytes');
});

test('assembly cache rollback includes all three CAD fields and refuses newer part edits',()=>{
 const p=blankProject(),store=storage();p.solidSpec=solid;p.assemblySpec=setAssemblyPartSource(null,'part',solid,'Assembly');
 const previous=JSON.stringify(emptyAssembly('Prior assembly'));store.setItem(assemblyKey(p.id),previous);
 const before=readGeometryState(p,store).raw,originalSet=store.setItem;
 store.setItem=(key,value)=>{if(key===assemblyKey(p.id))throw new Error('quota');originalSet(key,value);};
 assert.throws(()=>replaceGeometryCache(p,store,before),/quota/);
 assert.equal(store.getItem(solidKey(p.id)),null);assert.equal(store.getItem(assemblyKey(p.id)),previous);
 store.setItem=originalSet;const transaction=replaceGeometryCache(p,store,before);
 assert.deepEqual(JSON.parse(store.getItem(assemblyKey(p.id))),p.assemblySpec);
 store.setItem(assemblyKey(p.id),JSON.stringify(emptyAssembly('New external edit')));
 assert.throws(()=>transaction.rollback(),error=>{assert.ok(error.recovery.some(entry=>entry.key===assemblyKey(p.id)&&entry.originalRaw===previous));return true;});
 assert.equal(store.getItem(solidKey(p.id)),null);assert.equal(JSON.parse(store.getItem(assemblyKey(p.id))).title,'New external edit');
 assert.throws(()=>replaceGeometryCache(p,store,before),/changed/);
});

test('assembly sidecar may exceed legacy 64 KB without relaxing legacy limits',()=>{
 const p=blankProject(),store=storage(),assembly=setAssemblyPartSource(null,'part',solid,'Assembly');
 const pretty=JSON.stringify(assembly,null,120);assert.ok(pretty.length<65536);
 // Whitespace is valid JSON and counts toward the stored sidecar byte limit.
 const roomy=JSON.stringify(assembly)+' '.repeat(70000);store.setItem(assemblyKey(p.id),roomy);
 assert.deepEqual(readGeometryState(p,store).project.assemblySpec,assembly);
 store.setItem(solidKey(p.id),JSON.stringify(solid)+' '.repeat(70000));assert.throws(()=>readGeometryState(p,store),/64 KB/);
 store.removeItem(solidKey(p.id));store.setItem(assemblyKey(p.id),JSON.stringify(assembly)+' '.repeat(262144));assert.throws(()=>readGeometryState(p,store),/256 KB/);
});
