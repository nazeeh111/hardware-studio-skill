"""Independent OCP inspection of the retained, instruction-specific pull tab.

This imports no Hardware Studio builder or verification helpers. Constants and
analytic expectations below are derived from the captured instruction, not the
model's probes, source-derived expected geometry, or generated build report.
"""
import argparse
import hashlib
import importlib.metadata
import json
import math
from pathlib import Path
import zipfile

from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface
from OCP.BRepAlgoAPI import BRepAlgoAPI_Common, BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepGProp import BRepGProp
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
from OCP.Bnd import Bnd_Box
from OCP.GeomAbs import GeomAbs_Circle, GeomAbs_Cylinder, GeomAbs_Line, GeomAbs_Plane, GeomAbs_Torus
from OCP.GProp import GProp_GProps
from OCP.IFSelect import IFSelect_RetDone
from OCP.STEPControl import STEPControl_Reader
from OCP.ShapeUpgrade import ShapeUpgrade_UnifySameDomain
from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE, TopAbs_SOLID
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS
from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt, gp_Trsf

ROOT = Path(__file__).resolve().parent
INSTRUCTION_SHA256 = '03a0c5a5251393c5f5c99d5aef9bfa95676b560026f1ec05d819be276ddfd1bf'
EPS = 2e-6
AREA = 400 + 100*math.pi
PERIMETER = 40 + 20*math.pi
# Top round: for t=z-5 in [0,1], inward offset d=1-sqrt(1-t*t).
# Capsule offset area is A-P*d+pi*d*d. Integrals: int d=1-pi/4;
# int d*d=5/3-pi/2. The R3 bore is unchanged and subtracts 6*pi*3^2.
REMOVED_TOP_ROUND = PERIMETER*(1-math.pi/4)-math.pi*(5/3-math.pi/2)
EXPECTED_VOLUME = 6*(AREA-9*math.pi)-REMOVED_TOP_ROUND


def require(condition, message):
    if not condition:
        raise ValueError(message)


def close(actual, expected, message, tolerance=EPS):
    require(math.isfinite(actual) and abs(actual-expected) <= tolerance,
            f'{message}: got {actual}, expected {expected} ±{tolerance}.')


def vector(actual, expected, message):
    require(len(actual) == len(expected), message)
    for index, (a,b) in enumerate(zip(actual,expected)):
        close(a,b,f'{message} [{index}]')


def volume(shape):
    properties = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape,properties)
    return properties.Mass()


def surface_area(shape):
    properties = GProp_GProps()
    BRepGProp.SurfaceProperties_s(shape,properties)
    return properties.Mass()


def bbox(shape):
    box = Bnd_Box()
    BRepBndLib.AddOptimal_s(shape,box,False,False)
    return [list(box.CornerMin().Coord()),list(box.CornerMax().Coord())]


def count(shape,kind):
    explorer,n = TopExp_Explorer(shape,kind),0
    while explorer.More():
        n += 1
        explorer.Next()
    return n


def read_step(path):
    text = path.read_text()
    require('.MILLI.' in text and '.METRE.' in text,'STEP must declare millimeter length units.')
    reader = STEPControl_Reader()
    require(reader.ReadFile(str(path)) == IFSelect_RetDone and reader.TransferRoots() >= 1,'STEP readback failed.')
    shape = reader.OneShape()
    require(not shape.IsNull() and BRepCheck_Analyzer(shape).IsValid(),'STEP must be a valid shape.')
    require(count(shape,TopAbs_SOLID) == 1,'STEP must contain exactly one solid.')
    return shape


