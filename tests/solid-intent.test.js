import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {solidIntentSchema,solidIntentPrompt,validateSolidIntentRequest,validateSolidIntentResponse} from '../solid-intent.js';

const bracket=JSON.parse(await readFile(new URL('../tools/solid-generator/examples/mounting-bracket.json',import.meta.url),'utf8'));
const plate={schema:'hardware-studio-solid-v1',title:'First plate',units:'mm',features:[{id:'plate',operation:'add',shape:'box',origin:[0,0,0],size:[40,25,3]}],probes:[]};
const create={mode:'create',instruction:'Make a rectangular plate 40 × 25 × 3 mm.'};
const ready=spec=>({status:'ready',spec,assumptions:[],missing:[]});

test('creation accepts an original first part without a base; snapshots do not change inputs',()=>{
 const input={...create,context:{project:{id:'project',title:'Small fixture',brief:'A support fixture'},target:{id:'plate',name:'Base plate',category:'Mechanical',detail:'Flat stock',qty:1}}};
 const before=JSON.stringify(input),request=validateSolidIntentRequest(input),output=ready(plate),originalOutput=JSON.stringify(output);
 const result=validateSolidIntentResponse(request,output);
 assert.equal(result.status,'ready');assert.equal(result.base,null);assert.deepEqual(result.spec,plate);
 assert.equal(JSON.stringify(input),before);assert.equal(JSON.stringify(output),originalOutput);
 input.context.target.name='Changed';assert.equal(request.context.target.name,'Base plate');
 assert.throws(()=>{request.instruction='Changed';},TypeError);
 result.spec.features[0].size[0]=90;assert.equal(plate.features[0].size[0],40);
 assert.match(solidIntentPrompt(request),/CREATE one original/);
});

test('create prompt excludes an existing bracket entirely; edit retains current features and probes',()=>{
 const request=validateSolidIntentRequest({...create,base:bracket});
 const prompt=solidIntentPrompt(request);
 assert.doesNotMatch(prompt,/Current spec|mounting.bracket|"features"|"probes"/i);
 assert.ok(!prompt.includes(JSON.stringify(request.base)));
 for(const feature of bracket.features)assert.ok(!prompt.includes(JSON.stringify(feature)));
 const edit=validateSolidIntentRequest({mode:'edit',instruction:'Change the base width to 70 mm.',base:bracket});
 const editPrompt=solidIntentPrompt(edit);
 assert.match(editPrompt,/EDIT the supplied solid/);assert.match(editPrompt,/Preserve every unrequested/);
 assert.ok(editPrompt.includes(JSON.stringify(edit.base)));assert.ok(editPrompt.includes('region probe'));
 const updated=structuredClone(bracket);updated.features[0].size[0]=70;
 const result=validateSolidIntentResponse(edit,ready(updated));
 assert.equal(result.base,JSON.stringify(edit.base));assert.deepEqual(result.spec.probes,bracket.probes);
 assert.throws(()=>validateSolidIntentResponse(edit,ready(bracket)),/no feature changes/);
 assert.throws(()=>validateSolidIntentResponse(request,ready(bracket)),/no feature changes/);
});

test('missing dimensions and unsupported shapes remain explicit null-source outcomes',()=>{
 for(const [status,reason]of [['needs-input','What is the hole diameter and its center location?'],['unsupported','Helical threads are unsupported.']]){
  const result=validateSolidIntentResponse(create,{status,spec:null,assumptions:[],missing:[reason]});
  assert.equal(result.status,status);assert.equal(result.spec,null);assert.deepEqual(result.missing,[reason]);
  assert.throws(()=>validateSolidIntentResponse(create,{status,spec:plate,assumptions:[],missing:[reason]}),/spec:null/);
  assert.throws(()=>validateSolidIntentResponse(create,{status,spec:null,assumptions:[],missing:[]}),/explain/);
 }
 assert.throws(()=>validateSolidIntentResponse(create,{...ready(plate),missing:['hole size']}),/missing/);
 assert.throws(()=>validateSolidIntentResponse(create,ready(null)),/unsupported fields/);
 assert.match(solidIntentPrompt(create),/Never invent essential dimensions/);
 assert.match(solidIntentPrompt(create),/Do not claim fit, strength/);
});

