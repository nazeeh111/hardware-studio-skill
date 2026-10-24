import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validateCurveProfile,arcGeometry,curveProfileBounds,curvePathData} from '../curve-profile.js';
const cases=JSON.parse(fs.readFileSync(new URL('../tools/solid-generator/examples/curve-contract-cases.json',import.meta.url)));
for(const c of cases)test(`curve contract: ${c.name}`,()=>{
 if(c.valid){const original=structuredClone(c);const normalized=validateCurveProfile(c.start,c.segments);assert.deepEqual(c,original);assert.deepEqual(normalized.segments.at(-1).end,normalized.start);assert.notEqual(normalized.start,c.start);}
 else assert.throws(()=>validateCurveProfile(c.start,c.segments));
});
test('arc traversal preserves major arc and reverse winding',()=>{
 const major=arcGeometry([5,0],[-5,0],[0,5]);assert.ok(Math.abs(major.sweep+1.5*Math.PI)<1e-12);assert.deepEqual(major.center,[0,0]);assert.equal(major.radius,5);
 const reverse=arcGeometry([0,5],[-5,0],[5,0]);assert.ok(Math.abs(reverse.sweep-1.5*Math.PI)<1e-12);
});
test('analytic bounds include extrema away from supplied via',()=>{
 const start=[5,0],segments=[{kind:'arc',via:[-3,-4],end:[0,5]},{kind:'line',end:start}];
 const bounds=curveProfileBounds(start,segments);assert.deepEqual(bounds,{min:[-5,-5],max:[5,5]});
 const path=curvePathData(start,segments);assert.match(path,/A 5 5 0 1 0 0 5/);
});
test('nonfinite, null, string and boolean numbers never coerce',()=>{
 for(const value of [NaN,Infinity,-Infinity,null,'1',true])assert.throws(()=>validateCurveProfile([value,0],[{kind:'line',end:[10,0]},{kind:'line',end:[0,0]}]));
});
test('segment count is bounded and raw arc numbers are copied',()=>{
 assert.throws(()=>validateCurveProfile([0,0],[]));assert.throws(()=>validateCurveProfile([0,0],Array(65).fill({kind:'line',end:[0,0]})));
 const c=cases.find(c=>c.name==='D-profile'),n=validateCurveProfile(c.start,c.segments);n.segments[0].via[0]=123;assert.equal(c.segments[0].via[0],5);
});
test('closure snapping occurs only within the Euclidean distance tolerance',()=>{
 const s=[{kind:'line',end:[10,0]},{kind:'line',end:[0,10]},{kind:'line',end:[8e-8,8e-8]}];
 assert.throws(()=>validateCurveProfile([0,0],s),/close/);
});
