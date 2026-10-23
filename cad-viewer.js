import { parseStl, meshesToGlb, MAX_STL_BYTES } from './stl.js?v=1';
import { PREVIEW_KEY, readPreviewSnapshot, previewMeshes } from './cad-preview.js?v=1';
import { SOLID_PREVIEW_KEY, readSolidSnapshot, solidMeshes } from './solid-preview.js?v=2';
const $ = selector => document.querySelector(selector), canvas = $('#viewport');
const gl = canvas.getContext('webgl', { antialias:true, alpha:true });
let meshes=[], yaw=-.65, pitch=.72, zoom=1, sequence=0, pointers=new Map();
let previewRecord=null,generatedBusy=false;
const palette=[[.53,.67,.35],[.87,.84,.64],[.65,.76,.75],[.77,.51,.34]];
function status(text,error=false){$('#viewer-status').textContent=text;$('#viewer-status').classList.toggle('error',error);}
function shader(type,source){const value=gl.createShader(type);gl.shaderSource(value,source);gl.compileShader(value);if(!gl.getShaderParameter(value,gl.COMPILE_STATUS))throw new Error('Your browser could not prepare the 3D renderer.');return value;}
let program, position, normal, uniforms;
if(gl){
  try{
    program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,'attribute vec3 aPosition;attribute vec3 aNormal;uniform mat3 uRotation;uniform vec3 uCenter;uniform vec3 uOffset;uniform float uScale;uniform float uAspect;varying vec3 vNormal;void main(){vec3 q=uRotation*(aPosition-uCenter+uOffset);gl_Position=vec4(q.x*uScale/uAspect,q.y*uScale,-q.z*uScale*.3,1.0);vNormal=uRotation*aNormal;}'));
    gl.attachShader(program,shader(gl.FRAGMENT_SHADER,'precision mediump float;varying vec3 vNormal;uniform vec3 uColor;void main(){vec3 n=normalize(vNormal);if(!gl_FrontFacing)n=-n;float light=.35+.65*max(dot(n,normalize(vec3(-.4,.7,1.0))),0.0);gl_FragColor=vec4(uColor*light,1.0);}'));
    gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('Your browser could not link the 3D renderer.');
    position=gl.getAttribLocation(program,'aPosition');normal=gl.getAttribLocation(program,'aNormal');uniforms=Object.fromEntries(['Rotation','Center','Offset','Scale','Aspect','Color'].map(n=>[n,gl.getUniformLocation(program,`u${n}`)]));
    gl.enable(gl.DEPTH_TEST);gl.clearColor(0,0,0,0);
  }catch(error){program=null;status(error.message,true);}
}else status('WebGL is unavailable. Enable browser graphics acceleration or use a desktop CAD viewer.',true);
function draw(){
  if(!gl||!program)return;
  const ratio=Math.min(devicePixelRatio||1,2),width=Math.round(canvas.clientWidth*ratio),height=Math.round(canvas.clientHeight*ratio);
  if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
  gl.viewport(0,0,width,height);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);if(!meshes.length)return;
  const min=[0,1,2].map(k=>Math.min(...meshes.map(m=>m.min[k]))),max=[0,1,2].map(k=>Math.max(...meshes.map(m=>m.max[k])));
  const span=Math.max(...max.map((v,k)=>v-min[k])),center=max.map((v,k)=>(v+min[k])/2),c=Math.cos(yaw),s=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
  const lift=$('#explode').checked?span*.35:0;
  center[2]+=lift*.45;
  gl.useProgram(program);gl.uniformMatrix3fv(uniforms.Rotation,false,new Float32Array([c,sp*s,-cp*s,-s,sp*c,-cp*c,0,cp,sp]));
  gl.uniform3fv(uniforms.Center,center);gl.uniform1f(uniforms.Scale,1.25*zoom/Math.max(span,1e-6)*Math.min(1,width/height));gl.uniform1f(uniforms.Aspect,width/height);
  gl.enableVertexAttribArray(position);gl.enableVertexAttribArray(normal);
  for(const mesh of meshes){if(!mesh.visible)continue;gl.bindBuffer(gl.ARRAY_BUFFER,mesh.buffer);gl.vertexAttribPointer(position,3,gl.FLOAT,false,24,0);gl.vertexAttribPointer(normal,3,gl.FLOAT,false,24,12);gl.uniform3fv(uniforms.Color,mesh.color);gl.uniform3fv(uniforms.Offset,[0,0,mesh.cover?lift:0]);gl.drawArrays(gl.TRIANGLES,0,mesh.triangles*3);}
}
function reset(){yaw=-.65;pitch=.72;zoom=1;draw();}
function controls(){
  const list=$('#mesh-list');list.replaceChildren();
  for(const mesh of meshes){const row=document.createElement('div');row.className='mesh-row';const label=document.createElement('label'),check=document.createElement('input'),color=document.createElement('span'),name=document.createElement('span'),detail=document.createElement('small');check.type='checkbox';check.checked=mesh.visible;check.addEventListener('change',()=>{mesh.visible=check.checked;$('#export-glb').disabled=!meshes.some(m=>m.visible);draw();});color.className='mesh-color';color.style.background=`rgb(${mesh.color.map(n=>Math.round(n*255)).join(',')})`;name.textContent=mesh.name;detail.textContent=`${mesh.max.map((n,k)=>(n-mesh.min[k]).toFixed(2)).join(' × ')} mm · ${mesh.triangles.toLocaleString()} triangles`;label.append(check,color,name);row.append(label,detail);list.append(row);}
  $('#empty-view').hidden=meshes.length>0;$('#export-glb').disabled=!meshes.length;$('#explode').disabled=!meshes.some(m=>m.cover);$('#explode').closest('label').hidden=!meshes.some(m=>m.cover);$('#explode').checked=false;$('#glb-note').textContent='GLB uses meters and a Y-up scene. It preserves original mesh positions. '+(meshes.some(m=>m.cover)?'The lifted display offset is excluded. ':'')+'Mesh dimensions do not establish fit or manufacturing quality.';reset();
}
function replaceMeshes(next){for(const mesh of meshes)gl.deleteBuffer(mesh.buffer);meshes=next.map((mesh,i)=>{const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,mesh.data,gl.STATIC_DRAW);return {...mesh,buffer,color:palette[i],visible:true};});controls();status(`${meshes.length} ${meshes.length===1?'mesh':'meshes'} · ${meshes.reduce((n,m)=>n+m.triangles,0).toLocaleString()} triangles. Original positions retained.`);}
async function loadExample(){
  leaveGeneratedMode();
  const token=++sequence;if(!gl||!program)return;status('Loading the worked tray and cover…');
  try{const next=await Promise.all(['tray','lid'].map(async(name)=>{const response=await fetch(`./examples/pico-neopixel-tray/generated/window-cover-v1/${name}.stl`);if(!response.ok)throw new Error('The example could not be loaded. Try again or choose a local STL.');return {...parseStl(await response.arrayBuffer()),name:name==='lid'?'Window cover':'Pico prototype tray',cover:name==='lid'};}));if(token===sequence)replaceMeshes(next);}catch(error){if(token===sequence)status(error.message,true);}
}
$('#load-example').addEventListener('click',loadExample);
$('#choose-mesh').addEventListener('click',()=>$('#mesh-files').click());
$('#mesh-files').addEventListener('change',async event=>{
  const files=[...event.target.files];event.target.value='';if(!files.length||!gl||!program)return;const token=++sequence;status('Reading selected STL geometry…');
  leaveGeneratedMode();
  try{if(files.length>4)throw new Error('Choose at most four STL files.');if(files.some(f=>f.size>MAX_STL_BYTES||!f.name.toLowerCase().endsWith('.stl')))throw new Error('Choose STL files smaller than 32 MB each.');const next=[];let triangles=0;for(const file of files){const mesh=parseStl(await file.arrayBuffer());triangles+=mesh.triangles;if(triangles>400000)throw new Error('Use at most 400,000 triangles across all files.');next.push({...mesh,name:file.name.slice(0,120),cover:false});}if(token===sequence)replaceMeshes(next);}catch(error){if(token===sequence)status(error.message,true);}
});
$('#export-glb').addEventListener('click',()=>{try{const blob=new Blob([meshesToGlb(meshes.filter(m=>m.visible))],{type:'model/gltf-binary'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='hardware-studio-assembly.glb';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('GLB downloaded in meters, at original positions. The display lift is excluded.');}catch(error){status(error.message,true);}});
$('#reset-view').addEventListener('click',reset);$('#top-view').addEventListener('click',()=>{yaw=0;pitch=Math.PI/2;draw();});$('#front-view').addEventListener('click',()=>{yaw=0;pitch=0;draw();});$('#explode').addEventListener('change',draw);
function scale(factor){zoom=Math.max(.2,Math.min(6,zoom*factor));draw();}$('#zoom-in').addEventListener('click',()=>scale(1.2));$('#zoom-out').addEventListener('click',()=>scale(1/1.2));
canvas.addEventListener('wheel',event=>{event.preventDefault();scale(Math.exp(-event.deltaY*.001));},{passive:false});
canvas.addEventListener('pointerdown',event=>{canvas.focus();canvas.setPointerCapture(event.pointerId);pointers.set(event.pointerId,[event.clientX,event.clientY]);});
canvas.addEventListener('pointermove',event=>{const previous=pointers.get(event.pointerId);if(!previous)return;const points=[...pointers.values()],oldDistance=points.length===2?Math.hypot(points[0][0]-points[1][0],points[0][1]-points[1][1]):0;pointers.set(event.pointerId,[event.clientX,event.clientY]);if(points.length===2){const next=[...pointers.values()],distance=Math.hypot(next[0][0]-next[1][0],next[0][1]-next[1][1]);if(oldDistance>0)scale(distance/oldDistance);}else{yaw+=(event.clientX-previous[0])*.008;pitch=Math.max(-1.5,Math.min(1.5,pitch+(event.clientY-previous[1])*.008));draw();}});
for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,event=>pointers.delete(event.pointerId));
canvas.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','+','=','-'].includes(event.key))return;event.preventDefault();if(event.key==='Home')return reset();if(['+','='].includes(event.key))return scale(1.2);if(event.key==='-')return scale(1/1.2);yaw+=event.key==='ArrowLeft'?-.15:event.key==='ArrowRight'?.15:0;pitch=Math.max(-1.5,Math.min(1.5,pitch+(event.key==='ArrowUp'?-.15:event.key==='ArrowDown'?.15:0)));draw();});
canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();status('The graphics context was lost. Reload this page to restore the viewer; your files are unchanged.',true);$('#export-glb').disabled=true;});
new ResizeObserver(draw).observe(canvas);draw();

