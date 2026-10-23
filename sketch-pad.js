import {SketchHistory,validateSketch,blankSketch,SKETCH_WIDTH,SKETCH_HEIGHT} from './sketch-data.js?v=1';
const DRAFT_KEY='hardware-studio-sketch-draft-v1';
export function createSketchPad({onUse}){
 const dialog=document.querySelector('#sketch-dialog'),canvas=document.querySelector('#sketch-canvas'),$=selector=>dialog.querySelector(selector);
 let history=new SketchHistory(),active=null,pointer=null,tool='pen',busy=false,draftKey=DRAFT_KEY+'-brief';
 const note=(message,error=false)=>{$('#sketch-status').textContent=message;$('#sketch-status').classList.toggle('error',error);};
 function paint(target,document,grid=false){
  const ctx=target.getContext('2d');ctx.clearRect(0,0,target.width,target.height);ctx.fillStyle='#fffef8';ctx.fillRect(0,0,target.width,target.height);
  if(grid){ctx.strokeStyle='#e5e9df';ctx.lineWidth=1;ctx.beginPath();for(let x=24;x<target.width;x+=24){ctx.moveTo(x,0);ctx.lineTo(x,target.height);}for(let y=24;y<target.height;y+=24){ctx.moveTo(0,y);ctx.lineTo(target.width,y);}ctx.stroke();}
  for(const stroke of document.strokes){
   ctx.fillStyle=stroke.tool==='eraser'?'#fffef8':stroke.color;ctx.strokeStyle=ctx.fillStyle;
   if(stroke.tool==='text'){ctx.font='20px Arial, sans-serif';ctx.fillText(stroke.text,stroke.x,stroke.y,Math.max(1,SKETCH_WIDTH-stroke.x-8));continue;}
   ctx.lineWidth=stroke.width;ctx.lineCap='round';ctx.lineJoin='round';ctx.beginPath();
   if(stroke.points.length===1){ctx.arc(...stroke.points[0],stroke.width/2,0,Math.PI*2);ctx.fill();}
   else{ctx.moveTo(...stroke.points[0]);for(const p of stroke.points.slice(1))ctx.lineTo(...p);ctx.stroke();}
  }
 }
 function render(){const value=history.document;if(active)value.strokes.push(active);paint(canvas,value,$('#sketch-grid').checked);$('#sketch-undo').disabled=busy||!history.canUndo;$('#sketch-redo').disabled=busy||!history.canRedo;$('#sketch-clear').disabled=busy||!history.document.strokes.length;$('#sketch-use').disabled=busy||!history.document.strokes.length;}
 function persist(){try{sessionStorage.setItem(draftKey,JSON.stringify(history.document));note('Editable draft kept in this tab. Use sketch to attach it to your brief or project.');}catch{note('Tab storage is unavailable. Use sketch before reloading to keep this drawing.',true);}render();}
 function point(event){const box=canvas.getBoundingClientRect();return [Math.max(0,Math.min(SKETCH_WIDTH,(event.clientX-box.left)*SKETCH_WIDTH/box.width)),Math.max(0,Math.min(SKETCH_HEIGHT,(event.clientY-box.top)*SKETCH_HEIGHT/box.height))];}
 function finish(){if(!active)return;const stroke=active;active=null;pointer=null;try{history.add(stroke);persist();}catch(error){note(error.message,true);render();}}
 canvas.addEventListener('pointerdown',event=>{if(busy||pointer!==null||event.button>0)return;event.preventDefault();if(tool==='text'){const p=point(event);addLabel(Math.min(p[0],740),Math.max(p[1],22));return;}canvas.setPointerCapture(event.pointerId);pointer=event.pointerId;active={tool,color:$('#sketch-color').value,width:Number($('#sketch-width').value),points:[point(event)]};render();});
 canvas.addEventListener('pointermove',event=>{if(event.pointerId!==pointer||!active)return;const p=point(event),last=active.points.at(-1);if(Math.hypot(p[0]-last[0],p[1]-last[1])<1)return;const count=history.document.strokes.reduce((n,s)=>n+(s.points?.length||0),0);if(count+active.points.length>=8000){note('Point limit reached. Finish this stroke, then undo or clear to continue.',true);return;}active.points.push(p);render();});
 for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,event=>{if(event.pointerId===pointer)finish();});
 function chooseTool(next){tool=next;for(const[id,value]of [['sketch-pen','pen'],['sketch-eraser','eraser'],['sketch-label-tool','text']])$('#'+id).setAttribute('aria-pressed',String(tool===value));canvas.style.cursor=next==='text'?'crosshair':'default';}
 $('#sketch-pen').addEventListener('click',()=>chooseTool('pen'));$('#sketch-eraser').addEventListener('click',()=>chooseTool('eraser'));$('#sketch-label-tool').addEventListener('click',()=>{chooseTool('text');note('Tap the drawing to place your label. Or use Add at top left.');});
 for(const [id,action]of [['sketch-undo','undo'],['sketch-redo','redo'],['sketch-clear','clear']])$('#'+id).addEventListener('click',()=>{finish();history[action]();persist();});
 $('#sketch-grid').addEventListener('change',render);
 function addLabel(x,y){if(busy)return;finish();try{history.add({tool:'text',color:$('#sketch-color').value,text:$('#sketch-label').value,x,y});$('#sketch-label').value='';persist();}catch(error){note(error.message,true);}}
 $('#sketch-add-label').addEventListener('click',()=>addLabel(28,36+history.document.strokes.filter(s=>s.tool==='text').length*28%392));
 function close(){if(busy)return;finish();dialog.close();}
 $('#sketch-close').addEventListener('click',close);$('#sketch-cancel').addEventListener('click',close);
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 dialog.addEventListener('keydown',event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'&&!event.target.matches('input,textarea,select')){event.preventDefault();finish();history[event.shiftKey?'redo':'undo']();persist();}});
 $('#sketch-use').addEventListener('click',async()=>{
  if(busy)return;finish();busy=true;render();
  try{const sketch=validateSketch(history.document),output=document.createElement('canvas');output.width=SKETCH_WIDTH;output.height=SKETCH_HEIGHT;paint(output,sketch);let dataUrl='';for(const quality of [.85,.7,.5,.3]){dataUrl=output.toDataURL('image/jpeg',quality);if(dataUrl.length<=250000)break;}if(dataUrl.length>250000)throw new Error('This sketch is too detailed for the reference limit. Simplify it and try again.');
   const saved=await onUse({name:'hardware-sketch.jpg',dataUrl,sketch});if(saved!==false){dialog.close();if(!saved?.keepDraft)try{sessionStorage.removeItem(draftKey);}catch{}}
  }catch(error){note(error.message||'Could not attach this sketch.',true);}finally{busy=false;render();}
 });
 return {open(sketch,context='brief'){if(busy)return;draftKey=DRAFT_KEY+'-'+String(context).slice(0,80);let initial=sketch,restored=false;try{const raw=sessionStorage.getItem(draftKey);if(raw&&raw.length<=200000){initial=validateSketch(JSON.parse(raw));restored=true;}}catch{ /* Preserve the supplied source if the unfinished draft is unreadable. */ }history=new SketchHistory(initial||blankSketch());active=null;pointer=null;chooseTool('pen');note(restored?'Unfinished sketch restored for this brief or project.':'Draw the arrangement. Add labels for functions and intended dimensions; the grid is only a drawing aid.');dialog.showModal();render();}};
}
