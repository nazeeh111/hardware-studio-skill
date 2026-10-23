export const SOLID_SCHEMA='hardware-studio-solid-v1';
const allowed=(value,keys,label)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))throw new Error(`${label} has unsupported fields.`);};
const number=(n,label,positive=false)=>{if(typeof n!=='number'||!Number.isFinite(n)||Math.abs(n)>500||(positive&&n<.01))throw new Error(`${label} must be a finite number ${positive?'at least 0.01 mm and ':''}within 500 mm.`);return n;};
function primitive(raw,label,metadata=[]){
 allowed(raw,['shape','origin','size','axis','radius','height',...metadata],label);
 if(!Array.isArray(raw.origin)||raw.origin.length!==3)throw new Error(`${label} needs three origin coordinates.`);
 const value={shape:raw.shape,origin:raw.origin.map(n=>number(n,`${label}.origin`))};
 if(raw.shape==='box'){
  if(['axis','radius','height'].some(k=>k in raw)||!Array.isArray(raw.size)||raw.size.length!==3)throw new Error(`${label} box needs size only.`);
  value.size=raw.size.map(n=>number(n,`${label}.size`,true));
 }else if(raw.shape==='cylinder'){
  if('size'in raw||!['x','y','z'].includes(raw.axis))throw new Error(`${label} cylinder needs an x, y or z axis.`);
  Object.assign(value,{axis:raw.axis,radius:number(raw.radius,`${label}.radius`,true),height:number(raw.height,`${label}.height`,true)});
 }else throw new Error(`${label} supports box or cylinder only.`);
 return value;
}
export function validateSolidSpec(raw){
 allowed(raw,['schema','title','units','features','probes'],'Solid specification');
 if(raw.schema!==SOLID_SCHEMA||raw.units!=='mm')throw new Error(`Use ${SOLID_SCHEMA} and millimeter units.`);
 if(typeof raw.title!=='string'||!raw.title.trim()||raw.title.length>100)throw new Error('Use a title of 1–100 characters.');
 if(!Array.isArray(raw.features)||raw.features.length<1||raw.features.length>32)throw new Error('Use 1–32 ordered features.');
 const ids=new Set(),id=(value)=>{if(typeof value!=='string'||!value.trim()||value.length>60||ids.has(value))throw new Error('Feature and probe IDs must be unique short text.');ids.add(value);return value;};
 const features=raw.features.map((f,i)=>{
  const value=primitive(f,`Feature ${i+1}`,['id','operation']);
  if(!['add','cut'].includes(f.operation)||(i===0&&f.operation!=='add'))throw new Error('The first feature must add material; later operations add or cut.');
  return {id:id(f.id),operation:f.operation,...value};
 });
 const source=raw.probes===undefined?[]:raw.probes;if(!Array.isArray(source)||source.length>16)throw new Error('Use at most 16 material/void probes.');
 const probes=source.map((p,i)=>{const value=primitive(p,`Probe ${i+1}`,['id','expect']);if(!['void','material'].includes(p.expect))throw new Error('Probes need material or void expectations.');return {id:id(p.id),expect:p.expect,...value};});
 return {schema:SOLID_SCHEMA,title:raw.title.trim(),units:'mm',features,probes};
}
export function solidProposal(base,raw){
 allowed(raw,['spec','assumptions','missing'],'Model proposal');
 for(const key of ['assumptions','missing'])if(!Array.isArray(raw[key])||raw[key].length>12||raw[key].some(s=>typeof s!=='string'||!s.trim()||s.length>240))throw new Error('The proposal needs short assumptions and missing-information lists.');
 if(raw.missing.length)throw new Error('More information needed: '+raw.missing.join('; '));
 const before=validateSolidSpec(base),spec=validateSolidSpec(raw.spec);
 if(JSON.stringify(before)===JSON.stringify(spec))throw new Error('No feature changes proposed.');
 return {base:JSON.stringify(before),spec,assumptions:raw.assumptions};
}
