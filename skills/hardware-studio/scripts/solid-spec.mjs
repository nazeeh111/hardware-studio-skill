import {validateCurveProfile} from './curve-profile.mjs';
export const SOLID_SCHEMA='hardware-studio-solid-v1';
const allowed=(value,keys,label)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))throw new Error(`${label} has unsupported fields.`);};
const number=(n,label,positive=false)=>{if(typeof n!=='number'||!Number.isFinite(n)||Math.abs(n)>500||(positive&&n<.01))throw new Error(`${label} must be a finite number ${positive?'at least 0.01 mm and ':''}within 500 mm.`);return n;};
// Keep polygon topology checks and winding normalization identical to solid.py.
const PROFILE_EPS=1e-9;
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const onSegment=(a,b,p)=>Math.abs(cross(a,b,p))<=PROFILE_EPS&&p[0]>=Math.min(a[0],b[0])-PROFILE_EPS&&p[0]<=Math.max(a[0],b[0])+PROFILE_EPS&&p[1]>=Math.min(a[1],b[1])-PROFILE_EPS&&p[1]<=Math.max(a[1],b[1])+PROFILE_EPS;
function segmentsTouch(a,b,c,d){
 const abC=cross(a,b,c),abD=cross(a,b,d),cdA=cross(c,d,a),cdB=cross(c,d,b);
 return ((abC>PROFILE_EPS&&abD<-PROFILE_EPS||abC<-PROFILE_EPS&&abD>PROFILE_EPS)&&(cdA>PROFILE_EPS&&cdB<-PROFILE_EPS||cdA<-PROFILE_EPS&&cdB>PROFILE_EPS))||onSegment(a,b,c)||onSegment(a,b,d)||onSegment(c,d,a)||onSegment(c,d,b);
}
function profilePoints(raw,label){
 if(!Array.isArray(raw)||raw.length<3||raw.length>64)throw new Error(`${label} needs 3–64 polygon vertices, with implicit closure and no holes.`);
 const points=raw.map(p=>{if(!Array.isArray(p)||p.length!==2)throw new Error(`${label} vertices need two coordinates.`);return p.map(n=>number(n,`${label}.points`));});
 let area2=0;
 for(let i=0;i<points.length;i++){
  const a=points[i],b=points[(i+1)%points.length],c=points[(i+2)%points.length];
  const dx=b[0]-a[0],dy=b[1]-a[1];
  if(dx*dx+dy*dy<.01*.01)throw new Error(`${label} polygon edges must be at least 0.01 mm.`);
  if(Math.abs(cross(a,b,c))<=PROFILE_EPS)throw new Error(`${label} polygon has adjacent collinear corners.`);
  area2+=a[0]*b[1]-b[0]*a[1];
  for(let j=i+1;j<points.length;j++){
   const d=points[j],ex=d[0]-a[0],ey=d[1]-a[1];
   if(ex*ex+ey*ey<=PROFILE_EPS*PROFILE_EPS)throw new Error(`${label} polygon has repeated vertices; closure is implicit.`);
   if(j!==i+1&&!(i===0&&j===points.length-1)&&segmentsTouch(a,b,d,points[(j+1)%points.length]))throw new Error(`${label} polygon edges cross or touch.`);
  }
 }
 if(Math.abs(area2)<=PROFILE_EPS)throw new Error(`${label} polygon needs nonzero area.`);
 return area2<0?[points[0],...points.slice(1).reverse()]:points;
}
function primitive(raw,label,metadata=[]){
 allowed(raw,['shape','origin','size','axis','radius','height','points','start','segments',...metadata],label);
 if(!Array.isArray(raw.origin)||raw.origin.length!==3)throw new Error(`${label} needs three origin coordinates.`);
 const value={shape:raw.shape,origin:raw.origin.map(n=>number(n,`${label}.origin`))};
 if(raw.shape==='box'){
  if(['axis','radius','height','points','start','segments'].some(k=>k in raw)||!Array.isArray(raw.size)||raw.size.length!==3)throw new Error(`${label} box needs size only.`);
  value.size=raw.size.map(n=>number(n,`${label}.size`,true));
 }else if(raw.shape==='cylinder'){
  if(['size','points','start','segments'].some(k=>k in raw)||!['x','y','z'].includes(raw.axis))throw new Error(`${label} cylinder needs an x, y or z axis.`);
  Object.assign(value,{axis:raw.axis,radius:number(raw.radius,`${label}.radius`,true),height:number(raw.height,`${label}.height`,true)});
 }else if(raw.shape==='profile'){
  if(['size','radius','start','segments'].some(k=>k in raw)||!['x','y','z'].includes(raw.axis))throw new Error(`${label} profile needs points and an x, y or z axis.`);
  // Right-handed local axes: x => U=Y,V=Z; y => U=Z,V=X; z => U=X,V=Y.
  Object.assign(value,{axis:raw.axis,height:number(raw.height,`${label}.height`,true),points:profilePoints(raw.points,label)});
 }else if(raw.shape==='curve'){
  if(['size','radius','points'].some(k=>k in raw)||!['x','y','z'].includes(raw.axis))throw new Error(`${label} curved profile needs start, segments and an x, y or z axis.`);
  Object.assign(value,{axis:raw.axis,height:number(raw.height,`${label}.height`,true),...validateCurveProfile(raw.start,raw.segments)});
 }else throw new Error(`${label} supports box, cylinder, polygon or curved profile only.`);
 return value;
}
export function validateSolidSpec(raw){
 allowed(raw,['schema','title','units','features','probes'],'Solid specification');
 if(raw.schema!==SOLID_SCHEMA||raw.units!=='mm')throw new Error(`Use ${SOLID_SCHEMA} and millimeter units.`);
 if(typeof raw.title!=='string'||!raw.title.trim()||raw.title.length>100)throw new Error('Use a title of 1–100 characters.');
 if(!Array.isArray(raw.features)||raw.features.length<1||raw.features.length>32)throw new Error('Use 1–32 ordered features.');
 const ids=new Set(),id=(value)=>{if(typeof value!=='string'||!value.trim()||value.length>60||ids.has(value))throw new Error('Feature and probe IDs must be unique short text.');ids.add(value);return value;};
 const features=raw.features.map((f,i)=>{
  if(f?.operation==='fillet'){
   allowed(f,['id','operation','radius','edges','tolerance'],`Feature ${i+1}`);
   if(i===0)throw new Error('A fillet needs an existing solid; the first feature must add material.');
   if(!Array.isArray(f.edges)||f.edges.length<1||f.edges.length>16)throw new Error('A fillet needs 1–16 edge interior points.');
   const edges=f.edges.map(p=>{if(!Array.isArray(p)||p.length!==3)throw new Error('Each fillet edge point needs X, Y, Z coordinates.');return p.map(n=>number(n,'Fillet edge point'));});
   if(new Set(edges.map(p=>JSON.stringify(p))).size!==edges.length)throw new Error('Fillet edge points must be distinct.');
   const tolerance=f.tolerance===undefined ? .01 : f.tolerance;
   if(typeof tolerance!=='number'||!Number.isFinite(tolerance)||tolerance<.000001||tolerance>.1)throw new Error('Fillet edge tolerance must be 0.000001–0.1 mm.');
   return {id:id(f.id),operation:'fillet',radius:number(f.radius,'Fillet radius',true),edges,tolerance};
  }
  const value=primitive(f,`Feature ${i+1}`,['id','operation']);
  if(!['add','cut'].includes(f.operation)||(i===0&&f.operation!=='add'))throw new Error('The first feature must add material; later operations add or cut.');
  return {id:id(f.id),operation:f.operation,...value};
 });
 const source=raw.probes===undefined?[]:raw.probes;if(!Array.isArray(source)||source.length>16)throw new Error('Use at most 16 material/void probes.');
 const probes=source.map((p,i)=>{const value=primitive(p,`Probe ${i+1}`,['id','expect']);if(!['void','material'].includes(p.expect))throw new Error('Probes need material or void expectations.');return {id:id(p.id),expect:p.expect,...value};});
 return {schema:SOLID_SCHEMA,title:raw.title.trim(),units:'mm',features,probes};
}
export function needsCurvedRuntime(spec){return [...(spec?.features||[]),...(spec?.probes||[])].some(item=>item.operation==='fillet'||item.shape==='curve');}
export function solidProposal(base,raw){
 allowed(raw,['spec','assumptions','missing'],'Model proposal');
 for(const key of ['assumptions','missing'])if(!Array.isArray(raw[key])||raw[key].length>12||raw[key].some(s=>typeof s!=='string'||!s.trim()||s.length>240))throw new Error('The proposal needs short assumptions and missing-information lists.');
 if(raw.missing.length)throw new Error('More information needed: '+raw.missing.join('; '));
 const before=validateSolidSpec(base),spec=validateSolidSpec(raw.spec);
 if(JSON.stringify(before)===JSON.stringify(spec))throw new Error('No feature changes proposed.');
 return {base:JSON.stringify(before),spec,assumptions:raw.assumptions};
}
