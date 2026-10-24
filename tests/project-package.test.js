import test from 'node:test';
import assert from 'node:assert/strict';
import {blankProject} from '../core.js';
import {projectPackageFiles, projectSourceArchive} from '../project-package.js';

const options = {
  generatedAt:'2026-10-23T18:04:06.000Z',
  wiringMarkup:'<svg viewBox="0 0 100 20"><text>captured wiring</text></svg>',
  assemblyMarkup:'<svg viewBox="0 0 200 40"><text>captured inventory</text></svg>'
};
const solid = title => ({schema:'hardware-studio-solid-v1',title,units:'mm',features:[
  {id:'body',operation:'add',shape:'box',origin:[0,0,0],size:[40,20,6]},
  {id:'bore',operation:'cut',shape:'cylinder',origin:[10,10,-1],axis:'z',radius:3,height:8},
  {id:'round-top',operation:'fillet',radius:1,edges:[[20,0,6]],tolerance:.01}
],probes:[{id:'check-bore',expect:'void',shape:'cylinder',origin:[10,10,0],axis:'z',radius:2.9,height:6}]});
function fixture() {
  const p=blankProject('Paired pull tabs');
  p.id='saved-project-id';
  p.parts=[
    {id:'tab-a',name:'Left tab',category:'Mechanical',qty:1,unitCost:0,detail:'R1 outer edge',verified:true,specUrl:'https://example.com/spec',sourceUrl:'https://example.com/buy',checkedAt:'2026-10-23'},
    {id:'tab-b',name:'Right tab',category:'Mechanical',qty:2,unitCost:0,detail:'Mirrored placement',verified:false}
  ];
  p.steps=[{id:'saved-step-id',phase:'Test',title:'Check both bores',detail:'Measure before assembly.',partIds:['tab-a','tab-b'],done:true}];
  p.tools=['Caliper']; p.assumptions=['Clearance must be measured.'];
  p.review={electrical:true,mechanical:true,sourcing:false};
  p.mechanicalConnections=[{from:'tab-a',to:'tab-b',label:'Keep spacing',note:'Unverified'}];
  p.solidSpec=solid('Project legacy source');
  p.assemblySpec={schema:'hardware-studio-assembly-v1',title:'Paired sources',units:'mm',assets:[
    {partId:'tab-b',source:solid('Right source')},{partId:'tab-a',source:solid('Left source')}
  ],instances:[{id:'saved-instance-id',partId:'tab-a',position:[20,30,40],rotation:[0,0,90]}]};
  return p;
}
const entries = p => new Map(projectPackageFiles(p,options).map(entry=>[entry.name,entry.data]));
function freezeDeep(value) {
  if (value && typeof value==='object') {Object.freeze(value);for(const child of Object.values(value))freezeDeep(child);}
  return value;
}
// Read local records independently from the archive writer, including binary
// entries, to establish that callers receive actual ZIP bytes in source order.
function unzipStored(bytes) {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength), files=new Map();let offset=0;
  while(view.getUint32(offset,true)===0x04034b50) {
    assert.equal(view.getUint16(offset+8,true),0);
    const length=view.getUint32(offset+18,true),nameLength=view.getUint16(offset+26,true),extra=view.getUint16(offset+28,true);
    const name=new TextDecoder().decode(bytes.subarray(offset+30,offset+30+nameLength));
    const start=offset+30+nameLength+extra;files.set(name,bytes.slice(start,start+length));offset=start+length;
  }
  assert.equal(view.getUint32(offset,true),0x02014b50);
  assert.equal(view.getUint32(bytes.length-22,true),0x06054b50);
  assert.equal(view.getUint16(bytes.length-14,true),files.size);
  return files;
}

test('source package preserves original part, step and instance IDs, review flags and ordered CAD history',()=>{
  const p=freezeDeep(fixture()),before=JSON.stringify(p),files=entries(p);
  assert.equal(JSON.stringify(p),before);
  assert.deepEqual(JSON.parse(files.get('project.json')),p);
  assert.deepEqual(JSON.parse(files.get('solid-spec.json')),p.solidSpec);
  assert.deepEqual(JSON.parse(files.get('assembly-spec.json')),p.assemblySpec);
  assert.deepEqual(JSON.parse(files.get('cad-sources/part-001.json')),p.assemblySpec.assets[0].source);
  assert.deepEqual(JSON.parse(files.get('cad-sources/part-002.json')),p.assemblySpec.assets[1].source);
  assert.match(files.get('build-plan.txt'),/Caliper/);
  assert.match(files.get('build-plan.txt'),/Clearance must be measured/);
  assert.match(files.get('build-plan.txt'),/checked in this browser/);
  assert.match(files.get('build-plan.txt'),/Parts: Left tab, Right tab/);
  assert.match(files.get('bill-of-materials.csv'),/"Left tab","Mechanical","1"/);
  assert.match(files.get('review.txt'),/no placed instance|records 2 units/);
  assert.match(files.get('review.txt'),/not a safety, sourcing or engineering certification/);
});