test('request validation bounds instructions, context and baseline and requires a project target',()=>{
 const bad=[null,[],{...create,mode:'automatic'},{...create,instruction:''},{...create,instruction:'x'.repeat(2001)},{...create,instruction:'bad\0text'},{...create,code:'run()'},{mode:'edit',instruction:'Widen'},{...create,base:{...plate,verified:true}},{...create,context:{project:{id:'p',title:'Fixture'}}},{...create,context:{target:{id:'t'}}},{...create,context:{target:{id:'t',name:'Part',qty:Infinity}}},{...create,context:{target:{id:'t',name:'Part',verified:true}}},{...create,context:{project:{id:'p',title:'Fixture',summary:'x'.repeat(5001)},target:{id:'t',name:'Part'}}}];
 for(const value of bad)assert.throws(()=>validateSolidIntentRequest(value));
 const request=validateSolidIntentRequest({...create,instruction:'  First line\nSecond line  '});assert.equal(request.instruction,'First line\nSecond line');
 const fullContext={project:{id:'p'.repeat(100),title:'t'.repeat(200),brief:'b'.repeat(5000),summary:'s'.repeat(5000)},target:{id:'t',name:'Part'}};
 assert.deepEqual(validateSolidIntentRequest({...create,context:fullContext}).context,fullContext);
 const edit=validateSolidIntentRequest({mode:'edit',instruction:'Widen',base:bracket});
 assert.notEqual(edit.base,bracket);assert.equal(bracket.features[0].size[0],60);
});

test('response validation rejects unknown fields, authority, bad lists and malformed geometry',()=>{
 const bad=[null,[],{...ready(plate),status:'verified'},{...ready(plate),code:'return part'},{...ready(plate),verified:true},{...ready(plate),fitChecked:true},{...ready(plate),assumptions:Array(13).fill('choice')},{...ready(plate),assumptions:['']},{...ready(plate),missing:[true]},{...ready(plate),assumptions:['x'.repeat(241)]},{...ready(plate),assumptions:['bad\ntext']},{...ready(plate),spec:{...plate,title:'bad\0title'}},{...ready(plate),spec:{...plate,strengthVerified:true}},{...ready(plate),spec:{...plate,features:[{...plate.features[0],size:[1,2,NaN]}]}},{...ready(plate),spec:{...plate,features:[{...plate.features[0],code:'box()'}]}},{...ready(plate),spec:{...plate,title:'x'.repeat(70000)}}];
 for(const value of bad)assert.throws(()=>validateSolidIntentResponse(create,value));
 const response={...ready(plate),assumptions:['  Lower corner placed at origin.  ']};
 assert.deepEqual(validateSolidIntentResponse(create,response).assumptions,['Lower corner placed at origin.']);
 assert.equal(response.assumptions[0],'  Lower corner placed at origin.  ');
});

test('schema constrains supported source records and each call returns independent objects',()=>{
 const schema=solidIntentSchema();assert.equal(schema.additionalProperties,false);
 assert.deepEqual(schema.required,['status','spec','assumptions','missing']);
 assert.deepEqual(schema.properties.status.enum,['ready','needs-input','unsupported']);
 const source=schema.properties.spec.oneOf[0];assert.equal(source.additionalProperties,false);
 assert.equal(source.properties.features.maxItems,32);assert.equal(source.properties.probes.maxItems,16);
 assert.deepEqual(source.properties.features.items.oneOf.map(item=>item.properties.shape?.const||item.properties.operation.const),['box','cylinder','profile','curve','fillet']);
 assert.equal(source.properties.probes.items.oneOf.some(item=>item.properties.operation?.const==='fillet'),false);
 schema.properties.assumptions.maxItems=99;assert.equal(solidIntentSchema().properties.assumptions.maxItems,12);
});
