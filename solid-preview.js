import {validateMeshReadback} from './mesh-readback.js?v=1';
import {solidContext} from './project-geometry.js?v=4';
import {validateSolidSpec,needsCurvedRuntime} from './solid-spec.js?v=3';
import {parseStl} from './stl.js?v=1';
export const SOLID_PREVIEW_KEY='hardware-studio-solid-snapshot-v1';
export function solidSnapshot(spec,now=Date.now(),search=''){return {schema:SOLID_PREVIEW_KEY,at:now,spec:validateSolidSpec(spec),returnTo:solidContext(search).returnTo};}
export function readSolidSnapshot(raw,now=Date.now()){
 if(typeof raw!=='string'||raw.length>65536)throw new Error('Feature model snapshot unavailable. Open a new preview from the solid modeler.');
 const value=JSON.parse(raw);
 if(value?.schema!==SOLID_PREVIEW_KEY||!Number.isFinite(value.at)||now-value.at>1800000||value.at>now+10000)throw new Error('Feature snapshot expired. Open a new preview from the solid modeler.');
 if(typeof value.returnTo!=='string'||!/^\.\/solid\.html(?:\?|$)/.test(value.returnTo))throw new Error('Invalid modeler return link.');
 return solidSnapshot(value.spec,value.at,value.returnTo.slice('./solid.html'.length));
}
export async function solidMeshes(payload,spec){
 spec=validateSolidSpec(spec);
 if(payload?.schema!=='hardware-studio-solid-preview-v1'||JSON.stringify(validateSolidSpec(payload.spec))!==JSON.stringify(validateSolidSpec(spec))||!Array.isArray(payload.meshes)||payload.meshes.length!==1)throw new Error('The preview does not match the requested feature model.');
 const entry=payload.meshes[0],report=payload.verification;
 if(needsCurvedRuntime(spec)&&(report?.rebuilt_source?.matched!==true||!Number.isFinite(report.rebuilt_source.symmetric_difference_mm3)||report.rebuilt_source.symmetric_difference_mm3<0||!Number.isFinite(report.rebuilt_source.tolerance_mm3)||report.rebuilt_source.tolerance_mm3<=0||report.rebuilt_source.symmetric_difference_mm3>report.rebuilt_source.tolerance_mm3))throw new Error('Curved CAD is missing its STEP/source reconstruction check.');
 if(entry?.name!=='solid.stl'||typeof entry.dataBase64!=='string'||entry.dataBase64.length>22000000||report?.solid_count!==1||!Array.isArray(report.probes)||report.probes.length!==spec.probes.length||report.probes.some((p,i)=>p.id!==spec.probes[i].id||p.expect!==spec.probes[i].expect||p.passed!==true||!Number.isFinite(p.material_fraction)||(p.expect==='material'?p.material_fraction<.999:p.material_fraction>.001)))throw new Error('The solid preview is incomplete or its probes failed.');
 const bytes=Uint8Array.from(atob(entry.dataBase64),c=>c.charCodeAt(0));if(bytes.length>16000000)throw new Error('Preview too large.');
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
 if(hash!==report.sha256?.['solid.stl'])throw new Error('STL hash does not match readback.');
 if(!Number.isFinite(report.volume_mm3)||report.volume_mm3<=0||!Array.isArray(report.outer_span_mm)||report.outer_span_mm.length!==3||report.outer_span_mm.some((n,k)=>!Number.isFinite(n)||Math.abs(n-report.stl_outer_span_mm?.[k])>.03))throw new Error('STEP and STL readback disagree.');
 const mesh=parseStl(bytes.buffer);
 if(mesh.triangles>400000||mesh.triangles!==report.stl_triangles||!Array.isArray(report.stl_outer_span_mm)||report.stl_outer_span_mm.length!==3||report.stl_outer_span_mm.some((n,k)=>!Number.isFinite(n)||Math.abs(n-(mesh.max[k]-mesh.min[k]))>.03))throw new Error('Mesh dimensions or triangles do not match readback.');
 validateMeshReadback(report.stl_check,mesh.triangles,report.volume_mm3);
 return [{...mesh,name:spec.title,cover:false}];
}
