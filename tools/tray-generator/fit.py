"""Compare a generated tray STEP with explicitly placed component STEP models.

This reports nominal same-kernel geometry only. It does not infer placements,
validate a vendor model's completeness, or establish physical fit.
"""

import argparse
import hashlib
import json
import math
import shutil
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True

from OCP.BRepAlgoAPI import BRepAlgoAPI_Common
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepExtrema import BRepExtrema_DistShapeShape
from OCP.BRepGProp import BRepGProp
from OCP.Bnd import Bnd_Box
from OCP.GProp import GProp_GProps
from OCP.TopAbs import TopAbs_SOLID
from OCP.TopExp import TopExp_Explorer
from OCP.gp import gp_Trsf

from generate import validate as validate_tray
from verify import read_step

IDENTITY = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]


def finite(value, label, lower=-10000, upper=10000):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not lower <= value <= upper:
        raise ValueError(f'{label} must be a finite number from {lower} to {upper}')
    return float(value)


def rotation_matrix(raw):
    if not isinstance(raw, list) or len(raw) != 3 or any(not isinstance(row, list) or len(row) != 3 for row in raw):
        raise ValueError('rotation must be a 3 by 3 matrix')
    rows = [[finite(value, 'rotation entry', -1, 1) for value in row] for row in raw]
    for i in range(3):
        if abs(sum(x * x for x in rows[i]) - 1) > 1e-5:
            raise ValueError('rotation rows must have unit length')
        for j in range(i + 1, 3):
            if abs(sum(rows[i][k] * rows[j][k] for k in range(3))) > 1e-5:
                raise ValueError('rotation rows must be perpendicular')
    determinant = (rows[0][0] * (rows[1][1] * rows[2][2] - rows[1][2] * rows[2][1])
                   - rows[0][1] * (rows[1][0] * rows[2][2] - rows[1][2] * rows[2][0])
                   + rows[0][2] * (rows[1][0] * rows[2][1] - rows[1][1] * rows[2][0]))
    if abs(determinant - 1) > 1e-5:
        raise ValueError('rotation must preserve handedness; reflections are unsupported')
    return rows


def normalize_manifest(raw, root):
    if not isinstance(raw, dict) or raw.get('schema') != 'hardware-studio-fit-v1':
        raise ValueError('Expected hardware-studio-fit-v1 manifest')
    package = raw.get('trayPackage')
    if not isinstance(package, str) or not package:
        raise ValueError('trayPackage must be a directory path')
    package = (root / package).expanduser().resolve(strict=True)
    if not package.is_dir() or not all((package / name).is_file() for name in ('tray.step', 'spec.json', 'verification.json')):
        raise ValueError('trayPackage needs tray.step, spec.json and verification.json')
    components = raw.get('components')
    if not isinstance(components, list) or not 1 <= len(components) <= 20:
        raise ValueError('components must contain 1 to 20 placed STEP models')
    ids = set()
    normalized = []
    for index, item in enumerate(components):
        if not isinstance(item, dict) or not isinstance(item.get('id'), str) or not item['id'] or len(item['id']) > 80 or item['id'] in ids:
            raise ValueError(f'components[{index}] needs a unique short ID')
        ids.add(item['id'])
        source = item.get('step')
        if not isinstance(source, str) or not source:
            raise ValueError(f'components[{index}].step must be a local STEP path')
        source = (root / source).expanduser().resolve(strict=True)
        if not source.is_file() or source.suffix.lower() not in ('.step', '.stp') or source.stat().st_size > 100_000_000:
            raise ValueError(f'components[{index}] needs a STEP file under 100 MB')
        translation = item.get('translationMm', [0, 0, 0])
        if not isinstance(translation, list) or len(translation) != 3:
            raise ValueError(f'components[{index}].translationMm needs X, Y and Z')
        translation = [finite(value, f'components[{index}] translation') for value in translation]
        rotation = rotation_matrix(item.get('rotation', IDENTITY))
        normalized.append({'id': item['id'], 'step': source, 'translationMm': translation, 'rotation': rotation})
    limit = finite(raw.get('overlapLimitMm3', .01), 'overlapLimitMm3', 0, 100)
    return package, normalized, limit


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def bounds(shape):
    box = Bnd_Box()
    BRepBndLib.AddOptimal_s(shape, box, False, False)
    low, high = box.CornerMin(), box.CornerMax()
    minimum = [low.X(), low.Y(), low.Z()]
    maximum = [high.X(), high.Y(), high.Z()]
    return {'min_mm': minimum, 'max_mm': maximum, 'span_mm': [maximum[i] - minimum[i] for i in range(3)]}


