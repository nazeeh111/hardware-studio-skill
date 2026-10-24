import test from 'node:test';
import assert from 'node:assert/strict';
import {installSolidIntent} from '../solid-intent-ui.js';
import {writeWorkspace} from '../workspace-store.js';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {mockMeshReadback} from './fixtures/mock-mesh-readback.js';

const MODEL={name:'local-cad:latest',digest:'a'.repeat(64),size:10};
const OTHER={name:'another-local:latest',digest:'b'.repeat(64),size:20};
const BASE={schema:'hardware-studio-solid-v1',title:'Existing unrelated source',units:'mm',features:[{id:'old-box',operation:'add',shape:'box',origin:[0,0,0],size:[60,40,4]}],probes:[]};
const PART={schema:'hardware-studio-solid-v1',title:'Requested plate',units:'mm',features:[{id:'plate',operation:'add',shape:'box',origin:[0,0,0],size:[48,32,3]}],probes:[]};
const INSTRUCTION='Create a 48 by 32 by 3 mm rectangular plate. No other features.';
const PROJECT={id:'project-1',title:'Instrument support',brief:'A support for a small instrument.',summary:'Flat plate for a bench fixture.',parts:[{id:'part-1',name:'Support plate',category:'Mechanical',detail:'Flat base',qty:1},{id:'part-2',name:'Spacer',category:'Mechanical',detail:'Round standoff',qty:2}]};
const ready=()=>({model:MODEL.name,done:true,done_reason:'stop',response:JSON.stringify({status:'ready',spec:PART,assumptions:[],missing:[]})});
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function waitFor(predicate,label){for(let i=0;i<100;i++){if(predicate())return;await new Promise(resolve=>setImmediate(resolve));}assert.fail(label);}
function readZip(bytes){const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),entries=new Map();for(let at=0;at+30<=bytes.length&&view.getUint32(at,true)===0x04034b50;){const size=view.getUint32(at+18,true),nameLength=view.getUint16(at+26,true),extraLength=view.getUint16(at+28,true),start=at+30+nameLength+extraLength,end=start+size;assert.ok(end<=bytes.length);entries.set(new TextDecoder().decode(bytes.subarray(at+30,at+30+nameLength)),bytes.slice(start,end));at=end;}return entries;}