def horizontal_edges(face,z,radius):
    edges,explorer = [],TopExp_Explorer(face,TopAbs_EDGE)
    while explorer.More():
        curve = BRepAdaptor_Curve(TopoDS.Edge(explorer.Current()))
        if curve.GetType() == GeomAbs_Circle:
            circle = curve.Circle()
            edges.append({'kind':'circle','radius_mm':circle.Radius(),'center_mm':list(circle.Location().Coord()),'sweep_rad':abs(curve.LastParameter()-curve.FirstParameter())})
        elif curve.GetType() == GeomAbs_Line:
            points = [list(curve.Value(t).Coord()) for t in (curve.FirstParameter(),curve.LastParameter())]
            edges.append({'kind':'line','endpoints_mm':sorted(points)})
        else:
            raise ValueError('Horizontal perimeter must retain analytic circle and line edges.')
        explorer.Next()
    circles = [e for e in edges if e['kind']=='circle']
    lines = [e for e in edges if e['kind']=='line']
    require(len(circles)==3 and len(lines)==2,'Top/bottom face must have two semicircles, two lines and one unchanged circular bore.')
    outer = sorted((e for e in circles if abs(e['radius_mm']-radius)<=EPS),key=lambda e:e['center_mm'][0])
    bore = [e for e in circles if abs(e['radius_mm']-3)<=EPS]
    require(len(outer)==2 and len(bore)==1,'Top/bottom outer radius or unrounded R3 bore differs from instruction.')
    for edge,x in zip(outer,(10,30)):
        vector(edge['center_mm'],[x,10,z],'Outer semicircle center')
        close(edge['sweep_rad'],math.pi,'Outer semicircle angle')
    vector(bore[0]['center_mm'],[10,10,z],'Unrounded bore edge center')
    close(bore[0]['sweep_rad'],2*math.pi,'Bore edge angle')
    lines.sort(key=lambda edge:edge['endpoints_mm'][0][1])
    for edge,y in zip(lines,(10-radius,10+radius)):
        for actual,expected in zip(edge['endpoints_mm'],[[10,y,z],[30,y,z]]):
            vector(actual,expected,'Straight perimeter endpoint')
    return edges


