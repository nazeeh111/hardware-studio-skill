export const MAX_STL_BYTES = 32 * 1024 * 1024;
const MAX_TRIANGLES = 400000;

export function parseStl(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 15 || buffer.byteLength > MAX_STL_BYTES) throw new Error('Choose an STL file smaller than 32 MB.');
  const view = new DataView(buffer), vertices = [];
  const count = buffer.byteLength >= 84 ? view.getUint32(80, true) : 0;
  const binary = count > 0 && 84 + count * 50 === buffer.byteLength;
  if (binary) {
    if (count > MAX_TRIANGLES) throw new Error('Use a mesh with at most 400,000 triangles.');
    for (let i = 0; i < count; i++) for (let j = 0; j < 9; j++) vertices.push(view.getFloat32(84 + i * 50 + 12 + j * 4, true));
  } else {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    const body = source.match(/^\s*solid[^\r\n]*[\r\n]+([\s\S]*?)\bendsolid[^\r\n]*\s*$/i);
    if (!body) throw new Error('This is not a supported binary or ASCII STL.');
    const tokens = body[1].matchAll(/\S+/g), next = () => tokens.next().value?.[0];
    const expect = word => { if (next()?.toLowerCase() !== word) throw new Error('The ASCII STL has an incomplete or malformed facet.'); };
    const number = () => { const token=next(); if (!token || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(token) || !Number.isFinite(Number(token))) throw new Error('STL coordinates and normals must be finite numbers.'); return Number(token); };
    let token;
    while ((token = next()) !== undefined) {
      if (token.toLowerCase() !== 'facet') throw new Error('The ASCII STL has an unexpected record.');
      expect('normal'); number(); number(); number(); expect('outer'); expect('loop');
      for(let v=0;v<3;v++){expect('vertex');vertices.push(number(),number(),number());}
      expect('endloop');expect('endfacet');
      if (vertices.length > MAX_TRIANGLES * 9) throw new Error('Use a mesh with at most 400,000 triangles.');
    }
    if (!vertices.length) throw new Error('The STL has no triangles.');
  }
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  const data = new Float32Array(vertices.length * 2);
  let valid = 0;
  for (let i = 0; i < vertices.length; i += 9) {
    const p = vertices.slice(i, i + 9);
    if (p.some(n => !Number.isFinite(n) || Math.abs(n) > 1000000)) throw new Error('STL coordinates must be finite and within one million units.');
    const a = [p[3]-p[0], p[4]-p[1], p[5]-p[2]], b = [p[6]-p[0], p[7]-p[1], p[8]-p[2]];
    const n = [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]], len = Math.hypot(...n);
    if (!len) continue;
    for (let v = 0; v < 3; v++) {
      for (let axis = 0; axis < 3; axis++) { const value = p[v*3+axis]; min[axis] = Math.min(min[axis],value); max[axis] = Math.max(max[axis],value); data[valid*18+v*6+axis] = value; data[valid*18+v*6+3+axis] = n[axis]/len; }
    }
    valid++;
  }
  if (!valid) throw new Error('The STL has no usable surface triangles.');
  return { data: data.slice(0, valid * 18), triangles: valid, min, max };
}

// glTF uses meters. The caller explicitly interprets STL coordinates as millimeters.
export function meshesToGlb(meshes) {
  if (!meshes.length) throw new Error('Load a mesh before exporting.');
  const document = { asset: { version:'2.0', generator:'Hardware Studio STL viewer' }, scene:0, scenes:[{nodes:[]}], nodes:[], meshes:[], materials:[], buffers:[{byteLength:0}], bufferViews:[], accessors:[] };
  const chunks = []; let offset = 0;
  for (const mesh of meshes) {
    const count = mesh.data.length / 6, bytes = new ArrayBuffer(count * 24), output = new DataView(bytes);
    const min = mesh.min.map(n=>n/1000), max = mesh.max.map(n=>n/1000);
    for (let i=0;i<count;i++) for (let k=0;k<6;k++) output.setFloat32(i*24+k*4,mesh.data[i*6+k]/(k<3?1000:1),true);
    const bufferView = document.bufferViews.length, accessor = document.accessors.length, index = document.meshes.length;
    document.bufferViews.push({buffer:0,byteOffset:offset,byteLength:bytes.byteLength,byteStride:24,target:34962});
    document.accessors.push({bufferView,byteOffset:0,componentType:5126,count,type:'VEC3',min,max},{bufferView,byteOffset:12,componentType:5126,count,type:'VEC3'});
    document.materials.push({name:mesh.name,pbrMetallicRoughness:{baseColorFactor:[...mesh.color,1],metallicFactor:0,roughnessFactor:.7},doubleSided:true});
    document.meshes.push({name:mesh.name,primitives:[{attributes:{POSITION:accessor,NORMAL:accessor+1},material:index,mode:4}]});
    document.nodes.push({name:mesh.name,mesh:index,rotation:[-Math.SQRT1_2,0,0,Math.SQRT1_2]});
    document.scenes[0].nodes.push(index);chunks.push(new Uint8Array(bytes));offset+=bytes.byteLength;
  }
  document.buffers[0].byteLength=offset;
  const json = new TextEncoder().encode(JSON.stringify(document)), padded = Math.ceil(json.length/4)*4;
  const result = new ArrayBuffer(12+8+padded+8+offset), view = new DataView(result), bytes = new Uint8Array(result);
  view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,result.byteLength,true);
  view.setUint32(12,padded,true);view.setUint32(16,0x4e4f534a,true);bytes.fill(32,20,20+padded);bytes.set(json,20);
  view.setUint32(20+padded,offset,true);view.setUint32(24+padded,0x004e4942,true);
  let cursor=28+padded;for(const chunk of chunks){bytes.set(chunk,cursor);cursor+=chunk.length;}
  return result;
}
