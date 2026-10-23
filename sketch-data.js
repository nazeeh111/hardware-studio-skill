export const SKETCH_WIDTH=768, SKETCH_HEIGHT=480;
export const SKETCH_COLORS=['#14211f','#9a5f42','#61733f'];
export function validateSketch(value){
 if(!value||value.schema!=='hardware-studio-sketch-v1'||value.width!==SKETCH_WIDTH||value.height!==SKETCH_HEIGHT||!Array.isArray(value.strokes)||value.strokes.length>300)throw new Error('This sketch has an unsupported format or too many strokes.');
 let points=0;
 const coordinate=(n,max)=>{if(typeof n!=='number'||!Number.isFinite(n)||n<0||n>max)throw new Error('Sketch coordinates are invalid.');return Math.round(n*10)/10;};
 const strokes=value.strokes.map(stroke=>{
  if(!stroke||!SKETCH_COLORS.includes(stroke.color))throw new Error('Sketch color is invalid.');
  if(stroke.tool==='text'){
   if(typeof stroke.text!=='string'||!stroke.text.trim()||stroke.text.length>80||/[\r\n]/.test(stroke.text))throw new Error('Use a label of at most 80 characters.');
   return {tool:'text',color:stroke.color,text:stroke.text.trim(),x:coordinate(stroke.x,SKETCH_WIDTH),y:coordinate(stroke.y,SKETCH_HEIGHT)};
  }
  if(!['pen','eraser'].includes(stroke.tool)||![2,5,10,20].includes(stroke.width)||!Array.isArray(stroke.points)||!stroke.points.length)throw new Error('Sketch stroke is invalid.');
  points+=stroke.points.length;if(points>8000)throw new Error('The sketch has reached 8,000 points. Undo or clear before drawing more.');
  return {tool:stroke.tool,color:stroke.color,width:stroke.width,points:stroke.points.map(p=>{if(!Array.isArray(p)||p.length!==2)throw new Error('Sketch point is invalid.');return [coordinate(p[0],SKETCH_WIDTH),coordinate(p[1],SKETCH_HEIGHT)];})};
 });
 return {schema:'hardware-studio-sketch-v1',width:SKETCH_WIDTH,height:SKETCH_HEIGHT,strokes};
}
export const blankSketch=()=>({schema:'hardware-studio-sketch-v1',width:SKETCH_WIDTH,height:SKETCH_HEIGHT,strokes:[]});
export class SketchHistory{
 constructor(document=blankSketch()){this.states=[validateSketch(document)];this.cursor=0;}
 get document(){return structuredClone(this.states[this.cursor]);}
 get canUndo(){return this.cursor>0;}
 get canRedo(){return this.cursor<this.states.length-1;}
 commit(document){const next=validateSketch(document);this.states=this.states.slice(0,this.cursor+1);this.states.push(next);if(this.states.length>50)this.states.shift();this.cursor=this.states.length-1;}
 add(stroke){const next=this.document;next.strokes.push(stroke);this.commit(next);}
 clear(){if(this.states[this.cursor].strokes.length)this.commit(blankSketch());}
 undo(){if(this.canUndo)this.cursor--;}
 redo(){if(this.canRedo)this.cursor++;}
}
