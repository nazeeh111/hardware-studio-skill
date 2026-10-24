import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {parseStl,meshesToGlb} from '../stl.js';
const source=readFileSync(new URL('../cad-viewer.js',import.meta.url),'utf8');
// Boundaries are consecutive functions. The controls and replacement logic run
// unchanged, with only browser elements and GPU allocation mocked.
const replace=source.slice(source.indexOf('function replaceMeshes('),source.indexOf('\nasync function loadExample'));
const controls=source.slice(source.indexOf('function controls('),source.indexOf('\nfunction replaceMeshes'));
const buffer=readFileSync(new URL('../examples/pico-neopixel-tray/generated/window-cover-v1/tray.stl',import.meta.url));
const parsed=parseStl(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength));
const next=count=>Array.from({length:count},(_,i)=>({...parsed,name:'Instance '+(i+1),cover:false}));
function setup(failAt=Infinity){
 const nodes=new Map(),removed=[];let allocated=0;
 const node=()=>({children:[],style:{},handlers:new Map(),append(...items){this.children.push(...items);},replaceChildren(){this.children=[];},addEventListener(name,callback){this.handlers.set(name,callback);},closest(){return {hidden:false};}});
 const $=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
 const original={...parsed,name:'Previous',color:[.5,.6,.4],visible:true,buffer:{original:true}};
 const sandbox={meshes:[original],geometryRevision:5,palette:[[.53,.67,.35],[.87,.84,.64],[.65,.76,.75],[.77,.51,.34]],sheetBusy:false,visionPanel:null,$,document:{createElement:node},reset(){},status(){},gl:{ARRAY_BUFFER:1,STATIC_DRAW:2,createBuffer(){return allocated++===failAt?null:{id:allocated};},bindBuffer(){},bufferData(){},deleteBuffer(buffer){removed.push(buffer);}}};
 vm.runInNewContext(controls+'\n'+replace,sandbox);return {sandbox,nodes,removed,original};
}
test('all supported sixteen instances render controls and export finite GLB materials',()=>{
 const env=setup();env.sandbox.replaceMeshes(next(16));assert.equal(env.nodes.get('#mesh-list').children.length,16);
 assert.ok(env.sandbox.meshes.every(mesh=>mesh.color.length===3&&mesh.color.every(Number.isFinite)));
 const glb=meshesToGlb(env.sandbox.meshes),view=new DataView(glb),length=view.getUint32(12,true),doc=JSON.parse(new TextDecoder().decode(new Uint8Array(glb,20,length)));
 assert.equal(doc.nodes.length,16);assert.ok(doc.materials.every(m=>m.pbrMetallicRoughness.baseColorFactor.every(Number.isFinite)));
 assert.equal(env.removed.length,1);assert.equal(env.removed[0],env.original.buffer);
});
test('allocation failure preserves prior mesh and frees only newly prepared GPU buffers',()=>{
 const env=setup(2);assert.throws(()=>env.sandbox.replaceMeshes(next(5)),/allocation|allocated/);assert.equal(env.sandbox.meshes[0],env.original);assert.equal(env.sandbox.geometryRevision,5);assert.equal(env.removed.length,2);assert.ok(!env.removed.includes(env.original.buffer));
});
