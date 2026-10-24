import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {invalidateManualEdit,manualEditNotice} from '../manual-edit-effects.js';
import {safePinList,powerBudget} from '../core.js';

// Execute production handlers and rollback orchestration. Only browser controls,
// rendering and the persistence boundary are mocked; no editing logic is copied.
const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
function productionFunction(name){
 const start=source.indexOf(`function ${name}(`);
 assert.ok(start>=0,`Missing production function ${name}`);
 const end=source.indexOf('\nfunction ',start+1);
 return source.slice(start,end<0?undefined:end);
}
const executable=['saveWithRollback','saveManualEdit','editProject','closeEditor','saveEditor','deleteEntry','handleClick','handleChange'].map(productionFunction).join('\n');
const plain=value=>JSON.parse(JSON.stringify(value));
function fixture(){
 const part=id=>({id,name:id,category:'Control',qty:1,unitCost:5,voltage:'5',pins:['VCC','GND'],sourceUrl:`https://example.test/${id}`,specUrl:`https://example.test/${id}/spec`,detail:`Exact ${id}`,verified:true,checkedAt:'2026-10-23'});
 return {id:'manual-project',title:'Manual project',brief:'Specific brief',summary:'Summary',parts:['source','alternate','a','b','stand'].map(part),
  wires:[{from:'source',to:'a',fromPin:'VCC',toPin:'VCC',signal:'Power',voltage:'5 V',note:'Retain evidence'},{from:'source',to:'b',fromPin:'VCC',toPin:'VCC',signal:'Power',voltage:'5 V',note:'Unrelated branch'}],
  mechanicalConnections:[{from:'a',to:'stand',label:'M3 mounting',note:'Unverified fit'}],
  powerRails:[{id:'rail',name:'5 V input',voltageV:5,sourcePartId:'source',supplyCurrentMa:1000,marginPercent:20,loads:[{partId:'a',currentMaEach:100},{partId:'b',currentMaEach:200}]}],
  steps:['a','b','source','stand'].map(id=>({id:`step-${id}`,phase:'Test',title:`Check ${id}`,detail:'Original acceptance criterion',partIds:[id],done:true})),tools:['Meter'],assumptions:['Power isolated'],
  review:{electrical:true,mechanical:true,sourcing:true},notes:'Keep literal notes',cadUrl:'https://example.test/cad',wiringUrl:'https://example.test/wiring',
  solidSpec:{opaque:'Preserved source bytes'},traySpec:{opaque:'Preserved tray bytes'},assemblySpec:{opaque:'Preserved assembly bytes'}};
}
function setup(){
 const project=fixture(),errors=[],toasts=[],saved=[],nodes=new Map();
 let form={},fail=false;
 const get=selector=>{if(!nodes.has(selector))nodes.set(selector,{closed:false,close(){this.closed=true;}});return nodes.get(selector);};
 const sandbox={project,editor:null,current:()=>project,$:get,safePinList,invalidateManualEdit,manualEditNotice,structuredClone,crypto:globalThis.crypto,
  FormData:class{get(key){return form[key]??'';}getAll(key){const value=form[key];return Array.isArray(value)?value:value==null?[]:[value];}has(key){return Boolean(form[key]);}},
  window:{confirm:()=>true},save(reason){if(fail)return false;saved.push({reason,project:structuredClone(project)});return true;},
  editorError:message=>errors.push(message),render(){},showToast:message=>toasts.push(message)};
 vm.runInNewContext(executable,sandbox,{filename:'app.js production manual handlers'});
 const edit=(kind,index,values)=>{form=values;sandbox.editor={kind,index};sandbox.saveEditor({preventDefault(){}});};
 const editPart=(id,changes={})=>{const index=project.parts.findIndex(p=>p.id===id),part=project.parts[index];edit('part',index,{...part,pins:part.pins.join('\n'),verified:false,...changes});};
 const change=(dataset,value,checked)=>sandbox.handleChange({target:{id:'',dataset,value,checked}});
 const click=button=>sandbox.handleClick({target:{closest:()=>({id:'',dataset:{},...button})}});
 const remove=(kind,index)=>{sandbox.editor={kind,index};sandbox.deleteEntry();};
 return {project,errors,toasts,saved,edit,editPart,change,click,remove,sandbox,get,fail:()=>{fail=true;}};
}
const progress=p=>Object.fromEntries(p.steps.map(s=>[s.id,s.done]));
const preserved=p=>plain({notes:p.notes,solidSpec:p.solidSpec,traySpec:p.traySpec,assemblySpec:p.assemblySpec,cadUrl:p.cadUrl,wiringUrl:p.wiringUrl});

test('actual part editor clears replacement evidence while retaining other branch, CAD and notes',()=>{
 const env=setup(),before=preserved(env.project);env.editPart('a',{name:'Replacement load',pins:'VCC\nGND',specUrl:'https://example.test/replacement'});
 assert.deepEqual(env.errors,[]);assert.equal(env.saved.length,1);
 assert.equal(env.project.powerRails[0].loads[0].currentMaEach,null);assert.equal(env.project.powerRails[0].loads[1].currentMaEach,200);assert.equal(env.project.powerRails[0].supplyCurrentMa,1000);
 assert.equal(progress(env.project)['step-a'],false);assert.equal(progress(env.project)['step-b'],true);
 assert.deepEqual(preserved(env.project),before);assert.match(env.toasts.at(-1),/Reset/);
});

