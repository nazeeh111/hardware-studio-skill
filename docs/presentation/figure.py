"""Nominal top views, exact source placements and separately reopened native results."""
from pathlib import Path
import json,html,hashlib
P=Path(__file__).parent;c=json.loads((P/'case.json').read_text())
for mobile in [False,True]:
 w,h=(375,940)if mobile else(1100,650);pad=24 if mobile else 36;s=[f'<svg xmlns="http://www.w3.org/2000/svg" width="100%" viewBox="0 0 {w} {h}" role="img" aria-labelledby="title desc"><title id="title">Valid structure is not verified clearance</title><desc id="desc">Two synthetic 10 by 8 by 4 millimetre spacers share one source. At second-instance x = 13 millimetres, reopened STEP solids have a nominal 3 millimetre gap. A separate control at x = 9 millimetres has 32 cubic millimetres of overlap and is labeled interference. Both are structurally valid. These top views use the same millimetre scale in both directions. The captured planning source and CAD hashes preserve one download; no physical fit or electrical safety is established.</desc><rect width="{w}" height="{h}" fill="#f6f4e9"/>']
 def text(x,y,t,size=16,color='#173c37',anchor='start'):s.append(f'<text x="{x}" y="{y}" font-family="Arial, Helvetica, sans-serif" font-size="{size}" fill="{color}" text-anchor="{anchor}">{html.escape(str(t))}</text>')
 def line(x1,y1,x2,y2,color='#788a7e'):s.append(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{color}"/>')
 text(pad,30,'HARDWARE STUDIO / SOURCE → NOMINAL CHECKS',10)
 for j,t in enumerate(['Valid structure is not','verified clearance.']if mobile else['Valid structure is not verified clearance.']):text(pad,73+j*34,t,28 if mobile else 38)
 text(pad,158 if mobile else 118,'One source. Two explicit placements. No hardware.',12 if mobile else 17)
 scale=11 if mobile else 15;panels=[]
 for i,xpos in enumerate([c['captured_second_x_mm'],c['control_second_x_mm']]):
  x0=48 if mobile else(62+i*540);top=(241+i*259)if mobile else 241;y0=top+8*scale;panels.append({'x0':x0,'y0':y0,'scale':scale,'second_x':xpos})
  text(x0-24,top-48,'01 / CAPTURED PROJECT'if i==0 else'02 / PLACEMENT CONTROL',11)
  for j,xx in enumerate([0,xpos]):
   s.append(f'<rect data-panel="{i}" data-instance="{j}" x="{x0+xx*scale}" y="{top}" width="{10*scale}" height="{8*scale}" fill="{"#dfe6d2"if j==0 else"#c5d9d1"}" stroke="#315a4f" stroke-width="1.5"/>');text(x0+(xx+5)*scale,top+4*scale,'A'if j==0 else'B',18,'#173c37','middle')
  if i==1:s.append(f'<rect data-overlap="true" x="{x0+9*scale}" y="{top}" width="{scale}" height="{8*scale}" fill="#ae5939" fill-opacity="0.8"/>')
  for xx in [0,10,xpos,xpos+10]:
   line(x0+xx*scale,y0+4,x0+xx*scale,y0+10);text(x0+xx*scale,y0+26,str(xx),10,'#526b60','middle')
  line(x0-10,top,x0-10,y0);text(x0-15,top+4*scale,'8',11,'#526b60','end')
  text(x0,y0+53,'x in mm · top view · height 4 mm',11)
  text(x0,top-18,'3 mm gap · native status PASSED'if i==0 else'32 mm³ overlap · INTERFERENCE',14,'#315a4f'if i==0 else'#a3492d')
 y=802 if mobile else 515;text(pad,y,'STRUCTURE ≠ NOMINAL GEOMETRY ≠ PHYSICAL FIT',10)
 text(pad,y+29,'The source checker passes both inputs.',14 if mobile else 20)
 text(pad,y+54,'STEP readback reports the placement difference.',12 if mobile else 17)
 text(pad,y+87,'Captured source + generated CAD + file hashes.',11 if mobile else 15)
 text(pad,h-20,'Same-kernel software checks. Fabrication and electrical review remain open.',9 if mobile else 12)
 s.append('</svg>');n='handoff-mobile.svg'if mobile else'handoff.svg';(P/n).write_text(''.join(s));
 if mobile:phone=panels
 else:wide=panels
(P/'figure-manifest.json').write_text(json.dumps({'input':'case.json','input_sha256':hashlib.sha256((P/'case.json').read_bytes()).hexdigest(),'encoding':'Nominal source rectangles x=origin+mm*scale, width=10*scale, height=8*scale; equal XY units and common scale between the two panels. Native STEP check independently corroborates gap and overlap. No physical measurement.','variants':{'handoff.svg':wide,'handoff-mobile.svg':phone}},indent=2)+'\n')