def inspect_analytic_faces(shape):
    explorer,faces = TopExp_Explorer(shape,TopAbs_FACE),[]
    horizontal,outer,straight_rounds,torus,bore,sides = {},[],[],[],[],[]
    while explorer.More():
        face = TopoDS.Face(explorer.Current())
        surface = BRepAdaptor_Surface(face)
        kind = surface.GetType()
        item = {'area_mm2':surface_area(face),'bounds_mm':bbox(face)}
        if kind == GeomAbs_Plane:
            plane = surface.Plane()
            normal,location = list(plane.Axis().Direction().Coord()),list(plane.Location().Coord())
            item.update(kind='plane',normal=normal,location_mm=location)
            if abs(normal[2])>1-EPS:
                z = round(location[2])
                require(z in (0,6) and z not in horizontal,'Only one top and one bottom horizontal plane are expected.')
                close(location[2],z,'Horizontal face height')
                expected = 400+91*math.pi if z==0 else 360+72*math.pi
                close(item['area_mm2'],expected,'Bottom/full or top/inset face area')
                item['edges'] = horizontal_edges(face,z,10 if z==0 else 9)
                horizontal[z] = item
            else:
                vector([abs(n) for n in normal],[0,1,0],'Straight-side plane orientation')
                require(any(abs(location[1]-y)<=EPS for y in (0,20)),'Straight side must stay at y=0 or20.')
                close(item['area_mm2'],100,'Straight side extends only z=0..5 under top round')
                vector([item['bounds_mm'][0][2],item['bounds_mm'][1][2]],[0,5],'Straight-side height')
                sides.append(item)
        elif kind == GeomAbs_Cylinder:
            cylinder = surface.Cylinder()
            radius,axis,location = cylinder.Radius(),list(cylinder.Axis().Direction().Coord()),list(cylinder.Location().Coord())
            item.update(kind='cylinder',radius_mm=radius,axis=axis,location_mm=location)
            if abs(radius-10)<=EPS:
                vector([abs(n) for n in axis],[0,0,1],'Outer cylinder axis')
                close(location[1],10,'Outer cylinder Y center')
                require(any(abs(location[0]-x)<=EPS for x in (10,30)),'Outer cylinder X center must be10or30.')
                close(item['area_mm2'],50*math.pi,'Outer semicylinder area')
                vector([item['bounds_mm'][0][2],item['bounds_mm'][1][2]],[0,5],'Outer semicylinder height')
                x_low,x_high = (0,10) if abs(location[0]-10)<=EPS else (30,40)
                vector([item['bounds_mm'][0][0],item['bounds_mm'][1][0]],[x_low,x_high],'Outer semicylinder left/right extent')
                outer.append(item)
            elif abs(radius-3)<=EPS:
                vector([abs(n) for n in axis],[0,0,1],'Bore cylinder axis')
                vector(location[:2],[10,10],'Bore center')
                vector([item['bounds_mm'][0][2],item['bounds_mm'][1][2]],[0,6],'Bore through height')
                close(item['area_mm2'],36*math.pi,'Unrounded full-height bore surface area')
                bore.append(item)
            elif abs(radius-1)<=EPS:
                vector([abs(n) for n in axis],[1,0,0],'Straight fillet cylinder axis')
                close(location[2],5,'Top fillet cylinder Z center')
                require(any(abs(location[1]-y)<=EPS for y in (1,19)),'Straight top fillet centers must be y1or19.')
                close(item['area_mm2'],10*math.pi,'Straight quarter-cylinder fillet area')
                straight_rounds.append(item)
            else:
                raise ValueError('Unexpected cylinder radius in retained STEP.')
        elif kind == GeomAbs_Torus:
            surface_torus = surface.Torus()
            location = list(surface_torus.Location().Coord())
            vector([abs(n) for n in surface_torus.Axis().Direction().Coord()],[0,0,1],'Curved top fillet torus axis')
            close(surface_torus.MajorRadius(),9,'Top fillet major radius')
            close(surface_torus.MinorRadius(),1,'Top fillet minor radius')
            close(location[1],10,'Top torus Y center')
            close(location[2],5,'Top torus Z center')
            require(any(abs(location[0]-x)<=EPS for x in (10,30)),'Torus X center must be10or30.')
            close(item['area_mm2'],4.5*math.pi**2+math.pi,'Semicircular quarter-tube fillet area')
            item.update(kind='torus',major_radius_mm=surface_torus.MajorRadius(),minor_radius_mm=surface_torus.MinorRadius(),location_mm=location)
            torus.append(item)
        else:
            raise ValueError('Expected only analytic planes, cylinders and tori; no approximated spline faces.')
        faces.append(item)
        explorer.Next()
    require(len(faces)==11 and len(horizontal)==2 and len(sides)==2 and len(outer)==2 and len(bore)==1 and len(straight_rounds)==2 and len(torus)==2,'Unexpected analytic face inventory.')
    require({round(f['location_mm'][0]) for f in outer}=={10,30} and {round(f['location_mm'][0]) for f in torus}=={10,30},'Both specified end caps must be present.')
    require({round(f['location_mm'][1]) for f in straight_rounds}=={1,19},'Both specified straight top rounds must be present.')
    return faces


def boolean(operation,a,b):
    result = operation(a,b)
    result.Build()
    require(result.IsDone(),'Independent nominal Boolean operation failed.')
    return result.Shape()


def box(origin,size):
    return BRepPrimAPI_MakeBox(gp_Pnt(*origin),*size).Shape()


def cylinder(x,y,radius,z=0,height=6):
    return BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(x,y,z),gp_Dir(0,0,1)),radius,height).Shape()


