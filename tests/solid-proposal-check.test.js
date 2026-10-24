import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {checkSolidProposal,proposalCheckEntries,SolidProposalCheckError,SOLID_PROPOSAL_CHECK_SCHEMA,SOLID_PROPOSAL_RESPONSE_MAX_BYTES,SOLID_PROPOSAL_ERROR_MAX_BYTES} from '../solid-proposal-check.js';
import {validateSolidSpec} from '../solid-spec.js';
import {mockMeshReadback} from './fixtures/mock-mesh-readback.js';
const source=JSON.parse(await readFile(new URL('../tools/solid-generator/examples/mounting-bracket.json',import.meta.url),'utf8'));
const bytes=await readFile(new URL('../examples/feature-bracket/generated/solid.stl',import.meta.url));
const report=JSON.parse(await readFile(new URL('../examples/feature-bracket/generated/verification.json',import.meta.url),'utf8'));
// Historical mesh plus synthetic declarations exercise the existing browser
// contract only. They are not fresh native geometric verification evidence.
report.stl_check=mockMeshReadback(report.stl_triangles,report.volume_mm3);
const payload=()=>({schema:'hardware-studio-solid-preview-v1',spec:structuredClone(source),verification:structuredClone(report),meshes:[{name:'solid.stl',dataBase64:bytes.toString('base64')}]});
const response=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
const sha=value=>createHash('sha256').update(value).digest('hex');
async function failure(promise,code){try{await promise;assert.fail('Expected typed failure');}catch(error){assert.ok(error instanceof SolidProposalCheckError);assert.equal(error.code,code);assert.equal(error.record.receipt.code,code);assert.ok(Object.isFrozen(error.record));return error;}}

test('captured normalized source, exact payload and verified bytes remain immutable with evidence hashes',async()=>{
 const input=structuredClone(source),original=JSON.stringify(input);let request;
 const record=await checkSolidProposal(input,{local:true,fetchImpl:async(url,options)=>{request={url,options};input.features[0].size[0]=70;return response(payload());}});
 assert.equal(request.url,'./api/solid-preview');assert.equal(request.options.credentials,'same-origin');assert.equal(request.options.redirect,'error');assert.equal(request.options.cache,'no-store');assert.equal(request.options.method,'POST');
 assert.equal(record.receipt.schema,SOLID_PROPOSAL_CHECK_SCHEMA);assert.equal(record.receipt.status,'passed');assert.equal(record.receipt.sourceSha256,sha(request.options.body));assert.equal(request.options.body,JSON.stringify(validateSolidSpec(JSON.parse(original))));
 assert.deepEqual(record.response,payload());assert.equal(record.spec.features[0].size[0],60);assert.equal(record.receipt.stlSha256,sha(bytes));assert.equal(record.receipt.responseSha256,sha(JSON.stringify(payload())));assert.equal(record.receipt.limits.stepAvailable,false);assert.equal(record.receipt.limits.semanticIntentValidation,false);
 assert.throws(()=>{record.spec.title='changed';},TypeError);assert.throws(()=>{record.response.verification.probes[0].passed=false;},TypeError);
 const mutable=record.stlBytes;mutable[0]^=255;assert.deepEqual(record.stlBytes,new Uint8Array(bytes));
 const entries=proposalCheckEntries(record);assert.deepEqual(entries.map(e=>e.name),['source.json','check.json','response.json','solid.stl','README.txt']);assert.equal(sha(entries[0].data),record.receipt.sourceSha256);assert.equal(sha(entries[2].data),record.receipt.responseSha256);entries[3].data[0]^=255;assert.deepEqual(proposalCheckEntries(record)[3].data,new Uint8Array(bytes));assert.throws(()=>proposalCheckEntries({...record}),/checker-created/);
});

test('public origin refuses requests while preserving captured source and its hash',async()=>{
 let calls=0;const error=await failure(checkSolidProposal(source,{local:false,fetchImpl:()=>{calls++;throw new Error();}}),'unavailable');assert.equal(calls,0);assert.equal(error.record.receipt.status,'not-run');assert.equal(error.record.receipt.sourceSha256,sha(JSON.stringify(validateSolidSpec(source))));assert.equal(error.record.receipt.title,source.title);assert.equal(error.record.response,null);assert.equal(error.record.stlBytes,null);assert.deepEqual(proposalCheckEntries(error.record).map(e=>e.name),['source.json','check.json','README.txt']);assert.match(proposalCheckEntries(error.record).at(-1).data,/prepared for submission/);assert.match(proposalCheckEntries(error.record).at(-1).data,/does not prove that a request was sent/);
});

