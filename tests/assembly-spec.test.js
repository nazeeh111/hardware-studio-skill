import test from 'node:test';
import assert from 'node:assert/strict';
import {ASSEMBLY_SCHEMA,validateAssemblySpec,emptyAssembly,setAssemblyPartSource,assemblyIssues,instanceMatrix} from '../assembly-spec.js';

const source = {schema:'hardware-studio-solid-v1',title:'Spacer',units:'mm',features:[{id:'body',operation:'add',shape:'box',origin:[0,0,0],size:[10,20,3]}],probes:[]};
const placed = (id = 'one', partId = 'spacer') => ({id,partId,position:[0,0,0],rotation:[0,0,0]});
function sample() { const value = setAssemblyPartSource(null,'spacer',source,'Test assembly'); value.instances.push(placed()); return value; }

test('draft and build modes distinguish unplaced source from a buildable placement', () => {
  const empty = emptyAssembly(' Assembly ');
  assert.deepEqual(empty,{schema:ASSEMBLY_SCHEMA,title:'Assembly',units:'mm',assets:[],instances:[]});
  assert.throws(() => validateAssemblySpec(empty,{requirePlaced:true}),/Place at least one/);
  const value = sample();
  assert.deepEqual(validateAssemblySpec(value,{requirePlaced:true}),value);
  value.instances[0].partId = 'unknown';
  assert.throws(() => validateAssemblySpec(value),/missing assembly source/);
});

test('source replacement preserves every other source and placement without mutating callers', () => {
  const before = sample();
  before.assets.push({partId:'lid',source:structuredClone(source)});
  before.instances.push({...placed('two','lid'),position:[11,12,13]});
  const bytes = JSON.stringify(before), replacement = structuredClone(source);
  replacement.features[0].size[0] = 44;
  const after = setAssemblyPartSource(before,'spacer',replacement);
  assert.equal(JSON.stringify(before),bytes);
  assert.deepEqual(after.assets[1],before.assets[1]);
  assert.deepEqual(after.instances,before.instances);
  after.assets[0].source.features[0].size[0] = 99;
  assert.equal(replacement.features[0].size[0],44);
  assert.equal(before.assets[0].source.features[0].size[0],10);
  const third = setAssemblyPartSource(before,'new',source);
  assert.equal(third.instances.length,2);
});

test('source, instance and aggregate resource bounds reject oversized or executable records', () => {
  const duplicate = sample(); duplicate.instances.push(placed());
  assert.throws(() => validateAssemblySpec(duplicate),/unique/);
  const large = sample(); large.assets = Array.from({length:9},(_,i) => ({partId:String(i),source}));
  assert.throws(() => validateAssemblySpec(large),/8 assembly/);
  const many = sample(); many.instances = Array.from({length:17},(_,i) => placed(String(i)));
  assert.throws(() => validateAssemblySpec(many),/16 placed/);
  const features = sample();
  features.assets = Array.from({length:5},(_,i) => ({partId:String(i),source:{...source,features:Array.from({length:32},(_,j) => ({...source.features[0],id:String(j)}))}}));
  assert.throws(() => validateAssemblySpec(features),/128 total/);
  const oversized = sample(); oversized.command = 'x'.repeat(262144);
  assert.throws(() => validateAssemblySpec(oversized),/256 KB/);
  for (const change of [s => s.code = 'run()',s => s.instances[0].scale = [2,2,2],s => s.assets[0].verified = true,s => s.assets[0].source.features[0].size[0] = -1]) {
    const bad = sample(); change(bad); assert.throws(() => validateAssemblySpec(bad));
  }
  for (const change of [s => delete s.instances[0],s => delete s.assets[0],s => delete s.assets[0].source.features[0],s => delete s.instances[0].position[1]]) {
    const bad = sample(); change(bad); assert.throws(() => validateAssemblySpec(bad));
  }
});

test('position and rotation limits reject strings, nonfinite values and arrays with hidden coordinates', () => {
  for (const [field,value] of [['position',[501,0,0]],['rotation',[0,-361,0]],['position',[0,NaN,0]],['position',['1',0,0]],['rotation',[0,0,0,0]]]) {
    const bad = sample(); bad.instances[0][field] = value; assert.throws(() => validateAssemblySpec(bad),/three finite/);
  }
  const bounds = sample(); bounds.instances[0].position = [-500,500,0]; bounds.instances[0].rotation = [-360,360,0];
  assert.doesNotThrow(() => validateAssemblySpec(bounds));
});

test('deleted BOM parts retain their exact CAD and placements and produce actionable record issues', () => {
  const value = sample(), bytes = JSON.stringify(value);
  assert.ok(assemblyIssues(value,[]).some(issue => issue.code === 'missing-bom-part'));
  assert.equal(JSON.stringify(value),bytes);
  assert.deepEqual(assemblyIssues(value,[{id:'spacer',name:'Spacer',qty:1}]),[]);
  assert.ok(assemblyIssues(value,[{id:'spacer',name:'Spacer',qty:2}]).some(issue => issue.code === 'quantity-mismatch'));
  value.instances = [];
  const issues = assemblyIssues(value,[{id:'spacer',name:'Spacer',qty:1}]);
  assert.ok(issues.some(issue => issue.code === 'unplaced-asset'));
  assert.ok(issues.every(issue => !/verified|passed|fit confirmed/i.test(issue.text)));
});

test('placements use right-handed X then Y then Z rotations about source origin, then translation', () => {
  const point = [2,3,5], degrees = [30,40,50], position = [11,13,17];
  const matrix = instanceMatrix({...placed(),rotation:degrees,position});
  const actual = [0,1,2].map(row => matrix[row]*point[0]+matrix[row+4]*point[1]+matrix[row+8]*point[2]+matrix[row+12]);
  const [x,y,z] = degrees.map(n => n*Math.PI/180);
  let [a,b,c] = point;
  [b,c] = [b*Math.cos(x)-c*Math.sin(x),b*Math.sin(x)+c*Math.cos(x)];
  [a,c] = [a*Math.cos(y)+c*Math.sin(y),-a*Math.sin(y)+c*Math.cos(y)];
  [a,b] = [a*Math.cos(z)-b*Math.sin(z),a*Math.sin(z)+b*Math.cos(z)];
  [a,b,c].forEach((n,i) => assert.ok(Math.abs(actual[i]-n-position[i])<1e-12));
  assert.deepEqual(instanceMatrix({...placed(),position}) .slice(12),[11,13,17,1]);
});