def inspect_regions(shape):
    regions = [
        ('through_bore','void',cylinder(10,10,2.9,.05,5.9)),
        ('unrounded_top_bore_wall','material',box([13.05,9.95,5.85],[.1,.1,.1])),
        ('bottom_straight_perimeter_intact','material',box([19.9,.05,.05],[.2,.1,.1])),
        ('top_straight_round_removed','void',box([19.9,.05,5.85],[.2,.1,.1])),
        ('top_straight_round_retained','material',box([19.9,.65,5.7],[.2,.1,.1])),
        ('left_bottom_perimeter_intact','material',box([.05,9.95,.05],[.1,.1,.1])),
        ('left_top_round_removed','void',box([.05,9.95,5.85],[.1,.1,.1])),
        ('right_top_round_removed','void',box([39.85,9.95,5.85],[.1,.1,.1])),
        ('back_top_round_removed','void',box([19.9,19.85,5.85],[.2,.1,.1])),
        ('core_retained','material',box([18,8,1],[4,4,3])),
    ]
    checks = []
    for name,expect,tool in regions:
        fraction = volume(boolean(BRepAlgoAPI_Common,shape,tool))/volume(tool)
        passed = fraction>=.999999 if expect=='material' else fraction<=1e-7
        require(passed,f'Independent region {name} expected {expect}; got material fraction{fraction}.')
        checks.append({'name':name,'expect':expect,'material_fraction':fraction,'passed':True})
    return checks


def inspect_shape(shape):
    require(BRepCheck_Analyzer(shape).IsValid() and count(shape,TopAbs_SOLID)==1,'Expected one valid analytic solid.')
    bounds = bbox(shape)
    vector(bounds[0],[0,0,0],'Absolute minimum bounds')
    vector(bounds[1],[40,20,6],'Absolute maximum bounds')
    actual_volume = volume(shape)
    close(actual_volume,EXPECTED_VOLUME,'Independently integrated instruction volume')
    faces = inspect_analytic_faces(shape)
    regions = inspect_regions(shape)
    return {'passed':True,'bounds_mm':bounds,'volume_mm3':actual_volume,'analytic_expected_volume_mm3':EXPECTED_VOLUME,
            'top_round_removed_volume_mm3':REMOVED_TOP_ROUND,'analytic_faces':faces,'independent_regions':regions}


def source_and_archive(package,archive):
    proposal_path = ROOT/'model-27b'/'proposal.json'
    proposal = json.loads(proposal_path.read_text())
    instruction = proposal['request']['instruction']
    require(hashlib.sha256(instruction.encode()).hexdigest()==INSTRUCTION_SHA256,'Captured instruction differs from the one independently reviewed by this verifier.')
    require(proposal['output']['status']=='ready' and proposal['error'] is None,'Captured proposal is not a successful ready proposal.')
    source = json.loads((package/'spec.json').read_text())
    proposed = json.loads((ROOT/'model-27b'/'proposed-source.json').read_text())
    require(source==proposed==proposal['output']['spec'],'Captured proposal, explicitly proposed source and CAD package source disagree.')
    expected = [
        {'operation':'add','shape':'curve','origin':[0,0,0],'axis':'z','height':6,'start':[10,0],
         'segments':[{'kind':'line','end':[30,0]},{'kind':'arc','via':[40,10],'end':[30,20]},
                     {'kind':'line','end':[10,20]},{'kind':'arc','via':[0,10],'end':[10,0]}]},
        {'operation':'cut','shape':'cylinder','origin':[10,10,0],'axis':'z','radius':3,'height':6},
        {'operation':'fillet','radius':1,'edges':[[20,0,6],[40,10,6],[20,20,6],[0,10,6]],'tolerance':.01},
    ]
    require([{k:v for k,v in f.items() if k!='id'} for f in source['features']]==expected,'Source feature sequence or explicitly supplied dimensions/seed points differs from instruction.')
    require(source['units']=='mm' and source.get('probes',[])==[],'Unexpected units or model-authored verification probes.')
    hashes = {}
    with zipfile.ZipFile(archive) as zipped:
        names = zipped.namelist()
        require(len(names)==len(set(names)) and set(names)=={p.name for p in package.iterdir() if p.is_file()},'Retained CAD ZIP members differ from retained extracted package files.')
        for name in names:
            require('/' not in name and '\\' not in name,'Unexpected CAD ZIP member path.')
            data = (package/name).read_bytes()
            require(zipped.read(name)==data,f'Retained browser ZIP bytes differ for{name}.')
            hashes[name] = hashlib.sha256(data).hexdigest()
    with zipfile.ZipFile(ROOT/'model-27b'/'proposal.zip') as zipped:
        require(json.loads(zipped.read('proposal.json'))==proposal and json.loads(zipped.read('proposed-source.json'))==proposed,'Retained proposal ZIP differs from captured proposal/source files.')
    rejected = json.loads((ROOT/'model-rejected'/'proposal.json').read_text())
    require(rejected['output'] is None and bool(rejected['error']),'Retained rejected attempt must remain a rejection, not successful CAD evidence.')
    return {'instruction':instruction,'instruction_sha256':INSTRUCTION_SHA256,'model':proposal['model'],
            'proposal_source_matches_packaged_source':True,'browser_archive_bytes_match_extracted_package':True,
            'package_sha256':hashes,'retained_rejected_model':rejected['model'],'retained_rejection_error':rejected['error']}