for(const [name,mutate] of [
 ['different source',p=>p.spec.features[0].size[0]=70],
 ['changed STL bytes',p=>p.meshes[0].dataBase64=Buffer.from('bad').toString('base64')],
 ['wrong hash',p=>p.verification.sha256['solid.stl']='0'.repeat(64)],
 ['missing probe',p=>p.verification.probes.pop()],
 ['failed probe',p=>p.verification.probes[0].passed=false],
 ['missing native sampled readback',p=>delete p.verification.stl_check],
 ['tampered native sampled readback',p=>p.verification.stl_check.checked_triangle_centers--],
 ['mismatched triangles',p=>p.verification.stl_triangles++],
 ['mismatched dimensions',p=>p.verification.stl_outer_span_mm[0]++],
 ['mismatched schema',p=>p.schema='other']
])test('production viewer validation rejects '+name,async()=>{
 const changed=payload();mutate(changed);const error=await failure(checkSolidProposal(source,{local:true,fetchImpl:async()=>response(changed)}),'invalid-response');assert.equal(error.record.receipt.status,'not-run');assert.equal(error.record.stlBytes,null);assert.equal(error.record.receipt.sourceSha256,sha(JSON.stringify(validateSolidSpec(source))));
});

test('422 records rejected build with captured source, other HTTP failures remain not-run',async()=>{
 const error=await failure(checkSolidProposal(source,{local:true,fetchImpl:async()=>new Response(JSON.stringify({error:'Cut feature removed no material.'}),{status:422})}),'rejected');assert.equal(error.record.receipt.status,'rejected');assert.equal(error.record.receipt.httpStatus,422);assert.equal(error.record.receipt.error,'Cut feature removed no material.');assert.equal(error.record.receipt.rawMeshAvailable,undefined);assert.equal(error.record.receipt.limits.rawMeshAvailable,false);
 const offline=await failure(checkSolidProposal(source,{local:true,fetchImpl:async()=>new Response('Unavailable',{status:503})}),'unavailable');assert.equal(offline.record.receipt.status,'not-run');
});

test('deadline resolves even when fetch ignores AbortSignal and late rejection is handled',async()=>{
 let reject;const start=Date.now();const error=await failure(checkSolidProposal(source,{local:true,timeoutMs:250,fetchImpl:()=>new Promise((_,r)=>{reject=r;})}),'timeout');assert.ok(Date.now()-start<5000);assert.match(error.message,/server may continue/);assert.equal(typeof reject,'function');reject(new Error('Late fetch failure'));await new Promise(resolve=>setTimeout(resolve,5));
});

test('cancelled capture never invokes fetch, active cancellation also bounds ignored signals',async()=>{
 const before=new AbortController();before.abort();let calls=0;const first=await failure(checkSolidProposal(source,{local:true,signal:before.signal,fetchImpl:()=>{calls++;}}),'cancelled');assert.equal(calls,0);assert.equal(first.record.receipt.sourceSha256,null);assert.equal(first.record.spec.title,source.title);
 const active=new AbortController();let start;const begun=new Promise(resolve=>{start=resolve;});const check=checkSolidProposal(source,{local:true,signal:active.signal,fetchImpl:()=>{start();return new Promise(()=>{});}});await begun;active.abort();await failure(check,'cancelled');
});

test('response stream cancellation/deadline works when pending reader ignores request signal',async()=>{
 let cancel=false;const stream=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{'));},cancel(){cancel=true;}});
 await failure(checkSolidProposal(source,{local:true,timeoutMs:15,fetchImpl:async()=>new Response(stream,{headers:{'Content-Type':'application/json'}})}),'timeout');assert.equal(cancel,true);
});

test('declared and actual response caps, truncated bodies, content type and invalid JSON fail closed',async()=>{
 for(const make of [
  ()=>new Response('{}',{headers:{'Content-Type':'application/json','Content-Length':String(SOLID_PROPOSAL_RESPONSE_MAX_BYTES+1)}}),
  ()=>new Response(new Uint8Array(SOLID_PROPOSAL_RESPONSE_MAX_BYTES+1),{headers:{'Content-Type':'application/json'}}),
  ()=>new Response('{}',{headers:{'Content-Type':'application/json','Content-Length':'3'}}),
  ()=>new Response('{}',{headers:{'Content-Type':'text/html'}}),
  ()=>new Response('{',{headers:{'Content-Type':'application/json'}})
 ])await failure(checkSolidProposal(source,{local:true,fetchImpl:async()=>make()}),'invalid-response');
});

test('error responses use smaller bounded body cap without replacing server rejection classification',async()=>{
 let cancelled=false;const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(SOLID_PROPOSAL_ERROR_MAX_BYTES+1));},cancel(){cancelled=true;}});
 const error=await failure(checkSolidProposal(source,{local:true,fetchImpl:async()=>new Response(stream,{status:422})}),'rejected');assert.equal(cancelled,true);assert.match(error.message,/rejected/);
});