def solid_count(shape):
    explorer = TopExp_Explorer(shape, TopAbs_SOLID)
    total = 0
    while explorer.More():
        total += 1
        explorer.Next()
    return total


def volume(shape):
    properties = GProp_GProps()
    BRepGProp.VolumeProperties_s(shape, properties)
    return properties.Mass()


def overlap_mm3(first, second):
    operation = BRepAlgoAPI_Common(first, second)
    operation.Build()
    if not operation.IsDone() or not BRepCheck_Analyzer(operation.Shape()).IsValid():
        raise RuntimeError('OpenCascade intersection failed')
    return max(0, volume(operation.Shape()))


def separation_mm(first, second):
    distance = BRepExtrema_DistShapeShape(first, second)
    distance.Perform()
    if not distance.IsDone():
        raise RuntimeError('OpenCascade distance calculation failed')
    return distance.Value()


def place(shape, rotation, translation):
    transform = gp_Trsf()
    transform.SetValues(rotation[0][0], rotation[0][1], rotation[0][2], translation[0],
                        rotation[1][0], rotation[1][1], rotation[1][2], translation[1],
                        rotation[2][0], rotation[2][1], rotation[2][2], translation[2])
    placed = BRepBuilderAPI_Transform(shape, transform, True).Shape()
    if placed.IsNull() or not BRepCheck_Analyzer(placed).IsValid():
        raise RuntimeError('Placed component geometry is invalid')
    return placed


def cavity_margins(box, spec):
    outer, wall, floor = spec['outer'], spec['wall'], spec['floor']
    low, high = box['min_mm'], box['max_mm']
    return {'left': low[0] - wall, 'right': outer['length'] - wall - high[0],
            'front': low[1] - wall, 'back': outer['width'] - wall - high[1],
            'floor': low[2] - floor, 'rim': outer['height'] - high[2]}


