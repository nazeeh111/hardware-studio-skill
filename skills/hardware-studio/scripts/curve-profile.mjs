// Data-only analytic line/three-point-arc wire contract. Mirror in the CAD builder.
export const CURVE_EPS=1e-7;
const EPS=CURVE_EPS,TAU=2*Math.PI;
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1]];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1];
const cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
const distance=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const near=(a,b)=>distance(a,b)<=EPS;
const mod=a=>((a%TAU)+TAU)%TAU;
function point(raw,label){
 if(!Array.isArray(raw)||raw.length!==2||raw.some(n=>typeof n!=='number'||!Number.isFinite(n)||Math.abs(n)>500))throw new Error(`${label} needs two finite coordinates within 500 mm.`);
 return [...raw];
}
/** Signed radians, through via; winding is preserved, never polygonized. */
export function arcGeometry(startRaw,viaRaw,endRaw){
 const a=point(startRaw,'Arc start'),b=point(viaRaw,'Arc via'),c=point(endRaw,'Arc end');
 const ab=sub(b,a),ac=sub(c,a),bc=sub(c,b),det=cross(ab,ac),chord=Math.hypot(...ac);
 if(Math.min(Math.hypot(...ab),chord,Math.hypot(...bc))<=EPS||Math.abs(det)<=EPS*chord)throw new Error('Arc points must be distinct and noncollinear.');
 const ab2=dot(ab,ab),ac2=dot(ac,ac);
 const center=[a[0]+(ab2*ac[1]-ac2*ab[1])/(2*det),a[1]+(ab[0]*ac2-ac[0]*ab2)/(2*det)];
 const radius=distance(a,center);
 if(!Number.isFinite(radius)||radius<.01||radius>500)throw new Error('Arc radius must be 0.01–500 mm.');
 const startAngle=Math.atan2(a[1]-center[1],a[0]-center[0]);
 const endAngle=Math.atan2(c[1]-center[1],c[0]-center[0]);
 const viaAngle=Math.atan2(b[1]-center[1],b[0]-center[0]);
 const ccw=mod(endAngle-startAngle),sweep=mod(viaAngle-startAngle)<ccw?ccw:ccw-TAU;
 return {center,radius,startAngle,sweep};
}
const arcPoint=(g,angle)=>[g.center[0]+g.radius*Math.cos(angle),g.center[1]+g.radius*Math.sin(angle)];
function onArc(g,p){
 if(Math.abs(distance(g.center,p)-g.radius)>EPS)return false;
 if(near(p,g.a)||near(p,g.b))return true;
 const angle=Math.atan2(p[1]-g.center[1],p[0]-g.center[0]);
 return (g.sweep>0?mod(angle-g.startAngle):mod(g.startAngle-angle))<=Math.abs(g.sweep)+EPS/g.radius;
}
function onLine(e,p){const v=sub(e.b,e.a),w=sub(p,e.a),length=Math.hypot(...v);return Math.abs(cross(v,w))<=EPS*length&&dot(w,v)>=-EPS*length&&dot(w,v)<=dot(v,v)+EPS*length;}
const within=(e,p)=>e.kind==='arc'?onArc(e,p):onLine(e,p);
function lineLine(a,b){
 const r=sub(a.b,a.a),s=sub(b.b,b.a),q=sub(b.a,a.a),den=cross(r,s),lr=Math.hypot(...r),ls=Math.hypot(...s);
 if(Math.abs(den)<=1e-12*lr*ls){
  if(Math.abs(cross(q,r))>EPS*lr)return {points:[]};
  const t0=dot(q,r)/dot(r,r),t1=t0+dot(s,r)/dot(r,r),low=Math.max(0,Math.min(t0,t1)),high=Math.min(1,Math.max(t0,t1));
  if((high-low)*lr>EPS)return {overlap:true,points:[]};
  return {points:[a.a,a.b,b.a,b.b].filter(p=>onLine(a,p)&&onLine(b,p))};
 }
 const t=cross(q,s)/den,u=cross(q,r)/den;
 return {points:t>=-EPS/lr&&t<=1+EPS/lr&&u>=-EPS/ls&&u<=1+EPS/ls?[[a.a[0]+t*r[0],a.a[1]+t*r[1]]]:[]};
}
function lineArc(line,arc){
 const v=sub(line.b,line.a),length=Math.hypot(...v),unit=v.map(n=>n/length),q=sub(arc.center,line.a),projection=dot(q,unit),h2=arc.radius**2-(dot(q,q)-projection**2);
 if(h2<-EPS*(2*arc.radius+EPS))return {points:[]};
 const h=Math.sqrt(Math.max(0,h2)),points=[];
 for(const t of [projection-h,projection+h])if(t>=-EPS&&t<=length+EPS){const p=[line.a[0]+t*unit[0],line.a[1]+t*unit[1]];if(onArc(arc,p))points.push(p);}
 return {points};
}
// Positive-angle coverage splits at 0; overlap length is analytic, including wrap.
function intervals(arc){
 const start=mod(arc.sweep>0?arc.startAngle:arc.startAngle+arc.sweep),end=start+Math.abs(arc.sweep);
 return end<=TAU?[[start,end]]:[[start,TAU],[0,end-TAU]];
}
function arcArc(a,b){
 const delta=sub(b.center,a.center),d=Math.hypot(...delta);
 if(d<=EPS&&Math.abs(a.radius-b.radius)<=EPS){
  const overlap=intervals(a).some(x=>intervals(b).some(y=>(Math.min(x[1],y[1])-Math.max(x[0],y[0]))*a.radius>EPS));
  return {overlap,points:[a.a,a.b,b.a,b.b].filter(p=>onArc(a,p)&&onArc(b,p))};
 }
 if(d<=EPS||d>a.radius+b.radius+EPS||d<Math.abs(a.radius-b.radius)-EPS)return {points:[]};
 const along=(a.radius**2-b.radius**2+d*d)/(2*d),h2=a.radius**2-along**2;
 if(h2<-EPS*(2*a.radius+EPS))return {points:[]};
 const h=Math.sqrt(Math.max(0,h2)),u=delta.map(n=>n/d),base=[a.center[0]+along*u[0],a.center[1]+along*u[1]];
 return {points:[1,-1].map(sign=>[base[0]-sign*h*u[1],base[1]+sign*h*u[0]]).filter(p=>onArc(a,p)&&onArc(b,p))};
}
function intersections(a,b){return a.kind==='line'?(b.kind==='line'?lineLine(a,b):lineArc(a,b)):(b.kind==='line'?lineArc(b,a):arcArc(a,b));}
export function validateCurveProfile(startRaw,segmentsRaw){
 const start=point(startRaw,'Curve start');
 if(!Array.isArray(segmentsRaw)||segmentsRaw.length<2||segmentsRaw.length>64)throw new Error('Curve needs 2–64 line or arc segments.');
 const segments=segmentsRaw.map((s,i)=>{
  const keys=s?.kind==='line'?['kind','end']:['kind','via','end'];
  if(!s||typeof s!=='object'||Array.isArray(s)||!['line','arc'].includes(s.kind)||Object.keys(s).some(k=>!keys.includes(k)))throw new Error(`Curve segment ${i+1} has unsupported fields or kind.`);
  return s.kind==='arc'?{kind:'arc',via:point(s.via,'Arc via'),end:point(s.end,'Curve end')}:{kind:'line',end:point(s.end,'Curve end')};
 });
 if(!near(segments.at(-1).end,start))throw new Error('Curve must close explicitly at its start.');
 segments.at(-1).end=[...start];
 let previous=start,area2=0;
 const edges=segments.map(s=>{
  const a=previous,b=s.end;previous=b;
  if(distance(a,b)<.01)throw new Error('Curve edge chords must be at least 0.01 mm.');
  const edge=s.kind==='arc'?{kind:'arc',a,b,...arcGeometry(a,s.via,b)}:{kind:'line',a,b};
  area2+=s.kind==='arc'?edge.center[0]*(b[1]-a[1])-edge.center[1]*(b[0]-a[0])+edge.radius**2*edge.sweep:cross(a,b);
  return edge;
 });
 for(let i=0;i<edges.length;i++)for(let j=i+1;j<edges.length;j++){
  const a=edges[i],b=edges[j],allowed=[];
  if(j===i+1)allowed.push(a.b);
  if(i===0&&j===edges.length-1)allowed.push(a.a);
  const hit=intersections(a,b);
  if(hit.overlap||hit.points.some(p=>!allowed.some(q=>near(p,q))))throw new Error('Curve edges cross, touch or overlap away from a shared endpoint.');
  // Endpoint contact also protects against tiny analytic-solver roundoff.
  for(const p of [a.a,a.b,b.a,b.b])if(within(a,p)&&within(b,p)&&!allowed.some(q=>near(p,q)))throw new Error('Curve edges cross or touch away from a shared endpoint.');
 }
 if(Math.abs(area2/2)<=EPS)throw new Error('Curve needs nonzero enclosed area.');
 return {start,segments};
}
/** SVG data in the supplied local coordinates. A caller may flip Y for display. */
export function curvePathData(start,segments){
 const normalized=validateCurveProfile(start,segments);let previous=normalized.start;
 const commands=[`M ${previous.join(' ')}`];
 for(const s of normalized.segments){
  if(s.kind==='line')commands.push(`L ${s.end.join(' ')}`);
  else {const g=arcGeometry(previous,s.via,s.end);commands.push(`A ${g.radius} ${g.radius} 0 ${Math.abs(g.sweep)>Math.PI?1:0} ${g.sweep>0?1:0} ${s.end.join(' ')}`);}
  previous=s.end;
 }
 return commands.join(' ')+' Z';
}
/** Exact line/arc extrema, including any cardinal angles on each swept arc. */
export function curveProfileBounds(start,segments){
 const wire=validateCurveProfile(start,segments),points=[wire.start];let previous=wire.start;
 for(const s of wire.segments){
  points.push(s.end);
  if(s.kind==='arc'){
   const arc={a:previous,b:s.end,...arcGeometry(previous,s.via,s.end)};
   for(const angle of [0,Math.PI/2,Math.PI,3*Math.PI/2]){const p=arcPoint(arc,angle);if(onArc(arc,p))points.push(p);}
  }
  previous=s.end;
 }
 return {min:[0,1].map(i=>Math.min(...points.map(p=>p[i]))),max:[0,1].map(i=>Math.max(...points.map(p=>p[i])))};
}
