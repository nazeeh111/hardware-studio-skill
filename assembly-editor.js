import {validateAssemblySpec,ASSEMBLY_MAX_BYTES} from './assembly-spec.js?v=1';
// A tab draft may contain unfinished numeric fields or names. Its CAD sources
// and references still pass the structural rules; it is never buildable directly.
export function editableAssembly(raw){
 if(!raw||typeof raw!=='object'||new TextEncoder().encode(JSON.stringify(raw)).length>ASSEMBLY_MAX_BYTES+8192)throw new Error('Assembly draft is too large or invalid.');
 const draft=structuredClone(raw),test=structuredClone(raw);
 if(typeof draft.title!=='string'||draft.title.length>100||/[\u0000-\u001f\u007f]/.test(draft.title))throw new Error('Draft title is invalid.');
 test.title=draft.title.trim()||'Unfinished assembly';
 if(!Array.isArray(draft.instances)||draft.instances.length>16)throw new Error('Draft instance list is invalid.');
 for(let n=0;n<draft.instances.length;n++){
  const item=draft.instances[n],check=test.instances[n];
  if(!item||typeof item.id!=='string'||item.id.length>80||/[\u0000-\u001f\u007f]/.test(item.id))throw new Error('Draft instance name is invalid.');
  check.id='draft-'+n;
  for(const key of ['position','rotation']){
   if(!Array.isArray(item[key])||item[key].length!==3||Object.keys(item[key]).length!==3||Array.from({length:3},(_,i)=>Object.hasOwn(item[key],i)).some(v=>!v))throw new Error('Draft placement needs three fields.');
   for(const value of item[key])if(!(typeof value==='number'&&Number.isFinite(value))&&!(typeof value==='string'&&value.length<=50&&/^[-+0-9.eE]*$/.test(value)))throw new Error('Draft numeric field is invalid.');
   check[key]=[0,0,0];
  }
 }
 const normalized=validateAssemblySpec(test);draft.assets=normalized.assets;
 return draft;
}
export function normalizeAssemblyDraft(raw){
 const next=editableAssembly(raw);
 for(const instance of next.instances)for(const key of ['position','rotation'])instance[key]=instance[key].map(value=>{
  if(typeof value==='string'&&!value.trim())throw new Error('Complete every position and rotation field.');
  const n=Number(value);if(!Number.isFinite(n))throw new Error('Use finite numeric placement values.');return n;
 });
 return validateAssemblySpec(next);
}
