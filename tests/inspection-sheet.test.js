import test from 'node:test';
import assert from 'node:assert/strict';
import {INSPECTION_VIEWS,inspectionScene,inspectionManifest} from '../inspection-sheet.js';
const project=(r,v)=>[0,1,2].map(row=>v.reduce((n,x,col)=>n+r[col*3+row]*x,0));
const mesh=(name,min,max,visible=true)=>({name,min,max,visible,triangles:1,data:new Float32Array([0,0,0,0,0,1, 8,0,0,0,0,1, 0,4,0,0,0,1])});
test('inspection basis has correct screen axes and observer side without mirroring',()=>{
  assert.deepEqual(INSPECTION_VIEWS.map(v=>project(v.rotation,[2,3,5])),[[2,3,5],[2,5,-3],[3,5,2]]);
  for(const {rotation:r} of INSPECTION_VIEWS){
    const columns=[0,1,2].map(k=>r.slice(k*3,k*3+3));
    const [a,b,c]=columns;
    assert.equal(a[0]*(b[1]*c[2]-b[2]*c[1])-b[0]*(a[1]*c[2]-a[2]*c[1])+c[0]*(a[1]*b[2]-a[2]*b[1]),1);
  }
});
test('all views share bounds, center and scale excluding hidden meshes',async()=>{
  const items=[mesh('plate',[10,-4,2],[70,36,6]),mesh('hidden',[-100,-100,-100],[200,200,200],false)];
  const before=JSON.stringify(items),scene=inspectionScene(items),manifest=await inspectionManifest(scene);
  assert.deepEqual(scene.spans,[60,40,4]);assert.deepEqual(scene.center,[40,16,4]);assert.equal(scene.span,60);
  assert.equal(manifest.pixelsPerAssumedMm,8);assert.equal(manifest.displayLiftIncluded,false);assert.equal(manifest.meshes.length,1);
  assert.deepEqual(manifest.views.map(v=>v.name),['TOP','FRONT','RIGHT']);assert.equal(JSON.stringify(items),before);
  assert.throws(()=>inspectionScene(items.map(m=>({...m,visible:false}))),/Show at least one/);
});
test('manifest hashes actual Float32 render bytes rather than name, camera or bounds',async()=>{
  const a=mesh('first',[0,0,0],[8,4,1]),b={...a,name:'renamed'};
  const hash=async m=>(await inspectionManifest(inspectionScene([m]))).meshes[0].geometrySha256;
  assert.equal(await hash(a),await hash(b));assert.match(await hash(a),/^[0-9a-f]{64}$/);
  b.data=new Float32Array(a.data);b.data[6]=7;
  assert.notEqual(await hash(a),await hash(b));
});
