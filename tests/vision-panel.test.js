import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { installVisionPanel } from '../vision-panel.js';

const MODEL = {name:'test-vision:latest', digest:'a'.repeat(64), size:10};
const FEATURES = 'One circular opening';
const DETAIL = 'A circular opening appears in the top view.';
const PNG = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'));
const validResponse = () => ({model:MODEL.name, done:true, done_reason:'stop', response:JSON.stringify({observations:[{id:'f1', state:'visible', views:['TOP'], detail:DETAIL}]})});
const content = node => [node.textContent, ...node.children.map(content)].join(' ');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve=done; }); return {promise, resolve}; };

// Yield real event turns so Response streams can finish, with a fixed failure bound.
async function waitFor(predicate, message) {
  for (let turn=0; turn<100; turn++) {
    if (predicate()) return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail(message);
}

function readZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), entries = new Map();
  for (let offset=0; offset+30<=bytes.length && view.getUint32(offset,true)===0x04034b50;) {
    const size=view.getUint32(offset+18,true), nameLength=view.getUint16(offset+26,true), extraLength=view.getUint16(offset+28,true);
    const start=offset+30+nameLength+extraLength, end=start+size;
    assert.ok(end<=bytes.length, 'ZIP entry must be within the downloaded archive');
    entries.set(new TextDecoder().decode(bytes.subarray(offset+30,offset+30+nameLength)), bytes.slice(start,end));
    offset=end;
  }
  return entries;
}

function setup(t, {hostname='127.0.0.1', models=[MODEL], generate=async () => validResponse()}={}) {
  const originals = new Map(), timers = new Set(), nodes = new Map(), blobs = new Map();
  const calls=[], downloads=[], pendingRuns=new Set(), savedRequests=new Map();
  const nativeSetTimeout=globalThis.setTimeout, nativeClearTimeout=globalThis.clearTimeout;
  const originalCreate=Object.getOwnPropertyDescriptor(URL,'createObjectURL'), originalRevoke=Object.getOwnPropertyDescriptor(URL,'revokeObjectURL');
  let revision=1, captureCount=0;
  const snapshots=[];
  function replaceGlobal(name,value) {
    originals.set(name,Object.getOwnPropertyDescriptor(globalThis,name));
    Object.defineProperty(globalThis,name,{value,writable:true,configurable:true});
  }
  // Minimal DOM behavior used by the panel, including disabled buttons and select defaults.
  class Element {
    constructor(tag='div') { Object.assign(this,{tagName:tag,textContent:'',value:'',children:[],handlers:new Map(),disabled:false,hidden:false}); }
    append(...children) { this.children.push(...children); if(this.tagName==='select'&&!this.value&&children.length)this.value=children[0].value; }
    replaceChildren(...children) { this.children=[]; if(this.tagName==='select')this.value=''; this.append(...children); }
    addEventListener(event,handler) { this.handlers.set(event,handler); }
    click() {
      if(this.disabled)return;
      if(this.tagName==='a')downloads.push({filename:this.download,blob:blobs.get(this.href)});
      return this.handlers.get('click')?.();
    }
  }
  for(const id of ['features','model','status','retention','observe','stale','download','result','cancel','earlier','earlier-result','earlier-download'])nodes.set(id,new Element(id==='model'?'select':'div'));
  for(const id of ['observe','model','download'])nodes.get(id).disabled=true;
  for(const id of ['stale','cancel','earlier'])nodes.get(id).hidden=true;
  replaceGlobal('document',{getElementById:id=>nodes.get(id.replace(/^vision-/,'')),createElement:tag=>new Element(tag)});
  replaceGlobal('location',{hostname});
  replaceGlobal('sessionStorage',{getItem:key=>savedRequests.get(key)??null,setItem:(key,value)=>savedRequests.set(key,value)});
  replaceGlobal('setTimeout',(callback,delay,...args)=>{
    const timer=nativeSetTimeout(()=>{timers.delete(timer);callback(...args);},delay);
    timers.add(timer);return timer;
  });
  replaceGlobal('clearTimeout',timer=>{timers.delete(timer);nativeClearTimeout(timer);});
  Object.defineProperty(URL,'createObjectURL',{configurable:true,writable:true,value:blob=>{const url='blob:vision-test-'+blobs.size;blobs.set(url,blob);return url;}});
  Object.defineProperty(URL,'revokeObjectURL',{configurable:true,writable:true,value:url=>blobs.delete(url)});
  replaceGlobal('fetch',async (url,options={})=>{
    calls.push({url,options});
    if(url.endsWith('/api/tags'))return Response.json({models});
    if(url.endsWith('/api/show'))return Response.json({capabilities:JSON.parse(options.body).model===MODEL.name?['vision']:['completion']});
    if(url.endsWith('/api/generate')) {
      if(options.signal.aborted)throw new DOMException('Cancelled','AbortError');
      const aborted=new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true}));
      return Response.json(await Promise.race([generate(JSON.parse(options.body),options.signal),aborted]));
    }
    throw new Error('Unexpected fetch: '+url);
  });
  t.after(async ()=>{
    nodes.get('cancel').click();
    await Promise.allSettled([...pendingRuns]);
    for(const timer of timers)nativeClearTimeout(timer);
    for(const [name,descriptor] of originals) {
      if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];
    }
    if(originalCreate)Object.defineProperty(URL,'createObjectURL',originalCreate);else delete URL.createObjectURL;
    if(originalRevoke)Object.defineProperty(URL,'revokeObjectURL',originalRevoke);else delete URL.revokeObjectURL;
  });
  const panel=installVisionPanel({
    capture:async ()=>{
      const imageBytes=captureCount++===0?PNG.slice():new Uint8Array([9,8,7]);
      const snapshot={viewerVersion:revision,imageBytes,imageSha256:createHash('sha256').update(imageBytes).digest('hex'),manifest:{schema:'test-geometry',revision}};
      snapshots.push(snapshot);return snapshot;
    },viewerVersion:()=>revision,hasGeometry:()=>true
  });
  nodes.get('features').value=FEATURES;
  return {
    nodes,calls,downloads,snapshots,
    ready:()=>waitFor(()=>!nodes.get('observe').disabled,'Local vision discovery did not finish'),
    observe:()=>{const run=nodes.get('observe').click();if(run){pendingRuns.add(run);void run.finally(()=>pendingRuns.delete(run));}return run;},
    changeGeometry:()=>{revision++;panel.geometryChanged();},
    zip:async id=>{const before=downloads.length;nodes.get(id).click();assert.equal(downloads.length,before+1);return readZip(new Uint8Array(await downloads.at(-1).blob.arrayBuffer()));}
  };
}