function setup(t,{base=null,project=true,hostname='127.0.0.1',models=[MODEL,OTHER],saved=null,generate=async()=>ready(),applyError=null,checkProposal,preview}={}){
 const originals=new Map(),nodes=new Map(),timers=new Set(),blobs=new Map(),events=new Map(),calls=[],downloads=[],runs=new Set(),retained=new Map(saved||[]);
 const nativeTimeout=globalThis.setTimeout,nativeClear=globalThis.clearTimeout;
 const createDescriptor=Object.getOwnPropertyDescriptor(URL,'createObjectURL'),revokeDescriptor=Object.getOwnPropertyDescriptor(URL,'revokeObjectURL');
 const state={spec:base?structuredClone(base):null,dirty:false,blocked:false,expectedRaw:base?JSON.stringify(base):null,currentRaw:base?JSON.stringify(base):null,projectSignature:'initial-project-signature'};
 let currentProject=structuredClone(PROJECT),applied=0;
 const replace=(name,value)=>{originals.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});};
 class Element{
  constructor(tag='div'){Object.assign(this,{tagName:tag,value:'',textContent:'',children:[],handlers:new Map(),hidden:false,disabled:false});}
  get options(){return this.children;}
  append(...children){const empty=this.children.length===0;this.children.push(...children);if(this.tagName==='select'&&empty&&children.length)this.value=children[0].value;}
  replaceChildren(...children){this.children=[];if(this.tagName==='select')this.value='';this.append(...children);}
  addEventListener(name,handler){this.handlers.set(name,handler);}
  click(){if(this.disabled)return;if(this.tagName==='a')downloads.push({filename:this.download,blob:blobs.get(this.href)});return this.handlers.get('click')?.();}
  change(value){this.value=value;this.handlers.get(this===nodes.get('instruction')?'input':'change')?.();}
 }
 for(const id of ['instruction','mode','target','model','ai-status','intent-retention','propose','cancel','accept','stale','proposal-download','proposal','proposal-heading','assumptions','proposed-source','earlier-proposal','target-field','discard','earlier-download','check','check-cancel','check-status','check-summary','check-stats','check-span','check-volume','check-triangles','check-details','check-capture','check-hash'])nodes.set(id,new Element(['mode','target','model'].includes(id)?'select':'div'));
 nodes.get('mode').append(Object.assign(new Element('option'),{value:'create'}),Object.assign(new Element('option'),{value:'edit'}));
 for(const id of ['proposal','stale','cancel','earlier-proposal','target-field'])nodes.get(id).hidden=true;
 replace('document',{getElementById:id=>nodes.get(id.replace(/^solid-/,'')),createElement:tag=>new Element(tag)});
 replace('location',{hostname});
 replace('sessionStorage',{getItem:key=>retained.get(key)??null,setItem:(key,value)=>retained.set(key,value)});
 replace('addEventListener',(event,handler)=>events.set(event,handler));
 replace('setTimeout',(callback,delay,...args)=>{const timer=nativeTimeout(()=>{timers.delete(timer);callback(...args);},delay);timers.add(timer);return timer;});
 replace('clearTimeout',timer=>{timers.delete(timer);nativeClear(timer);});
 Object.defineProperty(URL,'createObjectURL',{configurable:true,writable:true,value:blob=>{const url='blob:solid-test-'+blobs.size;blobs.set(url,blob);return url;}});
 Object.defineProperty(URL,'revokeObjectURL',{configurable:true,writable:true,value:url=>blobs.delete(url)});
 replace('fetch',async(url,options={})=>{
  calls.push({url,options});
  if(url.endsWith('/api/tags'))return Response.json({models});
  if(url.endsWith('/api/show'))return Response.json({capabilities:['completion']});
  if(url.endsWith('/api/generate')){
   if(options.signal.aborted)throw new DOMException('Cancelled','AbortError');
   const aborted=new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true}));
   return Response.json(await Promise.race([generate(JSON.parse(options.body),options.signal),aborted]));
  }
  if(url==='./api/solid-preview'&&preview)return preview(JSON.parse(options.body),options);
  throw new Error('Unexpected fetch '+url);
 });
 const panel=installSolidIntent({...(checkProposal?{checkProposal}:{}),storageKey:'test-intent',project:project?()=>currentProject:null,readState:()=>state,apply:next=>{if(applyError)throw new Error(applyError);const storage={getItem:()=>state.currentRaw,setItem:(key,value)=>{state.currentRaw=value;}};state.expectedRaw=writeWorkspace(storage,'source',state.expectedRaw,JSON.stringify(next));state.spec=structuredClone(next);applied++;}});
 t.after(async()=>{nodes.get('cancel').click();nodes.get('check-cancel').click();await Promise.allSettled([...runs]);for(const timer of timers)nativeClear(timer);for(const [key,descriptor]of originals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}for(const [key,descriptor]of [['createObjectURL',createDescriptor],['revokeObjectURL',revokeDescriptor]]){if(descriptor)Object.defineProperty(URL,key,descriptor);else delete URL[key];}});
 return {nodes,state,calls,retained,panel,events,get applied(){return applied;},project:()=>currentProject,replaceProject:p=>{currentProject=p;},ready:()=>waitFor(()=>!nodes.get('propose').disabled,'Model discovery did not finish'),prepare:()=>{nodes.get('instruction').change(INSTRUCTION);if(project)nodes.get('target').change('part-1');},check:()=>{const run=nodes.get('check').click();if(run){runs.add(run);void run.finally(()=>runs.delete(run));}return run;},propose:()=>{const run=nodes.get('propose').click();if(run){runs.add(run);void run.finally(()=>runs.delete(run));}return run;},zip:async id=>{const count=downloads.length;nodes.get(id).click();assert.equal(downloads.length,count+1);return readZip(new Uint8Array(await downloads.at(-1).blob.arrayBuffer()));}};
}

