// Validate the local CAD verifier's declared sampled mesh/STEP checks.
// This does not recompute topology or analytic surface distance in the browser.
const CENTER_MM=.0405,WELD_MM=.0002;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const nonnegative=n=>finite(n)&&n>=0;
const positive=n=>finite(n)&&n>0;
const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const close=(a,b)=>Math.abs(a-b)<=1e-9*Math.max(1,Math.abs(a),Math.abs(b));
const fail=()=>{throw new Error('Mesh/STEP sampled readback is missing, incomplete or inconsistent.');};
export function validateMeshReadback(report,triangles,stepVolume){
 if(!report||report.passed!==true||report.closed_oriented_topology!==true||!integer(triangles,4,400000)||report.stl_triangles!==triangles||report.checked_triangle_centers!==triangles||report.vertex_weld_tolerance_mm!==WELD_MM||report.center_tolerance_mm!==CENTER_MM)fail();
 if(!integer(report.boundary_components,1,triangles)||report.step_boundary_shells!==report.boundary_components||!integer(report.maximum_center_triangle,0,triangles-1)||!nonnegative(report.maximum_center_distance_mm)||report.maximum_center_distance_mm>CENTER_MM)fail();
 const {signed_volume_mm3:meshVolume,step_volume_mm3:volume,volume_difference_mm3:difference,volume_tolerance_mm3:allowance,step_boundary_area_mm2:area}=report;
 if(!positive(stepVolume)||!positive(meshVolume)||!positive(volume)||!positive(area)||!nonnegative(difference)||!positive(allowance)||!close(volume,stepVolume)||!close(difference,Math.abs(meshVolume-volume))||!close(allowance,Math.max(.01,area*CENTER_MM))||difference>allowance)fail();
 const faces=report.step_faces_checked,witnesses=report.step_surface_witnesses;
 if(!integer(faces,1,400000)||!Array.isArray(witnesses)||witnesses.length<faces||witnesses.length>faces*3||!nonnegative(report.maximum_face_witness_distance_mm)||report.maximum_face_witness_distance_mm>CENTER_MM)fail();
 const coverage=new Map();let maximum=0;
 for(const witness of witnesses){
  if(!witness||!integer(witness.face,0,faces-1)||!['trimmed-face interior parameter sample','trimmed-face boundary vertex fallback'].includes(witness.kind)||!Array.isArray(witness.point_mm)||witness.point_mm.length!==3||witness.point_mm.some(n=>!finite(n)||Math.abs(n)>4000)||!nonnegative(witness.distance_mm)||witness.distance_mm>CENTER_MM)fail();
  const record=coverage.get(witness.face)||{count:0,fallback:false};record.count++;record.fallback ||= witness.kind==='trimmed-face boundary vertex fallback';if(record.count>3||record.fallback&&record.count!==1)fail();coverage.set(witness.face,record);maximum=Math.max(maximum,witness.distance_mm);
 }
 if(coverage.size!==faces||!close(maximum,report.maximum_face_witness_distance_mm))fail();
 return report;
}
