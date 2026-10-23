// These symbols describe a part family. They never stand in for a CAD model.
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const board = '<path d="M14 57 76 31 136 57 74 85Z" fill="#a4bbaa"/><path d="m14 57 60 28v9L14 66Zm60 28 62-28v9L74 94Z" fill="#6c8a78"/>';
const symbols = {
  plate: '<path d="m13 58 61-26 63 26-62 27Z" fill="#b4c9b8"/><path d="m13 58 62 27v9L13 67Zm62 27 62-27v9L75 94Z" fill="#6b8976"/><ellipse cx="75" cy="57" rx="10" ry="5" fill="#294237"/><path d="m29 61 25-11m43 18 24-10" stroke="#edf2df" stroke-width="2"/>',
  feet: '<path d="M39 57v16c0 17 72 17 72 0V57" fill="#31473b"/><ellipse cx="75" cy="57" rx="36" ry="15" fill="#748773"/><ellipse cx="75" cy="57" rx="27" ry="10" fill="#a9ba91"/><path d="M49 75c15 6 37 6 51 0" stroke="#9bb08c" fill="none"/>',
  spacer: '<path d="M46 44v34c0 13 58 13 58 0V44" fill="#7c9684"/><ellipse cx="75" cy="44" rx="29" ry="12" fill="#bfd0b8"/><ellipse cx="75" cy="44" rx="11" ry="5" fill="#344c3e"/><path d="M55 75v-25" stroke="#a9bba3" stroke-width="3"/>',
  bracket: '<path d="m29 67 48 20 53-22-12-6-41 17-36-15V28L29 23Z" fill="#7d9c86"/><path d="m29 23 12 5 47-19-12-5Z" fill="#c0d0b7"/><path d="m41 28 47-19v40l30 10-41 17-36-15Z" fill="#a9c1aa"/><ellipse cx="65" cy="35" rx="5" ry="7" fill="#355440" transform="rotate(21 65 35)"/><ellipse cx="82" cy="65" rx="8" ry="3" fill="#355440"/>',
  enclosure: '<path d="m15 45 60-25 61 25-60 27Z" fill="#c2d0b9"/><path d="m15 45 61 27v37L15 82Zm61 27 60-27v37l-60 27Z" fill="#7f9e87"/><path d="m32 46 43-17 44 17-43 18Z" fill="#526f5b"/><path d="m32 46 44 18 43-18" stroke="#e8efdb" fill="none"/>',
  wire: '<path d="M26 74c-32-37 53-56 66-30s-69 55-69 22c0-26 67-38 73-16 5 18 24 3 34-9" stroke="#789b70" stroke-width="7" fill="none"/><path d="m126 35 10 9m-8-6 7-9" stroke="#b4c65c" stroke-width="5"/>',
  fastener: '<path d="m61 31 11 6-26 57-10-5Z" fill="#829781"/><path d="m42 77 11 5m-7-13 11 5m-7-13 11 5m-7-13 11 5" stroke="#405c48" stroke-width="2"/><path d="m57 26 10-11 17 7-1 15-11 7-15-8Z" fill="#b3c2a2"/><path d="m65 26 11 5m-7 0 4-8" stroke="#526d4e" stroke-width="2"/>',
  display: board + '<path d="m31 56 45-18 43 18-44 19Z" fill="#243b31"/><path d="m45 55 31-12m-29 19 48-19" stroke="#dcef75" stroke-width="3"/>',
  sensor: board + '<ellipse cx="75" cy="55" rx="19" ry="11" fill="#d6e789"/><ellipse cx="75" cy="52" rx="11" ry="7" fill="#566e49"/><path d="m31 56 15-6m57 5 15 6" stroke="#edf3df" stroke-width="2"/>',
  power: board + '<path d="m53 47 26-11 22 10-25 12Z" fill="#dcef75"/><path d="m53 47 23 11v15L53 62Zm23 11 25-12v15L76 73Z" fill="#6d8847"/><path d="m117 66 18 8m-17-15 17 8" stroke="#597348" stroke-width="3"/>',
  controller: board + '<path d="m54 55 23-9 24 10-24 10Z" fill="#2d4737"/><path d="m29 47 9-4m-1 18 9-4m53-16 9-4m0 28 9-4" stroke="#dcef75" stroke-width="3"/>',
  part: '<path d="m31 50 44-19 44 19-44 20Z" fill="#c0cbb7"/><path d="m31 50 44 20v33L31 83Zm44 20 44-20v33l-44 20Z" fill="#829987"/><path d="m31 50 44 20 44-20m-44 20v33" stroke="#4d6856" fill="none"/>'
};
export function partSymbol(part) {
  const name = String(part.name ?? '').toLowerCase(), category = String(part.category ?? '').toLowerCase();
  const mechanical = /mechanical|structural|fastener|enclosure/.test(category);
  // Name-based shapes only within mechanical families; unknown parts keep a neutral symbol.
  if (mechanical) {
    if (/\b(feet|foot|bumper)s?\b/.test(name)) return 'feet';
    if (/\b(spacer|standoff|washer)s?\b/.test(name)) return 'spacer';
    if (/\b(bracket|angle bracket)s?\b/.test(name)) return 'bracket';
    if (/\b(plate|panel)s?\b/.test(name)) return 'plate';
    if (/\b(enclosure|housing|case|tray)s?\b/.test(name) || /enclosure/.test(category)) return 'enclosure';
    if (/\b(screw|bolt|fastener)s?\b/.test(name) || /fastener/.test(category)) return 'fastener';
    return 'part';
  }
  if (/wire|interconnect/.test(category) || (/assembly/.test(category) && /\b(wire|wires|wiring|cable|cables|lead|leads)\b/.test(name))) return 'wire';
  if (/display/.test(category)) return 'display';
  if (/sensor/.test(category)) return 'sensor';
  if (/power/.test(category)) return 'power';
  if (/control|compute|logic/.test(category)) return 'controller';
  return 'part';
}
const symbolSvg = part => `<svg viewBox="0 0 150 120" aria-hidden="true" focusable="false">${symbols[partSymbol(part)]}</svg>`;
export function assemblyInventory(p) {
  const parts = p.parts.slice(0,30);
  return `<section class="part-inventory" aria-label="Conceptual component inventory"><div class="inventory-head"><h4>Component index <span>${parts.length} / ${p.parts.length}</span></h4><span>Illustrative symbols · not to scale</span></div><div class="inventory-grid">${parts.map((part,i) => `<article class="inventory-part"><div class="inventory-part-head"><span>${String(i+1).padStart(2,'0')} / ${escape(part.category)}</span><span>QTY <b>${escape(part.qty)}</b></span></div><div class="inventory-symbol">${symbolSvg(part)}</div><h5>${escape(part.name)}</h5></article>`).join('')}</div>${p.parts.length>30 ? `<p class="assembly-legend">Showing the first 30 of ${p.parts.length} parts. The Parts tab lists every part.</p>` : ''}</section>`;
}
function wrapName(value, limit=34) {
  const words=String(value).split(/\s+/).flatMap(word=>word.match(new RegExp(`.{1,${limit}}`,'gu')) || []), lines=[];
  for (const word of words) { const last=lines.length-1; if(last>=0 && lines[last].length+1+word.length<=limit) lines[last]+=' '+word; else lines.push(word); }
  return lines.length ? lines : [''];
}
// The downloadable diagram is independent of the current viewport and retains full names.
export function assemblySvg(p) {
  const parts=p.parts.slice(0,30), rows=[]; let y=66;
  for(let i=0;i<parts.length;i+=2) {
    const height=174+Math.max(...parts.slice(i,i+2).map(part=>wrapName(part.name).length))*20;
    rows.push(...parts.slice(i,i+2).map((part,j)=>({part,index:i+j,x:20+j*350,y,height})));
    y+=height+14;
  }
  const height=y+24;
  return `<svg class="assembly-svg" viewBox="0 0 740 ${height}" role="img" aria-label="Conceptual part inventory, ${parts.length} of ${p.parts.length} parts shown, illustrative symbols, not dimensioned CAD"><rect width="740" height="${height}" fill="#f4f5ed"/><text x="22" y="28" font-size="11" font-family="monospace" fill="#334d3e">COMPONENT INDEX / ${parts.length} OF ${p.parts.length}</text><text x="22" y="46" font-size="10" font-family="monospace" fill="#59715e">ILLUSTRATIVE SYMBOLS · NOT TO SCALE</text>${rows.map(({part,index,x,y,height:h})=>`<g><title>${escape(part.name)}</title><rect x="${x}" y="${y}" width="336" height="${h}" fill="#fffefa" stroke="#c5cebd"/><text x="${x+16}" y="${y+25}" font-family="monospace" font-size="10" fill="#4d6753">${String(index+1).padStart(2,'0')} / ${escape(String(part.category).slice(0,32))}</text><text x="${x+16}" y="${y+47}" font-family="monospace" font-size="10" fill="#4d6753">QTY ${escape(part.qty)}</text><g transform="translate(${x+93} ${y+35})">${symbols[partSymbol(part)]}</g>${wrapName(part.name).map((line,n)=>`<text x="${x+16}" y="${y+170+n*20}" font-family="Arial,sans-serif" font-size="16" font-weight="bold" fill="#14211f">${escape(line)}</text>`).join('')}</g>`).join('')}${p.parts.length>30 ? `<text x="22" y="${height-9}" font-family="monospace" font-size="10" fill="#4d6753">First 30 parts shown; project JSON contains the full inventory.</text>`:''}</svg>`;
}
