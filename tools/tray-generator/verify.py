"""Fresh-process STEP/STL readback for a generated tray package."""

import argparse
import hashlib
import json
import math
import struct
import sys
from pathlib import Path

sys.dont_write_bytecode = True

from OCP.BRepBndLib import BRepBndLib
from OCP.BRepAlgoAPI import BRepAlgoAPI_Common
from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepGProp import BRepGProp
from OCP.Bnd import Bnd_Box
from OCP.GProp import GProp_GProps
from OCP.IFSelect import IFSelect_RetDone
from OCP.STEPControl import STEPControl_Reader
from OCP.TopAbs import TopAbs_SOLID
from OCP.TopExp import TopExp_Explorer
from OCP.gp import gp_Trsf, gp_Vec


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_step(path):
    text = path.read_text(errors='ignore')
    if '.MILLI.' not in text or '.METRE.' not in text:
        raise ValueError('STEP lacks an explicit millimeter unit declaration')
    reader = STEPControl_Reader()
    if reader.ReadFile(str(path)) != IFSelect_RetDone or reader.TransferRoots() < 1:
        raise RuntimeError('STEP readback failed')
    shape = reader.OneShape()
    if shape.IsNull() or not BRepCheck_Analyzer(shape).IsValid():
        raise RuntimeError('STEP readback shape is invalid')
    return shape


def bounds(shape):
    boundary = Bnd_Box()
    BRepBndLib.AddOptimal_s(shape, boundary, False, False)
    lo, hi = boundary.CornerMin(), boundary.CornerMax()
    return [hi.X() - lo.X(), hi.Y() - lo.Y(), hi.Z() - lo.Z()]


def volume(shape):
    properties = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, properties)
    return properties.Mass()


def solid_count(shape):
    count = 0
    explorer = TopExp_Explorer(shape, TopAbs_SOLID)
    while explorer.More():
        count += 1
        explorer.Next()
    return count


def overlap_volume(first, second):
    result = BRepAlgoAPI_Common(first, second)
    result.Build()
    if not result.IsDone():
        raise RuntimeError('STEP overlap comparison failed')
    return 0.0 if result.Shape().IsNull() else volume(result.Shape())


def checked_stl_span(path, expected):
    stl = path.read_bytes()
    if len(stl) < 84:
        raise RuntimeError(f'{path.name} is incomplete')
    triangle_count = struct.unpack_from('<I', stl, 80)[0]
    if triangle_count < 12 or len(stl) != 84 + triangle_count * 50:
        raise RuntimeError(f'{path.name} triangle count or byte length is invalid')
    span = stl_bounds(stl, triangle_count)
    if any(not math.isclose(value, target, abs_tol=.03) for value, target in zip(span, expected)):
        raise RuntimeError(f'{path.name} dimensions {span} differ from spec {expected}')
    return span, triangle_count


def stl_bounds(data, triangle_count):
    low = [math.inf] * 3
    high = [-math.inf] * 3
    for index in range(triangle_count):
        values = struct.unpack_from('<12f', data, 84 + index * 50)
        if not all(math.isfinite(value) for value in values):
            raise RuntimeError(f'STL triangle {index} contains a non-finite coordinate')
        for vertex in range(3):
            for axis in range(3):
                coordinate = values[3 + vertex * 3 + axis]
                low[axis] = min(low[axis], coordinate)
                high[axis] = max(high[axis], coordinate)
    return [high[axis] - low[axis] for axis in range(3)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package', type=Path, required=True)
    args = parser.parse_args()
    root = args.package.expanduser().resolve()
    spec = json.loads((root / 'spec.json').read_text())
    built = json.loads((root / 'build-report.json').read_text())
    shape = read_step(root / 'tray.step')
    tray_solids = solid_count(shape)
    if tray_solids != 1:
        raise RuntimeError(f'Expected one connected tray solid, got {tray_solids}')
    span = bounds(shape)
    expected = [spec['outer'][key] for key in ('length', 'width', 'height')]
    if any(not math.isclose(value, target, abs_tol=.03) for value, target in zip(span, expected)):
        raise RuntimeError(f'STEP dimensions {span} differ from spec {expected}')
    volume_mm3 = volume(shape)
    if not math.isclose(volume_mm3, built['volume_mm3'], rel_tol=1e-5, abs_tol=.01):
        raise RuntimeError('STEP volume differs from build report')
    mesh_span, triangle_count = checked_stl_span(root / 'tray.stl', expected)
    lid_result = None
    names = ['spec.json', 'tray.step', 'tray.stl', 'layout.svg']
    if spec.get('lid'):
        lid = read_step(root / 'lid.step')
        if solid_count(lid) != 1:
            raise RuntimeError('Expected one connected lid solid')
        margin = spec['lid']['clearance'] + spec['lid']['skirtWall']
        lid_expected = [spec['outer']['length'] + 2 * margin, spec['outer']['width'] + 2 * margin, spec['lid']['thickness'] + spec['lid']['skirtDepth']]
        lid_span = bounds(lid)
        if any(not math.isclose(value, target, abs_tol=.03) for value, target in zip(lid_span, lid_expected)):
            raise RuntimeError(f'Lid STEP dimensions {lid_span} differ from spec {lid_expected}')
        lid_volume = volume(lid)
        if not math.isclose(lid_volume, built['lid']['volume_mm3'], rel_tol=1e-5, abs_tol=.01):
            raise RuntimeError('Lid STEP volume differs from build report')
        lid_mesh_span, lid_triangles = checked_stl_span(root / 'lid.stl', lid_expected)
        seated_overlap = overlap_volume(shape, lid)
        if seated_overlap > .01:
            raise RuntimeError(f'Seated lid overlaps tray by {seated_overlap:.3f} mm³')
        transform = gp_Trsf()
        transform.SetTranslation(gp_Vec(spec['lid']['clearance'] + spec['lid']['skirtWall'] / 2, 0, 0))
        shifted = BRepBuilderAPI_Transform(lid, transform, True).Shape()
        shifted_overlap = overlap_volume(shape, shifted)
        if shifted_overlap <= .01:
            raise RuntimeError('Shifted lid did not detect the expected tray interference')
        lid_result = {'solid_count': 1, 'outer_span_mm': lid_span, 'volume_mm3': lid_volume, 'stl_triangles': lid_triangles,
                      'stl_outer_span_mm': lid_mesh_span, 'seated_overlap_mm3': seated_overlap, 'shifted_overlap_mm3': shifted_overlap,
                      'nominal_side_clearance_mm': spec['lid']['clearance']}
        names.extend(['lid.step', 'lid.stl'])
    result = {
        'status': 'fresh-process same-kernel readback passed; physical fit untested',
        'solid_count': tray_solids,
        'outer_span_mm': span,
        'volume_mm3': volume_mm3,
        'stl_triangles': triangle_count,
        'stl_outer_span_mm': mesh_span,
        'sha256': {name: sha256(root / name) for name in names},
        'lid': lid_result,
        'limits': ['Same OpenCascade kernel wrote and read STEP.', 'No manufacturer models, printed sample, connector access or physical tolerances were checked.', 'The optional lift-off cover has no retention, seal, or proven cable access.'],
    }
    (root / 'verification.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
