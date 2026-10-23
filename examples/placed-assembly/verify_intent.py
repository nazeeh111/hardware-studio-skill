"""Verify the retained browser download against this study's explicit dimensions.

Run with an OCP-enabled Python. Expected geometry below is handwritten from
before-project.json, not inferred from the generator's verification report.
"""
import hashlib
import json
import math
from pathlib import Path
import struct
import sys
import zipfile

sys.dont_write_bytecode = True
from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepAlgoAPI import BRepAlgoAPI_Common
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepExtrema import BRepExtrema_DistShapeShape
from OCP.BRepGProp import BRepGProp
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
from OCP.Bnd import Bnd_Box
from OCP.GProp import GProp_GProps
from OCP.GeomAbs import GeomAbs_Cylinder
from OCP.IFSelect import IFSelect_RetDone
from OCP.STEPControl import STEPControl_Reader
from OCP.TopAbs import TopAbs_FACE, TopAbs_SOLID
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS
from OCP.gp import gp_Ax1, gp_Ax2, gp_Dir, gp_Pnt, gp_Trsf, gp_Vec

ROOT = Path(__file__).resolve().parent
CAD = ROOT/'checked-cad'
PACKAGE = CAD/'package'
PLATE_VOLUME = 48*32*3 - 2*math.pi*2**2*3
STANDOFF_VOLUME = math.pi*(4**2-2**2)*10

def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def require(condition, message):
    if not condition: raise ValueError(message)

def close(actual, expected, tolerance=1e-4):
    require(math.isfinite(actual) and abs(actual-expected) <= tolerance, f'Expected {expected}, got {actual}.')

def vector(actual, expected, tolerance=1e-4):
    require(len(actual)==len(expected), 'Vector length differs.')
    for a, b in zip(actual, expected): close(a, b, tolerance)

def volume(shape):
    p = GProp_GProps(); BRepGProp.VolumeProperties_s(shape, p)
    return p.Mass()

def bounds(shape):
    b = Bnd_Box(); BRepBndLib.AddOptimal_s(shape, b, False, False)
    low, high = b.CornerMin(), b.CornerMax()
    return {'min_mm': [low.X(), low.Y(), low.Z()], 'max_mm': [high.X(), high.Y(), high.Z()]}

def solids(shape):
    result, e = [], TopExp_Explorer(shape, TopAbs_SOLID)
    while e.More(): result.append(e.Current()); e.Next()
    return result

def read_step(path):
    text = path.read_text(errors='strict')
    require('.MILLI.' in text and '.METRE.' in text, 'STEP lacks explicit millimeter unit declaration.')
    reader = STEPControl_Reader()
    require(reader.ReadFile(str(path))==IFSelect_RetDone and reader.TransferRoots()>0, 'STEP read failed.')
    shape = reader.OneShape()
    require(not shape.IsNull() and BRepCheck_Analyzer(shape).IsValid(), 'Invalid STEP shape.')
    return shape

def common_volume(first, second):
    result = BRepAlgoAPI_Common(first, second); result.Build()
    require(result.IsDone(), 'Intersection failed.')
    return 0 if result.Shape().IsNull() else max(0., volume(result.Shape()))

def cylinders(shape):
    result, e = [], TopExp_Explorer(shape, TopAbs_FACE)
    while e.More():
        face = TopoDS.Face(e.Current()); surface = BRepAdaptor_Surface(face, True)
        if surface.GetType()==GeomAbs_Cylinder:
            c = surface.Cylinder(); axis, origin = c.Axis().Direction(), c.Location()
            result.append({'radius_mm': c.Radius(), 'center_xy_mm': [origin.X(), origin.Y()],
                           'axis': [axis.X(), axis.Y(), axis.Z()], 'surface_bounds': bounds(face)})
        e.Next()
    return result

def expectation(low, high, volume_, cylinders_, material):
    return {'low': low, 'high': high, 'volume': volume_, 'cylinders': cylinders_, 'material': material}

def cyl(x, y, radius, z0, z1): return (x, y, radius, z0, z1)

EXPECTED = [
    expectation([0,0,0], [32,48,3], PLATE_VOLUME, [cyl(16,8,2,0,3),cyl(16,40,2,0,3)], [1,1,.5,1,1,2]),
    expectation([12,4,3], [20,12,13], STANDOFF_VOLUME, [cyl(16,8,2,3,13),cyl(16,8,4,3,13)], [18.5,7.5,4,1,1,8]),
    expectation([12,36,3], [20,44,13], STANDOFF_VOLUME, [cyl(16,40,2,3,13),cyl(16,40,4,3,13)], [18.5,39.5,4,1,1,8]),
]

