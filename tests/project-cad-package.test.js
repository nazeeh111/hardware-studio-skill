import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createProjectCadController,PROJECT_CAD_SOURCE_MAX_BYTES,PROJECT_CAD_RESPONSE_MAX_BYTES} from '../project-cad-package.js';
import {createZip} from '../zip.js';
const solid={schema:'hardware-studio-solid-v1',title:'Plate',units:'mm',features:[{id:'plate',operation:'add',shape:'box',origin:[0,0,0],size:[20,10,3]}],probes:[]};
const curved={schema:'hardware-studio-solid-v1',title:'Circle',units:'mm',features:[{id:'circle',operation:'add',shape:'curve',origin:[0,0,0],axis:'z',height:3,start:[0,0],segments:[{kind:'arc',via:[5,5],end:[10,0]},{kind:'arc',via:[5,-5],end:[0,0]}]}],probes:[]};
const assembly={schema:'hardware-studio-assembly-v1',title:'Placed plates',units:'mm',assets:[{partId:'a',source:solid},{partId:'unplaced',source:solid}],instances:[{id:'one',partId:'a',position:[0,0,0],rotation:[0,0,0]}]};
const project=()=>({id:'project-one',title:'Captured bench support',review:{mechanical:false},parts:[{id:'a',qty:1}],solidSpec:structuredClone(solid),traySpec:null,assemblySpec:null});
const zip=createZip([{name:'verification.json',data:'{"status":"passed"}'}],new Date('2026-10-23T00:00:00Z'));
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
const hash=async bytes=>Buffer.from(await webcrypto.subtle.digest('SHA-256',bytes)).toString('hex');
const settle=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setImmediate(resolve));}assert.fail('Expected asynchronous controller state was not reached');};
function setup({initial=project(),local=true,features=['project-cad-package-v1','curved-solid-v1'],archive,reply,download,timeoutMs}={}){
 let selected=initial,archiveCalls=0;const requests=[],downloads=[],changes=[];
 const controller=createProjectCadController({getProject:()=>selected,local,cryptoImpl:webcrypto,timeoutMs,
  makeSourceArchive:frozen=>{archiveCalls++;return archive?archive(frozen):createZip([{name:'project.json',data:JSON.stringify(frozen)}],new Date('2026-10-23T00:00:00Z'));},
  fetchImpl:async(url,options={})=>{requests.push({url,options});if(url==='./api/health')return Response.json({ok:true,features});const body=JSON.parse(options.body),bytes=Uint8Array.from(Buffer.from(body.sourceZipBase64,'base64')),sourceHash=await hash(bytes);return reply?reply({url,options,bytes,sourceHash}):new Response(zip,{headers:{'Content-Type':'application/zip','X-Hardware-Studio-Source-SHA256':sourceHash,'X-Hardware-Studio-CAD-Status':'passed'}});},
  download:async(name,blob,type)=>{downloads.push({name,blob,type});if(download)return download(name,blob,type);},onChange:state=>changes.push(state)});
 return {controller,requests,downloads,changes,setProject:value=>{selected=value;},selected:()=>selected,get archiveCalls(){return archiveCalls;}};
}

test('captured project and byte-exact source remain bound across edits and project switches without source writes',async()=>{
 const gate=deferred();let captured;
 const env=setup({archive:async frozen=>{captured=frozen;assert.ok(Object.isFrozen(frozen));assert.ok(Object.isFrozen(frozen.solidSpec.features[0]));await gate.promise;return createZip([{name:'project.json',data:JSON.stringify(frozen)}],new Date('2026-10-23T00:00:00Z'));}});
 const before=structuredClone(env.selected());await env.controller.refreshRuntime();const run=env.controller.build();await settle(()=>captured);
 env.selected().title='Later title';env.selected().solidSpec.features[0].size[0]=99;env.setProject({...project(),id:'other',title:'Other project'});gate.resolve();
 assert.equal(await run,true);assert.equal(env.archiveCalls,1);assert.deepEqual(captured,before);assert.equal(env.selected().title,'Other project');assert.equal(env.selected().review.mechanical,false);
 const posted=env.requests.find(value=>value.url==='./api/project-cad'),body=JSON.parse(posted.options.body),source=Buffer.from(body.sourceZipBase64,'base64');
 assert.equal(body.schema,'hardware-studio-project-cad-v1');assert.equal(body.project,undefined);assert.equal(env.controller.state().last.sourceSha256,await hash(source));assert.equal(env.controller.state().last.title,before.title);assert.match(env.controller.state().message,/Captured bench support/);assert.doesNotMatch(env.controller.state().message,/Other project/);
 assert.equal(env.downloads.length,1);assert.equal(env.downloads[0].type,'application/zip');assert.ok(env.downloads[0].blob instanceof Blob);assert.deepEqual(new Uint8Array(await env.downloads[0].blob.arrayBuffer()),zip);assert.equal(posted.options.redirect,'error');assert.equal(posted.options.credentials,'same-origin');
 assert.equal(await env.controller.downloadLast(),true);assert.strictEqual(env.downloads[0].blob,env.downloads[1].blob);
});

