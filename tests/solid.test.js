import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validateSolidSpec,solidProposal} from '../solid-spec.js';
import {solidSnapshot,readSolidSnapshot,solidMeshes} from '../solid-preview.js';
import {mockMeshReadback} from './fixtures/mock-mesh-readback.js';
const spec=JSON.parse(await readFile(new URL('../tools/solid-generator/examples/mounting-bracket.json',import.meta.url),'utf8'));
test('feature source preserves ordered geometry and rejects executable, invalid or unbounded records',()=>{
 const valid=validateSolidSpec(spec);assert.equal(valid.features.length,5);assert.equal(valid.probes.length,3);
 for(const change of [s=>s.code='anything',s=>s.features[0].size[0]=1e-300,s=>s.probes=null,s=>s.features[0].origin[0]=NaN,s=>s.features[0].size[0]=true,s=>s.features[0].operation='cut',s=>s.features[0].size=[1,2],s=>s.features.push(s.features[0]),s=>s.features=Array(33).fill(s.features[0])]){const s=structuredClone(spec);change(s);assert.throws(()=>validateSolidSpec(s));}
 const next=structuredClone(spec);next.features[0].size[0]=70;const result=solidProposal(spec,{spec:next,assumptions:[],missing:[]});assert.equal(result.spec.features[0].size[0],70);assert.equal(spec.features[0].size[0],60);assert.throws(()=>solidProposal(spec,{spec:next,assumptions:[],missing:['hole position']}),/hole position/);
});
test('solid preview freezes source and refuses expired or future snapshots',()=>{
 const frozen=solidSnapshot(spec,100000);spec.features[0].size[0]=61;assert.equal(frozen.spec.features[0].size[0],60);spec.features[0].size[0]=60;
 assert.equal(readSolidSnapshot(JSON.stringify(frozen),100001).returnTo,'./solid.html');
 assert.throws(()=>readSolidSnapshot(JSON.stringify(frozen),2000000),/expired/);assert.throws(()=>readSolidSnapshot(JSON.stringify(frozen),1000),/expired/);
});
test('historical bracket mesh with explicit mock sampled report requires client readback agreement',async()=>{
 const base=new URL('../examples/feature-bracket/generated/',import.meta.url),bytes=await readFile(new URL('solid.stl',base)),report=JSON.parse(await readFile(new URL('verification.json',base),'utf8'));
 // Historical bytes stay unchanged; the new sampled-report fields are a mock.
 report.stl_check=mockMeshReadback(report.stl_triangles,report.volume_mm3);
 const payload={schema:'hardware-studio-solid-preview-v1',spec,verification:report,meshes:[{name:'solid.stl',dataBase64:bytes.toString('base64')}]};
 const meshes=await solidMeshes(payload,validateSolidSpec(spec));assert.equal(meshes.length,1);assert.deepEqual(meshes[0].max.map((n,k)=>n-meshes[0].min[k]),[60,30,40]);
 for(const change of [r=>delete r.stl_check,r=>r.stl_check.checked_triangle_centers--,r=>r.stl_check.maximum_center_distance_mm=.1,r=>r.stl_check.step_surface_witnesses.pop()]){const incomplete=structuredClone(payload);change(incomplete.verification);await assert.rejects(()=>solidMeshes(incomplete,validateSolidSpec(spec)),/sampled readback/);}
 const tampered=structuredClone(payload);tampered.meshes[0].dataBase64=Buffer.from('corrupt').toString('base64');await assert.rejects(()=>solidMeshes(tampered,validateSolidSpec(spec)),/hash/);
 const noProbe=structuredClone(payload);noProbe.verification.probes.pop();await assert.rejects(()=>solidMeshes(noProbe,validateSolidSpec(spec)),/probes/);
 const moved=structuredClone(payload);moved.spec.features[0].size[0]=70;await assert.rejects(()=>solidMeshes(moved,validateSolidSpec(spec)),/match/);
 const wrongProbe=structuredClone(payload);wrongProbe.verification.probes[0].material_fraction=.5;await assert.rejects(()=>solidMeshes(wrongProbe,validateSolidSpec(spec)),/probes/);
 const wrongSpan=structuredClone(payload);wrongSpan.verification.stl_outer_span_mm[0]=61;await assert.rejects(()=>solidMeshes(wrongSpan,validateSolidSpec(spec)),/disagree|dimensions/);
});