test('cancelled retry preserves the exact earlier image, request, model and raw response ZIP', async t=>{
  let generation=0;
  const env=setup(t,{generate:async ()=>++generation===1?validResponse():new Promise(()=>{})});
  await env.ready();await env.observe();
  const original=await env.zip('download');
  env.nodes.get('features').value='Two raised tabs';
  const retry=env.observe();
  await waitFor(()=>generation===2,'Retry did not reach the model');
  assert.equal(env.nodes.get('download').disabled,true);
  assert.equal(env.nodes.get('earlier').hidden,false);
  assert.match(content(env.nodes.get('earlier-result')),new RegExp(DETAIL));
  const during=await env.zip('earlier-download');
  env.nodes.get('cancel').click();await retry;
  assert.match(content(env.nodes.get('result')),/NOT RUN \/ NO OBSERVATIONS/);
  assert.equal(env.nodes.get('features').value,'Two raised tabs');
  assert.equal(env.nodes.get('earlier').hidden,false);
  const after=await env.zip('earlier-download');
  for(const name of ['inspection.png','geometry.json','observation.json','raw-model-response.json']) {
    assert.deepEqual(during.get(name),original.get(name),name+' changed during retry');
    assert.deepEqual(after.get(name),original.get(name),name+' changed after cancellation');
  }
  assert.deepEqual(after.get('inspection.png'),PNG);
  const record=JSON.parse(new TextDecoder().decode(after.get('observation.json')));
  assert.equal(record.context.request,FEATURES);assert.equal(record.model.digest,MODEL.digest);
});

test('discovery finds a vision model after sixteen smaller text models', async t=>{
  const models=[...Array.from({length:16},(_,i)=>({...MODEL,name:'text-'+i,size:1})),MODEL];
  const env=setup(t,{models});await env.ready();
  assert.equal(env.nodes.get('model').value,MODEL.name);
  assert.deepEqual(env.nodes.get('model').children.map(node=>node.value),[MODEL.name]);
  assert.equal(env.calls.filter(call=>call.url.endsWith('/api/show')).length,17);
});

test('geometry changed while observing remains visibly stale on completion', async t=>{
  const gate=deferred();let started=false;
  const env=setup(t,{generate:async ()=>{started=true;return gate.promise;}});
  await env.ready();const run=env.observe();
  await waitFor(()=>started,'Observation did not reach the model');
  env.changeGeometry();
  assert.equal(env.nodes.get('stale').hidden,false);
  gate.resolve(validResponse());await run;
  assert.match(content(env.nodes.get('result')),/MODEL OBSERVATIONS \/ UNVERIFIED/);
  assert.equal(env.nodes.get('stale').hidden,false);
  assert.match(env.nodes.get('status').textContent,/earlier request\/viewer state/);
  const entries=await env.zip('download'), record=JSON.parse(new TextDecoder().decode(entries.get('observation.json')));
  assert.equal(record.context.viewerVersion,1);
  assert.equal(record.geometry.revision,1);
  assert.deepEqual(entries.get('inspection.png'),env.snapshots[0].imageBytes);
});

test('public origin never contacts local Ollama', async t=>{
  const env=setup(t,{hostname:'example.test'});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(env.nodes.get('observe').disabled,true);
  assert.equal(env.nodes.get('features').disabled,true);
  await env.observe();
  assert.deepEqual(env.calls,[]);
});

test('malformed model output becomes NOT RUN and retains the exact captured input', async t=>{
  const env=setup(t,{generate:async ()=>({...validResponse(),response:'{"observations":[{"id":"unknown"}]}'})});
  await env.ready();await env.observe();
  assert.match(content(env.nodes.get('result')),/NOT RUN \/ NO OBSERVATIONS/);
  assert.doesNotMatch(content(env.nodes.get('result')),/MODEL SAYS VISIBLE/);
  const entries=await env.zip('download'), record=JSON.parse(new TextDecoder().decode(entries.get('observation.json')));
  assert.equal(record.status,'not-run');assert.deepEqual(record.observations,[]);
  assert.equal(record.context.request,FEATURES);
  assert.deepEqual(entries.get('inspection.png'),PNG);
  assert.equal(JSON.parse(new TextDecoder().decode(entries.get('raw-model-response.json'))).response,'{"observations":[{"id":"unknown"}]}');
});