test('injected diagrams are retained as standalone SVG with no viewport lookup',()=>{
  const files=entries(fixture());
  assert.equal(files.get('wiring.svg'),options.wiringMarkup.replace('<svg','<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.equal(files.get('assembly.svg'),options.assemblyMarkup.replace('<svg','<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.throws(()=>projectPackageFiles(fixture(),{generatedAt:options.generatedAt}),/Render wiring and assembly/);
});

test('reference bytes and editable bounded sketch are exported without encoding changes',()=>{
  const p=fixture(),jpeg=Uint8Array.of(255,216,255,0,255,1,128,2,3);
  p.referenceImage={name:'captured.jpg',dataUrl:'data:image/jpeg;base64,'+Buffer.from(jpeg).toString('base64'),sketch:{schema:'hardware-studio-sketch-v1',width:768,height:480,strokes:[{tool:'text',color:'#14211f',text:'Measure bore',x:10,y:20}]}};
  const files=entries(p),zipFiles=unzipStored(projectSourceArchive(p,options));
  assert.deepEqual(files.get('reference.jpg'),jpeg);
  assert.deepEqual(zipFiles.get('reference.jpg'),jpeg);
  assert.deepEqual(JSON.parse(files.get('reference-sketch.json')),p.referenceImage.sketch);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(zipFiles.get('project.json'))).referenceImage,p.referenceImage);
});

test('archive is deterministic for a captured project, markup and clock and detached from later edits',()=>{
  const p=fixture(),first=projectSourceArchive(p,options),files=entries(p);
  assert.ok(first instanceof Uint8Array);
  assert.deepEqual(projectSourceArchive(p,options),first);
  const unzipped=unzipStored(first);
  assert.deepEqual([...unzipped.keys()],[...files.keys()]);
  for(const [name,data] of files)assert.deepEqual(unzipped.get(name),typeof data==='string'?new TextEncoder().encode(data):data,name);
  p.parts[0].name='Edited after capture';p.assemblySpec.assets[0].source.features[0].size[0]=99;
  assert.match(files.get('build-plan.txt'),/Left tab/);
  assert.equal(JSON.parse(files.get('cad-sources/part-001.json')).features[0].size[0],40);
  assert.throws(()=>projectSourceArchive(p,{...options,generatedAt:'not a date'}),/timestamp/);
});

test('invalid standalone or per-part CAD source fails without mutating the original',()=>{
  for(const alter of [p=>p.solidSpec.features[0].size[0]=-1,p=>p.assemblySpec.assets[0].source.features[2].radius=0,p=>p.assemblySpec.instances[0].partId='missing-source',p=>p.traySpec={schema:'hardware-studio-tray-v1',units:'mm'}]) {
    const p=fixture();alter(p);const before=JSON.stringify(p);
    assert.throws(()=>projectSourceArchive(p,options));assert.equal(JSON.stringify(p),before);
  }
});

test('source-only package names stay within the checked-upload allowlist without adding geometry',()=>{
  const p=fixture();p.traySpec={schema:'hardware-studio-tray-v1',title:'Tray',units:'mm',outer:{length:80,width:60,height:25},wall:2,floor:2,mounts:[],cutouts:[],lid:null};
  p.assemblySpec.assets=Array.from({length:8},(_,index)=>({partId:'part-'+index,source:solid('Source '+index)}));
  p.assemblySpec.instances=[];
  const files=entries(p);
  assert.equal(files.size,20);assert.ok(files.size<=32);
  assert.equal(files.has('tray-spec.json'),true);
  assert.equal([...files.keys()].some(name=>/\.(stl|step|glb)$/.test(name)),false);
  assert.ok(projectSourceArchive(p,options).byteLength<12*1024*1024);
});
