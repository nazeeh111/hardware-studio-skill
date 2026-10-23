import test from 'node:test';
import assert from 'node:assert/strict';
import {partSymbol,assemblyInventory,assemblySvg} from '../assembly-inventory.js';
test('mechanical symbols distinguish families while unknown components stay neutral',()=>{
  const part=name=>({name,category:'Mechanical'});
  assert.deepEqual(['Custom concave mounting plate','Adhesive rubber feet','M3 spacer','L bracket','Unknown gizmo'].map(name=>partSymbol(part(name))),['plate','feet','spacer','bracket','part']);
  assert.equal(partSymbol({name:'sensor plate',category:'Sensor'}),'sensor');
});
test('inventory and standalone diagram escape names and preserve long names without viewport access',()=>{
  const name='A <script> & unusually long descriptive custom part with many additional words so the full description extends across several lines';
  const project={parts:[{name,category:'Mechanical',qty:4}]},before=JSON.stringify(project);
  const html=assemblyInventory(project),svg=assemblySvg(project);
  assert.ok(!html.includes('<script>'));assert.ok(!svg.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(svg.includes('additional words'));assert.ok(svg.includes('across several lines'));assert.ok(!svg.includes('…'));assert.ok(svg.includes('NOT TO SCALE'));
  assert.equal(JSON.stringify(project),before);
});