test('controller copies archive bytes before hashing or posting a reused exporter buffer',async()=>{
 let source,posted;const cryptoImpl={subtle:{digest:async(algorithm,bytes)=>{source.fill(0);return webcrypto.subtle.digest(algorithm,bytes);}}};
 const original=createZip([{name:'source.json',data:'original bytes'}]),controller=createProjectCadController({getProject:project,local:true,cryptoImpl,makeSourceArchive:()=>{source=original.slice();return source;},download:()=>{},fetchImpl:async(url,options)=>{if(url==='./api/health')return Response.json({ok:true,features:['project-cad-package-v1']});posted=Uint8Array.from(Buffer.from(JSON.parse(options.body).sourceZipBase64,'base64'));return new Response(zip,{headers:{'Content-Type':'application/zip','X-Hardware-Studio-Source-SHA256':await hash(posted),'X-Hardware-Studio-CAD-Status':'passed'}});}});
 await controller.refreshRuntime();assert.equal(await controller.build(),true);assert.deepEqual(posted,original);assert.ok(source.every(value=>value===0));
});

test('public origin never fetches health, CAD or model endpoints',async()=>{
 const env=setup({local:false});assert.equal(await env.controller.refreshRuntime(),false);assert.equal(await env.controller.build(),false);assert.equal(env.controller.state().canBuild,false);assert.equal(env.archiveCalls,0);assert.deepEqual(env.requests,[]);
});

test('health contract and curved sources gate all branches, including unplaced assembly assets',async()=>{
 for(const [name,features,source,buildable]of [
  ['old server',['sampled-mesh-readback-v1'],project(),false],
  ['basic server solid',['project-cad-package-v1'],project(),true],
  ['curved shared source',['project-cad-package-v1'],{...project(),solidSpec:curved},false],
  ['unplaced curved asset',['project-cad-package-v1'],{...project(),solidSpec:null,assemblySpec:{...assembly,assets:[assembly.assets[0],{partId:'unplaced',source:curved}]}},false],
  ['advanced unplaced curved asset',['project-cad-package-v1','curved-solid-v1'],{...project(),solidSpec:null,assemblySpec:{...assembly,assets:[assembly.assets[0],{partId:'unplaced',source:curved}]}},true]
 ]){const env=setup({initial:source,features});assert.equal(env.controller.state().canBuild,false,name);await env.controller.refreshRuntime();assert.equal(env.controller.state().canBuild,buildable,name);assert.equal(await env.controller.build(),buildable,name);assert.equal(env.archiveCalls,buildable?1:0,name);}
});

test('missing CAD, malformed branch and assembly without placements fail before source archive or request',async()=>{
 for(const source of [{...project(),solidSpec:null},{...project(),solidSpec:{...solid,features:[]}},{...project(),assemblySpec:{...assembly,instances:[]}}, {...project(),traySpec:{schema:'bad'}}]){const env=setup({initial:source});await env.controller.refreshRuntime();assert.equal(env.controller.state().canBuild,false);assert.equal(await env.controller.build(),false);assert.equal(env.archiveCalls,0);assert.equal(env.requests.length,1);}
 const env=setup({initial:{...project(),solidSpec:null,assemblySpec:assembly}});await env.controller.refreshRuntime();assert.equal(await env.controller.build(),true);assert.equal(env.selected().assemblySpec.assets.length,2);
});

