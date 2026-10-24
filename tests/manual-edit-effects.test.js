import test from 'node:test';
import assert from 'node:assert/strict';
import {invalidateManualEdit,manualEditNotice} from '../manual-edit-effects.js';
import {blankProject,powerBudget,validate} from '../core.js';
const part=id=>({id,name:id,category:'Control',detail:'Exact '+id,voltage:'5',qty:1,pins:['VCC','GND'],specUrl:'https://example.test/'+id,sourceUrl:'https://example.test/buy/'+id,unitCost:8,verified:true,checkedAt:'2026-10-23'});
function fixture(){
 const p=blankProject('Evidence branches');p.parts=['source','a','b','mount','other'].map(part);
 p.wires=['a','b'].map(id=>({from:'source',to:id,fromPin:'VCC',toPin:'VCC',signal:'Power',voltage:'5 V',note:'Same source'}));
 p.mechanicalConnections=[{from:'mount',to:'a',label:'Screw',note:'Measured fit'}];
 p.powerRails=[{id:'rail',name:'5 V',voltageV:5,sourcePartId:'source',supplyCurrentMa:1000,marginPercent:20,loads:[{partId:'a',currentMaEach:100},{partId:'b',currentMaEach:150}]}];
 p.steps=['source','a','b','mount','other'].map(id=>({id:'step-'+id,title:'Test '+id,detail:'Check exact hardware',phase:'Test',partIds:[id],done:true}));
 p.steps.push({id:'global',title:'Prepare',detail:'Bench check',phase:'Prepare',partIds:[],done:true});p.tools=['Driver'];p.assumptions=['Dry use'];p.notes='Preserved work';p.solidSpec={retained:'solid'};p.assemblySpec={retained:'assembly'};p.review={electrical:true,mechanical:true,sourcing:true};return p;
}
function apply(change){const before=fixture(),after=structuredClone(before);change(after);const effects=invalidateManualEdit(before,after);assert.equal(before.powerRails[0].supplyCurrentMa,1000);for(const k of ['notes','solidSpec','assemblySpec'])assert.deepEqual(after[k],before[k]);return {before,after,effects};}
const completed=p=>Object.fromEntries(p.steps.map(s=>[s.id,s.done]));
test('replacement supply cannot carry previous rating or completion',()=>{
 const {before,after,effects}=apply(p=>{p.parts[0].name='Replacement 500 mA supply';});assert.equal(powerBudget(before,before.powerRails[0]).status,'within-margin');assert.equal(powerBudget(after,after.powerRails[0]).status,'incomplete');assert.equal(after.powerRails[0].supplyCurrentMa,null);assert.deepEqual(after.powerRails[0].loads,before.powerRails[0].loads);assert.deepEqual(completed(after),{'step-source':false,'step-a':false,'step-b':false,'step-mount':true,'step-other':true,global:false});assert.equal(after.wires[0].fromPin,'');assert.equal(after.wires[0].toPin,'VCC');assert.match(manualEditNotice(effects),/stale current/);
});
test('load replacement clears its current and direct neighbors, not another branch',()=>{
 const {after}=apply(p=>p.parts[1].voltage='3.3');assert.equal(after.powerRails[0].loads[0].currentMaEach,null);assert.equal(after.powerRails[0].loads[1].currentMaEach,150);assert.equal(after.powerRails[0].supplyCurrentMa,1000);assert.deepEqual(completed(after),{'step-source':false,'step-a':false,'step-b':true,'step-mount':false,'step-other':true,global:false});
});
test('quantity retains per-unit evidence and recalculates demand but resets linked steps',()=>{
 const {after}=apply(p=>p.parts[1].qty=3);assert.equal(after.powerRails[0].loads[0].currentMaEach,100);assert.equal(powerBudget(after,after.powerRails[0]).knownDemandMa,450);assert.equal(after.steps[1].done,false);assert.equal(after.steps[2].done,true);
});
test('wire changes clear old/new endpoint currents and retain supply hardware rating',()=>{
 for(const change of [p=>p.wires[0].toPin='GND',p=>p.wires.splice(0,1),p=>p.wires.push({from:'a',to:'other',signal:'Signal',fromPin:'GND',toPin:'GND',voltage:'5 V'})]){const {after}=apply(change);assert.equal(after.powerRails[0].loads[0].currentMaEach,null);assert.equal(after.powerRails[0].loads[1].currentMaEach,150);assert.equal(after.powerRails[0].supplyCurrentMa,1000);assert.equal(after.steps[1].done,false);assert.equal(after.steps[2].done,true);}
 const {after}=apply(p=>p.wires[0].to='b');assert.ok(after.powerRails[0].loads.every(l=>l.currentMaEach===null));
});
test('source reassignment clears inherited rating and old/new linked completion',()=>{
 const {after}=apply(p=>p.powerRails[0].sourcePartId='other');assert.equal(after.powerRails[0].supplyCurrentMa,null);assert.deepEqual(after.powerRails[0].loads,[{partId:'a',currentMaEach:100},{partId:'b',currentMaEach:150}]);for(const id of ['source','a','b','other'])assert.equal(completed(after)['step-'+id],false);
});
test('rail voltage change clears rating and all its load currents',()=>{
 const {after,effects}=apply(p=>p.powerRails[0].voltageV=3.3);assert.equal(after.powerRails[0].supplyCurrentMa,null);assert.ok(after.powerRails[0].loads.every(l=>l.currentMaEach===null));assert.equal(effects.currentsCleared,3);
});
test('fresh current/rating and load removal retain unaffected evidence',()=>{
 for(const change of [p=>p.powerRails[0].supplyCurrentMa=600,p=>p.powerRails[0].loads[0].currentMaEach=50,p=>p.powerRails[0].loads.splice(0,1)]){const {after,effects}=apply(change);assert.equal(effects.currentsCleared,0);assert.equal(after.powerRails[0].loads.at(-1).currentMaEach,150);assert.equal(after.steps[0].done,false);assert.equal(after.steps[2].done,false);assert.equal(after.steps[4].done,true);}
});
test('mount changes clear affected completion without changing electrical evidence',()=>{
 for(const change of [p=>p.mechanicalConnections[0].label='Press fit',p=>p.mechanicalConnections=[],p=>p.mechanicalConnections[0].to='other']){const {before,after,effects}=apply(change);assert.deepEqual(after.powerRails,before.powerRails);assert.equal(effects.currentsCleared,0);assert.equal(after.steps[1].done,false);assert.equal(after.steps[3].done,false);assert.equal(after.steps[2].done,true);}
});
test('deletion sees removed relationships and original step links after cascade',()=>{
 const {after}=apply(p=>{p.parts=p.parts.filter(p=>p.id!=='a');p.wires=p.wires.filter(w=>w.to!=='a');p.mechanicalConnections=[];p.powerRails[0].loads=p.powerRails[0].loads.filter(l=>l.partId!=='a');p.steps.forEach(s=>s.partIds=s.partIds.filter(id=>id!=='a'));});assert.equal(after.steps[1].done,false);assert.equal(after.steps[3].done,false);assert.equal(after.powerRails[0].loads[0].currentMaEach,150);assert.equal(after.steps[4].done,true);
});
test('edited completed procedure and new preparation need fresh completion',()=>{
 for(const change of [p=>p.steps[1].detail='New acceptance test',p=>p.steps[1].phase='Wire',p=>p.steps[1].partIds=['other']]){const {after}=apply(change);assert.equal(after.steps[1].done,false);assert.equal(after.steps[2].done,true);}
 const {after}=apply(p=>p.assumptions.push('New setup'));assert.ok(after.steps.every(s=>!s.done));
});
test('review, progress, price, supplier, rail name, wire note and reordering do not reset unrelated evidence',()=>{
 for(const change of [p=>p.review.electrical=false,p=>p.steps[1].done=false,p=>p.parts[1].unitCost=12,p=>p.parts[1].sourceUrl='https://example.test/new-shop',p=>p.powerRails[0].name='Bench 5 V',p=>p.wires[0].note='New citation',p=>p.wires.reverse()]){const {before,after,effects}=apply(change);assert.deepEqual(effects,{currentsCleared:0,pinsCleared:0,stepsCleared:0});assert.deepEqual(after.powerRails.map(r=>({...r,name:''})),before.powerRails.map(r=>({...r,name:''})));}
});
test('unassigned source is explicit even with complete worksheet arithmetic',()=>{
 const p=fixture();p.solidSpec=null;p.assemblySpec=null;p.powerRails[0].sourcePartId='';assert.equal(powerBudget(p,p.powerRails[0]).status,'within-margin');assert.ok(validate(p).some(i=>i.kind==='todo'&&/no supply part assigned/.test(i.text)));
});
test('pin inventory and evidence-link updates preserve recorded endpoint names for mismatch review',()=>{
 for(const change of [p=>p.parts[1].pins=['GND'],p=>p.parts[1].specUrl='https://example.test/new-spec']){const {after}=apply(change);assert.equal(after.wires[0].toPin,'VCC');assert.equal(after.powerRails[0].loads[0].currentMaEach,null);assert.equal(after.powerRails[0].loads[1].currentMaEach,150);}
 const {after}=apply(p=>p.parts[1].pins=['GND']);after.solidSpec=null;after.assemblySpec=null;assert.ok(validate(after).some(i=>/absent.*inventory|inventory.*absent/i.test(i.text)));
});
test('legacy duplicate rail IDs do not hide an earlier rail from invalidation',()=>{
 const before=fixture();before.powerRails.push({...structuredClone(before.powerRails[0]),sourcePartId:'other',loads:[{partId:'b',currentMaEach:80}]});
 const after=structuredClone(before);after.parts[0].name='Replacement source';invalidateManualEdit(before,after);assert.equal(after.powerRails[0].supplyCurrentMa,null);assert.equal(after.powerRails[1].supplyCurrentMa,1000);
 const voltageEdit=structuredClone(before);voltageEdit.powerRails[0].voltageV=3.3;invalidateManualEdit(before,voltageEdit);assert.equal(voltageEdit.powerRails[0].supplyCurrentMa,null);assert.deepEqual(voltageEdit.powerRails[0].loads.map(l=>l.currentMaEach),[null,null]);assert.deepEqual(voltageEdit.powerRails[1],before.powerRails[1]);
});
