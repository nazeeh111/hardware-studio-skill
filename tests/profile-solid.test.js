import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, access} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {blankProject,safeProject,parseSavedWorkspace,restoreProjectFromRevision,mechanicalOnly,validate} from '../core.js';
import {validateSolidSpec} from '../solid-spec.js';

const example=JSON.parse(await readFile(new URL('../tools/solid-generator/examples/profile-plate.json',import.meta.url),'utf8'));
const polygon=[[0,0],[60,0],[60,16],[36,16],[36,40],[0,40]];
const oneProfile=(points=polygon)=>({schema:'hardware-studio-solid-v1',title:'Profile fixture',units:'mm',features:[{id:'plate',operation:'add',shape:'profile',origin:[-5,7,-2],axis:'z',height:4,points:structuredClone(points)}],probes:[]});
const invalidPolygons=[
 [],[[0,0],[1,0]],Array.from({length:65},(_,i)=>[Math.cos(i*2*Math.PI/65),Math.sin(i*2*Math.PI/65)]),
 [[0,0],[4,0],[4,4],[0,4],[0,0]], // Explicit closure repeats a vertex.
 [[0,0],[4,0],[4,4],[0,4],[4,0]], // Nonadjacent repeated vertex.
 [[0,0],[.009,0],[0,1]], // Short edge.
 [[0,0],[2,0],[4,0],[0,4]], // Adjacent collinear corners.
 [[0,0],[4,4],[0,4],[4,0]], // Bow tie with cancelling area.
 [[0,0],[6,5],[0,6],[4,0]], // Crossing with nonzero signed area.
 [[0,0],[4,0],[4,4],[2,0],[0,4]], // A vertex touches a nonadjacent edge.
 [[0,0],[6,0],[6,4],[2,4],[2,0],[4,0],[4,6],[0,6]], // Collinear overlapping edges.
 [[0,0],[1,1],[2,2]],[[0,0],[1,0],[0,Infinity]],[[0,0],[1,0],[0,NaN]],
 [[0,0],[501,0],[0,1]],[[0,0],[true,0],[0,1]],[[0,0],[1,0],[0]],
 [[[0,0],[4,0],[4,4],[0,4]],[[1,1],[2,1],[1,2]]] // Nested rings/holes unsupported.
];

test('profile polygons normalize clockwise winding, retain concavity, support probes and do not mutate source',()=>{
 const clockwise=[polygon[0],...polygon.slice(1).reverse()],raw=oneProfile(clockwise);
 const valid=validateSolidSpec(raw);assert.deepEqual(valid.features[0].points,polygon);assert.deepEqual(raw.features[0].points,clockwise);
 assert.deepEqual(validateSolidSpec(valid),valid);
 const fixture=validateSolidSpec(example);assert.equal(fixture.features[0].shape,'profile');assert.equal(fixture.probes.filter(p=>p.shape==='profile').length,3);
 for(const axis of ['x','y','z']){const s=oneProfile();s.features[0].axis=axis;assert.equal(validateSolidSpec(s).features[0].axis,axis);}
 const max=oneProfile(Array.from({length:64},(_,i)=>[100*Math.cos(i*2*Math.PI/64),100*Math.sin(i*2*Math.PI/64)]));assert.equal(validateSolidSpec(max).features[0].points.length,64);
 const minimum=oneProfile([[0,0],[.01,0],[0,.01]]);minimum.features[0].height=.01;assert.doesNotThrow(()=>validateSolidSpec(minimum));
 const bounded=oneProfile([[-500,-500],[500,-500],[-500,500]]);bounded.features[0].height=500;assert.doesNotThrow(()=>validateSolidSpec(bounded));
});