test('project creation sends selected brief and part with no inherited CAD and applies only on explicit acceptance',async t=>{
 const env=setup(t,{base:BASE});await env.ready();env.prepare();env.nodes.get('mode').change('create');await env.propose();
 const request=JSON.parse(env.calls.find(call=>call.url.endsWith('/api/generate')).options.body);
 assert.match(request.prompt,/Instrument support/);assert.match(request.prompt,/Support plate/);assert.match(request.prompt,/A support for a small instrument/);
 assert.doesNotMatch(request.prompt,/Existing unrelated source|old-box|Current spec|60,40,4/);
 assert.deepEqual(env.state.spec,BASE);assert.equal(env.applied,0);assert.equal(env.nodes.get('accept').disabled,false);
 const entries=await env.zip('proposal-download'),report=JSON.parse(new TextDecoder().decode(entries.get('proposal.json')));
 assert.equal(report.request.context.target.id,'part-1');assert.equal(report.model.digest,MODEL.digest);assert.equal(report.model.identityCheckedBeforeAndAfter,true);assert.equal('identity'in report,false);assert.equal(report.schema,'hardware-studio-solid-intent-v1');
 assert.match(new TextDecoder().decode(entries.get('README.txt')),/no solved assembly or per-part CAD binding/);
 env.nodes.get('accept').click();assert.equal(env.applied,1);assert.deepEqual(env.state.spec,PART);assert.match(env.nodes.get('ai-status').textContent,/not an assembly binding/);
});

test('project target is required before any model request',async t=>{
 const env=setup(t);await env.ready();env.nodes.get('instruction').change(INSTRUCTION);await env.propose();
 assert.equal(env.calls.filter(call=>call.url.endsWith('/api/generate')).length,0);assert.match(env.nodes.get('ai-status').textContent,/Select the part/);assert.equal(env.applied,0);
});

test('acceptance rejects changed request, action, model, target, project, source, dirty editor and stale sidecar',async t=>{
 const mutations={instruction:env=>env.nodes.get('instruction').change('Make a different plate.'),mode:env=>env.nodes.get('mode').change('edit'),model:env=>env.nodes.get('model').change(OTHER.name),target:env=>env.nodes.get('target').change('part-2'),project:env=>{env.state.projectSignature='changed-project';},context:env=>{env.project().brief='Changed brief';},source:env=>{env.state.spec=structuredClone(BASE);},dirty:env=>{env.state.dirty=true;},blocked:env=>{env.state.blocked=true;},sidecar:env=>{env.state.currentRaw='new external bytes';}};
 for(const [name,change]of Object.entries(mutations))await t.test(name,async sub=>{
  const env=setup(sub);await env.ready();env.prepare();await env.propose();assert.equal(env.nodes.get('accept').disabled,false);change(env);env.panel.refresh();assert.equal(env.nodes.get('accept').disabled,true);assert.equal(env.nodes.get('check').disabled,true);assert.equal(env.nodes.get('stale').hidden,false);
  // Invoke the handler directly as well: disabled UI is not the mutation guard.
  env.nodes.get('accept').handlers.get('click')();assert.equal(env.applied,0);assert.match(env.nodes.get('ai-status').textContent,/changed/);
 });
});

test('context changes while generation is pending leave its result downloadable and stale',async t=>{
 const gate=deferred();let started=false;const env=setup(t,{generate:async()=>{started=true;return gate.promise;}});await env.ready();env.prepare();const run=env.propose();await waitFor(()=>started,'Request not started');env.nodes.get('target').change('part-2');gate.resolve(ready());await run;
 assert.equal(env.applied,0);assert.equal(env.nodes.get('accept').disabled,true);assert.equal(env.nodes.get('stale').hidden,false);
 const report=JSON.parse(new TextDecoder().decode((await env.zip('proposal-download')).get('proposal.json')));assert.equal(report.request.context.target.id,'part-1');
});

test('failed checked write preserves current source and the completed proposal',async t=>{
 const env=setup(t,{base:BASE,applyError:'Quota exceeded, source not written.'});await env.ready();env.prepare();await env.propose();env.nodes.get('accept').click();
 assert.equal(env.applied,0);assert.deepEqual(env.state.spec,BASE);assert.equal(env.state.currentRaw,JSON.stringify(BASE));assert.match(env.nodes.get('ai-status').textContent,/Quota exceeded/);assert.equal(env.nodes.get('accept').disabled,false);
 const report=JSON.parse(new TextDecoder().decode((await env.zip('proposal-download')).get('proposal.json')));assert.equal(report.output.status,'ready');assert.equal('appliedAt'in report,false);
});

