// Dimension editing changes a working source only. Apply and CAD generation
// remain explicit, separate steps in the workbench.
import {validateSolidSpec} from './solid-spec.js?v=3';
import {validateCurveProfile,arcGeometry,curveProfileBounds} from './curve-profile.js?v=1';
const el=(tag,className,text)=>{const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n;};
const num=value=>value.trim()===''?null:Number(value);
const defaults=shape=>shape==='box'?{shape,origin:[0,0,0],size:[10,10,3]}:shape==='cylinder'?{shape,origin:[0,0,0],axis:'z',radius:3,height:10}:shape==='curve'?{shape,origin:[0,0,0],axis:'z',height:3,start:[5,0],segments:[{kind:'line',end:[15,0]},{kind:'arc',via:[20,5],end:[15,10]},{kind:'line',end:[5,10]},{kind:'arc',via:[0,5],end:[5,0]}]}:{shape:'profile',origin:[0,0,0],axis:'z',height:3,points:[[0,0],[20,0],[0,20]]};
const filletDefaults=()=>({operation:'fillet',radius:1,tolerance:.01,edges:[[null,null,null]]});
const shapes=[['box','Box'],['cylinder','Cylinder'],['profile','Polygon extrusion'],['curve','Line / arc extrusion']];
const axes=axis=>({x:['Y','Z'],y:['Z','X'],z:['X','Y']}[axis]||['X','Y']);
// A pending form may contain blank/invalid dimensions. Retain its editable
// structure across reloads without treating it as a valid solid specification.
function editableDraft(raw){
 const object=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k));
 const scalar=n=>n===null||(typeof n==='number'&&Number.isFinite(n));
 const vector=(v,count)=>Array.isArray(v)&&v.length===count&&v.every(scalar);
 if(!object(raw,['schema','title','units','features','probes'])||raw.schema!=='hardware-studio-solid-v1'||raw.units!=='mm'||typeof raw.title!=='string'||raw.title.length>100||!Array.isArray(raw.features)||!raw.features.length||raw.features.length>32||!Array.isArray(raw.probes)||raw.probes.length>16)throw new Error('Source structure unavailable.');
 for(const [items,probe]of [[raw.features,false],[raw.probes,true]])for(const item of items){
  if(!probe&&item?.operation==='fillet'){
   if(!object(item,['id','operation','radius','tolerance','edges'])||typeof item.id!=='string'||item.id.length>60||!scalar(item.radius)||!scalar(item.tolerance)||!Array.isArray(item.edges)||item.edges.length>16||item.edges.some(point=>!Array.isArray(point)||point.length>3||!point.every(scalar)))throw new Error('Source structure unavailable.');
   continue;
  }
  const fields=item?.shape==='box'?['size']:item?.shape==='cylinder'?['axis','radius','height']:item?.shape==='profile'?['axis','height','points']:item?.shape==='curve'?['axis','height','start','segments']:null;
  if(!fields||!object(item,['id',probe?'expect':'operation','shape','origin',...fields])||typeof item.id!=='string'||item.id.length>60||!vector(item.origin,3)||(probe?!['material','void'].includes(item.expect):!['add','cut'].includes(item.operation)))throw new Error('Source structure unavailable.');
  if(item.shape==='box'){if(!vector(item.size,3))throw new Error('Source structure unavailable.');continue;}
  if(!['x','y','z'].includes(item.axis)||!scalar(item.height))throw new Error('Source structure unavailable.');
  if(item.shape==='cylinder'){if(!scalar(item.radius))throw new Error('Source structure unavailable.');}
  else if(item.shape==='profile'){if(!Array.isArray(item.points)||item.points.length>64||item.points.some(point=>!Array.isArray(point)||point.length>2||!point.every(scalar)))throw new Error('Source structure unavailable.');}
  else if(!vector(item.start,2)||!Array.isArray(item.segments)||item.segments.length>64||item.segments.some(segment=>!['line','arc'].includes(segment?.kind)||!object(segment,segment.kind==='arc'?['kind','via','end']:['kind','end'])||!vector(segment.end,2)||(segment.kind==='arc'&&!vector(segment.via,2))))throw new Error('Source structure unavailable.');
 }
 return structuredClone(raw);
}
export function createSolidEditor(host,{change,error,openSource}){
 let draft=null,prior=null,openId=null;
 function emit(){try{change(structuredClone(draft));prior=structuredClone(draft);}catch(reason){draft=structuredClone(prior);render();error(reason.message);}}
 function input(label,value,field,{numeric=false,help='',max=100}={}){
  const wrap=el('label','dimension-field'),caption=el('span','',label),control=el('input');
  control.type=numeric?'number':'text';control.value=value??'';control.dataset.field=field;
  if(numeric){control.step='any';control.inputMode='decimal';}else control.maxLength=max;
  wrap.append(caption,control);if(help)wrap.append(el('small','',help));return wrap;
 }
 function select(label,value,field,choices){const wrap=el('label','dimension-field'),control=el('select');control.dataset.field=field;for(const [v,text]of choices){const option=el('option','',text);option.value=v;control.append(option);}control.value=value;wrap.append(el('span','',label),control);return wrap;}
 function vector(label,values,field,names=['X','Y','Z']){const group=el('fieldset','dimension-vector'),legend=el('legend','',label);group.append(legend);for(const [i,name]of names.entries())group.append(input(name+' / mm',values?.[i],field+'.'+i,{numeric:true}));return group;}
 function action(label,operation,disabled=false){const b=el('button','dimension-action',label);b.type='button';b.dataset.action=operation;b.disabled=disabled;return b;}
 function summary(entry,index,probe){const s=el('summary'),indexTag=el('span','dimension-index',String(index+1).padStart(2,'0')),body=el('span','dimension-summary'),title=el('b','',entry.id),detail=el('small','',(probe?entry.expect:entry.operation).toUpperCase()+' / '+(entry.operation==='fillet'?'EDGE SEEDS':entry.shape.toUpperCase()));body.append(title,detail);s.append(indexTag,body);return s;}
 function entryPanel(entry,index,probe=false){
  const panel=el('details','dimension-feature '+(probe?'probe':entry.operation));panel.dataset.index=String(index);panel.dataset.collection=probe?'probes':'features';panel.open=entry.id===openId;panel.append(summary(entry,index,probe));
  panel.addEventListener('toggle',()=>{if(panel.open)openId=entry.id;});
  const body=el('div','dimension-body'),meta=el('div','dimension-meta');
  meta.append(input(probe?'Check name':'Feature name',entry.id,'id',{max:60}),select(probe?'Check for':'Operation',probe?entry.expect:entry.operation,probe?'expect':'operation',probe?[['material','Material'],['void','Void']]:[['add','Add material'],['cut','Cut material'],['fillet','Round from edge seeds']]));
  if(entry.operation!=='fillet')meta.append(select('Shape',entry.shape,'shape',shapes));body.append(meta);
  if(entry.operation==='fillet'){
   const dimensions=el('div','dimension-meta dimension-extrusion');dimensions.append(input('Fillet radius / mm',entry.radius,'radius',{numeric:true}),input('Edge match tolerance / mm',entry.tolerance,'tolerance',{numeric:true}));body.append(dimensions);
   const label=el('label','dimension-field profile-points'),area=el('textarea');area.rows=5;area.spellcheck=false;area.dataset.field='edges';area.value=entry.edges.map(p=>p.map(v=>v??'').join(', ')).join('\n');
   label.append(el('span','','Points inside seed edges / X, Y, Z in mm'),area,el('small','','One X, Y, Z interior point per seed edge of the solid built so far, away from vertices. Each point must resolve one unique current edge within tolerance; duplicates and ambiguous matches fail at build. Use 1–16 points.'));body.append(label,el('p','dimension-intro','This rounds edges after earlier features. The CAD kernel may extend a fillet through connected tangent edges. Build and inspect the generated result to check its extent.'));
  }else{
   body.append(vector(entry.shape==='box'?'Minimum corner / position':'Base origin / position',entry.origin,'origin'));
   if(entry.shape==='box')body.append(vector('Size',entry.size,'size'));
   else{
    const dimensions=el('div','dimension-meta dimension-extrusion');dimensions.append(select('Positive axis',entry.axis,'axis',[['x','X'],['y','Y'],['z','Z']]),input('Height / mm',entry.height,'height',{numeric:true}));if(entry.shape==='cylinder')dimensions.append(input('Radius / mm',entry.radius,'radius',{numeric:true}));body.append(dimensions);
    if(entry.shape==='profile'){
     const names=axes(entry.axis),label=el('label','dimension-field profile-points'),area=el('textarea');area.rows=6;area.spellcheck=false;area.dataset.field='points';area.value=entry.points.map(p=>p.map(v=>v??'').join(', ')).join('\n');label.append(el('span','',`Outline points / ${names[0]}, ${names[1]} in mm`),area,el('small','',`One U, V pair per line, relative to the base origin. The final edge closes automatically. Use 3–64 corners; no crossings, touches or straight-through corners.`));body.append(label);
     const diagram=profileDiagram(entry.points);diagram.setAttribute('aria-label',`Unbuilt polygon outline in the ${names.join('/')} plane`);body.append(diagram);
    }else if(entry.shape==='curve')body.append(curveControls(entry));
   }
  }
  const commands=el('div','dimension-commands');if(!probe)commands.append(action('Move up','up',index===0),action('Move down','down',index===draft.features.length-1));commands.append(action('Remove','remove',!probe&&draft.features.length===1));body.append(commands);panel.append(body);return panel;
 }
 function profileDiagram(points){
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.classList.add('profile-diagram');svg.setAttribute('viewBox','0 0 240 160');svg.setAttribute('role','img');
  const label=document.createElementNS(ns,'text');label.setAttribute('x','12');label.setAttribute('y','18');label.textContent='OUTLINE / UNBUILT';svg.append(label);
  if(points.length<3||points.some(p=>p.length!==2||p.some(n=>!Number.isFinite(n))))return svg;
  const min=[0,1].map(k=>Math.min(...points.map(p=>p[k]))),max=[0,1].map(k=>Math.max(...points.map(p=>p[k]))),scale=Math.min(210/Math.max(.01,max[0]-min[0]),110/Math.max(.01,max[1]-min[1]));
  const polygon=document.createElementNS(ns,'polygon');polygon.setAttribute('points',points.map(p=>`${15+(p[0]-min[0])*scale},${140-(p[1]-min[1])*scale}`).join(' '));svg.append(polygon);return svg;
 }
 function curveControls(entry){
  const group=el('div','curve-controls'),names=axes(entry.axis);group.append(vector(`Start / ${names.join(', ')} relative to base origin`,entry.start,'start',['U','V']),el('p','dimension-intro','Each segment starts at the preceding endpoint. Arcs pass through their via point. Use 2–64 segments in one simple loop. Set the final endpoint equal to Start, or add a closing line explicitly. The outline is unbuilt; Apply checks its geometry.'));
  entry.segments.forEach((segment,index)=>{
   const row=el('fieldset','curve-segment');row.dataset.segment=String(index);row.append(el('legend','',`Segment ${index+1}`),select('Segment type',segment.kind,`segments.${index}.kind`,[['line','Line'],['arc','Arc through point']]));
   if(segment.kind==='arc')row.append(vector('Via point',segment.via,`segments.${index}.via`,['U','V']));row.append(vector('End point',segment.end,`segments.${index}.end`,['U','V']));
   const commands=el('div','dimension-commands');commands.append(action('Move segment up','segment-up',index===0),action('Move segment down','segment-down',index===entry.segments.length-1),action('Remove segment','segment-remove',entry.segments.length<=2));row.append(commands);group.append(row);
  });
  const commands=el('div','dimension-commands');commands.append(action('＋ Add line','segment-line',entry.segments.length>=64),action('＋ Add arc','segment-arc',entry.segments.length>=64),action('＋ Add closing line','segment-close',entry.segments.length>=64||entry.segments.at(-1)?.end.every((value,index)=>Number.isFinite(value)&&value===entry.start[index])));group.append(commands,curveDiagram(entry));return group;
 }
 function curveDiagram(entry){
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.classList.add('profile-diagram');svg.setAttribute('viewBox','0 0 240 160');svg.setAttribute('role','img');svg.setAttribute('aria-label',`Unbuilt line and arc outline in the ${axes(entry.axis).join('/')} plane`);
  const label=document.createElementNS(ns,'text');label.setAttribute('x','12');label.setAttribute('y','18');label.textContent='OUTLINE / UNBUILT';svg.append(label);
  try{
   const source=validateCurveProfile(entry.start,entry.segments),{min,max}=curveProfileBounds(source.start,source.segments),scale=Math.min(210/Math.max(.01,max[0]-min[0]),110/Math.max(.01,max[1]-min[1])),point=p=>[15+(p[0]-min[0])*scale,140-(p[1]-min[1])*scale];let previous=source.start,d=`M ${point(previous).join(' ')}`;
   for(const segment of source.segments){if(segment.kind==='line')d+=` L ${point(segment.end).join(' ')}`;else{const arc=arcGeometry(previous,segment.via,segment.end);d+=` A ${arc.radius*scale} ${arc.radius*scale} 0 ${Math.abs(arc.sweep)>Math.PI?1:0} ${arc.sweep>0?0:1} ${point(segment.end).join(' ')}`;}previous=segment.end;}
   const path=document.createElementNS(ns,'path');path.setAttribute('d',d+' Z');svg.append(path);
  }catch{label.textContent='OUTLINE / INCOMPLETE OR INVALID';}
  return svg;
 }
 function addToolbar(probe){const row=el('div','dimension-add'),selectNode=el('select');selectNode.setAttribute('aria-label',probe?'New region check shape':'New feature shape');for(const [shape,title]of [...shapes,...(probe?[]:[['fillet','Round from edge seeds']])]){const option=el('option','',title);option.value=shape;selectNode.append(option);}selectNode.dataset.newShape=probe?'probes':'features';const b=action(probe?'＋ Add region check':'＋ Add feature',probe?'add-probe':'add-feature',draft[probe?'probes':'features'].length>=(probe?16:32));row.append(selectNode,b);return row;}
 function render(){
  const probesOpen=host.querySelector('.dimension-probes')?.open||false;
  host.replaceChildren();if(!draft){const empty=el('div','dimension-empty');empty.append(el('p','','The source needs correction before dimension editing is available. Original text is retained.'));const button=action('Open editable JSON','source');empty.append(button);host.append(empty);return;}
  host.append(input('Part title',draft.title,'title'));
  const list=el('div','dimension-list');draft.features.forEach((entry,i)=>list.append(entryPanel(entry,i)));host.append(list,addToolbar(false));
  const probes=el('details','dimension-probes');probes.open=probesOpen;probes.append(el('summary','',`Selected region checks / ${draft.probes.length}`),el('p','','Optional checks describe a small region that should remain material or be empty after building. They do not check the whole part.'));draft.probes.forEach((entry,i)=>probes.append(entryPanel(entry,i,true)));probes.append(addToolbar(true));host.append(probes);
 }
 host.addEventListener('input',event=>{
  const control=event.target,field=control.dataset.field;if(!field||control.tagName==='SELECT'||!draft)return;
  if(field==='title')draft.title=control.value;
  else{const panel=control.closest('[data-index]');if(!panel)return;const entry=draft[panel.dataset.collection][Number(panel.dataset.index)],path=field.split('.');
   if(path.length>1){let target=entry;for(const key of path.slice(0,-1))target=target[key];target[path.at(-1)]=num(control.value);}
   else if(field==='points'||field==='edges')entry[field]=control.value.trim().split('\n').filter(line=>line.trim()).map(line=>line.split(',').map(v=>num(v)));
   else entry[field]=control.type==='number'?num(control.value):control.value;
   if(field==='id'){panel.querySelector('summary b').textContent=control.value;openId=control.value;}
   if(entry.shape==='curve'&&(field==='start'||field.startsWith('start.')||field.startsWith('segments.'))){const current=panel.querySelector('svg');current.replaceWith(curveDiagram(entry));}
   if(field==='points'){const current=panel.querySelector('svg'),replacement=profileDiagram(entry.points);replacement.setAttribute('aria-label','Unbuilt polygon outline');current.replaceWith(replacement);}
  }
  emit();
 });
 host.addEventListener('change',event=>{
  const control=event.target,field=control.dataset.field;if(control.tagName!=='SELECT'||!field||!draft)return;const panel=control.closest('[data-index]'),entry=draft[panel.dataset.collection][Number(panel.dataset.index)];
  openId=entry.id;
  if(field==='shape'){const replacement={id:entry.id,...(panel.dataset.collection==='probes'?{expect:entry.expect}:{operation:entry.operation}),...defaults(control.value)};replacement.origin=entry.origin;draft[panel.dataset.collection][Number(panel.dataset.index)]=replacement;}
  else if(field==='operation'&&(entry.operation==='fillet'||control.value==='fillet'))draft.features[Number(panel.dataset.index)]={id:entry.id,...(control.value==='fillet'?filletDefaults():{operation:control.value,...defaults('box')})};
  else if(field.startsWith('segments.')){const index=Number(field.split('.')[1]),segment=entry.segments[index];entry.segments[index]=control.value==='arc'?{kind:'arc',via:[null,null],end:segment.end}:{kind:'line',end:segment.end};}
  else entry[field]=control.value;emit();render();
 });
 host.addEventListener('click',event=>{
  const button=event.target.closest('button[data-action]');if(!button||button.disabled)return;const action=button.dataset.action;if(action==='source'){openSource();return;}if(!draft)return;
  if(action.startsWith('add-')){const probe=action==='add-probe',collection=probe?'probes':'features',limit=probe?16:32;if(draft[collection].length>=limit)return;const shape=host.querySelector(`[data-new-shape="${collection}"]`).value,ids=new Set([...draft.features,...draft.probes].map(f=>f.id));let count=1;while(ids.has(`${probe?'check':shape}-${count}`))count++;const entry={id:`${probe?'check':shape}-${count}`,...(probe?{expect:'material'}:{operation:'add'}),...(shape==='fillet'?filletDefaults():defaults(shape))};draft[collection].push(entry);openId=entry.id;emit();render();if(probe)host.querySelector('.dimension-probes').open=true;return;}
  const panel=button.closest('[data-index]');if(action.startsWith('segment-')){const entry=draft[panel.dataset.collection][Number(panel.dataset.index)];if(entry.shape!=='curve')return;openId=entry.id;const segments=entry.segments;if(['segment-line','segment-arc','segment-close'].includes(action)){if(segments.length>=64)return;segments.push(action==='segment-arc'?{kind:'arc',via:[null,null],end:[null,null]}:{kind:'line',end:action==='segment-close'?[...entry.start]:[null,null]});}else{const index=Number(button.closest('[data-segment]').dataset.segment);if(action==='segment-remove'){if(segments.length<=2)return;segments.splice(index,1);}else{const to=index+(action==='segment-up'?-1:1);if(to<0||to>=segments.length)return;[segments[index],segments[to]]=[segments[to],segments[index]];}}emit();render();return;}
  const items=draft[panel.dataset.collection],index=Number(panel.dataset.index);if(action==='remove')items.splice(index,1);else{const to=index+(action==='up'?-1:1);if(to<0||to>=items.length)return;[items[index],items[to]]=[items[to],items[index]];openId=items[to].id;}emit();render();
 });
 return {setSource(raw){try{const parsed=typeof raw==='string'?JSON.parse(raw):raw;try{draft=validateSolidSpec(parsed);}catch{draft=editableDraft(parsed);}prior=structuredClone(draft);if(![...draft.features,...draft.probes].some(item=>item.id===openId))openId=draft.features[0].id;render();return true;}catch{draft=null;render();return false;}}};
}
