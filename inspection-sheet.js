// Orthographic basis matrices, column-major for WebGL. Screen right × up
// points toward the observer: +Z (top), -Y (front), +X (right).
export const INSPECTION_VIEWS = Object.freeze([
  {name:'TOP',axes:'X → / Y ↑ · looking from +Z',rotation:[1,0,0, 0,1,0, 0,0,1],spanAxes:[0,1]},
  {name:'FRONT',axes:'X → / Z ↑ · looking from −Y',rotation:[1,0,0, 0,0,-1, 0,1,0],spanAxes:[0,2]},
  {name:'RIGHT',axes:'Y → / Z ↑ · looking from +X',rotation:[0,0,1, 1,0,0, 0,1,0],spanAxes:[1,2]}
]);
export function inspectionScene(meshes) {
  const visible=meshes.filter(mesh=>mesh.visible!==false);
  if(!visible.length)throw new Error('Show at least one mesh before exporting an inspection sheet.');
  const min=[0,1,2].map(k=>Math.min(...visible.map(m=>m.min[k]))),max=[0,1,2].map(k=>Math.max(...visible.map(m=>m.max[k])));
  const spans=max.map((v,k)=>v-min[k]);
  if([...min,...max,...spans].some(v=>!Number.isFinite(v))||spans.some(v=>v<0)||Math.max(...spans)<=0)throw new Error('The loaded mesh bounds cannot be projected.');
  return {meshes:visible,min,max,spans,center:max.map((v,k)=>(v+min[k])/2),span:Math.max(...spans)};
}
export async function inspectionManifest(scene,renderPixels=600) {
  const records=[];
  for(const mesh of scene.meshes) {
    // Identify the actual render geometry, not the filename or an unretained STL.
    const bytes=new ArrayBuffer(mesh.data.length*4),view=new DataView(bytes);
    for(let i=0;i<mesh.data.length;i++)view.setFloat32(i*4,mesh.data[i],true);
    const sha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
    records.push({name:mesh.name,triangles:mesh.triangles,bounds:{min:mesh.min,max:mesh.max},geometrySha256:sha256});
  }
  return {schema:'hardware-studio-inspection-sheet-v1',units:'mm (assumed from STL coordinates)',visibleMeshesOnly:true,displayLiftIncluded:false,positions:'original shared mesh positions',projection:'orthographic; no perspective',pixelsPerAssumedMm:renderPixels*.8/scene.span,bounds:{min:scene.min,max:scene.max,spans:scene.spans},views:INSPECTION_VIEWS.map(({name,axes,rotation})=>({name,axes,rotationColumnMajor:rotation})),geometryEncoding:'Float32 little-endian interleaved x,y,z,nx,ny,nz for each rendered vertex',meshes:records,limits:['Rendered mesh surfaces only; hidden cavities may not be visible.','Not a dimensioned engineering drawing or evidence of solid validity, fit, strength, tolerances or physical manufacture.','Pixel scale applies to the original PNG, not a resized or printed image.']};
}