test('cancelled retry retains the exact earlier source, request, response and model',async t=>{
 let generation=0;const env=setup(t,{generate:async()=>++generation===1?ready():new Promise(()=>{})});await env.ready();env.prepare();await env.propose();const original=await env.zip('proposal-download');
 env.nodes.get('instruction').change('Create a different 10 by 10 by 1 mm plate.');const run=env.propose();await waitFor(()=>generation===2,'Retry not started');assert.equal(env.nodes.get('earlier-proposal').hidden,false);env.nodes.get('cancel').click();await run;
 assert.equal(env.applied,0);assert.equal(env.state.spec,null);assert.match(env.nodes.get('ai-status').textContent,/Cancelled/);assert.equal(env.nodes.get('accept').hidden,true);
 const earlier=await env.zip('earlier-download');for(const [name,bytes]of original)assert.deepEqual(earlier.get(name),bytes,name+' changed after cancellation');
});

test('missing and unsupported results never apply source, and invalid model fields remain failed raw proposals',async t=>{
 for(const status of ['needs-input','unsupported','invalid'])await t.test(status,async sub=>{
  const response=status==='invalid'?{status:'ready',spec:PART,assumptions:[],missing:[],verified:true}:{status,spec:null,assumptions:[],missing:['Specify the interface or supported shape.']};
  const env=setup(sub,{base:BASE,generate:async()=>({...ready(),response:JSON.stringify(response)})});await env.ready();env.prepare();await env.propose();env.nodes.get('accept').handlers.get('click')();assert.equal(env.applied,0);assert.deepEqual(env.state.spec,BASE);assert.equal(env.nodes.get('accept').hidden,true);
  const report=JSON.parse(new TextDecoder().decode((await env.zip('proposal-download')).get('proposal.json')));assert.equal(report.rawResponse.response,JSON.stringify(response));assert.equal(report.output?.status??null,status==='invalid'?null:status);if(status==='invalid')assert.match(report.error,/unsupported fields/);
 });
});

test('retained request restores its mode, target and local model choice after reload',async t=>{
 const saved=[['test-intent',JSON.stringify({instruction:INSTRUCTION,mode:'create',target:'part-2',model:OTHER.name})]],env=setup(t,{base:BASE,saved});await env.ready();
 assert.equal(env.nodes.get('instruction').value,INSTRUCTION);assert.equal(env.nodes.get('mode').value,'create');assert.equal(env.nodes.get('target').value,'part-2');assert.equal(env.nodes.get('model').value,OTHER.name);assert.equal(env.nodes.get('proposal').hidden,true);
 env.nodes.get('instruction').change('Revised explicit dimensions');const retained=JSON.parse(env.retained.get('test-intent'));assert.equal(retained.instruction,'Revised explicit dimensions');assert.equal(retained.target,'part-2');assert.equal(retained.model,OTHER.name);
});

test('public origin never contacts local Ollama',async t=>{
 const env=setup(t,{hostname:'nazeeh111.github.io'});env.prepare();await env.propose();assert.deepEqual(env.calls,[]);assert.equal(env.nodes.get('propose').disabled,true);assert.match(env.nodes.get('ai-status').textContent,/local modeler/);
});

// Historical geometry and synthetic verifier declarations exercise the actual
// browser checker contract here, not fresh native geometry or design intent.
const CHECK_SOURCE=JSON.parse(await readFile(new URL('../tools/solid-generator/examples/mounting-bracket.json',import.meta.url),'utf8'));
const CHECK_BYTES=await readFile(new URL('../examples/feature-bracket/generated/solid.stl',import.meta.url));
const CHECK_REPORT=JSON.parse(await readFile(new URL('../examples/feature-bracket/generated/verification.json',import.meta.url),'utf8'));
CHECK_REPORT.stl_check=mockMeshReadback(CHECK_REPORT.stl_triangles,CHECK_REPORT.volume_mm3);
const checkReady=()=>({...ready(),response:JSON.stringify({status:'ready',spec:CHECK_SOURCE,assumptions:[],missing:[]})});
const checkedPreview=()=>Response.json({schema:'hardware-studio-solid-preview-v1',spec:structuredClone(CHECK_SOURCE),verification:structuredClone(CHECK_REPORT),meshes:[{name:'solid.stl',dataBase64:CHECK_BYTES.toString('base64')}]});
const jsonEntry=(entries,name)=>JSON.parse(new TextDecoder().decode(entries.get(name)));
const bytesSha=bytes=>createHash('sha256').update(bytes).digest('hex');

