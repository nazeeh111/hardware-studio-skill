import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectStore,ProjectStoreConflict,PROJECT_STORE_KEY} from '../project-store.js';
import {blankProject,STORAGE_KEY,REVISIONS_KEY} from '../core.js';
import {solidKey} from '../project-geometry.js';
function fixture(){
 const data=new Map(),storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};
 let tail=Promise.resolve();const locks={request(name,options,fn){const next=tail.then(fn);tail=next.catch(()=>{});return next;}};
 const project=blankProject('Synthetic');storage.setItem(STORAGE_KEY,JSON.stringify({projects:[project],currentId:project.id}));return {data,storage,locks,project};
}
test('one owner serializes competing generations and preserves stale attempted value',async()=>{
 const f=fixture(),a=createProjectStore(f),b=createProjectStore(f),old=await a.open();
 const x=structuredClone(old.document.workspace),y=structuredClone(x);x.projects[0].title='first';y.projects[0].title='second';
 const [one,two]=await Promise.allSettled([a.commit(old.raw,x,[]),b.commit(old.raw,y,[])]);
 assert.equal(one.status,'fulfilled');assert.equal(two.status,'rejected');assert.ok(two.reason instanceof ProjectStoreConflict);
 assert.equal(JSON.parse(f.storage.getItem(PROJECT_STORE_KEY)).workspace.projects[0].title,'first');assert.equal(y.projects[0].title,'second');
});
test('failed atomic publication retains old bytes and legacy migration inputs',async()=>{
 const f=fixture(),store=createProjectStore(f),old=await store.open(),prior=f.storage.getItem(STORAGE_KEY);const previous=f.storage.setItem;
 f.storage.setItem=(k,v)=>{if(k===PROJECT_STORE_KEY)throw Error('quota');previous(k,v)};
 const next=structuredClone(old.document.workspace);next.projects[0].title='unsaved';await assert.rejects(store.commit(old.raw,next,[]),/quota/);
 assert.equal(f.storage.getItem(PROJECT_STORE_KEY),old.raw);assert.equal(f.storage.getItem(STORAGE_KEY),prior);assert.equal(next.projects[0].title,'unsaved');
});
test('migration rejects unreadable sidecar and leaves all legacy bytes',async()=>{
 const f=fixture();f.storage.setItem(solidKey(f.project.id),'broken');const before=new Map(f.data);await assert.rejects(createProjectStore(f).open());assert.deepEqual(f.data,before);
});
test('refuses missing lock manager',()=>{assert.throws(()=>createProjectStore({storage:{}}),/Web Locks/);});
test('pending asynchronous commit captures the intended revision before waiting',async()=>{
 const f=fixture(),store=createProjectStore(f),old=await store.open();let release;
 const held=new Promise(resolve=>{release=resolve});let first=true;
 const locks={request(_name,_opts,fn){if(first){first=false;return held.then(fn);}return Promise.resolve().then(fn);}};
 const queued=createProjectStore({...f,locks}),attempt=structuredClone(old.document.workspace);attempt.projects[0].title='confirmed';
 const pending=queued.commit(old.raw,attempt,[]);attempt.projects[0].title='later unconfirmed';release();
 const saved=await pending;assert.equal(saved.document.workspace.projects[0].title,'confirmed');
});
test('revision commits project, geometry and history together; restore invalidates evidence',async()=>{
 const f=fixture();f.project.review.mechanical=true;f.storage.setItem(STORAGE_KEY,JSON.stringify({projects:[f.project],currentId:f.project.id}));
 const store=createProjectStore(f),old=await store.open();const next=structuredClone(old.document.workspace.projects[0]);next.title='Revised';
 const saved=await store.revise(old.raw,next.id,next,'Before title edit');assert.equal(saved.document.revisions.length,1);assert.equal(saved.document.revisions[0].snapshot.title,'Synthetic');
 const restored=await store.revise(saved.raw,next.id,saved.document.revisions[0].snapshot,'Before restore',{restore:true});
 assert.equal(restored.document.workspace.projects[0].title,'Synthetic');assert.equal(restored.document.workspace.projects[0].review.mechanical,false);assert.equal(restored.document.revisions.length,2);
 await assert.rejects(store.revise(old.raw,next.id,next,'Stale'),ProjectStoreConflict);
});
test('stale unchanged revision is still refused',async()=>{
 const f=fixture(),store=createProjectStore(f),old=await store.open();const changed=structuredClone(old.document.workspace);changed.projects[0].title='new';await store.commit(old.raw,changed,[]);
 await assert.rejects(store.revise(old.raw,f.project.id,old.document.workspace.projects[0],'stale no-op'),ProjectStoreConflict);
});
test('editable source and evidence status survive one owned revision and source package projection',async()=>{
 const {readFile}=await import('node:fs/promises');const {projectPackageFiles}=await import('../project-package.js');
 const f=fixture(),store=createProjectStore(f),old=await store.open(),candidate=structuredClone(old.document.workspace.projects[0]);
 candidate.solidSpec=JSON.parse(await readFile(new URL('../tools/solid-generator/examples/mounting-bracket.json',import.meta.url),'utf8'));
 candidate.review.mechanical=true;
 const next=await store.revise(old.raw,candidate.id,candidate,'Before geometry');const saved=next.document.workspace.projects[0];
 assert.equal(saved.review.mechanical,false);assert.equal(saved.solidSpec.features[0].size[0],candidate.solidSpec.features[0].size[0]);
 const files=projectPackageFiles(saved,{wiringMarkup:'<svg></svg>',assemblyMarkup:'<svg></svg>'});
 const packaged=JSON.parse(files.find(f=>f.name==='project.json').data);assert.deepEqual(packaged.solidSpec,saved.solidSpec);assert.equal(packaged.review.mechanical,false);
 const reopened=await store.open();assert.deepEqual(reopened.document.workspace.projects[0],saved);
});
test('post-migration legacy writer is detected and canonical/legacy bytes are preserved',async()=>{
 const f=fixture(),store=createProjectStore(f),old=await store.open();f.storage.setItem(STORAGE_KEY,'old tab edited');const before=f.storage.getItem(PROJECT_STORE_KEY);
 await assert.rejects(store.open(),ProjectStoreConflict);await assert.rejects(store.commit(old.raw,old.document.workspace,[]),ProjectStoreConflict);
 assert.equal(f.storage.getItem(PROJECT_STORE_KEY),before);assert.equal(f.storage.getItem(STORAGE_KEY),'old tab edited');
});
test('proposal guard is checked under the lock after an asynchronous wait',async()=>{
 const f=fixture(),initial=await createProjectStore(f).open();let release;const held=new Promise(resolve=>{release=resolve});
 const owner=createProjectStore({...f,locks:{request(_name,_options,fn){return held.then(fn);}}});
 const next=structuredClone(initial.document.workspace);next.projects[0].title='proposal';let request='original';
 const pending=owner.commit(initial.raw,next,[],()=>{if(request!=='original')throw Error('stale request');});request='new request';release();
 await assert.rejects(pending,/stale request/);assert.equal(f.storage.getItem(PROJECT_STORE_KEY),initial.raw);
});
test('recipient can import editable project with declared revision and reset untrusted review marks',async()=>{
 const {readFile}=await import('node:fs/promises'),{projectPackageFiles}=await import('../project-package.js'),{safeProject}=await import('../core.js');
 const f=fixture(),store=createProjectStore(f),opened=await store.open(),next=structuredClone(opened.document.workspace.projects[0]);
 next.solidSpec=JSON.parse(await readFile(new URL('../tools/solid-generator/examples/mounting-bracket.json',import.meta.url),'utf8'));
 next.parts=[{id:'part-a',name:'Synthetic plate',category:'Mechanical',qty:1,unitCost:0,detail:'Review',voltage:'',pins:[]}];
 const saved=await store.revise(opened.raw,next.id,next,'Before source');const project=saved.document.workspace.projects[0];
 const captured={...project,sourceRevision:{schema:'hardware-studio-source-revision-v1',status:'saved',storeId:saved.document.storeId,generation:saved.document.generation,projectId:project.id}};
 const files=projectPackageFiles(captured,{wiringMarkup:'<svg></svg>',assemblyMarkup:'<svg></svg>'});const data=JSON.parse(files.find(f=>f.name==='project.json').data),imported=safeProject(data);
 assert.deepEqual(imported.solidSpec,project.solidSpec);assert.equal(imported.solidSpec.units,'mm');assert.equal(imported.parts[0].id,'part-a');assert.deepEqual(imported.originRevision,captured.sourceRevision);assert.equal(imported.review.mechanical,false);
 const invalid=structuredClone(data);invalid.sourceRevision.generation=true;assert.throws(()=>safeProject(invalid),/revision/);
});
test('explicit recovery refuses a changed backup and preserves both original and attempted bytes',async()=>{
 const f=fixture(),store=createProjectStore(f),legacy={[STORAGE_KEY]:f.storage.getItem(STORAGE_KEY),[REVISIONS_KEY]:null};f.storage.setItem(STORAGE_KEY,'newer legacy bytes');
 const fresh={projects:[f.project],currentId:f.project.id};await assert.rejects(store.recover(null,legacy,fresh),ProjectStoreConflict);
 assert.equal(f.storage.getItem(PROJECT_STORE_KEY),null);assert.equal(f.storage.getItem(STORAGE_KEY),'newer legacy bytes');
 const updated={[STORAGE_KEY]:'newer legacy bytes',[REVISIONS_KEY]:null};const recovered=await store.recover(null,updated,fresh);
 assert.equal(recovered.document.workspace.projects[0].id,f.project.id);assert.equal(f.storage.getItem(STORAGE_KEY),'newer legacy bytes');
});
test('migration quota failure leaves legacy workspace, history and sidecar unchanged',async()=>{
 const f=fixture();f.storage.setItem(REVISIONS_KEY,'[]');const original=new Map(f.data),real=f.storage.setItem;f.storage.setItem=(k,v)=>{if(k===PROJECT_STORE_KEY)throw Error('quota');real(k,v);};
 await assert.rejects(createProjectStore(f).open(),/quota/);assert.deepEqual(f.data,original);
});