def check_shape(shape, expected):
    require(len(solids(shape))==1, 'Expected one solid per instance.')
    b = bounds(shape); vector(b['min_mm'], expected['low']); vector(b['max_mm'], expected['high'])
    v = volume(shape); close(v, expected['volume'])
    faces = cylinders(shape)
    require(len(faces)==len(expected['cylinders']), 'Cylindrical face count differs from explicit bores/walls.')
    remaining = list(faces)
    void_checks = []
    for x, y, radius, z0, z1 in expected['cylinders']:
        matched = next((i for i, f in enumerate(remaining) if abs(f['radius_mm']-radius)<1e-5 and all(abs(a-b)<1e-5 for a,b in zip(f['center_xy_mm'], [x,y]))), None)
        require(matched is not None, 'Expected cylindrical radius or world-space center is absent.')
        face = remaining.pop(matched)
        vector(face['axis'][:2], [0,0]); close(abs(face['axis'][2]), 1)
        close(face['surface_bounds']['min_mm'][2], z0); close(face['surface_bounds']['max_mm'][2], z1)
        if radius==2:
            probe = BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(x,y,z0),gp_Dir(0,0,1)),1.9,z1-z0).Shape()
            overlap = common_volume(shape, probe); close(overlap, 0, 1e-6)
            void_checks.append({'center_xy_mm': [x,y], 'probe_radius_mm': 1.9, 'overlap_mm3': overlap})
    x,y,z,dx,dy,dz = expected['material']
    probe = BRepPrimAPI_MakeBox(gp_Pnt(x,y,z),dx,dy,dz).Shape()
    material = common_volume(shape, probe); close(material, dx*dy*dz, 1e-6)
    return {**b, 'volume_mm3': v, 'analytic_expected_volume_mm3': expected['volume'], 'cylindrical_faces': faces,
            'bore_void_checks': void_checks, 'material_probe_overlap_mm3': material}

def check_stl(path, expected):
    data = path.read_bytes(); require(len(data)>=84, 'Incomplete STL.')
    count = struct.unpack_from('<I',data,80)[0]
    require(count>=4 and len(data)==84+50*count, 'STL byte length or triangle count differs.')
    low, high = [math.inf]*3, [-math.inf]*3
    for i in range(count):
        values = struct.unpack_from('<12f',data,84+50*i)
        require(all(math.isfinite(n) for n in values), 'Non-finite STL.')
        for vertex in range(3):
            for axis in range(3):
                n=values[3+3*vertex+axis]; low[axis]=min(low[axis],n);high[axis]=max(high[axis],n)
    vector(low,expected['low'],.05);vector(high,expected['high'],.05)
    return {'triangles':count,'min_mm':low,'max_mm':high}

def negative_control(shape, expected, transform, label):
    changed = BRepBuilderAPI_Transform(shape,transform,True).Shape()
    close(volume(changed),volume(shape))
    try: check_shape(changed,expected)
    except ValueError as error:
        return {'control':label,'rejected':True,'same_volume_mm3':volume(changed),'reason':str(error)}
    raise ValueError('Negative control was incorrectly accepted: '+label)