def fit_report(manifest_path):
    manifest_path = manifest_path.expanduser().resolve(strict=True)
    raw = json.loads(manifest_path.read_text())
    package, components, limit = normalize_manifest(raw, manifest_path.parent)
    saved_spec = json.loads((package / 'spec.json').read_text())
    legacy_spec = isinstance(saved_spec, dict) and 'schema' not in saved_spec and 'units' not in saved_spec
    if legacy_spec:
        saved_spec = {'schema': 'hardware-studio-tray-v1', 'units': 'mm', **saved_spec}
    spec = validate_tray(saved_spec)
    verification = json.loads((package / 'verification.json').read_text())
    if verification.get('sha256', {}).get('spec.json') != sha256(package / 'spec.json'):
        raise ValueError('Tray spec hash differs from its verification report')
    if verification.get('sha256', {}).get('tray.step') != sha256(package / 'tray.step'):
        raise ValueError('Tray STEP hash differs from its verification report')
    tray = read_step(package / 'tray.step')
    if solid_count(tray) != 1:
        raise ValueError('Tray STEP must contain exactly one solid')
    expected = [spec['outer'][key] for key in ('length', 'width', 'height')]
    actual = bounds(tray)['span_mm']
    if any(abs(a - b) > .03 for a, b in zip(actual, expected)):
        raise ValueError('Tray STEP dimensions differ from its spec')
    lid = None
    if spec['lid']:
        lid_path = package / 'lid.step'
        if not lid_path.is_file() or verification.get('sha256', {}).get('lid.step') != sha256(lid_path):
            raise ValueError('Lid STEP is missing or differs from its verification report')
        lid = read_step(lid_path)
        if solid_count(lid) != 1:
            raise ValueError('Lid STEP must contain exactly one solid')
    placed = []
    reports = []
    any_interference = False
    for item in components:
        raw_shape = read_step(item['step'])
        count = solid_count(raw_shape)
        if count < 1:
            raise ValueError(f"{item['id']} STEP contains no solid geometry")
        shape = place(raw_shape, item['rotation'], item['translationMm'])
        envelope = bounds(shape)
        overlap = overlap_mm3(tray, shape)
        distance = separation_mm(tray, shape)
        lid_overlap = overlap_mm3(lid, shape) if lid is not None else None
        lid_distance = separation_mm(lid, shape) if lid is not None else None
        tray_collision = overlap > limit
        lid_collision = lid_overlap is not None and lid_overlap > limit
        any_interference |= tray_collision or lid_collision
        reports.append({'id': item['id'], 'source_sha256': sha256(item['step']), 'source_solids': count,
                        'rotation': item['rotation'], 'translation_mm': item['translationMm'],
                        'placed_envelope': envelope, 'cavity_envelope_margins_mm': cavity_margins(envelope, spec),
                        'tray_overlap_mm3': overlap, 'tray_separation_mm': distance,
                        'lid_overlap_mm3': lid_overlap, 'lid_separation_mm': lid_distance,
                        'tray_interference_above_threshold': tray_collision, 'lid_interference_above_threshold': lid_collision,
                        'interference_above_threshold': tray_collision or lid_collision})
        placed.append((item['id'], shape))
    pairs = []
    for index, (name, shape) in enumerate(placed):
        for second_name, second_shape in placed[index + 1:]:
            overlap = overlap_mm3(shape, second_shape)
            distance = separation_mm(shape, second_shape)
            any_interference |= overlap > limit
            pairs.append({'parts': [name, second_name], 'overlap_mm3': overlap,
                          'separation_mm': distance, 'interference_above_threshold': overlap > limit})
    return {'schema': 'hardware-studio-fit-report-v1', 'status': 'modeled interference detected' if any_interference else 'no modeled intersection above threshold',
            'scope': 'same-kernel nominal STEP geometry; physical fit untested', 'units': 'mm',
            'manifest_sha256': sha256(manifest_path), 'tray_step_sha256': sha256(package / 'tray.step'),
            'lid_step_sha256': sha256(package / 'lid.step') if lid is not None else None,
            'legacy_spec_rehydrated': legacy_spec,
            'tray_bounds': bounds(tray), 'lid_bounds': bounds(lid) if lid is not None else None, 'overlap_limit_mm3': limit, 'components': reports, 'component_pairs': pairs,
            'limits': ['Source STEP files may omit connectors, tolerances or other physical features.',
                       'Axis-aligned cavity margins are descriptive; openings may intentionally cross a wall.',
                       'Mounting-hole alignment and fastener engagement were not checked.',
                       'The optional cover has no retention, seal or verified access for plugs and cables.',
                       'No print process, material shrinkage, cable routing, thermal behavior or physical assembly was tested.']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path, help='Absent output directory whose parent exists')
    args = parser.parse_args()
    destination = args.out.expanduser().resolve()
    if destination.exists() or not destination.parent.is_dir():
        parser.error('--out must be absent and its parent must exist')
    report = fit_report(args.manifest)
    staging = Path(tempfile.mkdtemp(prefix='.fit-staging-', dir=destination.parent))
    try:
        (staging / 'fit-report.json').write_text(json.dumps(report, indent=2) + '\n')
        staging.rename(destination)
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    print(json.dumps({'output': str(destination), 'status': report['status']}, indent=2))


if __name__ == '__main__':
    main()
