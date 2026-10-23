"""Check this instruction's plate against actual STEP, without generator reports.

Run in a fresh OCP Python process. Expectations below come from the preserved
user instruction, not generated features, probes, build reports or model claims.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import shutil
import subprocess
import tempfile
import zipfile

from OCP.BRepAdaptor import BRepAdaptor_Surface
from OCP.BRepAlgoAPI import BRepAlgoAPI_Common, BRepAlgoAPI_Cut
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepGProp import BRepGProp
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder
from OCP.Bnd import Bnd_Box
from OCP.GeomAbs import GeomAbs_Cylinder, GeomAbs_Plane
from OCP.GProp import GProp_GProps
from OCP.IFSelect import IFSelect_RetDone
from OCP.STEPControl import STEPControl_Reader, STEPControl_Writer, STEPControl_AsIs
from OCP.TopAbs import TopAbs_FACE, TopAbs_SOLID
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS
from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt

ROOT = Path(__file__).resolve().parent
EXPECTED_SPAN = [48.0, 32.0, 3.0]
HOLES = [(8.0, 16.0), (40.0, 16.0)]
RADIUS = 2.0
EXPECTED_VOLUME = 48 * 32 * 3 - 2 * math.pi * 2**2 * 3
TOLERANCE = 1e-6


def require(condition, message):
    if not condition:
        raise ValueError(message)


def close(value, expected):
    return math.isclose(value, expected, rel_tol=0, abs_tol=TOLERANCE)


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def extent(shape):
    boundary = Bnd_Box()
    BRepBndLib.AddOptimal_s(shape, boundary, False, False)
    lo, hi = boundary.CornerMin(), boundary.CornerMax()
    return [lo.X(), lo.Y(), lo.Z()], [hi.X(), hi.Y(), hi.Z()]


def volume(shape):
    properties = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, properties)
    return properties.Mass()


def operation(cls, a, b):
    result = cls(a, b)
    result.Build()
    require(result.IsDone(), 'Independent boolean region check failed.')
    return result.Shape()


def cylinder(x, y, radius, z=0.0, height=3.0):
    return BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(x, y, z), gp_Dir(0, 0, 1)), radius, height).Shape()


def read_step(path):
    source = path.read_text()
    require('.MILLI.' in source and '.METRE.' in source, 'STEP must declare millimeter units.')
    reader = STEPControl_Reader()
    require(reader.ReadFile(str(path)) == IFSelect_RetDone, 'STEP reader failed.')
    require(reader.TransferRoots() > 0, 'STEP contained no transferable roots.')
    shape = reader.OneShape()
    require(not shape.IsNull() and BRepCheck_Analyzer(shape).IsValid(), 'STEP shape must be valid.')
    return shape


def check_step(path):
    shape = read_step(path)
    solids = TopExp_Explorer(shape, TopAbs_SOLID)
    count = 0
    while solids.More():
        count += 1
        solids.Next()
    require(count == 1, f'Expected one solid, got {count}.')
    low, high = extent(shape)
    span = [b - a for a, b in zip(low, high)]
    require(all(close(n, 0) for n in low), f'Wrong minimum corner: {low}.')
    require(all(close(a, b) for a, b in zip(span, EXPECTED_SPAN)), f'Wrong bounds: {span}.')
    measured_volume = volume(shape)
    require(close(measured_volume, EXPECTED_VOLUME), f'Wrong analytic volume: {measured_volume}.')

    faces, cylinders, planes = TopExp_Explorer(shape, TopAbs_FACE), [], 0
    while faces.More():
        face = TopoDS.Face(faces.Current())
        surface = BRepAdaptor_Surface(face, True)
        if surface.GetType() == GeomAbs_Cylinder:
            analytic = surface.Cylinder()
            point, axis = analytic.Location(), analytic.Axis().Direction()
            face_low, face_high = extent(face)
            cylinders.append({'radius_mm': analytic.Radius(), 'axis': [axis.X(), axis.Y(), axis.Z()],
                              'center_xy_mm': [point.X(), point.Y()], 'z_range_mm': [face_low[2], face_high[2]]})
        elif surface.GetType() == GeomAbs_Plane:
            planes += 1
        else:
            raise ValueError('Unexpected curved surface in the requested plain plate.')
        faces.Next()
    require(len(cylinders) == 2 and planes == 6, f'Expected two cylindrical and six planar faces, got {len(cylinders)} and {planes}.')
    cylinders.sort(key=lambda item: item['center_xy_mm'][0])
    for actual, expected_xy in zip(cylinders, HOLES):
        require(close(actual['radius_mm'], RADIUS), f'Wrong hole radius: {actual}.')
        require(all(close(a, b) for a, b in zip(actual['axis'], [0, 0, 1])), f'Wrong hole axis: {actual}.')
        require(all(close(a, b) for a, b in zip(actual['center_xy_mm'], expected_xy)), f'Wrong hole center: {actual}.')
        require(close(actual['z_range_mm'][0], 0) and close(actual['z_range_mm'][1], 3), f'Hole surface does not span thickness: {actual}.')

    regions = []
    for x, y in HOLES:
        # A bore core extends beyond both faces: positive overlap would expose
        # a blind hole or retained plug. A surrounding annulus must be material.
        core = cylinder(x, y, 1.9, z=-0.01, height=3.02)
        core_overlap = volume(operation(BRepAlgoAPI_Common, shape, core))
        annulus = operation(BRepAlgoAPI_Cut, cylinder(x, y, 2.5), cylinder(x, y, 2.1))
        material = volume(operation(BRepAlgoAPI_Common, shape, annulus))
        expected_annulus = math.pi * (2.5**2 - 2.1**2) * 3
        require(abs(core_overlap) <= TOLERANCE, f'Bore at {(x, y)} is obstructed.')
        require(close(material, expected_annulus), f'Missing material around bore at {(x, y)}.')
        regions.append({'center_xy_mm': [x, y], 'through_core_overlap_mm3': core_overlap,
                        'surrounding_annulus_material_mm3': material, 'expected_annulus_mm3': expected_annulus})
    return {'solid_count': count, 'min_mm': low, 'max_mm': high, 'span_mm': span,
            'volume_mm3': measured_volume, 'expected_volume_mm3': EXPECTED_VOLUME,
            'volume_absolute_error_mm3': abs(measured_volume - EXPECTED_VOLUME),
            'cylinder_faces': cylinders, 'planar_faces': planes, 'independent_regions': regions}


def archive_check(directory, archive_name):
    archive = directory / archive_name
    entries = {}
    with zipfile.ZipFile(archive) as package:
        require(package.testzip() is None, f'ZIP CRC failed for {archive_name}.')
        for info in package.infolist():
            entry = Path(info.filename)
            require(not entry.is_absolute() and '..' not in entry.parts and not info.is_dir(), 'Unexpected ZIP path.')
            data = package.read(info.filename)
            require((directory / entry).read_bytes() == data, f'Extracted bytes differ for {info.filename}.')
            entries[info.filename] = hashlib.sha256(data).hexdigest()
    return {'archive': archive.name, 'sha256': sha256(archive), 'crc': 'passed', 'extracted_sha256': entries}


def replay_and_source_match():
    proposal = json.loads((ROOT / 'completed' / 'proposal.json').read_text())
    response = json.loads(proposal['rawResponse']['response'])
    require(proposal['request']['mode'] == 'create' and proposal['request']['base'] is None, 'Not an original creation request.')
    require(response['status'] == 'ready', 'Model response was not ready.')
    require(response['spec'] == json.loads((ROOT / 'completed' / 'proposed-source.json').read_text()), 'Proposed-source mismatch.')
    require(response['spec'] == json.loads((ROOT / 'checked-cad' / 'spec.json').read_text()), 'Actual CAD source differs from model proposal.')
    # Replay the actual raw JSON through the current public intent validator,
    # without contacting the model or executing any generated content.
    node = shutil.which('node')
    require(node is not None, 'Node is required to replay the response validator.')
    module = (ROOT.parent.parent / 'solid-intent.js').as_uri()
    script = (f'import {{validateSolidIntentResponse}} from {json.dumps(module)};'
              'import {readFileSync} from "node:fs";'
              'const p=JSON.parse(readFileSync(process.argv[1],"utf8"));'
              'process.stdout.write(JSON.stringify(validateSolidIntentResponse(p.request,JSON.parse(p.rawResponse.response))));')
    replay = subprocess.run([node, '--input-type=module', '-e', script, str(ROOT / 'completed' / 'proposal.json')], check=True, capture_output=True, text=True)
    require(json.loads(replay.stdout) == proposal['output'], 'Stored normalized proposal differs from replay.')
    return {'raw_response_validation_replayed': True, 'proposal_and_cad_source_match': True,
            'instruction': proposal['request']['instruction'], 'model_name_recorded': proposal['model']['name'],
            'cut_tool_heights_mm': [feature['height'] for feature in response['spec']['features'] if feature['shape'] == 'cylinder']}


def negative_checks():
    outcomes = []
    with tempfile.TemporaryDirectory(prefix='plate-intent-negatives-') as temporary:
        for name, centers in [('missing-hole', HOLES[:1]), ('shifted-hole', [(9, 16), HOLES[1]])]:
            shape = BRepPrimAPI_MakeBox(48, 32, 3).Shape()
            for x, y in centers:
                shape = operation(BRepAlgoAPI_Cut, shape, cylinder(x, y, 2, z=-1, height=5))
            writer = STEPControl_Writer()
            require(writer.Transfer(shape, STEPControl_AsIs) == IFSelect_RetDone, 'Negative fixture transfer failed.')
            path = Path(temporary) / (name + '.step')
            require(writer.Write(str(path)) == IFSelect_RetDone, 'Negative fixture write failed.')
            try:
                check_step(path)
            except ValueError as error:
                outcomes.append({'case': name, 'rejected': True, 'reason': str(error)})
            else:
                raise ValueError(f'Negative control {name} was not rejected.')
    return outcomes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--step', type=Path, default=ROOT / 'checked-cad' / 'solid.step')
    parser.add_argument('--out', type=Path, default=ROOT / 'intent-verification.json')
    parser.add_argument('--negative-checks', action='store_true')
    args = parser.parse_args()
    archives = [archive_check(ROOT / 'completed', 'hardware-studio-cad-proposal.zip'),
                archive_check(ROOT / 'checked-cad', 'hardware-studio-feature-cad.zip')]
    replay = replay_and_source_match()
    measurements = check_step(args.step.resolve())
    report = {'status': 'passed', 'basis': 'Explicit user dimensions and independent analytic expectations; no generated probes or reports used.',
              'numeric_absolute_tolerance': TOLERANCE, 'archives': archives, 'replay': replay,
              'step_sha256': sha256(args.step), 'measurements': measurements,
              'negative_controls': negative_checks() if args.negative_checks else [],
              'limits': ['Fresh-process readback uses the same OpenCascade kernel as generation, not another CAD system.',
                         'This single successful instruction does not establish general model accuracy.',
                         'No physical fit, fabrication, strength, safety or material measurements were performed.']}
    args.out.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'status': report['status'], 'span_mm': measurements['span_mm'],
                      'volume_mm3': measurements['volume_mm3'], 'report': str(args.out)}, indent=2))


if __name__ == '__main__':
    main()
