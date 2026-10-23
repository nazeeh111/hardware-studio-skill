import { validateTraySpec } from './tray-spec.js?v=4';
import { parseStl } from './stl.js?v=1';
export const PREVIEW_KEY = 'hardware-studio-cad-preview-v1';
const LIFETIME = 30 * 60 * 1000;
export function previewSnapshot(spec, query = '', now = Date.now()) {
  const params = new URLSearchParams(query), back = new URLSearchParams();
  for(const name of ['project','title']) if(params.has(name)) back.set(name,params.get(name).slice(0,100));
  return { schema:PREVIEW_KEY, at:now, spec:validateTraySpec(spec), returnTo:'./tray.html'+(back.size?'?'+back:'') };
}
export function readPreviewSnapshot(raw, now = Date.now()) {
  if(typeof raw!=='string'||raw.length>65536)throw new Error('The tray snapshot is unavailable. Return to the workbench and open a new preview.');
  const record=JSON.parse(raw);
  if(record?.schema!==PREVIEW_KEY||!Number.isFinite(record.at)||now-record.at>LIFETIME||record.at>now+10000)throw new Error('This tray snapshot expired. Return to the workbench and open a new preview.');
  const result=previewSnapshot(record.spec,'',record.at);
  if(typeof record.returnTo==='string' && /^\.\/tray\.html(?:\?[^#]*)?$/.test(record.returnTo)) result.returnTo=previewSnapshot(record.spec,record.returnTo.split('?')[1]||'',record.at).returnTo;
  return result;
}
export async function previewMeshes(payload, expectedSpec) {
  if(payload?.schema!=='hardware-studio-cad-preview-v1'||!Array.isArray(payload.meshes)||payload.meshes.length!==(expectedSpec.lid?2:1))throw new Error('The local server returned an invalid CAD preview.');
  if(JSON.stringify(validateTraySpec(payload.spec))!==JSON.stringify(validateTraySpec(expectedSpec)))throw new Error('The returned geometry does not match the requested tray specification.');
  const next=[];let total=0;
  for(let i=0;i<payload.meshes.length;i++) {
    const entry=payload.meshes[i],name=i===0?'tray.stl':'lid.stl',report=i===0?payload.verification:payload.verification?.lid;
    if(entry?.name!==name||typeof entry.dataBase64!=='string'||entry.dataBase64.length>22_000_000||!report)throw new Error('The local server returned incomplete mesh data.');
    const decoded=atob(entry.dataBase64),bytes=Uint8Array.from(decoded,c=>c.charCodeAt(0));total+=bytes.length;
    if(total>16_000_000)throw new Error('The generated mesh exceeds the preview size limit.');
    const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
    if(hash!==payload.verification?.sha256?.[name])throw new Error('The generated STL hash does not match its readback report.');
    const mesh=parseStl(bytes.buffer);
    if(mesh.triangles!==report.stl_triangles||!Array.isArray(report.stl_outer_span_mm)||report.stl_outer_span_mm.length!==3||report.stl_outer_span_mm.some((v,k)=>!Number.isFinite(v)||Math.abs((mesh.max[k]-mesh.min[k])-v)>.02))throw new Error('The displayed mesh does not match its readback dimensions or triangle count.');
    next.push({...mesh,name:i===0?expectedSpec.title:'Lift-off cover',cover:i===1});
  }
  if(next.reduce((n,m)=>n+m.triangles,0)>400000)throw new Error('This preview exceeds the triangle limit.');
  return next;
}