test('optional production geometry handler captures checked evidence without saving source or review marks',async t=>{
 const env=setup(t,{base:BASE,generate:checkReady,preview:checkedPreview});await env.ready();env.prepare();env.nodes.get('mode').change('create');await env.propose();
 assert.equal(env.nodes.get('accept').textContent,'Apply unchecked source');await env.check();
 assert.equal(env.applied,0);assert.deepEqual(env.state.spec,BASE);assert.equal(env.state.currentRaw,JSON.stringify(BASE));assert.equal(env.nodes.get('accept').textContent,'Apply proposed source');assert.match(env.nodes.get('check-status').textContent,/passed/);
 assert.equal(env.nodes.get('check-stats').hidden,false);assert.match(env.nodes.get('check-span').textContent,/ × /);assert.match(env.nodes.get('check-volume').textContent,/^[\d,.]+$/);assert.match(env.nodes.get('check-triangles').textContent,/^[\d,.]+$/);assert.equal(env.nodes.get('check-details').hidden,false);assert.match(env.nodes.get('check-hash').textContent,/^[a-f0-9]{64}$/);assert.doesNotMatch(env.nodes.get('check-summary').textContent,/[a-f0-9]{64}/);assert.match(env.nodes.get('check-capture').textContent,/captured/);
 const entries=await env.zip('proposal-download'),report=jsonEntry(entries,'proposal.json'),folder=report.geometryChecks[0].entry,receipt=jsonEntry(entries,folder+'check.json'),binding=jsonEntry(entries,folder+'proposal-binding.json');
 assert.equal(report.geometryChecks.length,1);assert.equal(report.geometryChecks[0].status,'passed');assert.equal('result'in report.geometryChecks[0],false);assert.equal('response'in report.geometryChecks[0],false);assert.equal('stlBytes'in report.geometryChecks[0],false);
 assert.equal(bytesSha(entries.get(folder+'source.json')),receipt.sourceSha256);assert.equal(bytesSha(entries.get(folder+'solid.stl')),receipt.stlSha256);assert.equal(binding.model.digest,MODEL.digest);assert.equal(binding.request.context.target.id,'part-1');assert.equal(binding.proposalCapturedAt,report.capturedAt);
 assert.match(new TextDecoder().decode(entries.get(folder+'README.txt')),/No STEP/);assert.match(new TextDecoder().decode(entries.get('README.txt')),/does not establish design intent/);
 env.nodes.get('accept').click();assert.equal(env.applied,1);assert.deepEqual(env.state.spec,CHECK_SOURCE);
});

test('retry failure and cancellation retain the exact successful capture with bounded attempt history',async t=>{
 let attempt=0,waiting=false;
 const env=setup(t,{base:BASE,generate:checkReady,preview:async()=>{attempt++;if(attempt===1)return checkedPreview();if(attempt===2)return Response.json({error:'Cut feature removed no material.'},{status:422});waiting=true;return new Promise(()=>{});}});await env.ready();env.prepare();await env.propose();await env.check();const first=await env.zip('proposal-download');
 await env.check();assert.match(env.nodes.get('check-status').textContent,/removed no material/);assert.match(env.nodes.get('check-summary').textContent,/Earlier successful check/);assert.equal(env.nodes.get('accept').textContent,'Apply unchecked source');
 const failed=await env.zip('proposal-download'),failedReport=jsonEntry(failed,'proposal.json');assert.deepEqual(failedReport.geometryChecks.map(check=>check.status),['passed','rejected']);
 for(const [name,bytes]of first)if(name.startsWith('geometry-checks/attempt-1/'))assert.deepEqual(failed.get(name),bytes,name);
 const run=env.check();await waitFor(()=>waiting,'Third check not started');assert.equal(env.nodes.get('propose').disabled,true);assert.equal(env.nodes.get('accept').disabled,true);assert.equal(env.nodes.get('discard').disabled,true);assert.equal(env.nodes.get('proposal-download').disabled,true);
 env.nodes.get('accept').handlers.get('click')();env.nodes.get('discard').handlers.get('click')();await env.nodes.get('propose').handlers.get('click')();assert.equal(env.applied,0);assert.equal(env.nodes.get('proposal').hidden,false);assert.equal(env.calls.filter(call=>call.url.endsWith('/api/generate')).length,1);
 env.nodes.get('check-cancel').click();await run;assert.equal(env.nodes.get('accept').textContent,'Apply unchecked source');assert.match(env.nodes.get('check-status').textContent,/cancelled/);assert.match(env.nodes.get('check-summary').textContent,/Earlier successful check/);const cancelled=await env.zip('proposal-download'),cancelledReport=jsonEntry(cancelled,'proposal.json');assert.equal(cancelledReport.geometryChecks.length,2);assert.equal(jsonEntry(cancelled,'geometry-checks/attempt-2/check.json').code,'cancelled');
 for(const [name,bytes]of first)if(name.startsWith('geometry-checks/attempt-1/'))assert.deepEqual(cancelled.get(name),bytes,name);assert.equal(env.applied,0);assert.deepEqual(env.state.spec,BASE);
});

