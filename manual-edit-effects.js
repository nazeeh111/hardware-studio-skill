// Manual edits carry explicit new values. Invalidate derived records using both
// versions of the design, without altering CAD sources or unrelated branches.
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const rows=(p,key)=>p[key]||[];
const fields=(value,keys)=>keys.map(key=>value?.[key]??null);
const differs=(a,b,keys)=>!same(fields(a,keys),fields(b,keys));
const indexed=(items)=>new Map(items.map(item=>[item.id,item]));
// Imported legacy rails can repeat an ID. Manual controls address rows, so keep
// every occurrence instead of silently dropping all but the last one in a Map.
const railIndex=items=>{
 const seen=new Map();
 return new Map(items.map(item=>{const occurrence=seen.get(item.id)||0;seen.set(item.id,occurrence+1);return [JSON.stringify([item.id,occurrence]),item];}));
};
function changedRelationships(before,after,keys){
 const remaining=after.slice(),changed=[];
 for(const row of before){const index=remaining.findIndex(next=>!differs(row,next,keys));if(index<0)changed.push(row);else remaining.splice(index,1);}
 return changed.concat(remaining);
}
export function invalidateManualEdit(before,after){
 const affected=new Set(),changedParts=new Set(),replacedParts=new Set(),identityParts=new Set(),wireParts=new Set();
 const effect={currentsCleared:0,pinsCleared:0,stepsCleared:0};
 const touch=id=>{if(id)affected.add(id);};
 const clear=(object,key,count)=>{if(object[key]!=null&&object[key]!==''){object[key]=key.endsWith('Pin')?'':null;effect[count]++;}};
 const oldParts=indexed(rows(before,'parts')),newParts=indexed(rows(after,'parts'));
 for(const id of new Set([...oldParts.keys(),...newParts.keys()])){
  const a=oldParts.get(id),b=newParts.get(id);
  const replacement=!a||!b||differs(a,b,['name','category','detail','voltage','pins','specUrl']);
  if(replacement||a?.qty!==b?.qty){changedParts.add(id);touch(id);}
  if(replacement)replacedParts.add(id);
  if(!a||!b||differs(a,b,['name','category','detail','voltage']))identityParts.add(id);
 }
 for(const section of ['wires','mechanicalConnections']){
  const keys=section==='wires'?['from','to','fromPin','toPin','signal','voltage']:['from','to','label','note'];
  for(const row of changedRelationships(rows(before,section),rows(after,section),keys)){
   touch(row.from);touch(row.to);
   if(section==='wires'){wireParts.add(row.from);wireParts.add(row.to);}
  }
  // One connection away, from either revision. Do not traverse a shared source
  // into unrelated load branches.
  for(const row of [...rows(before,section),...rows(after,section)])if(changedParts.has(row.from)||changedParts.has(row.to)){touch(row.from);touch(row.to);}
 }
 for(const wire of rows(after,'wires')){
  if(identityParts.has(wire.from))clear(wire,'fromPin','pinsCleared');
  if(identityParts.has(wire.to))clear(wire,'toPin','pinsCleared');
 }
 const oldRails=railIndex(rows(before,'powerRails')),newRails=railIndex(rows(after,'powerRails'));
 for(const id of new Set([...oldRails.keys(),...newRails.keys()])){
  const a=oldRails.get(id),b=newRails.get(id);
  const voltageChanged=!!a&&!!b&&a.voltageV!==b.voltageV;
  const sourceChanged=!!a&&!!b&&a.sourcePartId!==b.sourcePartId;
  const railChanged=!a||!b||differs(a,b,['voltageV','sourcePartId','supplyCurrentMa','marginPercent','loads']);
  if(railChanged)for(const rail of [a,b])if(rail){touch(rail.sourcePartId);rail.loads.forEach(load=>touch(load.partId));}
  if(!b)continue;
  if(voltageChanged||sourceChanged||replacedParts.has(b.sourcePartId)){
   clear(b,'supplyCurrentMa','currentsCleared');b.loads.forEach(load=>touch(load.partId));
  }
  for(const load of b.loads){
   if(voltageChanged||replacedParts.has(load.partId)||wireParts.has(load.partId)){clear(load,'currentMaEach','currentsCleared');touch(b.sourcePartId);}
  }
 }
 const globalChange=differs(before,after,['tools','assumptions']);
 const oldSteps=indexed(rows(before,'steps'));
 for(const step of rows(after,'steps')){
  const old=oldSteps.get(step.id);
  const contentChanged=!!old&&differs(old,step,['phase','title','detail','partIds']);
  const linked=[...(old?.partIds||[]),...(step.partIds||[])];
  const dependent=affected.size>0&&(!linked.length||linked.some(id=>affected.has(id)));
  if(step.done&&(globalChange||contentChanged||dependent)){step.done=false;effect.stepsCleared++;}
 }
 if(globalChange||[...oldSteps.values()].some(old=>{const step=rows(after,'steps').find(s=>s.id===old.id);return !step||differs(old,step,['phase','title','detail','partIds']);})){
  after.review={...after.review,electrical:false,mechanical:false};
 }
 return effect;
}
export function manualEditNotice(effect){
 const items=[];
 if(effect.currentsCleared)items.push(`${effect.currentsCleared} stale current figure${effect.currentsCleared===1?'':'s'}`);
 if(effect.pinsCleared)items.push(`${effect.pinsCleared} prior pin name${effect.pinsCleared===1?'':'s'}`);
 if(effect.stepsCleared)items.push(`${effect.stepsCleared} completed step${effect.stepsCleared===1?'':'s'}`);
 return items.length?'Reset '+items.join(', ')+'. Review the changed design.':'';
}