test('invalid source and deadline options return typed evidence without network requests or input changes',async()=>{
 const invalid=structuredClone(source);invalid.features[0].size[0]=NaN;let calls=0;const error=await failure(checkSolidProposal(invalid,{local:true,fetchImpl:()=>calls++}),'invalid-source');assert.equal(calls,0);assert.equal(error.record.spec,null);assert.equal(error.record.receipt.sourceSha256,null);assert.ok(Number.isNaN(invalid.features[0].size[0]));
 for(const timeoutMs of [0,NaN,Infinity,130001])await failure(checkSolidProposal(source,{local:true,timeoutMs,fetchImpl:()=>calls++}),'invalid-source');assert.equal(calls,0);
});


test('exact HTTP formatting is retained rather than replaced by parsed JSON serialization',async()=>{
 const original='  '+JSON.stringify(payload(),null,1)+'\n';
 const record=await checkSolidProposal(source,{local:true,fetchImpl:async()=>new Response(original,{headers:{'Content-Type':'application/json'}})});
 const captured=proposalCheckEntries(record).find(e=>e.name==='response.json').data;
 assert.equal(new TextDecoder().decode(captured),original);assert.equal(record.receipt.responseSha256,sha(original));assert.notEqual(record.receipt.responseSha256,sha(JSON.stringify(payload())));
});

test('valid but excessive normalized source is bounded before hashing or network',async()=>{
 const points=Array.from({length:64},(_,n)=>[100*Math.cos(n*Math.PI/32),100*Math.sin(n*Math.PI/32)]);
 const oversized={...structuredClone(source),features:Array.from({length:32},(_,n)=>({id:'large-profile-'+n,operation:'add',shape:'profile',origin:[0,0,n],axis:'z',height:2,points}))};
 assert.ok(JSON.stringify(validateSolidSpec(oversized)).length>65536);let calls=0;
 const error=await failure(checkSolidProposal(oversized,{local:true,fetchImpl:()=>calls++}),'invalid-source');assert.equal(calls,0);assert.equal(error.record.spec,null);assert.deepEqual(proposalCheckEntries(error.record).map(e=>e.name),['check.json','README.txt']);
});

test('deadline also bounds source hashing when its promise does not settle',async()=>{
 const original=Object.getOwnPropertyDescriptor(globalThis,'crypto');let hashing=false;
 try{
  Object.defineProperty(globalThis,'crypto',{configurable:true,value:{subtle:{digest:()=>{hashing=true;return new Promise(()=>{});}}}});
  let calls=0;const error=await failure(checkSolidProposal(source,{local:true,timeoutMs:15,fetchImpl:()=>calls++}),'timeout');assert.equal(hashing,true);assert.equal(calls,0);assert.equal(error.record.receipt.sourceSha256,null);assert.deepEqual(error.record.spec,validateSolidSpec(source));
 }finally{if(original)Object.defineProperty(globalThis,'crypto',original);else delete globalThis.crypto;}
});


for(const [label,headers] of [
 ['wrong content type',{'Content-Type':'text/html'}],
 ['excessive declared size',{'Content-Type':'application/json','Content-Length':String(SOLID_PROPOSAL_RESPONSE_MAX_BYTES+1)}]
])test('terminal '+label+' cancels unread body and aborts request before returning evidence',async()=>{
 let cancelled=false,requestSignal;
 const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('unread'));},cancel(){cancelled=true;return new Promise(()=>{});}});
 const error=await failure(checkSolidProposal(source,{local:true,fetchImpl:async(_url,options)=>{requestSignal=options.signal;return new Response(stream,{headers});}}),'invalid-response');
 assert.equal(cancelled,true);assert.equal(requestSignal.aborted,true);assert.equal(error.record.receipt.status,'not-run');assert.equal(error.record.receipt.code,'invalid-response');assert.ok(error.record.receipt.sourceSha256);assert.equal(error.record.stlBytes,null);
});

test('oversized declared error body is cancelled without losing HTTP rejection classification',async()=>{
 let cancelled=false,requestSignal;
 const stream=new ReadableStream({cancel(){cancelled=true;}});
 const error=await failure(checkSolidProposal(source,{local:true,fetchImpl:async(_url,options)=>{requestSignal=options.signal;return new Response(stream,{status:422,headers:{'Content-Length':String(SOLID_PROPOSAL_ERROR_MAX_BYTES+1)}});}}),'rejected');
 assert.equal(cancelled,true);assert.equal(requestSignal.aborted,true);assert.equal(error.record.receipt.status,'rejected');assert.equal(error.record.receipt.httpStatus,422);
});