test('changed capture is rejected before checking and a change during checking retains stale downloadable evidence',async t=>{
 let calls=0;const gate=deferred();const env=setup(t,{generate:checkReady,preview:async()=>{calls++;return gate.promise;}});await env.ready();env.prepare();await env.propose();
 env.nodes.get('target').change('part-2');await env.nodes.get('check').handlers.get('click')();assert.equal(calls,0);assert.equal(env.nodes.get('check').disabled,true);
 env.nodes.get('target').change('part-1');const run=env.check();await waitFor(()=>calls===1,'Check not started');env.state.projectSignature='Changed during check';gate.resolve(checkedPreview());await run;
 assert.equal(env.nodes.get('accept').disabled,true);assert.equal(env.nodes.get('check').disabled,true);assert.equal(env.nodes.get('stale').hidden,false);assert.match(env.nodes.get('check-status').textContent,/changed during this check/);env.nodes.get('accept').handlers.get('click')();assert.equal(env.applied,0);
 const entries=await env.zip('proposal-download'),report=jsonEntry(entries,'proposal.json');assert.equal(report.geometryChecks[0].staleAtCompletion,true);assert.equal(report.request.context.target.id,'part-1');assert.equal(jsonEntry(entries,'geometry-checks/attempt-1/proposal-binding.json').request.context.target.id,'part-1');assert.ok(entries.has('geometry-checks/attempt-1/solid.stl'));
});

test('completed proposal and its geometry evidence survive a cancelled new model request',async t=>{
 let generation=0;const env=setup(t,{generate:async()=>++generation===1?checkReady():new Promise(()=>{}),preview:checkedPreview});await env.ready();env.prepare();await env.propose();await env.check();const first=await env.zip('proposal-download');
 env.nodes.get('instruction').change('Create another support with different dimensions.');const run=env.propose();await waitFor(()=>generation===2,'Model retry not started');assert.equal(env.nodes.get('check').disabled,true);env.nodes.get('cancel').click();await run;
 const earlier=await env.zip('earlier-download');for(const [name,bytes]of first)assert.deepEqual(earlier.get(name),bytes,name+' was changed by model retry');assert.equal(env.applied,0);
});

test('non-ready model results and public origins cannot run proposal geometry checks',async t=>{
 for(const mode of ['needs-input','unsupported','public'])await t.test(mode,async sub=>{
  let checked=0;const env=setup(sub,{hostname:mode==='public'?'nazeeh111.github.io':'localhost',generate:async()=>({...ready(),response:JSON.stringify({status:mode,spec:null,assumptions:[],missing:['Required dimensions']})}),preview:async()=>{checked++;return checkedPreview();}});
  if(mode!=='public'){await env.ready();env.prepare();await env.propose();}await env.nodes.get('check').handlers.get('click')();assert.equal(checked,0);assert.equal(env.nodes.get('check').disabled,true);assert.equal(env.applied,0);if(mode==='public'){assert.deepEqual(env.calls,[]);assert.match(env.nodes.get('check-status').textContent,/does not contact local services/);}
 });
});
