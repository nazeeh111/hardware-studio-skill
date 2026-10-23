import {ASSEMBLY_PREVIEW_KEY,readAssemblySnapshot,assemblyMeshes,assemblyReadbackText} from './assembly-preview.js?v=1';
import { installVisionPanel } from './vision-panel.js?v=3';
import { INSPECTION_VIEWS, inspectionScene, inspectionManifest } from './inspection-sheet.js?v=2';
import { createZip } from './zip.js?v=1';
import { parseStl, meshesToGlb, MAX_STL_BYTES } from './stl.js?v=1';
import { PREVIEW_KEY, readPreviewSnapshot, previewMeshes } from './cad-preview.js?v=1';
import { SOLID_PREVIEW_KEY, readSolidSnapshot, solidMeshes } from './solid-preview.js?v=4';
const $ = selector => document.querySelector(selector), canvas = $('#viewport');
const gl = canvas.getContext('webgl', { antialias:true, alpha:true });
let meshes=[], yaw=-.65, pitch=.72, zoom=1, sequence=0, geometryRevision=0, pointers=new Map();
let previewRecord=null,generatedBusy=false,sheetBusy=false,visionPanel=null;
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
function renderGeometry(width,height,scene,rotation,scale,lift=0){
  gl.viewport(0,0,width,height);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
  gl.useProgram(program);gl.uniformMatrix3fv(uniforms.Rotation,false,new Float32Array(rotation));
  gl.uniform3fv(uniforms.Center,scene.center);gl.uniform1f(uniforms.Scale,scale);gl.uniform1f(uniforms.Aspect,width/height);
  gl.enableVertexAttribArray(position);gl.enableVertexAttribArray(normal);
  for(const mesh of scene.meshes){if(!mesh.visible)continue;gl.bindBuffer(gl.ARRAY_BUFFER,mesh.buffer);gl.vertexAttribPointer(position,3,gl.FLOAT,false,24,0);gl.vertexAttribPointer(normal,3,gl.FLOAT,false,24,12);gl.uniform3fv(uniforms.Color,mesh.color);gl.uniform3fv(uniforms.Offset,[0,0,mesh.cover?lift:0]);gl.drawArrays(gl.TRIANGLES,0,mesh.triangles*3);}
}
function draw(){
  if(!gl||!program)return;
  const ratio=Math.min(devicePixelRatio||1,2),width=Math.round(canvas.clientWidth*ratio),height=Math.round(canvas.clientHeight*ratio);
  if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
  if(!meshes.length){gl.viewport(0,0,width,height);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);return;}
  const min=[0,1,2].map(k=>Math.min(...meshes.map(m=>m.min[k]))),max=[0,1,2].map(k=>Math.max(...meshes.map(m=>m.max[k])));
  const span=Math.max(...max.map((v,k)=>v-min[k])),center=max.map((v,k)=>(v+min[k])/2),c=Math.cos(yaw),s=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
  const lift=$('#explode').checked?span*.35:0;
  center[2]+=lift*.45;
  renderGeometry(width,height,{meshes,center},[c,sp*s,-cp*s,-s,sp*c,-cp*c,0,cp,sp],1.25*zoom/Math.max(span,1e-6)*Math.min(1,width/height),lift);
}
function reset(){yaw=-.65;pitch=.72;zoom=1;draw();}
function controls(){
  const list=$('#mesh-list');list.replaceChildren();
  for(const mesh of meshes){const row=document.createElement('div');row.className='mesh-row';const label=document.createElement('label'),check=document.createElement('input'),color=document.createElement('span'),name=document.createElement('span'),detail=document.createElement('small');check.type='checkbox';check.checked=mesh.visible;check.addEventListener('change',()=>{mesh.visible=check.checked;$('#export-glb').disabled=!meshes.some(m=>m.visible);$('#export-sheet').disabled=sheetBusy||!meshes.some(m=>m.visible);geometryRevision++;visionPanel?.geometryChanged();draw();});color.className='mesh-color';color.style.background=`rgb(${mesh.color.map(n=>Math.round(n*255)).join(',')})`;name.textContent=mesh.name;detail.textContent=`${mesh.max.map((n,k)=>(n-mesh.min[k]).toFixed(2)).join(' × ')} mm · ${mesh.triangles.toLocaleString()} triangles`;label.append(check,color,name);row.append(label,detail);list.append(row);}
  $('#empty-view').hidden=meshes.length>0;$('#export-glb').disabled=!meshes.length;$('#export-sheet').disabled=sheetBusy||!meshes.length;$('#explode').disabled=!meshes.some(m=>m.cover);$('#explode').closest('label').hidden=!meshes.some(m=>m.cover);$('#explode').checked=false;$('#glb-note').textContent='GLB uses meters and a Y-up scene. It preserves original mesh positions. '+(meshes.some(m=>m.cover)?'The lifted display offset is excluded. ':'')+'Mesh dimensions do not establish fit or manufacturing quality.';reset();
}
function replaceMeshes(next){for(const mesh of meshes)gl.deleteBuffer(mesh.buffer);meshes=next.map((mesh,i)=>{const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,mesh.data,gl.STATIC_DRAW);return {...mesh,buffer,color:palette[i],visible:true};});geometryRevision++;controls();visionPanel?.geometryChanged();status(`${meshes.length} ${meshes.length===1?'mesh':'meshes'} · ${meshes.reduce((n,m)=>n+m.triangles,0).toLocaleString()} triangles. Original positions retained.`);}
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
// Render three real mesh views to a private framebuffer; the interactive view
// is redrawn in finally, including on allocation or PNG failures.
function sheetRaster(scene,rotation,size=600){
  if(gl.isContextLost())throw new Error('Graphics context unavailable. Reload the viewer before exporting.');
  const framebuffer=gl.createFramebuffer(),texture=gl.createTexture(),depth=gl.createRenderbuffer();
  try {
    gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,size,size,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.bindRenderbuffer(gl.RENDERBUFFER,depth);gl.renderbufferStorage(gl.RENDERBUFFER,gl.DEPTH_COMPONENT16,size,size);
    gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);gl.framebufferRenderbuffer(gl.FRAMEBUFFER,gl.DEPTH_ATTACHMENT,gl.RENDERBUFFER,depth);
    if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('Your browser could not allocate the inspection image.');
    renderGeometry(size,size,scene,rotation,1.6/scene.span);
    const pixels=new Uint8Array(size*size*4);gl.readPixels(0,0,size,size,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
    if(gl.isContextLost())throw new Error('Graphics context was lost during export. Reload before trying again.');
    const image=new ImageData(size,size);for(let y=0;y<size;y++)image.data.set(pixels.subarray(y*size*4,(y+1)*size*4),(size-1-y)*size*4);
    const output=document.createElement('canvas');output.width=size;output.height=size;output.getContext('2d').putImageData(image,0,0);return output;
  } finally {gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.deleteFramebuffer(framebuffer);gl.deleteTexture(texture);gl.deleteRenderbuffer(depth);draw();}
}
function sheetText(ctx,text,x,y,maxWidth,lineHeight){
  let line='';for(const word of String(text).split(/\s+/)){const next=line?line+' '+word:word;if(ctx.measureText(next).width>maxWidth&&line){ctx.fillText(line,x,y);y+=lineHeight;line=word;}else line=next;}ctx.fillText(line,x,y);return y+lineHeight;
}
async function captureInspection(){
  if(!gl||!program||gl.isContextLost())throw new Error('Load visible geometry with an available graphics context first.');
  const scene=inspectionScene(meshes),token=geometryRevision,manifest=await inspectionManifest(scene);
  if(token!==geometryRevision||scene.meshes.length!==meshes.filter(m=>m.visible).length||scene.meshes.some(m=>!meshes.includes(m)||!m.visible))throw new Error('Visible geometry changed during capture. Capture the current meshes again.');
    const sheet=document.createElement('canvas');sheet.width=2100;sheet.height=950+scene.meshes.length*96;
    const ctx=sheet.getContext('2d');ctx.fillStyle='#f4f3eb';ctx.fillRect(0,0,sheet.width,sheet.height);
    ctx.fillStyle='#19362b';ctx.fillRect(0,0,sheet.width,143);ctx.fillStyle='#dcef75';ctx.font='500 18px monospace';ctx.fillText('HARDWARE / STUDIO     GEOMETRY INSPECTION',50,44);ctx.fillStyle='#fffef5';ctx.font='500 37px sans-serif';ctx.fillText('Three views. One mesh record.',50,100);
    for(let i=0;i<INSPECTION_VIEWS.length;i++){
      const view=INSPECTION_VIEWS[i],x=50+i*680;
      ctx.fillStyle='#1b382c';ctx.font='bold 20px monospace';ctx.fillText(String(i+1).padStart(2,'0')+' / '+view.name,x,188);
      ctx.fillStyle='#576a55';ctx.font='15px monospace';ctx.fillText(view.axes,x,219);
      ctx.fillStyle='#fffefa';ctx.fillRect(x,245,640,600);ctx.strokeStyle='#c4cebc';ctx.strokeRect(x,245,640,600);
      ctx.drawImage(sheetRaster(scene,view.rotation),x+20,245);
      ctx.fillStyle='#435c44';ctx.font='15px monospace';ctx.fillText(view.spanAxes.map(k=>scene.spans[k].toFixed(2)).join(' × ')+' mm projected bounds',x,875);
    }
    let y=922;
    for(const mesh of manifest.meshes){ctx.fillStyle='#213c2d';ctx.font='bold 16px monospace';y=sheetText(ctx,mesh.name+' / '+mesh.triangles.toLocaleString()+' triangles',50,y,1950,23);ctx.fillStyle='#5b6c55';ctx.font='14px monospace';ctx.fillText('GEOMETRY SHA-256  '+mesh.geometrySha256,50,y);y+=43;}
    ctx.fillStyle='#5b6c55';ctx.font='15px monospace';ctx.fillText('Same pixel scale in all views · original positions · visible meshes only · display lift excluded',50,sheet.height-49);ctx.fillText('STL coordinates assumed mm. Surface views only; no model observations or physical test results included.',50,sheet.height-23);
    const png=await new Promise((resolve,reject)=>sheet.toBlob(blob=>blob?resolve(blob):reject(new Error('PNG encoding failed. Your meshes are unchanged.')),'image/png'));

  const imageBytes=new Uint8Array(await png.arrayBuffer());
  const imageSha256=[...new Uint8Array(await crypto.subtle.digest('SHA-256',imageBytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
  return {imageBytes,imageSha256,manifest,viewerVersion:token};
}
$('#export-sheet').addEventListener('click',async()=>{
  if(sheetBusy||!gl||!program)return;
  sheetBusy=true;$('#export-sheet').disabled=true;status('Preparing top, front and right views of visible meshes…');
  try {
    const {imageBytes,manifest}=await captureInspection();
    const zip=createZip([{name:'inspection.png',data:imageBytes},{name:'inspection.json',data:JSON.stringify(manifest,null,2)+'\n'},{name:'README.txt',data:'Three orthographic views of the visible rendered STL triangles.\nThe accompanying manifest identifies geometry with SHA-256 of Float32 little-endian interleaved x,y,z,nx,ny,nz vertex data after STL parsing. It is not the hash of the original STL file. All views use one pixel scale and original shared positions; hidden meshes and display-only lift are excluded.\nSTL units are assumed millimeters. This is a surface inspection sheet, not a dimensioned drawing, solid validity check, collision check or physical engineering test. This export does not run AI.\n'}]);
    const url=URL.createObjectURL(new Blob([zip],{type:'application/zip'})),link=document.createElement('a');link.href=url;link.download='hardware-studio-inspection.zip';link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
    status('Inspection ZIP downloaded: three-view PNG and geometry identity manifest. This export does not run AI or physical checks.');
  }catch(error){status(error.message||'Inspection export failed. Your meshes are unchanged.',true);}
  finally{sheetBusy=false;$('#export-sheet').disabled=!meshes.some(m=>m.visible)||!gl||gl.isContextLost();}
});
visionPanel=installVisionPanel({capture:captureInspection,viewerVersion:()=>geometryRevision,hasGeometry:()=>meshes.some(m=>m.visible)&&!!program&&!gl.isContextLost()});
$('#reset-view').addEventListener('click',reset);$('#top-view').addEventListener('click',()=>{yaw=0;pitch=Math.PI/2;draw();});$('#front-view').addEventListener('click',()=>{yaw=0;pitch=0;draw();});$('#explode').addEventListener('change',draw);
function scale(factor){zoom=Math.max(.2,Math.min(6,zoom*factor));draw();}$('#zoom-in').addEventListener('click',()=>scale(1.2));$('#zoom-out').addEventListener('click',()=>scale(1/1.2));
canvas.addEventListener('wheel',event=>{event.preventDefault();scale(Math.exp(-event.deltaY*.001));},{passive:false});
canvas.addEventListener('pointerdown',event=>{canvas.focus();canvas.setPointerCapture(event.pointerId);pointers.set(event.pointerId,[event.clientX,event.clientY]);});
canvas.addEventListener('pointermove',event=>{const previous=pointers.get(event.pointerId);if(!previous)return;const points=[...pointers.values()],oldDistance=points.length===2?Math.hypot(points[0][0]-points[1][0],points[0][1]-points[1][1]):0;pointers.set(event.pointerId,[event.clientX,event.clientY]);if(points.length===2){const next=[...pointers.values()],distance=Math.hypot(next[0][0]-next[1][0],next[0][1]-next[1][1]);if(oldDistance>0)scale(distance/oldDistance);}else{yaw+=(event.clientX-previous[0])*.008;pitch=Math.max(-1.5,Math.min(1.5,pitch+(event.clientY-previous[1])*.008));draw();}});
for(const name of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(name,event=>pointers.delete(event.pointerId));
canvas.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','+','=','-'].includes(event.key))return;event.preventDefault();if(event.key==='Home')return reset();if(['+','='].includes(event.key))return scale(1.2);if(event.key==='-')return scale(1/1.2);yaw+=event.key==='ArrowLeft'?-.15:event.key==='ArrowRight'?.15:0;pitch=Math.max(-1.5,Math.min(1.5,pitch+(event.key==='ArrowUp'?-.15:event.key==='ArrowDown'?.15:0)));draw();});
canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();status('The graphics context was lost. Reload this page to restore the viewer; your files are unchanged.',true);$('#export-glb').disabled=true;$('#export-sheet').disabled=true;geometryRevision++;visionPanel?.geometryChanged();});
new ResizeObserver(draw).observe(canvas);draw();

function leaveGeneratedMode(){
  previewRecord=null;$('#assembly-readback').hidden=true;$('#generated-status').classList.remove('interference');$('#generated-controls').hidden=true;$('#geometry-inputs').open=true;document.querySelector('.viewer-tools').insertBefore($('#geometry-inputs'),$('#viewer-status'));document.querySelector('.viewer-tools h2').textContent='A closer look.';document.querySelector('.viewer-tools>.eyebrow').textContent='01 / LOAD GEOMETRY';
  const url=new URL(location.href);if(url.searchParams.has('generated')){url.searchParams.delete('generated');history.replaceState(null,'',url);}
}
function generatedButtons(){ $('#retry-generated').disabled=generatedBusy;$('#download-generated').disabled=generatedBusy||!previewRecord||!meshes.length; }
async function generatePreview(){
  if(!previewRecord||generatedBusy||!gl||!program)return;
  const record=previewRecord,token=++sequence;generatedBusy=true;generatedButtons();
  status('Generating fresh STEP/STL and reopening the exports locally…');
  $('#generated-status').textContent=`Frozen model: ${record.spec.title}. This preview uses the workbench dimensions captured when you opened it.`;
  try {
    const response=await fetch(record.schema===ASSEMBLY_PREVIEW_KEY?'./api/assembly-preview':record.schema===SOLID_PREVIEW_KEY?'./api/solid-preview':'./api/tray-preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(record.spec),signal:AbortSignal.timeout(record.schema===ASSEMBLY_PREVIEW_KEY?190000:130000)});
    if(!response.ok){let message='The local CAD service could not generate the preview.';try{message=(await response.json()).error||message;}catch{}throw new Error(message);}
    const payload=await response.json();const next=await (record.schema===ASSEMBLY_PREVIEW_KEY?assemblyMeshes:record.schema===SOLID_PREVIEW_KEY?solidMeshes:previewMeshes)(payload,record.spec);
    if(token!==sequence||previewRecord!==record)return;
    replaceMeshes(next);
    if(record.schema===ASSEMBLY_PREVIEW_KEY){const text=assemblyReadbackText(payload.verification);$('#generated-status').textContent=text.split('\n')[0]+' Joints, motion, tolerances and physical fit remain untested.';$('#generated-status').classList.toggle('interference',payload.verification.status==='interference');$('#assembly-readback').hidden=false;$('#assembly-pairs-summary').textContent='Nominal pair checks / '+payload.verification.pairs.length;$('#assembly-pairs').textContent=text;}else{$('#generated-status').textContent='Readback matched: STL hash, triangle count and dimensions. Physical fit remains untested.';$('#assembly-readback').hidden=true;$('#generated-status').classList.remove('interference');}
  }catch(error){if(token===sequence&&previewRecord===record){status(error.name==='TimeoutError'?'Preview timed out. Check the local server before retrying.':error.message,true);$('#generated-status').textContent='Preview unavailable. Return to the workbench or retry with the same frozen dimensions.';}}
  finally{generatedBusy=false;generatedButtons();}
}
$('#retry-generated').addEventListener('click',generatePreview);
$('#download-generated').addEventListener('click',async()=>{
  if(!previewRecord||generatedBusy)return;
  const record=previewRecord;generatedBusy=true;generatedButtons();
  $('#generated-status').textContent='Regenerating a CAD ZIP from these frozen dimensions…';
  try{
    const response=await fetch(record.schema===ASSEMBLY_PREVIEW_KEY?'./api/assembly':record.schema===SOLID_PREVIEW_KEY?'./api/solid':'./api/tray',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(record.spec),signal:AbortSignal.timeout(record.schema===ASSEMBLY_PREVIEW_KEY?190000:130000)});
    if(!response.ok){let detail='CAD ZIP generation failed.';try{detail=(await response.json()).error||detail;}catch{}throw new Error(detail);}
    if(!response.headers.get('Content-Type')?.startsWith('application/zip'))throw new Error('The local service did not return a CAD ZIP.');
    const blob=await response.blob();if(previewRecord!==record)return;
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='hardware-studio-generated-cad.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
    $('#generated-status').textContent='CAD ZIP downloaded from the same frozen specification. Inspect its verification report before use.';
  }catch(error){if(previewRecord===record)$('#generated-status').textContent=error.name==='TimeoutError'?'CAD ZIP timed out. Check the local server.':error.message;}
  finally{generatedBusy=false;generatedButtons();}
});
const generatedMode=new URL(location.href).searchParams.get('generated');
if(generatedMode==='1'||generatedMode==='solid'||generatedMode==='assembly'){
  if(generatedMode==='solid'){document.querySelector('.back').href='./solid.html';document.querySelector('.back').textContent='SOLID MODELER ↗';}
  try{previewRecord=generatedMode==='assembly'?readAssemblySnapshot(sessionStorage.getItem(ASSEMBLY_PREVIEW_KEY)):generatedMode==='solid'?readSolidSnapshot(sessionStorage.getItem(SOLID_PREVIEW_KEY)):readPreviewSnapshot(sessionStorage.getItem(PREVIEW_KEY));document.querySelector('.back').href=previewRecord.returnTo;if(generatedMode==='solid')document.querySelector('.back').textContent='SOLID MODELER ↗';if(generatedMode==='assembly')document.querySelector('.back').textContent='ASSEMBLY WORKBENCH ↗';$('#generated-controls').hidden=false;$('#geometry-inputs').open=false;document.querySelector('.viewer-tools').append($('#geometry-inputs'));document.querySelector('.viewer-tools h2').textContent='Generated model.';document.querySelector('.viewer-tools>.eyebrow').textContent='01 / MODEL OUTPUT';void generatePreview();}
  catch(error){status(error.message,true);}
}