test('profile topology and unsupported dimensions are rejected for features and probes',()=>{
 for(const points of invalidPolygons){assert.throws(()=>validateSolidSpec(oneProfile(points)));const s=oneProfile();s.probes=[{id:'probe',expect:'material',...s.features[0],points}];delete s.probes[0].operation;s.probes[0].id='probe';assert.throws(()=>validateSolidSpec(s));}
 for(const change of [f=>f.axis='w',f=>f.height=0,f=>f.height=501,f=>f.height=true,f=>f.origin=[0,0],f=>f.size=[1,1,1],f=>f.radius=1,f=>f.points=null,f=>f.holes=[]]){const s=oneProfile();change(s.features[0]);assert.throws(()=>validateSolidSpec(s));}
 for(const shape of ['box','cylinder']){const s=oneProfile();s.features[0]=shape==='box'?{id:'plate',operation:'add',shape,origin:[0,0,0],size:[1,1,1],points:polygon}:{id:'plate',operation:'add',shape,origin:[0,0,0],axis:'z',radius:1,height:1,points:polygon};assert.throws(()=>validateSolidSpec(s));}
 const duplicate=structuredClone(example);duplicate.probes[0].id=duplicate.features[0].id;assert.throws(()=>validateSolidSpec(duplicate),/unique/);
});

test('installed Python and JavaScript validators agree on topology and normalized geometry',async t=>{
 const python='/Users/nazeeh/.local/share/codex-tools/engineering-ocp8-sympy1.14/venv/bin/python';
 try{await access(python);}catch{t.skip('Local OpenCascade Python runtime is unavailable.');return;}
 const cases=[example,oneProfile(),oneProfile([polygon[0],...polygon.slice(1).reverse()]),...invalidPolygons.filter(points=>!points.flat(Infinity).some(n=>typeof n==='number'&&!Number.isFinite(n))).map(points=>oneProfile(points))];
 for(const axis of ['x','y','z']){const s=oneProfile();s.features[0].axis=axis;cases.push(s);}
 for(const height of [.009,.01,500,501]){const s=oneProfile();s.features[0].height=height;cases.push(s);}
 cases.push(oneProfile([[0,0],[1,1e-10],[2,0],[0,2]]),oneProfile([[0,0],[1,1e-8],[2,0],[0,2]]));
 const script="import importlib.util,json,sys\nsys.dont_write_bytecode=True\nloader=importlib.util.spec_from_file_location('solid_kernel',sys.argv[1])\nsolid=importlib.util.module_from_spec(loader)\nloader.loader.exec_module(solid)\nresults=[]\nfor raw in json.load(sys.stdin):\n try: results.append({'valid':True,'spec':solid.validate(raw)})\n except ValueError: results.append({'valid':False})\nprint(json.dumps(results))\n";
 const run=spawnSync(python,['-c',script,fileURLToPath(new URL('../tools/solid-generator/solid.py',import.meta.url))],{input:JSON.stringify(cases),encoding:'utf8',timeout:30000});
 assert.equal(run.status,0,run.stderr);
 const expected=cases.map(s=>{try{return {valid:true,spec:validateSolidSpec(s)};}catch{return {valid:false};}});
 assert.deepEqual(JSON.parse(run.stdout),expected);
});

test('polygon source survives project import, storage and revision restoration',()=>{
 const project=blankProject('Custom profile');project.solidSpec=validateSolidSpec(example);
 const imported=safeProject(project);assert.deepEqual(imported.solidSpec,project.solidSpec);
 const saved=parseSavedWorkspace(JSON.stringify({projects:[project],currentId:project.id}));assert.deepEqual(saved.projects[0].solidSpec,project.solidSpec);
 const restored=restoreProjectFromRevision(project,imported);assert.equal(restored.id,project.id);assert.deepEqual(restored.solidSpec,project.solidSpec);assert.equal(restored.review.mechanical,false);
});

test('mechanical-only review omits electrical prompts without marking them verified',()=>{
 const p=blankProject('Plate');p.parts=[{id:'plate',name:'Plate',qty:1,unitCost:0,category:'Mechanical',voltage:'',pins:[]}];
 assert.equal(mechanicalOnly(p),true);assert.equal(p.review.electrical,false);
 assert.equal(validate(p).some(issue=>/electrical connections|Electrical ratings/.test(issue.text)),false);
 for(const change of [s=>s.wiringUrl='https://example.com/electrical-plan',s=>s.parts[0].category='Other',s=>s.parts[0].voltage='5',s=>s.parts[0].pins=['VCC'],s=>s.wires=[{}],s=>s.powerRails=[{}]]){const next=structuredClone(p);change(next);assert.equal(mechanicalOnly(next),false);}
});