def verify(package,archive):
    evidence = source_and_archive(package,archive)
    shape = read_step(package/'solid.step')
    positive = inspect_shape(shape)
    filled = boolean(BRepAlgoAPI_Fuse,shape,cylinder(10,10,3))
    shifted = boolean(BRepAlgoAPI_Cut,filled,cylinder(30,10,3))
    # Merge harmless planar subdivisions introduced by filling the old bore;
    # the negative must fail its bore location, not incidental face splitting.
    unified = ShapeUpgrade_UnifySameDomain(shifted,True,True,True)
    unified.Build()
    shifted = unified.Shape()
    mirror = gp_Trsf()
    mirror.SetMirror(gp_Ax2(gp_Pnt(0,0,3),gp_Dir(0,0,1)))
    wrong_fillet = BRepBuilderAPI_Transform(shape,mirror,True).Shape()
    negatives = []
    for name,negative in [('same_volume_bore_shifted_to_x30',shifted),('same_volume_round_moved_to_bottom',wrong_fillet)]:
        require(BRepCheck_Analyzer(negative).IsValid() and count(negative,TopAbs_SOLID)==1,'Negative control must remain a valid one-solid shape.')
        close(volume(negative),volume(shape),'Negative control must have the same volume')
        vector(bbox(negative)[0],[0,0,0],'Negative control minimum')
        vector(bbox(negative)[1],[40,20,6],'Negative control maximum')
        try:
            inspect_shape(negative)
        except ValueError as error:
            negatives.append({'name':name,'same_volume_mm3':volume(negative),'same_bounds':True,'rejected':True,'reason':str(error)})
        else:
            raise ValueError(f'Independent intent inspection failed to reject{name}.')
    return {'status':'passed','package':str(package),'archive':str(archive),'evidence':evidence,'geometry':positive,
            'negative_controls':negatives,'kernel':{'cadquery-ocp-novtk':importlib.metadata.version('cadquery-ocp-novtk')},
            'limits':['STEP was read and inspected with the same OpenCascade kernel family used by generation; this is not an independent CAD-kernel comparison.',
                      'These checks establish this explicit nominal geometry and feature locations, not general model accuracy, physical fit, fabrication tolerances, strength or safety.',
                      'STL mesh integrity and mesh/STEP sampled fidelity are covered separately by the retained package verifier, not repeated by this analytic intent inspection.']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package',type=Path,default=ROOT/'checked-cad')
    parser.add_argument('--archive',type=Path)
    parser.add_argument('--output',type=Path)
    args = parser.parse_args()
    package = args.package.resolve()
    archive = (args.archive or package.with_suffix('.zip')).resolve()
    report = verify(package,archive)
    output = args.output or (ROOT/'intent-verification.json' if package==(ROOT/'checked-cad').resolve() else None)
    if output:
        output.write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))


if __name__=='__main__':
    main()
