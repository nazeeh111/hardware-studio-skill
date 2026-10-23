"""Directly check the downloaded one-millimeter interference study with OCP."""
import copy
import hashlib
import json
import math
from pathlib import Path
import sys
import tempfile
import zipfile

sys.dont_write_bytecode=True
from OCP.BRepAlgoAPI import BRepAlgoAPI_Common
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepExtrema import BRepExtrema_DistShapeShape
from OCP.BRepGProp import BRepGProp
from OCP.Bnd import Bnd_Box
from OCP.GProp import GProp_GProps
from OCP.IFSelect import IFSelect_RetDone
from OCP.STEPControl import STEPControl_Reader
from OCP.TopAbs import TopAbs_SOLID
from OCP.TopExp import TopExp_Explorer
from OCP.gp import gp_Trsf,gp_Vec

ROOT=Path(__file__).resolve().parent
BASE=ROOT.parent

def require(test,message):
    if not test:raise ValueError(message)

def close(a,b,tolerance=1e-5):require(math.isfinite(a) and abs(a-b)<=tolerance,f'Expected {b}, got {a}.')

def volume(shape):
    properties=GProp_GProps();BRepGProp.VolumeProperties_s(shape,properties)
    return properties.Mass()

def bounds(shape):
    box=Bnd_Box();BRepBndLib.AddOptimal_s(shape,box,False,False)
    low,high=box.CornerMin(),box.CornerMax()
    return [[low.X(),low.Y(),low.Z()],[high.X(),high.Y(),high.Z()]]

def solids(shape):
    result=[];e=TopExp_Explorer(shape,TopAbs_SOLID)
    while e.More():result.append(e.Current());e.Next()
    return result

def read_step(path):
    text=path.read_text()
    require('.MILLI.' in text and '.METRE.' in text,'Missing explicit STEP millimeter units.')
    reader=STEPControl_Reader()
    require(reader.ReadFile(str(path))==IFSelect_RetDone and reader.TransferRoots()>0,'STEP read failed.')
    shape=reader.OneShape()
    require(not shape.IsNull() and BRepCheck_Analyzer(shape).IsValid(),'Invalid STEP geometry.')
    return shape

def overlap(a,b):
    common=BRepAlgoAPI_Common(a,b);common.Build()
    require(common.IsDone(),'Intersection failed.')
    return 0. if common.Shape().IsNull() else max(0.,volume(common.Shape()))

def same_geometry(a,b):
    close(volume(a),volume(b));close(overlap(a,b),volume(b))
    for aa,bb in zip(bounds(a),bounds(b)):
        for x,y in zip(aa,bb):close(x,y)