test('actual quantity edit preserves per-unit evidence and rejects a fractional quantity',()=>{
 const env=setup();env.editPart('a',{qty:3});assert.equal(env.project.parts.find(p=>p.id==='a').qty,3);assert.equal(env.project.powerRails[0].loads[0].currentMaEach,100);assert.equal(progress(env.project)['step-a'],false);assert.equal(progress(env.project)['step-b'],true);
 const before=plain(env.project);env.editPart('a',{qty:1.5});assert.match(env.errors.at(-1),/whole-number/);assert.deepEqual(plain(env.project),before);assert.equal(env.saved.length,1);
});

test('actual step editor invalidates changed completed procedure and rollback restores all bytes',()=>{
 for(const fail of [false,true]){
  const env=setup(),before=plain(env.project);if(fail)env.fail();env.edit('step',0,{phase:'Test',title:'New procedure',detail:'New criterion',stepPartId:['a']});
  if(fail){assert.deepEqual(plain(env.project),before);assert.match(env.errors.at(-1),/not saved/);assert.equal(env.get('#editor-dialog').closed,false);}
  else{assert.equal(env.project.steps[0].done,false);assert.equal(env.project.steps[1].done,true);assert.equal(env.get('#editor-dialog').closed,true);}
 }
});

test('actual wire deletion clears endpoint load evidence and preserves unrelated current and supply rating',()=>{
 const env=setup();env.remove('wire',0);assert.equal(env.project.wires.length,1);assert.equal(env.project.powerRails[0].loads[0].currentMaEach,null);assert.equal(env.project.powerRails[0].loads[1].currentMaEach,200);assert.equal(env.project.powerRails[0].supplyCurrentMa,1000);assert.equal(progress(env.project)['step-a'],false);assert.equal(progress(env.project)['step-b'],true);
});

test('actual deletion uses prior links and failed deletion restores all original bytes',()=>{
 for(const fail of [false,true]){
  const env=setup(),before=plain(env.project);if(fail)env.fail();env.remove('part',2);
  if(fail){assert.deepEqual(plain(env.project),before);assert.match(env.errors.at(-1),/not deleted/);}
  else{assert.equal(env.project.parts.some(p=>p.id==='a'),false);assert.deepEqual(env.project.steps[0].partIds,[]);assert.equal(env.project.steps[0].done,false);assert.equal(env.project.powerRails[0].loads[0].partId,'b');assert.equal(env.project.powerRails[0].loads[0].currentMaEach,200);assert.deepEqual(preserved(env.project),preserved(before));}
 }
});

test('actual power controls invalidate voltage evidence, preserve explicit current/rating entries and support rollback',()=>{
 const env=setup();env.change({railIndex:'0',railField:'voltageV'},'3.3');assert.equal(env.project.powerRails[0].voltageV,3.3);assert.equal(env.project.powerRails[0].supplyCurrentMa,null);assert.ok(env.project.powerRails[0].loads.every(load=>load.currentMaEach===null));
 env.change({railIndex:'0',railField:'supplyCurrentMa'},'750');env.change({loadRail:'0',loadIndex:'0'},'125');assert.equal(env.project.powerRails[0].supplyCurrentMa,750);assert.equal(env.project.powerRails[0].loads[0].currentMaEach,125);
 const before=plain(env.project);env.fail();env.change({railIndex:'0',railField:'voltageV'},'12');assert.deepEqual(plain(env.project),before);
});

test('actual source reassignment and load removal preserve unaffected load currents',()=>{
 const env=setup();env.change({railIndex:'0',railField:'sourcePartId'},'alternate');assert.equal(env.project.powerRails[0].sourcePartId,'alternate');assert.equal(env.project.powerRails[0].supplyCurrentMa,null);assert.deepEqual(env.project.powerRails[0].loads.map(l=>l.currentMaEach),[100,200]);
 env.click({dataset:{removeLoad:'0:0'}});assert.equal(env.project.powerRails[0].loads.length,1);assert.equal(env.project.powerRails[0].loads[0].partId,'b');assert.equal(env.project.powerRails[0].loads[0].currentMaEach,200);
});

test('actual mount/preparation editing and progress/review controls distinguish design changes from recording checks',()=>{
 const env=setup();env.edit('mount',0,{from:'a',to:'stand',label:'New mounting arrangement',note:'Measure interface'});assert.equal(progress(env.project)['step-a'],false);assert.equal(progress(env.project)['step-stand'],false);assert.equal(progress(env.project)['step-b'],true);assert.deepEqual(env.project.powerRails[0].loads.map(l=>l.currentMaEach),[100,200]);
 env.change({doneStep:'0'},'',true);env.change({review:'mechanical'},'',true);assert.equal(env.project.steps[0].done,true);assert.equal(env.project.review.mechanical,true);
 env.edit('prep',-1,{tools:'Meter\nCrimp tool',assumptions:'Power isolated'});assert.ok(env.project.steps.every(step=>!step.done));assert.equal(env.project.review.mechanical,false);
});


test('actual power renderer distinguishes an unbound supply from complete arithmetic',()=>{
 const sandbox={powerBudget,html:value=>String(value??''),panelHead:()=>''};
 vm.runInNewContext(productionFunction('renderPower'),sandbox,{filename:'app.js production power renderer'});
 for(const sourcePartId of ['', 'missing-supply', 'source']){
  const project=fixture();project.powerRails[0].sourcePartId=sourcePartId;
  assert.equal(powerBudget(project,project.powerRails[0]).status,'within-margin');
  const output=sandbox.renderPower(project);
  if(sourcePartId==='source'){
   assert.match(output,/<span class="power-status within-margin">WITHIN TARGET<\/span>/);
   assert.doesNotMatch(output,/ASSIGN SUPPLY/);
  }else{
   assert.match(output,/<span class="power-status incomplete">ASSIGN SUPPLY<\/span>/);
   assert.doesNotMatch(output,/WITHIN TARGET/);
  }
 }
});
