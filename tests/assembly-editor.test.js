import test from 'node:test';
import assert from 'node:assert/strict';
import {editableAssembly,normalizeAssemblyDraft} from '../assembly-editor.js';
const fixture=()=>({schema:'hardware-studio-assembly-v1',title:'Fixture',units:'mm',assets:[{partId:'plate',source:{schema:'hardware-studio-solid-v1',title:'Plate',units:'mm',features:[{id:'body',operation:'add',shape:'box',origin:[0,0,0],size:[10,20,3]}],probes:[]}}],instances:[{id:'one',partId:'plate',position:[1,2,3],rotation:[0,0,0]}]});

test('editable drafts retain incomplete names and numeric fields without mutating input',()=>{
 const value=fixture();value.title='';value.instances[0].id='';value.instances[0].position=['','4e','-'];const before=JSON.stringify(value),draft=editableAssembly(value);
 assert.deepEqual(draft,value);assert.equal(JSON.stringify(value),before);draft.assets[0].source.features[0].size[0]=99;assert.equal(value.assets[0].source.features[0].size[0],10);assert.throws(()=>normalizeAssemblyDraft(value));
});

test('draft normalization converts complete numeric strings and enforces geometry bounds and IDs',()=>{
 const value=fixture();value.instances[0].position=['-4.5','1e2','+3'];value.instances[0].rotation=['0','90','-360'];const result=normalizeAssemblyDraft(value);assert.deepEqual(result.instances[0].position,[-4.5,100,3]);assert.deepEqual(result.instances[0].rotation,[0,90,-360]);assert.equal(value.instances[0].position[0],'-4.5');
 for(const mutate of [s=>s.instances[0].position[0]='',s=>s.instances[0].position[0]='1e999',s=>s.instances[0].position[0]='501',s=>s.instances[0].rotation[0]='361',s=>s.instances.push(structuredClone(s.instances[0])),s=>s.instances[0].id='',s=>s.title='']){const bad=fixture();mutate(bad);assert.throws(()=>normalizeAssemblyDraft(bad));}
});

test('editable draft relaxation never accepts executable data, malformed arrays, invalid CAD or missing references',()=>{
 const mutations=[s=>s.code='run()',s=>s.instances[0].position[0]='alert(1)',s=>s.instances[0].position[0]=NaN,s=>s.instances[0].position[0]=true,s=>delete s.instances[0].position[1],s=>s.instances[0].partId='missing',s=>s.assets[0].source.features[0].size[0]=-1,s=>s.instances[0].id='bad\nname',s=>s.title='bad\u007ftitle',s=>s.instances[0].position[0]='1'.repeat(51)];
 for(const mutate of mutations){const bad=fixture();mutate(bad);assert.throws(()=>editableAssembly(bad));}
});