test('response hash, CAD status, type and ZIP envelope are required and invalid responses never replace last artifact',async()=>{
 let mode='valid';
 const env=setup({reply:({sourceHash})=>{
  const headers={'Content-Type':'application/zip','X-Hardware-Studio-Source-SHA256':sourceHash,'X-Hardware-Studio-CAD-Status':'passed'};
  if(mode==='missing hash')delete headers['X-Hardware-Studio-Source-SHA256'];if(mode==='wrong hash')headers['X-Hardware-Studio-Source-SHA256']='f'.repeat(64);if(mode==='missing status')delete headers['X-Hardware-Studio-CAD-Status'];if(mode==='unknown status')headers['X-Hardware-Studio-CAD-Status']='everything-perfect';if(mode==='wrong type')headers['Content-Type']='application/json';
  return new Response(mode==='empty'?null:mode==='error body'?'{"error":"failed"}':mode==='truncated'?zip.subarray(0,zip.length-1):zip,{headers});
 }});
 await env.controller.refreshRuntime();assert.equal(await env.controller.build(),true);const original=env.controller.state().last;
 for(const value of ['missing hash','wrong hash','missing status','unknown status','wrong type','empty','error body','truncated']){mode=value;assert.equal(await env.controller.build(),false,value);assert.deepEqual(env.controller.state().last,original,value);assert.equal(env.downloads.length,1,value);}
 assert.equal(await env.controller.downloadLast(),true);assert.equal(env.downloads.length,2);
});

test('assembly interference retains and downloads full artifact with explicit captured-title warning',async()=>{
 const env=setup({reply:({sourceHash})=>new Response(zip,{headers:{'Content-Type':'application/zip','X-Hardware-Studio-Source-SHA256':sourceHash,'X-Hardware-Studio-CAD-Status':'interference'}})});await env.controller.refreshRuntime();assert.equal(await env.controller.build(),true);assert.equal(env.controller.state().last.cadStatus,'interference');assert.match(env.controller.state().message,/INTERFERENCE recorded for “Captured bench support”/);assert.doesNotMatch(env.controller.state().message,/checks passed|fit passed/i);assert.equal(env.downloads.length,1);
});

test('oversized source is rejected before network, and claimed and streamed response bounds are enforced',async()=>{
 const sourceEnv=setup({archive:()=>new Uint8Array(PROJECT_CAD_SOURCE_MAX_BYTES+1)});await sourceEnv.controller.refreshRuntime();assert.equal(await sourceEnv.controller.build(),false);assert.equal(sourceEnv.requests.length,1);assert.match(sourceEnv.controller.state().message,/12 MiB/);
 for(const streamed of [false,true]){const env=setup({reply:({sourceHash})=>new Response(streamed?new ReadableStream({start(controller){for(let n=0;n<65;n++)controller.enqueue(new Uint8Array(1024*1024));controller.close();}}):zip,{headers:{'Content-Type':'application/zip','X-Hardware-Studio-Source-SHA256':sourceHash,'X-Hardware-Studio-CAD-Status':'passed',...(!streamed?{'Content-Length':String(PROJECT_CAD_RESPONSE_MAX_BYTES+1)}:{})}})});await env.controller.refreshRuntime();assert.equal(await env.controller.build(),false);assert.match(env.controller.state().message,/allowed package size/);assert.equal(env.downloads.length,0);}
});

test('cancel during an uncooperative request retains earlier artifact and ignores late response, allowing a new build',async()=>{
 const gate=deferred();let pending=false,count=0;
 const env=setup({reply:({sourceHash})=>{const response=()=>new Response(zip,{headers:{'Content-Type':'application/zip','X-Hardware-Studio-Source-SHA256':sourceHash,'X-Hardware-Studio-CAD-Status':'passed'}});if(++count===2){pending=true;return gate.promise.then(response);}return response();}});
 await env.controller.refreshRuntime();assert.equal(await env.controller.build(),true);const original=env.controller.state().last,run=env.controller.build();await settle(()=>pending);assert.equal(await env.controller.build(),false);assert.equal(env.controller.cancel(),true);assert.equal(await run,false);assert.equal(env.controller.state().busy,false);assert.deepEqual(env.controller.state().last,original);assert.match(env.controller.state().message,/server may continue its bounded build/);
 env.setProject({...project(),title:'New request'});assert.equal(await env.controller.build(),true);gate.resolve();await new Promise(resolve=>setImmediate(resolve));assert.equal(env.controller.state().last.title,'New request');assert.equal(env.downloads.length,2);
});

