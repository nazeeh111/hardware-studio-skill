import {validateMeshReadback} from './mesh-readback.js?v=1';
import {validateAssemblySpec,ASSEMBLY_MAX_BYTES} from './assembly-spec.js?v=2';
import {parseStl} from './stl.js?v=1';
export const ASSEMBLY_PREVIEW_KEY='hardware-studio-assembly-snapshot-v1';
const vector=v=>Array.isArray(v)&&v.length===3&&v.every(Number.isFinite);
const equalPoint=(a,b,tolerance=.03)=>vector(a)&&vector(b)&&a.every((n,k)=>Math.abs(n-b[k])<=tolerance);
export function assemblySnapshot(spec,projectId,now=Date.now()){
 if(typeof projectId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(projectId))throw new Error('Use a valid project assembly link.');
 return {schema:ASSEMBLY_PREVIEW_KEY,at:now,spec:validateAssemblySpec(spec,{requirePlaced:true}),returnTo:'./assembly.html?'+new URLSearchParams({project:projectId})};
}
export function readAssemblySnapshot(raw,now=Date.now()){
 if(typeof raw!=='string'||new TextEncoder().encode(raw).length>ASSEMBLY_MAX_BYTES+2048)throw new Error('Assembly snapshot unavailable. Open a fresh preview from its workbench.');
 const record=JSON.parse(raw);
 if(record?.schema!==ASSEMBLY_PREVIEW_KEY||!Number.isFinite(record.at)||now-record.at>1800000||record.at>now+10000||typeof record.returnTo!=='string'||!/^\.\/assembly\.html\?[^#]*$/.test(record.returnTo))throw new Error('Assembly preview expired or has an invalid return link.');
 const query=new URLSearchParams(record.returnTo.split('?')[1]),id=query.get('project');
 return assemblySnapshot(record.spec,id,record.at);
}
export async function assemblyMeshes(payload,expected){
 const spec=validateAssemblySpec(expected,{requirePlaced:true});
 if(payload?.schema!=='hardware-studio-assembly-preview-v1'||JSON.stringify(validateAssemblySpec(payload.spec,{requirePlaced:true}))!==JSON.stringify(spec)||!Array.isArray(payload.meshes)||payload.meshes.length!==spec.instances.length)throw new Error('The preview does not match the requested assembly.');
 const report=payload.verification;
 if(!['passed','interference'].includes(report?.status)||!Array.isArray(report.instances)||report.instances.length!==spec.instances.length||!Array.isArray(report.pairs)||report.pairs.length!==spec.instances.length*(spec.instances.length-1)/2)throw new Error('Assembly readback is incomplete.');
 const instanceIds=new Set(spec.instances.map(i=>i.id)),pairIds=new Set();
 for(const pair of report.pairs){
  const key=JSON.stringify([pair.firstId,pair.secondId].sort());
  if(!instanceIds.has(pair.firstId)||!instanceIds.has(pair.secondId)||pair.firstId===pair.secondId||pairIds.has(key)||!Number.isFinite(pair.overlap_mm3)||pair.overlap_mm3<0||!Number.isFinite(pair.minimum_distance_mm)||pair.minimum_distance_mm<0||pair.interference!==(pair.overlap_mm3>.01))throw new Error('Assembly pair checks are invalid.');pairIds.add(key);
 }
 if((report.status==='interference')!==report.pairs.some(p=>p.interference))throw new Error('Assembly status disagrees with its interference checks.');
 const next=[];let totalBytes=0,totalTriangles=0;
 for(let n=0;n<spec.instances.length;n++){
  const expectedInstance=spec.instances[n],entry=payload.meshes[n],r=report.instances[n],filename='instance-'+String(n+1).padStart(3,'0')+'.stl';
  if(entry?.id!==expectedInstance.id||entry.partId!==expectedInstance.partId||entry.name!==filename||r?.id!==expectedInstance.id||r.partId!==expectedInstance.partId||r.name!==filename||typeof entry.dataBase64!=='string'||entry.dataBase64.length>22000000||!Number.isFinite(r.volume_mm3)||r.volume_mm3<=0||!equalPoint(r.min_mm,r.stl_min_mm)||!equalPoint(r.max_mm,r.stl_max_mm))throw new Error('A placed mesh has incomplete or inconsistent readback.');
  let bytes;try{bytes=Uint8Array.from(atob(entry.dataBase64),c=>c.charCodeAt(0));}catch{throw new Error('A placed mesh is not valid base64 data.');}totalBytes+=bytes.length;if(totalBytes>16000000)throw new Error('Assembly preview exceeds the mesh size limit.');
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
  if(hash!==r.sha256?.stl)throw new Error('Placed STL hash differs from readback.');
  const mesh=parseStl(bytes.buffer);totalTriangles+=mesh.triangles;
  if(mesh.triangles!==r.stl_triangles||totalTriangles>400000||!equalPoint(mesh.min,r.min_mm)||!equalPoint(mesh.max,r.max_mm))throw new Error('Placed mesh position or bounds differ from STEP readback.');
  validateMeshReadback(r.stl_check,mesh.triangles,r.volume_mm3);
  const source=spec.assets.find(a=>a.partId===expectedInstance.partId).source;
  next.push({...mesh,name:source.title+' / '+expectedInstance.id,cover:false,partId:expectedInstance.partId,instanceId:expectedInstance.id});
 }
 const min=[0,1,2].map(k=>Math.min(...next.map(m=>m.min[k]))),max=[0,1,2].map(k=>Math.max(...next.map(m=>m.max[k])));
 if(report.assembly?.solid_count!==spec.instances.length||!equalPoint(min,report.assembly?.min_mm)||!equalPoint(max,report.assembly?.max_mm))throw new Error('Combined assembly bounds or solid count disagree with placed meshes.');
 return next;
}
export function assemblyReadbackText(report){
 const interference=report.pairs.filter(p=>p.interference);
 const summary=interference.length?`INTERFERENCE: ${interference.length} instance pair${interference.length===1?'':'s'} overlap by more than 0.01 mm³. `:'No pair overlap above 0.01 mm³ in these nominal placements. ';
 const pairs=report.pairs.map(p=>`${p.firstId} ↔ ${p.secondId}: overlap ${p.overlap_mm3.toFixed(4)} mm³; minimum distance ${p.minimum_distance_mm.toFixed(4)} mm.`).join('\n');
 return 'Readback matched instance STL hashes, positions, topology, volume and sampled STEP boundary checks. '+summary+(pairs?'\n'+pairs:'')+'\nRigid solids only. Joints, motion, tolerances and physical fit remain untested.';
}
