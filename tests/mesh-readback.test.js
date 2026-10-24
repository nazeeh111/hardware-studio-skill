import test from 'node:test';
import assert from 'node:assert/strict';
import {validateMeshReadback} from '../mesh-readback.js';
import {mockMeshReadback} from './fixtures/mock-mesh-readback.js';

test('sampled report binds exact triangle counts, fixed tolerances and reopened STEP volume without mutation',()=>{
 const report=mockMeshReadback(12,80),before=structuredClone(report);assert.equal(validateMeshReadback(report,12,80),report);assert.deepEqual(report,before);
 const boundary=mockMeshReadback(12,80);boundary.maximum_center_distance_mm=.0405;boundary.step_surface_witnesses[0].distance_mm=.0405;boundary.maximum_face_witness_distance_mm=.0405;assert.doesNotThrow(()=>validateMeshReadback(boundary,12,80));
 const fallback=mockMeshReadback(12,80);fallback.step_surface_witnesses[1].kind='trimmed-face boundary vertex fallback';assert.doesNotThrow(()=>validateMeshReadback(fallback,12,80));
});

test('old or weakened topology, partial sampling and adjustable tolerance declarations reject',()=>{
 assert.throws(()=>validateMeshReadback(undefined,12,80));
 for(const change of [r=>delete r.passed,r=>r.passed=false,r=>r.closed_oriented_topology=false,r=>r.closed_oriented_topology='true',r=>r.stl_triangles=13,r=>r.checked_triangle_centers=11,r=>r.checked_triangle_centers='12',r=>r.vertex_weld_tolerance_mm=.001,r=>r.center_tolerance_mm=.1,r=>r.boundary_components=0,r=>r.step_boundary_shells=2,r=>r.maximum_center_triangle=12,r=>r.maximum_center_triangle=-1,r=>r.maximum_center_distance_mm=.04050001,r=>r.maximum_center_distance_mm=-1,r=>r.maximum_center_distance_mm=Infinity,r=>delete r.maximum_center_distance_mm]){const r=mockMeshReadback(12,80);change(r);assert.throws(()=>validateMeshReadback(r,12,80));}
 for(const count of [0,3,12.5,400001,'12'])assert.throws(()=>validateMeshReadback(mockMeshReadback(count,80),count,80));
});

test('finite volume difference and fixed area-derived allowance must match the supplied STEP volume',()=>{
 for(const change of [r=>r.step_volume_mm3=81,r=>r.signed_volume_mm3=90,r=>r.volume_difference_mm3=-1,r=>r.volume_difference_mm3=NaN,r=>r.volume_tolerance_mm3=Infinity,r=>r.volume_tolerance_mm3=400,r=>r.volume_tolerance_mm3=0,r=>delete r.step_boundary_area_mm2,r=>r.step_boundary_area_mm2=-1,r=>r.step_boundary_area_mm2='100',r=>{r.signed_volume_mm3=90;r.volume_difference_mm3=10;}]){const r=mockMeshReadback(12,80);change(r);assert.throws(()=>validateMeshReadback(r,12,80));}
 const lowArea=mockMeshReadback(12,80);lowArea.step_boundary_area_mm2=.001;lowArea.volume_tolerance_mm3=.01;lowArea.signed_volume_mm3=80.005;lowArea.volume_difference_mm3=.005;assert.doesNotThrow(()=>validateMeshReadback(lowArea,12,80));
 for(const expected of [0,-80,Infinity,'80'])assert.throws(()=>validateMeshReadback(mockMeshReadback(12,80),12,expected));
});

test('surface witnesses cover each STEP face, use bounded exact points and agree on their maximum distance',()=>{
 for(const change of [r=>delete r.step_surface_witnesses,r=>r.step_surface_witnesses=[],r=>r.step_faces_checked=3,r=>r.step_surface_witnesses[1].face=0,r=>r.step_surface_witnesses[1].face=2,r=>r.step_surface_witnesses[1].face=.5,r=>r.step_surface_witnesses[1].kind='random bounding box sample',r=>r.step_surface_witnesses[1].point_mm=[0,1],r=>r.step_surface_witnesses[1].point_mm[0]=Infinity,r=>r.step_surface_witnesses[1].point_mm[0]=4001,r=>r.step_surface_witnesses[1].distance_mm=-.01,r=>r.step_surface_witnesses[1].distance_mm=.05,r=>r.maximum_face_witness_distance_mm=.02,r=>r.step_surface_witnesses[0].distance_mm=.02,r=>{r.step_surface_witnesses[0].kind='trimmed-face boundary vertex fallback';r.step_surface_witnesses.push(structuredClone(r.step_surface_witnesses[0]));},r=>{for(let i=0;i<3;i++)r.step_surface_witnesses.push(structuredClone(r.step_surface_witnesses[0]));}]){const r=mockMeshReadback(12,80);change(r);assert.throws(()=>validateMeshReadback(r,12,80));}
});
