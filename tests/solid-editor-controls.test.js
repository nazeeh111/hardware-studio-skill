import test from 'node:test';
import assert from 'node:assert/strict';
import {createSolidEditor} from '../solid-editor.js';

const box=()=>({schema:'hardware-studio-solid-v1',title:'Editable source',units:'mm',features:[{id:'base',operation:'add',shape:'box',origin:[0,0,0],size:[20,10,3]}],probes:[]});
function setup(t,{changeError=false}={}){
 const previous=globalThis.document,changes=[],errors=[];
 class Element{
  constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.parentElement=null;this.dataset={};this.handlers={};this.attributes={};this.className='';this.classList={add:name=>{this.className+=' '+name;}};this.value='';this.textContent='';}
  append(...items){for(const item of items){item.parentElement=this;this.children.push(item);}}
  replaceChildren(...items){this.children=[];this.append(...items);}
  replaceWith(item){const at=this.parentElement.children.indexOf(this);item.parentElement=this.parentElement;this.parentElement.children[at]=item;}
  setAttribute(key,value){this.attributes[key]=value;}
  addEventListener(name,handler){this.handlers[name]=handler;}
  matches(selector){
   const match=selector.match(/^([a-z]+)?(?:\.([\w-]+))?(?:\[([\w-]+)(?:="([^"]*)")?\])?$/);
   if(!match)throw new Error('Unsupported test selector '+selector);
   const [,tag,cls,attribute,value]=match;
   if(tag&&this.tagName!==tag.toUpperCase()||cls&&!this.className.split(' ').includes(cls))return false;
   if(attribute){const key=attribute.replace(/^data-/, '').replace(/-([a-z])/g,(_,c)=>c.toUpperCase());if(attribute.startsWith('data-')?!(key in this.dataset):!(attribute in this.attributes))return false;if(value!==undefined&&(attribute.startsWith('data-')?this.dataset[key]:this.attributes[attribute])!==value)return false;}return true;
  }
  querySelector(selector){const parts=selector.split(' '),all=this.descendants();return all.find(node=>{if(!node.matches(parts.at(-1)))return false;let parent=node.parentElement;for(let i=parts.length-2;i>=0;i--){while(parent&&!parent.matches(parts[i]))parent=parent.parentElement;if(!parent)return false;parent=parent.parentElement;}return true;})||null;}
  descendants(){return this.children.flatMap(child=>[child,...child.descendants()]);}
  closest(selector){for(let node=this;node;node=node.parentElement)if(node.matches(selector))return node;return null;}
 }
 globalThis.document={createElement:tag=>new Element(tag),createElementNS:(_,tag)=>new Element(tag)};
 t.after(()=>{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;});
 const host=new Element('div'),editor=createSolidEditor(host,{change:source=>{if(changeError)throw new Error('Draft storage failed');changes.push(source);},error:message=>errors.push(message),openSource:()=>{}});
 const find=(selector,scope=host)=>{const found=scope.querySelector(selector);assert.ok(found,'Missing '+selector);return found;};
 const event=(name,node,value)=>{if(value!==undefined)node.value=value;host.handlers[name]({target:node});};
 const field=(name,value,scope=host)=>{const node=find(`[data-field="${name}"]`,scope);event(node.tagName==='SELECT'?'change':'input',node,value);};
 const click=(action,scope=host)=>event('click',find(`[data-action="${action}"]`,scope));
 const panel=(index=0,collection='features')=>host.descendants().find(n=>n.dataset.index===String(index)&&n.dataset.collection===collection);
 return {editor,host,changes,errors,find,field,click,panel,event};
}

test('curve controls edit one source, retain blank arc coordinates through reload, and close only explicitly',t=>{
 const e=setup(t);assert.equal(e.editor.setSource(box()),true);e.field('shape','curve');const capsule=e.changes.at(-1).features[0];assert.equal(capsule.segments.length,4);assert.equal(capsule.segments[1].kind,'arc');assert.equal(e.find('path').attributes.d.includes(' A '),true);
 e.field('segments.1.via.0','');let pending=e.changes.at(-1);assert.equal(pending.features[0].segments[1].via[0],null);assert.equal(e.host.querySelector('path'),null);
 assert.equal(e.editor.setSource(JSON.stringify(pending)),true);assert.equal(e.find('[data-field="segments.1.via.0"]').value,'');assert.match(e.find('svg').children[0].textContent,/INCOMPLETE/);
 e.field('segments.1.via.0','20');e.click('segment-line');pending=e.changes.at(-1);assert.deepEqual(pending.features[0].segments.at(-1),{kind:'line',end:[null,null]});assert.equal(e.editor.setSource(pending),true);
 e.field('segments.4.end.0','-2');e.field('segments.4.end.1','5');e.click('segment-close');assert.deepEqual(e.changes.at(-1).features[0].segments.at(-1),{kind:'line',end:[5,0]});
 assert.equal(box().features[0].shape,'box');
});

test('segment kind, order and removal change the same declared segment list',t=>{
 const e=setup(t);e.editor.setSource(box());e.field('shape','curve');e.field('segments.0.kind','arc');assert.deepEqual(e.changes.at(-1).features[0].segments[0],{kind:'arc',via:[null,null],end:[15,0]});
 e.field('segments.0.kind','line');assert.equal('via'in e.changes.at(-1).features[0].segments[0],false);
 const original=structuredClone(e.changes.at(-1));e.click('segment-down',e.find('[data-segment="0"]'));assert.deepEqual(e.changes.at(-1).features[0].segments[0],original.features[0].segments[1]);
 e.click('segment-remove',e.find('[data-segment="1"]'));assert.equal(e.changes.at(-1).features[0].segments.length,3);e.click('segment-remove',e.find('[data-segment="1"]'));assert.equal(e.changes.at(-1).features[0].segments.length,2);assert.equal(e.find('[data-action="segment-remove"]').disabled,true);
});

test('fillet has its own panel and pending radius, tolerance and edge points survive reload',t=>{
 const e=setup(t);e.editor.setSource(box());e.find('[data-new-shape="features"]').value='fillet';e.click('add-feature');let source=e.changes.at(-1);assert.equal(source.features[1].operation,'fillet');assert.equal('shape'in source.features[1],false);assert.equal(e.panel(1).querySelector('[data-field="origin.0"]'),null);assert.match(e.panel(1).descendants().map(node=>node.textContent).join(' '),/connected tangent edges/);
 e.field('edges','0, 0, 1.5\n20, ,',e.panel(1));e.field('radius','',e.panel(1));e.field('tolerance','.002',e.panel(1));source=e.changes.at(-1);assert.deepEqual(source.features[1].edges,[[0,0,1.5],[20,null,null]]);assert.equal(source.features[1].radius,null);assert.equal(source.features[1].tolerance,.002);
 assert.equal(e.editor.setSource(JSON.stringify(source)),true);assert.equal(e.find('[data-field="radius"]',e.panel(1)).value,'');assert.match(e.find('[data-field="edges"]',e.panel(1)).value,/20, , /);
 e.field('edges','0,',e.panel(1));assert.equal(e.editor.setSource(e.changes.at(-1)),true);assert.equal(e.find('[data-field="edges"]',e.panel(1)).value,'0, ');
 e.field('operation','cut',e.panel(1));assert.equal(e.changes.at(-1).features[1].shape,'box');assert.equal('edges'in e.changes.at(-1).features[1],false);
});

test('curve region checks remain primitives and feature conversion clears incompatible fields',t=>{
 const e=setup(t);e.editor.setSource(box());e.find('[data-new-shape="probes"]').value='curve';e.click('add-probe');let source=e.changes.at(-1);assert.equal(source.probes[0].shape,'curve');assert.equal(source.probes[0].expect,'material');assert.equal(e.panel(0,'probes').querySelector('[data-field="operation"]'),null);
 assert.equal(e.find('[data-new-shape="probes"]').children.some(option=>option.value==='fillet'),false);
 e.field('operation','fillet',e.panel(0));source=e.changes.at(-1);assert.deepEqual(Object.keys(source.features[0]).sort(),['id','operation','radius','tolerance','edges'].sort());assert.equal(e.editor.setSource(source),true);
});

test('a failed draft write restores earlier source and reports the error',t=>{
 const e=setup(t,{changeError:true});e.editor.setSource(box());e.field('shape','curve');assert.equal(e.find('[data-field="shape"]').value,'box');assert.deepEqual(e.errors,['Draft storage failed']);assert.deepEqual(e.changes,[]);
});

test('analytical diagram includes extrema beyond arc via points and uses correct SVG sweep',t=>{
 const e=setup(t),source=box(),s=Math.SQRT1_2;source.features[0]={id:'major-arc',operation:'add',shape:'curve',origin:[0,0,0],axis:'z',height:2,start:[s,-s],segments:[{kind:'arc',via:[-s,-s],end:[s,s]},{kind:'line',end:[s,-s]}]};assert.equal(e.editor.setSource(source),true);
 const d=e.find('path').attributes.d;assert.match(d,/ A 55 55 0 1 1 /);assert.match(d,/ Z$/);assert.equal(e.changes.length,0,'Rendering cannot apply source');
});
