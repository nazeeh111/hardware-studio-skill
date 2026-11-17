"""Read one actual captured handoff; --cad separately reopens nominal STEP solids."""
from pathlib import Path
import argparse,io,json,hashlib,zipfile,tempfile
P=Path(__file__).resolve().parent
sha=lambda b:hashlib.sha256(b).hexdigest()
def require(ok,message):
 if not ok:raise ValueError(message)
def main():
 ap=argparse.ArgumentParser(description=__doc__);ap.add_argument('--cad',action='store_true');args=ap.parse_args()
 if (P/'MANIFEST.json').exists():
  for n,h in json.loads((P/'MANIFEST.json').read_text())['sha256'].items():require(sha((P/n).read_bytes())==h,'Changed bundle payload: '+n)
 c=json.loads((P/'case.json').read_text());project=json.loads((P/'captured-project.json').read_text());later=json.loads((P/'later-project.json').read_text());require({k for k in set(project)|set(later)if project.get(k)!=later.get(k)}=={'notes','updatedAt'},'Later project changes exceed captured note edit')
 require(not any(project['review'].values()),'Example unexpectedly claims completed engineering review')
 with zipfile.ZipFile(P/'checked-cad.zip')as z:
  require(z.testzip()is None,'Bad native archive CRC');m=json.loads(z.read('cad-package-manifest.json'));require(len(z.namelist())==24 and len(m['files'])==23,'Native archive membership changed')
  require(set(z.namelist())==set(m['files'])|{'cad-package-manifest.json'},'Native manifest closure differs')
  for n,r in m['files'].items():require(sha(z.read(n))==r['sha256']and len(z.read(n))==r['bytes'],'Native file changed: '+n)
  require(sha(z.read('captured-source.zip'))==m['source_archive_sha256']==c['captured_source_sha256'],'Source ZIP binding differs');require(z.read('captured-source.zip')==(P/'captured-source.zip').read_bytes(),'External source capture differs')
  with zipfile.ZipFile(io.BytesIO(z.read('captured-source.zip')))as source:
   require(len(source.namelist())==11,'Source member count differs')
   for n in source.namelist():require(source.read(n)==z.read(n),'Root source bytes differ: '+n)
  require(json.loads(z.read('project.json'))==project,'Captured project differs');positive=json.loads(z.read('generated-cad/assembly/verification.json'));control=json.loads((P/'control-readback.json').read_text());require(positive['status']=='passed'and control['status']=='interference','Stored result status differs');require(abs(positive['pairs'][0]['minimum_distance_mm']-3)<1e-8 and abs(control['pairs'][0]['overlap_mm3']-32)<1e-8,'Stored nominal result differs')
  if args.cad:
   from OCP.STEPControl import STEPControl_Reader
   from OCP.IFSelect import IFSelect_RetDone
   from OCP.BRepGProp import BRepGProp
   from OCP.GProp import GProp_GProps
   from OCP.BRepExtrema import BRepExtrema_DistShapeShape
   from OCP.BRepAlgoAPI import BRepAlgoAPI_Common
   def read(p):
    r=STEPControl_Reader();require(r.ReadFile(str(p))==IFSelect_RetDone,'STEP refused');r.TransferRoots();return r.OneShape()
   def volume(s):
    g=GProp_GProps();BRepGProp.VolumeProperties_s(s,g);return g.Mass()
   with tempfile.TemporaryDirectory(prefix='hardware-recipient-')as tmp:
    t=Path(tmp)
    for i in [1,2]:(t/f'a{i}.step').write_bytes(z.read(f'generated-cad/assembly/instances/instance-00{i}.step'))
    with zipfile.ZipFile(P/'control-cad.zip')as q:
     for i in [1,2]:(t/f'b{i}.step').write_bytes(q.read(f'instances/instance-00{i}.step'))
    a,b=read(t/'a1.step'),read(t/'a2.step');distance=BRepExtrema_DistShapeShape(a,b);distance.Perform();require(abs(volume(a)-320)<1e-8 and abs(volume(b)-320)<1e-8 and abs(distance.Value()-3)<1e-8,'Fresh STEP positive check failed');require(abs(volume(BRepAlgoAPI_Common(read(t/'b1.step'),read(t/'b2.step')).Shape())-32)<1e-8,'Fresh STEP control failed')
 print(json.dumps({'native_archive_members':24,'native_payload_hashes':23,'source_members':11,'all_source_and_payload_bytes_verified':True,'notes_edit_separate_from_capture':True,'review_marks_false':True,'stored_gap_mm':3,'stored_control_overlap_mm3':32,'fresh_same_kernel_STEP_reopened':args.cad,'physical_validation':False},indent=2))
if __name__=='__main__':main()
