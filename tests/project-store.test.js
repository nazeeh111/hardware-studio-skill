import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectStore,ProjectStoreConflict,ProjectIdentityConflict,PROJECT_STORE_KEY} from '../project-store.js';
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
 const [one,two]=await Promise.allSettled([a.commit(old.raw,x),b.commit(old.raw,y)]);
 assert.equal(one.status,'fulfilled');assert.equal(two.status,'rejected');assert.ok(two.reason instanceof ProjectStoreConflict);
 assert.equal(JSON.parse(f.storage.getItem(PROJECT_STORE_KEY)).workspace.projects[0].title,'first');assert.equal(y.projects[0].title,'second');
});
test('failed atomic publication retains old bytes and legacy migration inputs',async()=>{
 const f=fixture(),store=createProjectStore(f),old=await store.open(),prior=f.storage.getItem(STORAGE_KEY);const previous=f.storage.setItem;
 f.storage.setItem=(k,v)=>{if(k===PROJECT_STORE_KEY)throw Error('quota');previous(k,v)};
 const next=structuredClone(old.document.workspace);next.projects[0].title='unsaved';await assert.rejects(store.commit(old.raw,next),/quota/);
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
 const pending=queued.commit(old.raw,attempt);attempt.projects[0].title='later unconfirmed';release();
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
 const f=fixture(),store=createProjectStore(f),old=await store.open();const changed=structuredClone(old.document.workspace);changed.projects[0].title='new';await store.commit(old.raw,changed);
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
 await assert.rejects(store.open(),ProjectStoreConflict);await assert.rejects(store.commit(old.raw,old.document.workspace),ProjectStoreConflict);
 assert.equal(f.storage.getItem(PROJECT_STORE_KEY),before);assert.equal(f.storage.getItem(STORAGE_KEY),'old tab edited');
});
test('proposal guard is checked under the lock after an asynchronous wait',async()=>{
 const f=fixture(),initial=await createProjectStore(f).open();let release;const held=new Promise(resolve=>{release=resolve});
 const owner=createProjectStore({...f,locks:{request(_name,_options,fn){return held.then(fn);}}});
 const next=structuredClone(initial.document.workspace);next.projects[0].title='proposal';let request='original';
 const pending=owner.commit(initial.raw,next,{guard:()=>{if(request!=='original')throw Error('stale request');}});request='new request';release();
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

test('workspace publication owns snapshots for every changed and deleted project',async()=>{
 const f=fixture(),second=blankProject('Second');f.storage.setItem(STORAGE_KEY,JSON.stringify({projects:[f.project,second],currentId:f.project.id}));
 const store=createProjectStore(f),opened=await store.open(),next=structuredClone(opened.document.workspace);
 next.projects[0].title='Revised';next.projects.splice(1,1);
 const saved=await store.commit(opened.raw,next,{reason:'Before manual edit'});
 assert.deepEqual(saved.document.revisions.map(r=>[r.projectId,r.reason,r.snapshot.title]),[[f.project.id,'Before manual edit','Synthetic'],[second.id,'Deleted project','Second']]);
 const reopened=await store.open();assert.deepEqual(reopened.document,saved.document);
});
test('selection and timestamp changes preserve existing history without adding a checkpoint',async()=>{
 const f=fixture(),store=createProjectStore(f),opened=await store.open(),next=structuredClone(opened.document.workspace);
 next.projects[0].title='Edited';const first=await store.commit(opened.raw,next,{reason:'Before edit'});
 next.projects[0].updatedAt='later';const second=await store.commit(first.raw,next);
 assert.deepEqual(second.document.revisions,first.document.revisions);
});
test('studio and workbench commits share per-project retention while preserving their existing size budgets',async()=>{
 for(const route of ['studio','workbench']){
  const f=fixture(),store=createProjectStore(f);let opened=await store.open();
  for(let i=0;i<16;i++){
   const next=structuredClone(opened.document.workspace.projects[0]);next.title=`Revision ${i}`;next.notes='x'.repeat(180000);
   opened=route==='studio'?await store.commit(opened.raw,{projects:[next],currentId:next.id},{reason:'Before edit',historyLimitChars:2_000_000}):await store.revise(opened.raw,next.id,next,'Before edit');
  }
  assert.ok(opened.document.revisions.length<=12);if(route==='studio')assert.ok(JSON.stringify(opened.document.revisions).length<=2_000_000);else assert.ok(JSON.stringify(opened.document.revisions).length>2_000_000);
  assert.equal(opened.document.revisions.at(-1).snapshot.title,'Revision 14');
 }
});
test('studio refuses an oversized checkpoint while workbench preserves its existing larger allowance',async()=>{
 for(const route of ['studio','workbench']){
  const f=fixture();f.project.notes='x'.repeat(2_000_000);f.storage.setItem(STORAGE_KEY,JSON.stringify({projects:[f.project],currentId:f.project.id}));
  const store=createProjectStore(f),opened=await store.open(),next=structuredClone(f.project);next.title='Attempted';next.notes='';
  const pending=route==='studio'?store.commit(opened.raw,{projects:[next],currentId:next.id},{reason:'Before edit',historyLimitChars:2_000_000}):store.revise(opened.raw,next.id,next,'Before edit');
  if(route==='studio'){await assert.rejects(pending,/history limit/);assert.equal(f.storage.getItem(PROJECT_STORE_KEY),opened.raw);}else{assert.equal((await pending).document.revisions.length,1);}assert.equal(next.title,'Attempted');
 }
});

test('admitted legacy history is preserved by selection, timestamp, and project additions',async()=>{
 const f=fixture(),history=[{id:'old',projectId:f.project.id,snapshot:{notes:'x'.repeat(2_050_000)}}];
 f.storage.setItem(REVISIONS_KEY,JSON.stringify(history));const store=createProjectStore(f),opened=await store.open(),next=structuredClone(opened.document.workspace);
 next.projects[0].updatedAt='later';const added=blankProject('Added');next.projects.push(added);next.currentId=added.id;
 const saved=await store.commit(opened.raw,next);assert.deepEqual(saved.document.revisions,history);
 next.projects[0].title='Edited';const edited=await store.commit(saved.raw,next,{reason:'Before edit',historyLimitChars:2_000_000});
 assert.equal(edited.document.revisions.length,1);assert.equal(edited.document.revisions[0].snapshot.title,'Synthetic');
});
test('a mixed edit and deletion cannot evict either new required recovery checkpoint',async()=>{
 const f=fixture(),second=blankProject('Second');f.project.notes='a'.repeat(1_050_000);second.notes='b'.repeat(1_050_000);
 f.storage.setItem(STORAGE_KEY,JSON.stringify({projects:[f.project,second],currentId:f.project.id}));
 const store=createProjectStore(f),opened=await store.open(),next=structuredClone(opened.document.workspace);next.projects[0].title='Attempted';next.projects.pop();
 await assert.rejects(store.commit(opened.raw,next,{reason:'Before edit',historyLimitChars:2_000_000}),/history limit/);
 assert.equal(f.storage.getItem(PROJECT_STORE_KEY),opened.raw);
});

test('an old cached caller cannot silently discard its fourth-argument cancellation guard',async()=>{
 const f=fixture(),store=createProjectStore(f),opened=await store.open(),next=structuredClone(opened.document.workspace);next.projects[0].title='Old caller';
 await assert.rejects(store.commit(opened.raw,next,[],()=>{throw Error('cancelled');}),/Reload/);
 assert.equal(f.storage.getItem(PROJECT_STORE_KEY),opened.raw);
});

test('legacy optional defaults do not create checkpoints when selecting another project',async()=>{
 const f=fixture(),second=blankProject('Second');for(const p of [f.project,second])for(const key of ['traySpec','solidSpec','assemblySpec','powerRails','mechanicalConnections','review'])delete p[key];
 f.storage.setItem(STORAGE_KEY,JSON.stringify({projects:[f.project,second],currentId:f.project.id}));
 const {safeProjectForStorage}=await import('../core.js');const store=createProjectStore(f),opened=await store.open();
 const saved=await store.commit(opened.raw,{projects:opened.document.workspace.projects.map(safeProjectForStorage),currentId:second.id},{historyLimitChars:2_000_000});
 assert.equal(saved.document.revisions.length,0);
});
test('legacy data appearing after an empty open is refused rather than hidden by a starter',async()=>{
 const f=fixture();f.data.clear();const store=createProjectStore(f),opened=await store.open();assert.equal(opened.raw,null);
 const legacy=JSON.stringify({projects:[f.project],currentId:f.project.id});f.storage.setItem(STORAGE_KEY,legacy);
 const fresh=blankProject('New starter');await assert.rejects(store.commit(null,{projects:[fresh],currentId:fresh.id}),ProjectStoreConflict);
 assert.equal(f.storage.getItem(PROJECT_STORE_KEY),null);assert.equal(f.storage.getItem(STORAGE_KEY),legacy);
 assert.equal((await store.open()).document.workspace.projects[0].id,f.project.id);
});

function duplicateFixture(){
 const f=fixture(),second={...f.project,title:'Second duplicate'},unique=blankProject('Unique C');
 const entries=Array.from({length:12},(_,i)=>({id:`real-prior-${i}`,projectId:f.project.id,reason:`Real prior ${i}`,snapshot:{...f.project,title:`Design ${i}`}}));
 f.storage.setItem(STORAGE_KEY,JSON.stringify({projects:[f.project,second,unique],currentId:f.project.id}));f.storage.setItem(REVISIONS_KEY,JSON.stringify(entries));return {...f,second,unique,entries};
}
test('unchanged duplicate ID groups preserve every real checkpoint on navigation',async()=>{
 const f=duplicateFixture(),store=createProjectStore(f),opened=await store.open(),next=structuredClone(opened.document.workspace);next.currentId=f.unique.id;next.projects[0].updatedAt='later';
 const saved=await store.commit(opened.raw,next,{historyLimitChars:2_000_000});assert.deepEqual(saved.document.revisions,f.entries);assert.deepEqual(saved.document.workspace.projects,next.projects);
});
test('an unrelated unique project can be edited and deleted while duplicate groups stay intact',async()=>{
 const f=duplicateFixture(),store=createProjectStore(f),opened=await store.open(),next=structuredClone(f.unique);next.title='Unique revised';
 const revised=await store.revise(opened.raw,next.id,next,'Before unique edit');assert.deepEqual(revised.document.revisions.slice(0,12),f.entries);assert.equal(revised.document.revisions[12].snapshot.title,'Unique C');
 const workspace=structuredClone(revised.document.workspace);workspace.projects=workspace.projects.filter(p=>p.id!==next.id);workspace.currentId=f.project.id;
 const deleted=await store.commit(revised.raw,workspace);assert.deepEqual(deleted.document.revisions.slice(0,12),f.entries);assert.equal(deleted.document.revisions.at(-1).reason,'Deleted project');assert.deepEqual(deleted.document.workspace.projects,opened.document.workspace.projects.slice(0,2));
});
test('ambiguous edits, deletions and duplicate insertion refuse without changing original data',async()=>{
 for(const kind of ['edit','delete','insert']){
  const f=duplicateFixture(),store=createProjectStore(f),opened=await store.open(),next=structuredClone(opened.document.workspace),before=new Map(f.data);
  if(kind==='edit')next.projects[0].title='Attempted duplicate edit';else if(kind==='delete')next.projects=next.projects.filter(p=>p.id!==f.project.id);else next.projects.push({...next.projects[2],title:'Inserted duplicate C'});
  await assert.rejects(store.commit(opened.raw,next),ProjectIdentityConflict);assert.deepEqual(f.data,before);assert.notDeepEqual(next,opened.document.workspace);
 }
 const f=duplicateFixture(),store=createProjectStore(f),opened=await store.open(),next={...f.project,title:'Workbench ambiguous edit'};
 await assert.rejects(store.revise(opened.raw,next.id,next,'Before ambiguous edit'),ProjectIdentityConflict);assert.equal(f.storage.getItem(PROJECT_STORE_KEY),opened.raw);
});
