import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ASSEMBLY_PREVIEW_KEY,assemblySnapshot,readAssemblySnapshot,assemblyMeshes,assemblyReadbackText} from '../assembly-preview.js';
import {mockMeshReadback} from './fixtures/mock-mesh-readback.js';
import {setAssemblyPartSource} from '../assembly-spec.js';

const source = {schema:'hardware-studio-solid-v1',title:'Test plate',units:'mm',features:[{id:'body',operation:'add',shape:'box',origin:[0,0,0],size:[10,4,2]}],probes:[]};
function boxStl(min, max) {
  const vertices = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]].map(v => v.map((n,k) => n ? max[k] : min[k]));
  const faces = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[3,7,6],[3,6,2],[0,4,7],[0,7,3],[1,2,6],[1,6,5]];
  const bytes = Buffer.alloc(84+faces.length*50);bytes.writeUInt32LE(faces.length,80);
  faces.forEach((face,i) => face.forEach((v,j) => vertices[v].forEach((n,k) => bytes.writeFloatLE(n,84+i*50+12+j*12+k*4))));
  return bytes;
}
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function payload(count=2) {
  const spec = setAssemblyPartSource(null,'plate',source,'Plate assembly');
  spec.instances = Array.from({length:count},(_,i) => ({id:`plate-${i+1}`,partId:'plate',position:[i*12,0,0],rotation:[0,0,0]}));
  const instances = [], meshes = [], pairs = [];
  for (const [i,instance] of spec.instances.entries()) {
    const name = `instance-${String(i+1).padStart(3,'0')}.stl`,min = [i*12,0,0],max = [i*12+10,4,2],bytes = boxStl(min,max);
    meshes.push({id:instance.id,partId:instance.partId,name,dataBase64:bytes.toString('base64')});
    instances.push({id:instance.id,partId:instance.partId,name,min_mm:min,max_mm:max,stl_min_mm:[...min],stl_max_mm:[...max],volume_mm3:80,stl_triangles:12,stl_check:mockMeshReadback(12,80),sha256:{stl:hash(bytes)}});
    for(let j=0;j<i;j++)pairs.push({firstId:spec.instances[j].id,secondId:instance.id,overlap_mm3:0,minimum_distance_mm:(i-j)*12-10,interference:false});
  }
  return {schema:'hardware-studio-assembly-preview-v1',spec,meshes,verification:{status:'passed',instances,pairs,assembly:{solid_count:count,min_mm:[0,0,0],max_mm:[(count-1)*12+10,4,2],volume_mm3:count*80}}};
}

test('assembly snapshots freeze all source geometry and placements and preserve only a local project return link', () => {
  const {spec} = payload(), frozen = assemblySnapshot(spec,'project_12',100000);
  assert.equal(frozen.schema,ASSEMBLY_PREVIEW_KEY);
  spec.assets[0].source.features[0].size[0]=55;spec.instances[0].position[0]=77;
  assert.equal(frozen.spec.assets[0].source.features[0].size[0],10);assert.equal(frozen.spec.instances[0].position[0],0);
  assert.deepEqual(readAssemblySnapshot(JSON.stringify(frozen),100001),frozen);
  const extra = {...frozen,returnTo:frozen.returnTo+'&outside=https://example.invalid&part=ignored'};
  assert.equal(readAssemblySnapshot(JSON.stringify(extra),100001).returnTo,'./assembly.html?project=project_12');
  for (const id of ['',null,'../escape','x'.repeat(101)])assert.throws(() => assemblySnapshot(frozen.spec,id,100000),/project/);
  for (const returnTo of ['https://example.invalid','//example.invalid','./assembly.html/../other?project=x','./assembly.html?project=x#fragment','./assembly.html?project=..%2Fescape','./assembly.html?title=missing']) {
    assert.throws(() => readAssemblySnapshot(JSON.stringify({...frozen,returnTo}),100001));
  }
  for (const at of [100000-1800001,100000+10001])assert.throws(() => readAssemblySnapshot(JSON.stringify({...frozen,at}),100000),/expired/);
  assert.throws(() => readAssemblySnapshot(JSON.stringify({...frozen,schema:'other'}),100001));
  assert.throws(() => readAssemblySnapshot(JSON.stringify(frozen)+' '.repeat(264192),100001),/unavailable/);
});

test('assembly preview returns all explicit instance identities and their absolute world coordinates', async () => {
  const data = payload(3), before = JSON.stringify(data), meshes = await assemblyMeshes(data,data.spec);
  assert.equal(meshes.length,3);assert.equal(JSON.stringify(data),before);
  assert.deepEqual(meshes.map(m => m.instanceId),['plate-1','plate-2','plate-3']);
  assert.ok(meshes.every(m => m.partId==='plate' && m.triangles===12 && m.cover===false));
  assert.deepEqual(meshes[2].min,[24,0,0]);assert.deepEqual(meshes[2].max,[34,4,2]);
  assert.equal(meshes[2].name,'Test plate / plate-3');
});

