import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
function productionFunction(name){const start=source.indexOf(`function ${name}(`),end=source.indexOf('\nfunction ',start+1);assert.ok(start>=0);return source.slice(start,end);}

test('CAD status refresh retains unfinished overview and power fields',()=>{
 for(const activeTab of ['overview','power','parts','wiring']){
  const field={value:'Unfinished input',focused:true},project={},calls=[];
  const env={activeTab,current:()=>project,render(){field.value='last saved value';field.focused=false;calls.push('render');},renderReview(){calls.push('review');},projectChange:{refresh(){calls.push('revision');}},refreshProjectPackageUi(){calls.push('package');}};
  vm.runInNewContext(productionFunction('refreshGeometry'),env);
  env.refreshGeometry();
  assert.deepEqual(field,{value:'Unfinished input',focused:true});assert.deepEqual(calls,['review','revision','package']);
 }
});
test('external CAD sync refreshes CAD-dependent Assembly and Build views',()=>{
 for(const activeTab of ['assembly','build']){let renders=0;const env={activeTab,render(){renders++;}};vm.runInNewContext(productionFunction('refreshGeometry'),env);env.refreshGeometry();assert.equal(renders,1);}
});
test('design tab keyboard navigation wraps and supports Home and End without consuming unrelated keys',()=>{
 const names=['overview','parts','wiring','power','assembly','build'],tabs=names.map(name=>({dataset:{tab:name},focus(){this.focused=true;}}));let rendered=0,prevented=0;
 const env={activeTab:'overview',document:{querySelectorAll:()=>tabs},render(){rendered++;}};vm.runInNewContext(productionFunction('handleTabKeydown'),env);
 const send=(index,key)=>env.handleTabKeydown({key,target:{closest:()=>tabs[index]},preventDefault(){prevented++;}});
 for(const [index,key,want] of [[0,'ArrowLeft','build'],[5,'ArrowRight','overview'],[2,'End','build'],[3,'Home','overview'],[2,'ArrowRight','power']]){send(index,key);assert.equal(env.activeTab,want);assert.equal(tabs[names.indexOf(want)].focused,true);}
 send(2,'Tab');send(2,'a');assert.equal(rendered,5);assert.equal(prevented,5);
});
