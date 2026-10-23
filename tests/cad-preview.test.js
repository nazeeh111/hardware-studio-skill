import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PREVIEW_KEY,previewSnapshot,readPreviewSnapshot,previewMeshes} from '../cad-preview.js';
const root=new URL('../examples/pico-neopixel-tray/generated/window-cover-v1/',import.meta.url);
const json=name=>JSON.parse(readFileSync(new URL(name,root)));
const spec=json('spec.json');
function payload(){return {schema:'hardware-studio-cad-preview-v1',spec,verification:json('verification.json'),meshes:['tray.stl','lid.stl'].map(name=>({name,dataBase64:readFileSync(new URL(name,root)).toString('base64')}))};}
test('preview transfer freezes valid geometry, expires and restricts its return link',()=>{
 const input=structuredClone(spec),frozen=previewSnapshot(input,'?project=board&title=My+tray&unrelated=discard',100000);
 input.outer.length=90;assert.equal(frozen.spec.outer.length,66);assert.equal(frozen.schema,PREVIEW_KEY);
 assert.equal(readPreviewSnapshot(JSON.stringify(frozen),100001).returnTo,'./tray.html?project=board&title=My+tray');
 assert.throws(()=>readPreviewSnapshot(JSON.stringify(frozen),2000000),/expired/);
 frozen.returnTo='https://outside.example';assert.equal(readPreviewSnapshot(JSON.stringify(frozen),100001).returnTo,'./tray.html');
});
test('CAD preview requires matching geometry, STL hashes and readback bounds',async()=>{
 const data=payload(),meshes=await previewMeshes(data,spec);assert.equal(meshes.length,2);assert.equal(meshes[1].cover,true);assert.equal(meshes[0].triangles,4076);
 const uncovered=payload();uncovered.spec=structuredClone(spec);uncovered.spec.lid=null;uncovered.meshes=uncovered.meshes.slice(0,1);uncovered.verification.lid=null;
 assert.equal((await previewMeshes(uncovered,uncovered.spec)).length,1);
 data.meshes[0].dataBase64=Buffer.from('tampered bytes').toString('base64');await assert.rejects(previewMeshes(data,spec),/hash/);
 const dimensions=payload();dimensions.verification.stl_outer_span_mm[0]=99;await assert.rejects(previewMeshes(dimensions,spec),/dimensions/);
 const other=structuredClone(spec);other.outer.length=70;await assert.rejects(previewMeshes(payload(),other),/specification/);
});