def main():
    archive = CAD/'hardware-studio-assembly-cad.zip'
    source_path = CAD/'hardware-studio-assembly-source.json'
    expected_source = json.loads((ROOT/'expected-assembly.json').read_text())
    require(json.loads(source_path.read_text())==expected_source,'Browser source differs from the predeclared expected assembly.')
    before = json.loads((ROOT/'before-project.json').read_text())
    require(expected_source['assets'][0]['source']==before['solidSpec'],'Plate source differs from retained before-project source.')
    with zipfile.ZipFile(archive) as z:
        require(z.testzip() is None,'ZIP CRC failed.')
        require(len(z.namelist())==len(set(z.namelist())),'Duplicate ZIP members.')
        files={p.relative_to(PACKAGE).as_posix() for p in PACKAGE.rglob('*') if p.is_file()}
        require(files==set(z.namelist()),'Extracted package file list differs from ZIP.')
        for name in z.namelist(): require((PACKAGE/name).read_bytes()==z.read(name),'Extracted bytes differ: '+name)
        require(json.loads(z.read('spec.json'))==expected_source,'CAD ZIP source differs from expected/browser source.')
    instance_results, shapes = [], []
    for i, expected in enumerate(EXPECTED,1):
        path=PACKAGE/'instances'/f'instance-{i:03d}.step';shape=read_step(path)
        shapes.append(shape)
        instance_results.append({'file':path.relative_to(PACKAGE).as_posix(),**check_shape(shape,expected),
                                 'stl':check_stl(path.with_suffix('.stl'),expected),'step_sha256':digest(path),'stl_sha256':digest(path.with_suffix('.stl'))})
    combined=read_step(PACKAGE/'assembly.step');pieces=solids(combined)
    require(len(pieces)==3,'Combined STEP must retain all three unfused solids.')
    remaining=list(pieces)
    for expected in EXPECTED:
        found=None
        for i,piece in enumerate(remaining):
            try: check_shape(piece,expected);found=i;break
            except ValueError: continue
        require(found is not None,'Combined STEP lost or misplaced an expected solid.');remaining.pop(found)
    b=bounds(combined);vector(b['min_mm'],[0,0,0]);vector(b['max_mm'],[32,48,13])
    close(volume(combined),PLATE_VOLUME+2*STANDOFF_VOLUME)
    pairs=[]
    for i,j,gap in [(0,1,0),(0,2,0),(1,2,24)]:
        overlap=common_volume(shapes[i],shapes[j]);close(overlap,0,1e-6)
        distance=BRepExtrema_DistShapeShape(shapes[i],shapes[j]);distance.Perform()
        require(distance.IsDone(),'Pair distance failed.');close(distance.Value(),gap,1e-5)
        pairs.append({'first_instance':i+1,'second_instance':j+1,'overlap_mm3':overlap,'minimum_distance_mm':distance.Value(),'expected_distance_mm':gap})
    local_plate=expectation([0,0,0],[48,32,3],PLATE_VOLUME,[cyl(8,16,2,0,3),cyl(40,16,2,0,3)],[1,1,.5,1,1,2])
    local_standoff=expectation([-4,-4,0],[4,4,10],STANDOFF_VOLUME,[cyl(0,0,2,0,10),cyl(0,0,4,0,10)],[2.5,-.5,1,1,1,8])
    local=[check_shape(read_step(PACKAGE/'assets/part-001/solid.step'),local_plate),check_shape(read_step(PACKAGE/'assets/part-002/solid.step'),local_standoff)]
    moved=gp_Trsf();moved.SetTranslation(gp_Vec(1,0,0))
    rotated=gp_Trsf();rotated.SetRotation(gp_Ax1(gp_Pnt(0,0,0),gp_Dir(0,0,1)),math.pi/2)
    controls=[negative_control(shapes[1],EXPECTED[1],moved,'standoff shifted +1 mm in world X'),negative_control(shapes[0],EXPECTED[0],rotated,'plate rotated an extra +90 degrees about world Z')]
    report={'schema':'hardware-studio-placed-assembly-intent-check-v1','status':'passed','scope':'This retained, explicitly dimensioned nominal placement study only.',
            'source_equality':{'browser_source_expected_assembly':True,'zip_spec_expected_assembly':True,'plate_matches_before_project':True},
            'archive_crc':'passed','extracted_member_count':len(files),'all_extracted_bytes_equal_archive':True,
            'sha256':{'browser_zip':digest(archive),'browser_source':digest(source_path),'expected_source':digest(ROOT/'expected-assembly.json'),'before_project':digest(ROOT/'before-project.json'),'assembly_step':digest(PACKAGE/'assembly.step'),'verifier':digest(Path(__file__))},
            'instances':instance_results,'local_assets':local,'combined':{**b,'solid_count':3,'volume_mm3':volume(combined),'analytic_expected_volume_mm3':PLATE_VOLUME+2*STANDOFF_VOLUME},
            'pairs':pairs,'negative_controls':controls,'limits':['Direct STEP inspection and analytic expectations are independent of the generator report, but use the same OpenCascade kernel.','No joint constraints, fastener, material, load, manufacturing clearance, supplier accuracy or physical fit was tested.','Zero nominal distance is contact; it does not establish a manufacturable mating fit.']}
    out=ROOT/'intent-verification.json';out.write_text(json.dumps(report,indent=2,allow_nan=False)+'\n')
    print(json.dumps({'status':'passed','output':str(out),'zip_members':len(files),'solids':3,'bounds_mm':[32,48,13],'pairs':pairs,'negative_controls_rejected':len(controls)}))

if __name__=='__main__':main()