def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    archive=ROOT/'hardware-studio-assembly-cad.zip'
    baseline=json.loads((BASE/'expected-assembly.json').read_text())
    expected=copy.deepcopy(baseline);expected['instances'][1]['position'][2]=2
    with zipfile.ZipFile(archive) as zipped:
        require(zipped.testzip() is None,'ZIP CRC failed.')
        require(len(zipped.namelist())==16 and len(set(zipped.namelist()))==16,'Unexpected ZIP member count.')
        for name in ('spec.json','verification.json'):
            require((ROOT/name).read_bytes()==zipped.read(name),'Retained member bytes differ from archive: '+name)
        spec=json.loads(zipped.read('spec.json'));reported=json.loads(zipped.read('verification.json'))
        require(spec==expected,'Expected only standoff-1 Z placement to change from 3 to 2 mm.')
        require(reported['status']=='interference','Generator did not report interference.')
        with tempfile.TemporaryDirectory(prefix='hardware-studio-interference-check-') as temporary:
            temporary=Path(temporary)
            paths=['assembly.step']+[f'instances/instance-{i:03d}.step' for i in (1,2,3)]
            shapes=[]
            for name in paths:
                local=temporary/Path(name).name;local.write_bytes(zipped.read(name))
                shapes.append(read_step(local))
            combined,instances=shapes[0],shapes[1:]
            baseline_checks=[]
            for i,actual in enumerate(instances,1):
                require(len(solids(actual))==1,'Expected one solid per placed instance.')
                original=read_step(BASE/'checked-cad/package/instances'/f'instance-{i:03d}.step')
                if i==2:
                    t=gp_Trsf();t.SetTranslation(gp_Vec(0,0,-1))
                    original=BRepBuilderAPI_Transform(original,t,True).Shape()
                same_geometry(actual,original)
                baseline_checks.append({'instance':i,'change':'Z -1 mm' if i==2 else 'unchanged','bounds_mm':bounds(actual),'volume_mm3':volume(actual),'matches_baseline_after_explicit_change':True})
            pieces=solids(combined);require(len(pieces)==3,'Combined STEP lost a solid.')
            remaining=list(pieces)
            for actual in instances:
                matched=None
                for i,piece in enumerate(remaining):
                    try:same_geometry(piece,actual);matched=i;break
                    except ValueError:continue
                require(matched is not None,'Combined STEP has a missing or unexpected placement.')
                remaining.pop(matched)
            total=48*32*3-2*math.pi*2**2*3+2*math.pi*(4**2-2**2)*10
            close(volume(combined),total)
            overall=bounds(combined)
            for actual,wanted in zip(overall,[[0,0,0],[32,48,13]]):
                for x,y in zip(actual,wanted):close(x,y)
            pairs=[]
            for a,b,expected_overlap,expected_gap in [(0,1,12*math.pi,0),(0,2,0,0),(1,2,0,24)]:
                common=overlap(instances[a],instances[b]);close(common,expected_overlap)
                distance=BRepExtrema_DistShapeShape(instances[a],instances[b]);distance.Perform()
                require(distance.IsDone(),'Distance calculation failed.');close(distance.Value(),expected_gap)
                pairs.append({'firstId':spec['instances'][a]['id'],'secondId':spec['instances'][b]['id'],'overlap_mm3':common,'analytic_expected_overlap_mm3':expected_overlap,'minimum_distance_mm':distance.Value(),'expected_distance_mm':expected_gap})
            require(len(reported['pairs'])==3,'Reported pair list differs.')
            for actual,claim in zip(pairs,reported['pairs']):
                require(actual['firstId']==claim['firstId'] and actual['secondId']==claim['secondId'],'Reported pair IDs differ.')
                close(claim['overlap_mm3'],actual['overlap_mm3']);close(claim['minimum_distance_mm'],actual['minimum_distance_mm'])
                require(claim['interference']==(actual['overlap_mm3']>.01),'Reported interference flag differs.')
    report={'schema':'hardware-studio-interference-intent-check-v1','status':'passed','observed_assembly_status':'interference',
            'archive_crc':'passed','archive_members':16,'retained_json_bytes_equal_archive':True,
            'only_source_change':'standoff-1 position Z: 3 -> 2 mm; all other source fields and both asset sources unchanged',
            'sha256':{'browser_zip':sha(archive),'spec.json':sha(ROOT/'spec.json'),'verification.json':sha(ROOT/'verification.json'),'expected_baseline':sha(BASE/'expected-assembly.json'),'verifier':sha(Path(__file__))},
            'instances':baseline_checks,'combined':{'solid_count':3,'bounds_mm':overall,'volume_mm3':volume(combined),'expected_volume_mm3':total},
            'pairs':pairs,'reported_pairs_match_independent_checks':True,
            'limits':['Independent direct STEP geometry comparison and analytic overlap checks use the same OpenCascade kernel as generation.','This deliberately overlapping nominal geometry is an interference demonstration, not a physically validated fit or build.']}
    destination=ROOT/'independent-check.json';destination.write_text(json.dumps(report,indent=2,allow_nan=False)+'\n')
    print(json.dumps({'status':'passed','output':str(destination),'pairs':pairs,'source_change_only_standoff_z':True}))

if __name__=='__main__':main()
