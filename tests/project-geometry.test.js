import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {blankProject,safeProject,parseSavedWorkspace,setProjectSolidSpec,restoreProjectFromRevision} from '../core.js';
import {projectWithGeometry,readGeometryState,replaceGeometryCache,trayKey,solidKey,solidContext} from '../project-geometry.js';
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