test('changed source, placements, IDs, part IDs and per-instance filenames cannot be substituted', async () => {
  for (const change of [
    d => d.schema='other',d => d.spec.assets[0].source.features[0].size[0]=11,d => d.spec.instances[0].position[0]=1,
    d => d.meshes.pop(),d => d.meshes.reverse(),d => d.meshes[0].id='plate-2',d => d.meshes[0].partId='other',d => d.meshes[0].name='other.stl',
    d => d.verification.instances[0].id='plate-2',d => d.verification.instances[0].partId='other',d => d.verification.instances[0].name='other.stl'
  ]) {
    const expected=payload().spec, data=payload();change(data);await assert.rejects(assemblyMeshes(data,expected));
  }
});

test('hashes, absolute STEP/STL bounds and triangle counts reject shifted meshes with unchanged volume or span', async () => {
  for (const change of [
    d => d.verification.instances[0].sha256.stl='0'.repeat(64),d => d.verification.instances[0].stl_triangles=13,
    d => d.verification.instances[0].volume_mm3=0,d => d.verification.instances[0].volume_mm3=NaN,
    d => d.verification.instances[0].stl_min_mm[0]=1,d => d.verification.instances[0].max_mm[0]=11,
    d => d.meshes[0].dataBase64='invalid!'
  ]) { const data=payload();change(data);await assert.rejects(assemblyMeshes(data,data.spec)); }
  const moved=payload(), bytes=boxStl([100,0,0],[110,4,2]);
  moved.meshes[0].dataBase64=bytes.toString('base64');moved.verification.instances[0].sha256.stl=hash(bytes);
  // This box keeps the exact 80 mm³ volume, 10×4×2 span and 12 triangles.
  await assert.rejects(assemblyMeshes(moved,moved.spec),/position or bounds/);
});

test('every placed instance requires the full sampled mesh/STEP report even when hashes and bounds agree',async()=>{
  for(const change of [r=>delete r.stl_check,r=>r.stl_check.checked_triangle_centers=1,r=>r.stl_check.center_tolerance_mm=1,r=>r.stl_check.step_surface_witnesses[1].face=0]){const data=payload(3);change(data.verification.instances[1]);await assert.rejects(assemblyMeshes(data,data.spec),/sampled readback/);}
});

test('combined bounds and retained solid count must agree with every placed mesh', async () => {
  for(const change of [d=>d.verification.assembly.solid_count=1,d=>d.verification.assembly.min_mm[0]=1,d=>d.verification.assembly.max_mm[0]=21,d=>d.verification.assembly=null]) {
    const data=payload();change(data);await assert.rejects(assemblyMeshes(data,data.spec),/Combined assembly/);
  }
});

test('pair records cover every distinct pair exactly once and agree on interference status', async () => {
  for(const change of [
    d=>d.verification.pairs.pop(),d=>d.verification.pairs[1]=structuredClone(d.verification.pairs[0]),
    d=>{const p=d.verification.pairs[0];d.verification.pairs[1]={...p,firstId:p.secondId,secondId:p.firstId};},
    d=>d.verification.pairs[0].firstId='missing',d=>d.verification.pairs[0].firstId=d.verification.pairs[0].secondId,
    d=>d.verification.pairs[0].overlap_mm3=-1,d=>d.verification.pairs[0].minimum_distance_mm=-1,
    d=>d.verification.pairs[0].overlap_mm3=NaN,d=>d.verification.pairs[0].minimum_distance_mm=Infinity,
    d=>d.verification.pairs[0].interference=true,d=>d.verification.pairs[0].overlap_mm3=.02,
    d=>d.verification.status='interference',d=>d.verification.status='verified'
  ]) { const data=payload(3);change(data);await assert.rejects(assemblyMeshes(data,data.spec)); }
  const threshold=payload();threshold.verification.pairs[0].overlap_mm3=.01;
  assert.equal((await assemblyMeshes(threshold,threshold.spec)).length,2);
  const collision=payload();collision.verification.pairs[0]={...collision.verification.pairs[0],overlap_mm3:4,minimum_distance_mm:0,interference:true};collision.verification.status='interference';
  assert.equal((await assemblyMeshes(collision,collision.spec)).length,2);
  const single=payload(1);assert.equal((await assemblyMeshes(single,single.spec)).length,1);
});

test('readback text exposes nominal overlap and distance without claiming physical validation', () => {
  const data=payload(), before=JSON.stringify(data.verification), text=assemblyReadbackText(data.verification);
  assert.match(text,/No pair overlap above 0\.01 mm³/);assert.match(text,/minimum distance 2\.0000 mm/);
  assert.match(text,/Joints, motion, tolerances and physical fit remain untested/);assert.equal(JSON.stringify(data.verification),before);
  data.verification.status='interference';data.verification.pairs[0]={...data.verification.pairs[0],interference:true,overlap_mm3:2,minimum_distance_mm:0};
  assert.match(assemblyReadbackText(data.verification),/INTERFERENCE: 1 instance pair/);
  assert.doesNotMatch(text,/physical fit (?:passed|verified|confirmed)|safe to build/i);
});
