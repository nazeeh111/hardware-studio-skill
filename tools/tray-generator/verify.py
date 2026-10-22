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
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepGProp import BRepGProp
from OCP.Bnd import Bnd_Box
from OCP.GProp import GProp_GProps
from OCP.IFSelect import IFSelect_RetDone
from OCP.STEPControl import STEPControl_Reader
from OCP.TopAbs import TopAbs_SOLID
from OCP.TopExp import TopExp_Explorer


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
    solid_count = 0
    explorer = TopExp_Explorer(shape, TopAbs_SOLID)
    while explorer.More():
        solid_count += 1
        explorer.Next()
    if solid_count != 1:
        raise RuntimeError(f'Expected one connected solid, got {solid_count}')
    span = bounds(shape)
    expected = [spec['outer'][key] for key in ('length', 'width', 'height')]
    if any(not math.isclose(value, target, abs_tol=.03) for value, target in zip(span, expected)):
        raise RuntimeError(f'STEP dimensions {span} differ from spec {expected}')
    volume_mm3 = volume(shape)
    if not math.isclose(volume_mm3, built['volume_mm3'], rel_tol=1e-5, abs_tol=.01):
        raise RuntimeError('STEP volume differs from build report')
    stl = (root / 'tray.stl').read_bytes()
    if len(stl) < 84:
        raise RuntimeError('STL is incomplete')
    triangle_count = struct.unpack_from('<I', stl, 80)[0]
    if triangle_count < 12 or len(stl) != 84 + triangle_count * 50:
        raise RuntimeError('STL triangle count or byte length is invalid')
    mesh_span = stl_bounds(stl, triangle_count)
    if any(not math.isclose(value, target, abs_tol=.03) for value, target in zip(mesh_span, expected)):
        raise RuntimeError(f'STL dimensions {mesh_span} differ from spec {expected}')
    result = {
        'status': 'fresh-process same-kernel readback passed; physical fit untested',
        'solid_count': solid_count,
        'outer_span_mm': span,
        'volume_mm3': volume_mm3,
        'stl_triangles': triangle_count,
        'stl_outer_span_mm': mesh_span,
        'sha256': {name: sha256(root / name) for name in ('spec.json', 'tray.step', 'tray.stl', 'layout.svg')},
        'limits': ['Same OpenCascade kernel wrote and read STEP.', 'No manufacturer models, printed sample, connector access or physical tolerances were checked.'],
    }
    (root / 'verification.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