function leaveGeneratedMode(){
  previewRecord=null;$('#generated-controls').hidden=true;$('#geometry-inputs').open=true;document.querySelector('.viewer-tools').insertBefore($('#geometry-inputs'),$('#viewer-status'));document.querySelector('.viewer-tools h2').textContent='A closer look.';document.querySelector('.viewer-tools>.eyebrow').textContent='01 / LOAD GEOMETRY';
  const url=new URL(location.href);if(url.searchParams.has('generated')){url.searchParams.delete('generated');history.replaceState(null,'',url);}
}
function generatedButtons(){ $('#retry-generated').disabled=generatedBusy;$('#download-generated').disabled=generatedBusy||!previewRecord||!meshes.length; }
async function generatePreview(){
  if(!previewRecord||generatedBusy||!gl||!program)return;
  const record=previewRecord,token=++sequence;generatedBusy=true;generatedButtons();
  status('Generating fresh STEP/STL and reopening the exports locally…');
  $('#generated-status').textContent=`Frozen model: ${record.spec.title}. This preview uses the workbench dimensions captured when you opened it.`;
  try {
    const response=await fetch(record.schema===SOLID_PREVIEW_KEY?'./api/solid-preview':'./api/tray-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(record.spec),signal:AbortSignal.timeout(130000)});
    if(!response.ok){let message='The local CAD service could not generate the preview.';try{message=(await response.json()).error||message;}catch{}throw new Error(message);}
    const next=await (record.schema===SOLID_PREVIEW_KEY?solidMeshes:previewMeshes)(await response.json(),record.spec);
    if(token!==sequence||previewRecord!==record)return;
    replaceMeshes(next);
    $('#generated-status').textContent='Readback matched: STL hash, triangle count and dimensions. Physical fit remains untested.';
  }catch(error){if(token===sequence&&previewRecord===record){status(error.name==='TimeoutError'?'Preview timed out. Check the local server before retrying.':error.message,true);$('#generated-status').textContent='Preview unavailable. Return to the workbench or retry with the same frozen dimensions.';}}
  finally{generatedBusy=false;generatedButtons();}
}
$('#retry-generated').addEventListener('click',generatePreview);
$('#download-generated').addEventListener('click',async()=>{
  if(!previewRecord||generatedBusy)return;
  const record=previewRecord;generatedBusy=true;generatedButtons();
  $('#generated-status').textContent='Regenerating a CAD ZIP from these frozen dimensions…';
  try{
    const response=await fetch(record.schema===SOLID_PREVIEW_KEY?'./api/solid':'./api/tray',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(record.spec),signal:AbortSignal.timeout(130000)});
    if(!response.ok){let detail='CAD ZIP generation failed.';try{detail=(await response.json()).error||detail;}catch{}throw new Error(detail);}
    if(!response.headers.get('Content-Type')?.startsWith('application/zip'))throw new Error('The local service did not return a CAD ZIP.');
    const blob=await response.blob();if(previewRecord!==record)return;
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='hardware-studio-generated-cad.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
    $('#generated-status').textContent='CAD ZIP downloaded from the same frozen specification. Inspect its verification report before use.';
  }catch(error){if(previewRecord===record)$('#generated-status').textContent=error.name==='TimeoutError'?'CAD ZIP timed out. Check the local server.':error.message;}
  finally{generatedBusy=false;generatedButtons();}
});
const generatedMode=new URL(location.href).searchParams.get('generated');
if(generatedMode==='1'||generatedMode==='solid'){
  if(generatedMode==='solid'){document.querySelector('.back').href='./solid.html';document.querySelector('.back').textContent='SOLID MODELER ↗';}
  try{previewRecord=generatedMode==='solid'?readSolidSnapshot(sessionStorage.getItem(SOLID_PREVIEW_KEY)):readPreviewSnapshot(sessionStorage.getItem(PREVIEW_KEY));document.querySelector('.back').href=previewRecord.returnTo;if(generatedMode==='solid')document.querySelector('.back').textContent='SOLID MODELER ↗';$('#generated-controls').hidden=false;$('#geometry-inputs').open=false;document.querySelector('.viewer-tools').append($('#geometry-inputs'));document.querySelector('.viewer-tools h2').textContent='Generated model.';document.querySelector('.viewer-tools>.eyebrow').textContent='01 / MODEL OUTPUT';void generatePreview();}
  catch(error){status(error.message,true);}
}
