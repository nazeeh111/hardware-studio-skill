// Synthetic verifier declarations for client contract tests only. These do not
// assert that the historical test mesh received the newer CAD kernel checks.
export function mockMeshReadback(triangles,volume){
 return {passed:true,stl_triangles:triangles,boundary_components:1,step_boundary_shells:1,closed_oriented_topology:true,vertex_weld_tolerance_mm:.0002,signed_volume_mm3:volume,step_volume_mm3:volume,step_boundary_area_mm2:100,volume_difference_mm3:0,volume_tolerance_mm3:4.05,checked_triangle_centers:triangles,maximum_center_distance_mm:0,maximum_center_triangle:0,center_tolerance_mm:.0405,step_faces_checked:2,step_surface_witnesses:[0,1].map(face=>({face,kind:'trimmed-face interior parameter sample',point_mm:[0,0,face],distance_mm:0})),maximum_face_witness_distance_mm:0};
}
