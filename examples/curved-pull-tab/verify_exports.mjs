// Read actual browser downloads. Does not regenerate any CAD or visual export.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseStl} from '../../stl.js';
const root=new URL('./',import.meta.url),read=name=>readFile(new URL(name,root));
const json=async name=>JSON.parse(await read(name));
const report=await json('five-tabs-cad/verification.json'),spec=await json('five-tabs-cad/spec.json');
const manifest=await json('five-tabs-inspection/inspection.json');
const glb=await read('five-tabs.glb');
assert.equal(glb.toString('ascii',0,4),'glTF');assert.equal(glb.readUInt32LE(4),2);assert.equal(glb.readUInt32LE(8),glb.length);
const length=glb.readUInt32LE(12),document=JSON.parse(glb.toString('utf8',20,20+length));
assert.equal(glb.readUInt32LE(16),0x4e4f534a);assert.equal(glb.readUInt32LE(24+length),0x004e4942);
const binary=glb.subarray(28+length),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.equal(document.nodes.length,5);assert.equal(document.meshes.length,5);assert.equal(manifest.meshes.length,5);
assert.equal(report.assembly.solid_count,5);assert.equal(report.pairs.length,10);assert.ok(report.pairs.every(p=>p.overlap_mm3===0));
assert.equal(manifest.displayLiftIncluded,false);assert.deepEqual(manifest.bounds.spans,[240,20,6]);
let vertices=0,maximumError=0;
for(let i=0;i<5;i++){
 const record=report.instances[i],bytes=await read('five-tabs-cad/instances/'+record.name);
 assert.equal(sha(bytes),record.sha256.stl);assert.equal(record.stl_check.passed,true);assert.equal(record.stl_export.exact_byte_replay,true);
 const mesh=parseStl(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
 const rendered=Buffer.from(mesh.data.buffer,mesh.data.byteOffset,mesh.data.byteLength);
 assert.equal(sha(rendered),manifest.meshes[i].geometrySha256);
 assert.equal(mesh.triangles,4292);assert.equal(record.stl_check.checked_triangle_centers,4292);
 assert.equal(spec.instances[i].position[0],i*50);
 assert.ok(Math.abs(mesh.min[0]-i*50)<1e-5);assert.ok(Math.abs(mesh.max[0]-(i*50+40))<1e-5);
 const node=document.nodes[i];assert.equal(node.mesh,i);assert.equal(node.name,'Capsule Pull Tab / tab-'+(i+1));
 assert.deepEqual(node.rotation,[-Math.SQRT1_2,0,0,Math.SQRT1_2]);
 const primitive=document.meshes[i].primitives[0],accessor=document.accessors[primitive.attributes.POSITION],view=document.bufferViews[accessor.bufferView];
 assert.equal(accessor.componentType,5126);assert.equal(accessor.type,'VEC3');assert.equal(accessor.count,mesh.triangles*3);
 for(let n=0;n<accessor.count;n++)for(let k=0;k<3;k++){
  const position=binary.readFloatLE((view.byteOffset||0)+(accessor.byteOffset||0)+n*(view.byteStride||12)+k*4),expected=mesh.data[n*6+k]*.001;
  assert.ok(Number.isFinite(position));const error=Math.abs(position-expected);assert.ok(error<1e-8);maximumError=Math.max(error,maximumError);
 }
 vertices+=accessor.count;
 assert.ok(document.materials[primitive.material].pbrMetallicRoughness.baseColorFactor.every(Number.isFinite));
}
const png=await read('five-tabs-inspection/inspection.png');assert.equal(png.toString('hex',0,8),'89504e470d0a1a0a');
const result={passed:true,instances:5,triangles:21460,verticesCompared:vertices,maximumGlbPositionErrorMetres:maximumError,glbSha256:sha(glb),inspectionPngSha256:sha(png),boundsMm:[240,20,6],pairChecks:10,limits:['GLB/inspection byte and geometry identity checks, not physical validation.','Analytic geometry is checked separately by verify_intent.py.']};
await writeFile(new URL('export-verification.json',root),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
