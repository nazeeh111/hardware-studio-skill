import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const app=await readFile(new URL('../app.js',import.meta.url),'utf8'),solid=await readFile(new URL('../solid-workbench.js',import.meta.url),'utf8');
function section(source,start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b);}
test('actual edit completion preserves typed notes through render, navigation and draft export',async()=>{
 let release;const gate=new Promise(r=>{release=r;}),p={id:'p',starterId:'blank',title:'before',summary:'',notes:'original',parts:[],steps:[]};
 const nodes=new Map(),document={activeElement:null,querySelectorAll:()=>[]};let note;
 function makeNote(value){return {value,selectionStart:4,selectionEnd:4,focus(){document.activeElement=this;},setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b;}};}
 note=makeNote('original');document.activeElement=note;
 const panel={setAttribute(){},set innerHTML(v){const match=String(v).match(/<textarea>(.*?)<\/textarea>/);note=match?makeNote(match[1]):null;}};
 const get=s=>{if(s==='#project-notes')return note;if(s==='#panel')return panel;if(!nodes.has(s))nodes.set(s,{textContent:'',innerHTML:'',hidden:true});return nodes.get(s);};
 const ctx={structuredClone,projects:[p],currentId:'p',activeTab:'overview',renderedProjectId:'p',notesDrafts:new Map(),saving:false,expectedWorkspaceRaw:JSON.stringify({storeId:'test',generation:1}),projectStore:{assertCurrent(){}},localStorage:{},STARTERS:[],document,$:get,html:String,stats:()=>({distinctParts:0,wires:0,completed:0}),money:String,syncCurrentGeometry(){},renderOverview:x=>`<textarea>${x.notes}</textarea>`,renderParts:()=>'<parts/>',renderWiring(){},renderPower(){},renderAssembly(){},renderBuild(){},renderReview(){},projectChange:null,refreshProjectPackageUi(){},manualEditNotice(){return ''},showToast(){},saveManualEdit:async()=>{await gate;return true;}};
 vm.createContext(ctx);vm.runInContext(section(app,'function current()','function captureProjectChange()')+section(app,'async function editProject(','function download(')+section(app,'function projectWithCurrentGeometry(','function sourceProjectArchive(')+section(app,'function render()','function refreshGeometry()'),ctx);
 const pending=ctx.editProject(p,'edit',()=>{p.title='changed';});note.value='later notes';note.selectionStart=3;note.selectionEnd=5;release();await pending;
 assert.equal(note.value,'later notes');assert.equal(ctx.notesDrafts.get('p'),'later notes');assert.equal(get('#notes-retention').hidden,false);assert.equal(document.activeElement,note);assert.equal(note.selectionStart,3);assert.equal(note.selectionEnd,5);
 assert.throws(()=>ctx.projectWithCurrentGeometry(p),/not saved/);const exported=ctx.projectWithCurrentGeometry(p,{allowDraft:true});assert.equal(exported.notes,'later notes');assert.equal(exported.sourceRevision.status,'unsaved-draft');
 ctx.activeTab='parts';ctx.render();ctx.activeTab='overview';ctx.render();assert.equal(note.value,'later notes');assert.equal(p.notes,'original');
 const other={...p,id:'other',notes:'other project'};ctx.projects.push(other);ctx.currentId='other';ctx.render();assert.equal(note.value,'other project');ctx.currentId='p';ctx.render();assert.equal(note.value,'later notes');
});
test('actual solid undo keeps cursor on the applied revision after a refused wait and retry succeeds',async()=>{
 let release;const gate=new Promise(r=>{release=r;}),callbacks={};let value='B',first=true;
 const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,{get value(){return value;},set value(v){value=v;},addEventListener:(_e,fn)=>{callbacks[id]=fn;}});return nodes.get(id);};
 const a={name:'A',features:[],probes:[]},b={name:'B',features:[],probes:[]},ctx={$:get,validateSolidSpec:x=>x,persist:async(_n,guard)=>{if(first){first=false;await gate;}guard();},keepEditor(){},note(){},buttons(){},render(){value=ctx.spec.name;},spec:b,states:[a,b],cursor:1,sourcePersisted:true,context:{id:'p'}};
 vm.createContext(ctx);vm.runInContext(section(solid,'async function commit(','function download(')+section(solid,"for(const [id,delta]of [['solid-undo'","$('#solid-example')"),ctx);
 const pending=callbacks['#solid-undo']();value='new draft';release();await pending;assert.equal(ctx.spec.name,'B');assert.equal(ctx.cursor,1);assert.equal(value,'new draft');
 value='B';await callbacks['#solid-undo']();assert.equal(ctx.spec.name,'A');assert.equal(ctx.cursor,0);
});
