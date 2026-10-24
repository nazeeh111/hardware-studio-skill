import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {validateSolidSpec,needsCurvedRuntime} from '../solid-spec.js';
import {solidIntentSchema,solidIntentPrompt,validateSolidIntentResponse} from '../solid-intent.js';
const spec=JSON.parse(readFileSync(new URL('../tools/solid-generator/examples/rounded-pull-tab.json',import.meta.url)));
test('curved source and fillet remain bounded data with normalized picking tolerance',()=>{
 const before=JSON.stringify(spec),valid=validateSolidSpec(spec);assert.equal(JSON.stringify(spec),before);assert.deepEqual(valid,spec);assert.ok(needsCurvedRuntime(valid));
 const without=structuredClone(spec);delete without.features[2].tolerance;assert.equal(validateSolidSpec(without).features[2].tolerance,.01);assert.equal(needsCurvedRuntime({features:[],probes:[]}),false);
 for(const mutate of [p=>p.features.unshift(p.features[2]),p=>p.features[2].edges=[],p=>p.features[2].edges.push(p.features[2].edges[0]),p=>p.features[2].edges[0]=[0,null,1],p=>p.features[2].tolerance=1,p=>p.features[2].tolerance=NaN,p=>p.features[2].radius=true,p=>p.features[2].code='execute',p=>p.probes.push({...p.features[2],id:'fillet-check'}),p=>p.features[0].segments.at(-1).end=[0,0],p=>p.features[0].size=[1,2,3]]){const bad=structuredClone(spec);mutate(bad);assert.throws(()=>validateSolidSpec(bad));}
});
const python=process.env.HARDWARE_STUDIO_PYTHON||'/Users/nazeeh/.local/share/codex-tools/engineering-ocp8-sympy1.14/venv/bin/python';
test('entire curved source normalization agrees with the native validator',{skip:!existsSync(python)},()=>{
 const program=`import sys,json;sys.path.insert(0,sys.argv[1]);import solid;print(json.dumps(solid.validate(json.loads(sys.stdin.read()))))`;
 const output=execFileSync(python,['-c',program,new URL('../tools/solid-generator',import.meta.url).pathname],{input:JSON.stringify(spec),encoding:'utf8'});assert.deepEqual(JSON.parse(output),validateSolidSpec(spec));
});
test('local model contract supports curves and seed fillets without accepting code or physical authority',()=>{
 const request={mode:'create',instruction:'A dimensioned capsule pull tab with R1 upper edge fillet',base:null};
 assert.deepEqual(validateSolidIntentResponse(request,{status:'ready',spec,assumptions:[],missing:[]}).spec,spec);
 assert.match(solidIntentPrompt(request),/connected tangent edges/);assert.match(solidIntentPrompt(request),/without shape or origin/);
 assert.equal(solidIntentSchema().properties.spec.oneOf[0].properties.features.items.oneOf.at(-1).additionalProperties,false);
 assert.throws(()=>validateSolidIntentResponse(request,{status:'ready',spec:{...spec,code:'x'},assumptions:[],missing:[]}));
});
