// Dimension editing changes a working source only. Apply and CAD generation
// remain explicit, separate steps in the workbench.
import {validateSolidSpec} from './solid-spec.js?v=2';
const el=(tag,className,text)=>{const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n;};
const num=value=>value.trim()===''?null:Number(value);
const defaults=shape=>shape==='box'?{shape,origin:[0,0,0],size:[10,10,3]}:shape==='cylinder'?{shape,origin:[0,0,0],axis:'z',radius:3,height:10}:{shape:'profile',origin:[0,0,0],axis:'z',height:3,points:[[0,0],[20,0],[0,20]]};
const axes=axis=>({x:['Y','Z'],y:['Z','X'],z:['X','Y']}[axis]||['X','Y']);
// A pending form may contain blank/invalid dimensions. Retain its editable
// structure across reloads without treating it as a valid solid specification.
function editableDraft(raw){
 const object=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>keys.includes(k));
 const scalar=n=>n===null||(typeof n==='number'&&Number.isFinite(n));
 const vector=(v,count)=>Array.isArray(v)&&v.length===count&&v.every(scalar);
 if(!object(raw,['schema','title','units','features','probes'])||raw.schema!=='hardware-studio-solid-v1'||raw.units!=='mm'||typeof raw.title!=='string'||raw.title.length>100||!Array.isArray(raw.features)||!raw.features.length||raw.features.length>32||!Array.isArray(raw.probes)||raw.probes.length>16)throw new Error('Source structure unavailable.');
 for(const [items,probe]of [[raw.features,false],[raw.probes,true]])for(const item of items){
  const fields=item?.shape==='box'?['size']:item?.shape==='cylinder'?['axis','radius','height']:item?.shape==='profile'?['axis','height','points']:null;
  if(!fields||!object(item,['id',probe?'expect':'operation','shape','origin',...fields])||typeof item.id!=='string'||item.id.length>60||!vector(item.origin,3)||(probe?!['material','void'].includes(item.expect):!['add','cut'].includes(item.operation)))throw new Error('Source structure unavailable.');
  if(item.shape==='box'?!vector(item.size,3):!['x','y','z'].includes(item.axis)||!scalar(item.height)||(item.shape==='cylinder'?!scalar(item.radius):!Array.isArray(item.points)||item.points.length>64||item.points.some(point=>!Array.isArray(point)||point.length>2||!point.every(scalar))))throw new Error('Source structure unavailable.');
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
 function summary(entry,index,probe){const s=el('summary'),indexTag=el('span','dimension-index',String(index+1).padStart(2,'0')),body=el('span','dimension-summary'),title=el('b','',entry.id),detail=el('small','',(probe?entry.expect:entry.operation).toUpperCase()+' / '+entry.shape.toUpperCase());body.append(title,detail);s.append(indexTag,body);return s;}
 function entryPanel(entry,index,probe=false){
  const panel=el('details','dimension-feature '+(probe?'probe':entry.operation));panel.dataset.index=String(index);panel.dataset.collection=probe?'probes':'features';panel.open=entry.id===openId;panel.append(summary(entry,index,probe));
  panel.addEventListener('toggle',()=>{if(panel.open)openId=entry.id;});
  const body=el('div','dimension-body'),meta=el('div','dimension-meta');
  meta.append(input(probe?'Check name':'Feature name',entry.id,'id',{max:60}),select(probe?'Check for':'Operation',probe?entry.expect:entry.operation,probe?'expect':'operation',probe?[['material','Material'],['void','Void']]:[['add','Add material'],['cut','Cut material']]),select('Shape',entry.shape,'shape',[['box','Box'],['cylinder','Cylinder'],['profile','Polygon extrusion']]));body.append(meta);
  body.append(vector(entry.shape==='box'?'Minimum corner / position':'Base origin / position',entry.origin,'origin'));
  if(entry.shape==='box')body.append(vector('Size',entry.size,'size'));
  else{
   const dimensions=el('div','dimension-meta dimension-extrusion');dimensions.append(select('Positive axis',entry.axis,'axis',[['x','X'],['y','Y'],['z','Z']]),input('Height / mm',entry.height,'height',{numeric:true}));if(entry.shape==='cylinder')dimensions.append(input('Radius / mm',entry.radius,'radius',{numeric:true}));body.append(dimensions);
   if(entry.shape==='profile'){
    const names=axes(entry.axis),label=el('label','dimension-field profile-points'),area=el('textarea');area.rows=6;area.spellcheck=false;area.dataset.field='points';area.value=entry.points.map(p=>p.join(', ')).join('\n');label.append(el('span','',`Outline points / ${names[0]}, ${names[1]} in mm`),area,el('small','',`One U, V pair per line, relative to the base origin. The final edge closes automatically. Use 3–64 corners; no crossings, touches or straight-through corners.`));body.append(label);
    const diagram=profileDiagram(entry.points);diagram.setAttribute('aria-label',`Unbuilt polygon outline in the ${names.join('/')} plane`);body.append(diagram);
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
 function addToolbar(probe){const row=el('div','dimension-add'),selectNode=el('select');selectNode.setAttribute('aria-label',probe?'New region check shape':'New feature shape');for(const [shape,title]of [['box','Box'],['cylinder','Cylinder'],['profile','Polygon extrusion']]){const option=el('option','',title);option.value=shape;selectNode.append(option);}selectNode.dataset.newShape=probe?'probes':'features';const b=action(probe?'＋ Add region check':'＋ Add feature',probe?'add-probe':'add-feature',draft[probe?'probes':'features'].length>=(probe?16:32));row.append(selectNode,b);return row;}
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
   if(path.length===2)entry[path[0]][Number(path[1])]=num(control.value);
   else if(field==='points')entry.points=control.value.trim().split('\n').filter(line=>line.trim()).map(line=>line.split(',').map(v=>num(v)));
   else entry[field]=control.type==='number'?num(control.value):control.value;
   if(field==='id'){panel.querySelector('summary b').textContent=control.value;openId=control.value;}
   if(field==='points'){const current=panel.querySelector('svg'),replacement=profileDiagram(entry.points);replacement.setAttribute('aria-label','Unbuilt polygon outline');current.replaceWith(replacement);}
  }
  emit();
 });
 host.addEventListener('change',event=>{
  const control=event.target,field=control.dataset.field;if(control.tagName!=='SELECT'||!field||!draft)return;const panel=control.closest('[data-index]'),entry=draft[panel.dataset.collection][Number(panel.dataset.index)];
  openId=entry.id;if(field==='shape'){const replacement={id:entry.id,...(panel.dataset.collection==='probes'?{expect:entry.expect}:{operation:entry.operation}),...defaults(control.value)};replacement.origin=entry.origin;draft[panel.dataset.collection][Number(panel.dataset.index)]=replacement;}else entry[field]=control.type==='number'?num(control.value):control.value;emit();render();
 });
 host.addEventListener('click',event=>{
  const button=event.target.closest('button[data-action]');if(!button||button.disabled)return;const action=button.dataset.action;if(action==='source'){openSource();return;}if(!draft)return;
  if(action.startsWith('add-')){const probe=action==='add-probe',collection=probe?'probes':'features',limit=probe?16:32;if(draft[collection].length>=limit)return;const shape=host.querySelector(`[data-new-shape="${collection}"]`).value,ids=new Set([...draft.features,...draft.probes].map(f=>f.id));let count=1;while(ids.has(`${probe?'check':shape}-${count}`))count++;const entry={id:`${probe?'check':shape}-${count}`,...(probe?{expect:'material'}:{operation:'add'}),...defaults(shape)};draft[collection].push(entry);openId=entry.id;emit();render();if(probe)host.querySelector('.dimension-probes').open=true;return;}
  const panel=button.closest('[data-index]'),items=draft[panel.dataset.collection],index=Number(panel.dataset.index);if(action==='remove')items.splice(index,1);else{const to=index+(action==='up'?-1:1);if(to<0||to>=items.length)return;[items[index],items[to]]=[items[to],items[index]];openId=items[to].id;}emit();render();
 });
 return {setSource(raw){try{const parsed=typeof raw==='string'?JSON.parse(raw):raw;try{draft=validateSolidSpec(parsed);}catch{draft=editableDraft(parsed);}prior=structuredClone(draft);if(![...draft.features,...draft.probes].some(item=>item.id===openId))openId=draft.features[0].id;render();return true;}catch{draft=null;render();return false;}}};
}