test('timeout includes uncooperative source export and never creates a package or claims server cancellation',async()=>{
 const env=setup({archive:()=>new Promise(()=>{}),timeoutMs:5});await env.controller.refreshRuntime();assert.equal(await env.controller.build(),false);assert.equal(env.controller.state().phase,'timeout');assert.equal(env.controller.state().last,null);assert.equal(env.controller.state().busy,false);assert.match(env.controller.state().message,/server may continue/);assert.equal(env.requests.length,1);
});

test('server build failure reports bounded detail without discarding previously completed artifact',async()=>{
 let fail=false;const env=setup({reply:({sourceHash})=>fail?Response.json({error:'Invalid shell for part three.'},{status:422}):new Response(zip,{headers:{'Content-Type':'application/zip','X-Hardware-Studio-Source-SHA256':sourceHash,'X-Hardware-Studio-CAD-Status':'passed'}})});await env.controller.refreshRuntime();assert.equal(await env.controller.build(),true);fail=true;assert.equal(await env.controller.build(),false);assert.match(env.controller.state().message,/Invalid shell for part three/);assert.equal(env.controller.state().last.title,'Captured bench support');assert.equal(env.downloads.length,1);
});

test('download failure retains completed bytes and does not regenerate on retry',async()=>{
 let fail=true;const env=setup({download:()=>{if(fail)throw new Error('Browser denied download');}});await env.controller.refreshRuntime();assert.equal(await env.controller.build(),true);assert.match(env.controller.state().message,/retained.*download could not start/);assert.equal(env.controller.state().phase,'complete');fail=false;assert.equal(await env.controller.downloadLast(),true);assert.equal(env.archiveCalls,1);assert.strictEqual(env.downloads[0].blob,env.downloads[1].blob);
});


test('cancelling while a response stream is pending stops client reading and ignores subsequent bytes',async()=>{
 let streamStarted=false,streamCancelled=false;
 const env=setup({reply:({sourceHash})=>new Response(new ReadableStream({start(){streamStarted=true;},cancel(){streamCancelled=true;}}),{headers:{'Content-Type':'application/zip','X-Hardware-Studio-Source-SHA256':sourceHash,'X-Hardware-Studio-CAD-Status':'passed'}})});
 await env.controller.refreshRuntime();const run=env.controller.build();await settle(()=>streamStarted);assert.equal(env.controller.cancel(),true);assert.equal(await run,false);await settle(()=>streamCancelled);assert.equal(env.controller.state().last,null);assert.equal(env.downloads.length,0);assert.match(env.controller.state().message,/cancelled for “Captured bench support”/);
});

test('stale health responses cannot replace a newer successful runtime refresh',async()=>{
 const first=deferred();let calls=0;
 const controller=createProjectCadController({getProject:project,local:true,cryptoImpl:webcrypto,makeSourceArchive:()=>zip,download:()=>{},fetchImpl:()=>++calls===1?first.promise:Response.json({ok:true,features:['project-cad-package-v1','curved-solid-v1']})});
 const old=controller.refreshRuntime();assert.equal(await controller.refreshRuntime(),true);first.resolve(Response.json({ok:true,features:[]}));await old;assert.deepEqual(controller.state().runtime,{checked:true,ready:true,curved:true});
});

test('empty or non-byte source archives and truncated declared responses never download',async()=>{
 for(const archive of [()=>new Uint8Array(),()=>new Blob([zip])]){const env=setup({archive});await env.controller.refreshRuntime();assert.equal(await env.controller.build(),false);assert.equal(env.requests.length,1);assert.equal(env.downloads.length,0);}
 const env=setup({reply:({sourceHash})=>new Response(zip,{headers:{'Content-Type':'application/zip','Content-Length':String(zip.length+1),'X-Hardware-Studio-Source-SHA256':sourceHash,'X-Hardware-Studio-CAD-Status':'passed'}})});await env.controller.refreshRuntime();assert.equal(await env.controller.build(),false);assert.match(env.controller.state().message,/truncated/);assert.equal(env.downloads.length,0);
});
