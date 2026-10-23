import test from 'node:test';
import assert from 'node:assert/strict';
import {blankSketch,validateSketch,SketchHistory} from '../sketch-data.js';
import {safeReferenceImage,safeProject,makeProject,STARTERS} from '../core.js';
const stroke={tool:'pen',color:'#14211f',width:5,points:[[20,30],[50,80]]};
test('sketch history restores erased or cleared drawing and discards only the undone branch',()=>{
 const history=new SketchHistory();history.add(stroke);history.add({...stroke,tool:'eraser'});const drawn=history.document;history.clear();assert.equal(history.document.strokes.length,0);history.undo();assert.deepEqual(history.document,drawn);history.redo();assert.equal(history.document.strokes.length,0);history.undo();history.undo();history.add({tool:'text',color:'#61733f',text:'USB input',x:30,y:40});assert.equal(history.canRedo,false);assert.equal(history.document.strokes[1].text,'USB input');
 const copy=history.document;copy.strokes[0].points[0][0]=99;assert.equal(history.document.strokes[0].points[0][0],20);
});
test('sketch imports reject nonfinite geometry and oversized records without changing the last valid drawing',()=>{
 const history=new SketchHistory();history.add(stroke);assert.throws(()=>history.add({...stroke,points:[[NaN,2]]}),/coordinates/);assert.equal(history.document.strokes.length,1);
 assert.throws(()=>history.add({...stroke,points:Array.from({length:8000},()=>[1,2])}),/8,000/);
 const invalid=blankSketch();invalid.strokes=[{...stroke,color:'url(https://outside.example)'}];assert.throws(()=>validateSketch(invalid),/color/);
});
test('editable sketch survives reference and project JSON import',()=>{
 const sketch=blankSketch();sketch.strokes=[stroke];const reference={name:'sketch.jpg',dataUrl:'data:image/jpeg;base64,/9j/AAAA',sketch};
 const safe=safeReferenceImage(reference);assert.deepEqual(safe.sketch,sketch);
 const p=makeProject(STARTERS[0]);p.referenceImage=reference;const imported=safeProject(JSON.parse(JSON.stringify(p)));assert.deepEqual(imported.referenceImage.sketch,sketch);
});
