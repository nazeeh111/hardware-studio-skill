"""Bounded data-only feature solids: boxes, cylinders, polygon extrusions and probes."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tray-generator'))
from generate import export, boolean, box
from verify import read_step, bounds, volume, solid_count, checked_stl_span, overlap_volume
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepAlgoAPI import BRepAlgoAPI_Fuse, BRepAlgoAPI_Cut
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakePolygon, BRepBuilderAPI_MakeFace
from OCP.BRepPrimAPI import BRepPrimAPI_MakeCylinder, BRepPrimAPI_MakePrism
from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt, gp_Vec
from curve_profile import validate_curve_profile
from mesh_check import check_mesh, normalize_export_mesh, verify_export_mesh_record

SCHEMA = 'hardware-studio-solid-v1'
PROFILE_EPS = 1e-9

def number(value, label, positive=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or abs(value) > 500 or not math.isfinite(value) or (positive and value < .01):
        raise ValueError(f'{label} must be a finite number {"at least 0.01 mm and " if positive else ""}within 500 mm.')
    return float(value)

def keys(value, allowed, label):
    if not isinstance(value, dict) or set(value) - set(allowed):
        raise ValueError(f'{label} has unsupported fields.')

def cross(a, b, c):
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

def on_segment(a, b, p):
    return (abs(cross(a, b, p)) <= PROFILE_EPS
            and min(a[0], b[0]) - PROFILE_EPS <= p[0] <= max(a[0], b[0]) + PROFILE_EPS
            and min(a[1], b[1]) - PROFILE_EPS <= p[1] <= max(a[1], b[1]) + PROFILE_EPS)

def segments_touch(a, b, c, d):
    ab_c, ab_d, cd_a, cd_b = cross(a, b, c), cross(a, b, d), cross(c, d, a), cross(c, d, b)
    return (((ab_c > PROFILE_EPS and ab_d < -PROFILE_EPS or ab_c < -PROFILE_EPS and ab_d > PROFILE_EPS)
             and (cd_a > PROFILE_EPS and cd_b < -PROFILE_EPS or cd_a < -PROFILE_EPS and cd_b > PROFILE_EPS))
            or on_segment(a, b, c) or on_segment(a, b, d) or on_segment(c, d, a) or on_segment(c, d, b))

def profile_points(raw, label):
    # Keep topology checks and winding normalization identical to solid-spec.js.
    if not isinstance(raw, list) or not 3 <= len(raw) <= 64:
        raise ValueError(f'{label} needs 3–64 polygon vertices, with implicit closure and no holes.')
    points = []
    for point in raw:
        if not isinstance(point, list) or len(point) != 2:
            raise ValueError(f'{label} vertices need two coordinates.')
        points.append([number(n, f'{label}.points') for n in point])
    area2 = 0
    for i, a in enumerate(points):
        b, c = points[(i + 1) % len(points)], points[(i + 2) % len(points)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        if dx * dx + dy * dy < .01 * .01:
            raise ValueError(f'{label} polygon edges must be at least 0.01 mm.')
        if abs(cross(a, b, c)) <= PROFILE_EPS:
            raise ValueError(f'{label} polygon has adjacent collinear corners.')
        area2 += a[0] * b[1] - b[0] * a[1]
        for j in range(i + 1, len(points)):
            d = points[j]
            ex, ey = d[0] - a[0], d[1] - a[1]
            if ex * ex + ey * ey <= PROFILE_EPS * PROFILE_EPS:
                raise ValueError(f'{label} polygon has repeated vertices; closure is implicit.')
            if j != i + 1 and not (i == 0 and j == len(points) - 1) and segments_touch(a, b, d, points[(j + 1) % len(points)]):
                raise ValueError(f'{label} polygon edges cross or touch.')
    if abs(area2) <= PROFILE_EPS:
        raise ValueError(f'{label} polygon needs nonzero area.')
    return [points[0], *reversed(points[1:])] if area2 < 0 else points

def primitive(raw, label, metadata=()):
    keys(raw, ['shape', 'origin', 'size', 'axis', 'radius', 'height', 'points', 'start', 'segments', *metadata], label)
    shape = raw.get('shape')
    origin = raw.get('origin')
    if not isinstance(origin, list) or len(origin) != 3:
        raise ValueError(f'{label} needs three origin coordinates.')
    result = {'shape': shape, 'origin': [number(n, f'{label}.origin') for n in origin]}
    if shape == 'box':
        if any(key in raw for key in ('axis', 'radius', 'height', 'points', 'start', 'segments')) or not isinstance(raw.get('size'), list) or len(raw['size']) != 3:
            raise ValueError(f'{label} box needs size only.')
        result['size'] = [number(n, f'{label}.size', True) for n in raw['size']]
    elif shape == 'cylinder':
        if any(key in raw for key in ('size', 'points', 'start', 'segments')) or raw.get('axis') not in ('x', 'y', 'z'):
            raise ValueError(f'{label} cylinder needs an x, y or z axis.')
        result.update(axis=raw['axis'], radius=number(raw.get('radius'), f'{label}.radius', True), height=number(raw.get('height'), f'{label}.height', True))
    elif shape == 'profile':
        if any(key in raw for key in ('size', 'radius', 'start', 'segments')) or raw.get('axis') not in ('x', 'y', 'z'):
            raise ValueError(f'{label} profile needs points and an x, y or z axis.')
        result.update(axis=raw['axis'], height=number(raw.get('height'), f'{label}.height', True), points=profile_points(raw.get('points'), label))
    elif shape == 'curve':
        if any(key in raw for key in ('size', 'radius', 'points')) or raw.get('axis') not in ('x', 'y', 'z'):
            raise ValueError(f'{label} curved profile needs start, segments and an x, y or z axis.')
        result.update(axis=raw['axis'], height=number(raw.get('height'), f'{label}.height', True), **validate_curve_profile(raw.get('start'), raw.get('segments')))
    else:
        raise ValueError(f'{label} supports box, cylinder, polygon or curved profile only.')
    return result

def validate(raw):
    keys(raw, ['schema', 'title', 'units', 'features', 'probes'], 'Solid specification')
    if raw.get('schema') != SCHEMA or raw.get('units') != 'mm':
        raise ValueError(f'Use {SCHEMA} and millimeter units.')
    title = raw.get('title')
    if not isinstance(title, str) or not title.strip() or len(title) > 100:
        raise ValueError('Use a title of 1–100 characters.')
    features = raw.get('features')
    if not isinstance(features, list) or not 1 <= len(features) <= 32:
        raise ValueError('Use 1–32 ordered features.')
    normalized, ids = [], set()
    for i, feature in enumerate(features):
        if isinstance(feature, dict) and feature.get('operation') == 'fillet':
            keys(feature, ['id', 'operation', 'radius', 'edges', 'tolerance'], f'Feature {i + 1}')
            if i == 0:
                raise ValueError('A fillet needs an existing solid; the first feature must add material.')
            id_ = feature.get('id')
            if not isinstance(id_, str) or not id_.strip() or len(id_) > 60 or id_ in ids:
                raise ValueError('Feature IDs must be unique short text.')
            ids.add(id_)
            points = feature.get('edges')
            if not isinstance(points, list) or not 1 <= len(points) <= 16:
                raise ValueError('A fillet needs 1–16 edge interior points.')
            edges = []
            for point in points:
                if not isinstance(point, list) or len(point) != 3:
                    raise ValueError('Each fillet edge point needs X, Y, Z coordinates.')
                edges.append([number(n, 'Fillet edge point') for n in point])
            if len(set(tuple(point) for point in edges)) != len(edges):
                raise ValueError('Fillet edge points must be distinct.')
            tolerance = feature.get('tolerance', .01)
            if isinstance(tolerance, bool) or not isinstance(tolerance, (int, float)) or not math.isfinite(tolerance) or not .000001 <= tolerance <= .1:
                raise ValueError('Fillet edge tolerance must be 0.000001–0.1 mm.')
            normalized.append({'id': id_, 'operation': 'fillet', 'radius': number(feature.get('radius'), 'Fillet radius', True), 'edges': edges, 'tolerance': float(tolerance)})
            continue
        value = primitive(feature, f'Feature {i + 1}', ('id', 'operation'))
        id_ = feature.get('id')
        if not isinstance(id_, str) or not id_.strip() or len(id_) > 60 or id_ in ids:
            raise ValueError('Feature IDs must be unique short text.')
        ids.add(id_)
        op = feature.get('operation')
        if op not in ('add', 'cut') or (i == 0 and op != 'add'):
            raise ValueError('The first feature must add material; later operations add or cut.')
        normalized.append({'id': id_, 'operation': op, **value})
    probes = raw.get('probes', [])
    if not isinstance(probes, list) or len(probes) > 16:
        raise ValueError('Use at most 16 material/void probes.')
    checked = []
    for i, probe in enumerate(probes):
        value = primitive(probe, f'Probe {i + 1}', ('id', 'expect'))
        id_ = probe.get('id')
        if not isinstance(id_, str) or not id_.strip() or len(id_) > 60 or id_ in ids or probe.get('expect') not in ('material', 'void'):
            raise ValueError('Probes need unique short IDs and material or void expectations.')
        ids.add(id_)
        checked.append({'id': id_, 'expect': probe['expect'], **value})
    return {'schema': SCHEMA, 'title': title.strip(), 'units': 'mm', 'features': normalized, 'probes': checked}

def make_primitive(feature):
    if feature['shape'] == 'curve':
        from advanced import curved_solid
        return curved_solid(feature)
    if feature['shape'] == 'box':
        return box(*feature['origin'], *feature['size'])
    direction = {'x': (1, 0, 0), 'y': (0, 1, 0), 'z': (0, 0, 1)}[feature['axis']]
    if feature['shape'] == 'profile':
        x, y, z = feature['origin']
        polygon = BRepBuilderAPI_MakePolygon()
        for index, (u, v) in enumerate(feature['points']):
            # Right-handed axes: x U=Y,V=Z; y U=Z,V=X; z U=X,V=Y.
            point = {'x': (x, y + u, z + v), 'y': (x + v, y, z + u), 'z': (x + u, y + v, z)}[feature['axis']]
            polygon.Add(gp_Pnt(*point))
            # Added() reports a new edge; the first point only starts the wire.
            if index > 0 and not polygon.Added():
                raise ValueError('Profile polygon edge construction failed.')
        polygon.Close()
        if not polygon.IsDone() or not polygon.Added():
            raise ValueError('Profile polygon construction failed.')
        face = BRepBuilderAPI_MakeFace(polygon.Wire(), True)
        if not face.IsDone():
            raise ValueError('Profile planar face construction failed.')
        prism = BRepPrimAPI_MakePrism(face.Face(), gp_Vec(*(n * feature['height'] for n in direction)))
        if not prism.IsDone() or prism.Shape().IsNull() or not BRepCheck_Analyzer(prism.Shape()).IsValid():
            raise ValueError('Profile extrusion construction failed.')
        return prism.Shape()
    return BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(*feature['origin']), gp_Dir(*direction)), feature['radius'], feature['height']).Shape()

def check_shape(shape):
    if shape.IsNull() or not BRepCheck_Analyzer(shape).IsValid() or solid_count(shape) != 1:
        raise ValueError('Every feature must leave one connected valid solid.')
    v, span = volume(shape), bounds(shape)
    if not math.isfinite(v) or v <= .001 or any(not math.isfinite(n) or n <= 0 or n > 500.001 for n in span):
        raise ValueError('Result volume must exceed 0.001 cubic mm, with positive dimensions at most 500 mm.')
    return v, span

def check_probes(shape, spec):
    checks = []
    for probe in spec['probes']:
        tool = make_primitive(probe)
        fraction = overlap_volume(shape, tool) / volume(tool)
        ok = fraction >= .999 if probe['expect'] == 'material' else fraction <= .001
        checks.append({'id': probe['id'], 'expect': probe['expect'], 'material_fraction': fraction, 'passed': ok})
        if not ok:
            raise ValueError(f'Probe {probe["id"]} did not find the expected {probe["expect"]}.')
    return checks

def build(spec):
    shape, history, prior = None, [], 0
    for feature in spec['features']:
        detail = {}
        if feature['operation'] == 'fillet':
            from advanced import fillet_solid
            previous = shape
            shape, detail = fillet_solid(shape, feature)
        else:
            tool = make_primitive(feature)
            shape = tool if shape is None else boolean(BRepAlgoAPI_Fuse if feature['operation'] == 'add' else BRepAlgoAPI_Cut, shape, tool)
        v, span = check_shape(shape)
        delta = v - prior
        if (feature['operation'] == 'add' and delta <= .001) or (feature['operation'] == 'cut' and delta >= -.001):
            raise ValueError(f'Feature {feature["id"]} must change volume by more than 0.001 cubic mm.')
        if feature['operation'] == 'fillet':
            changed = prior + v - 2 * overlap_volume(previous, shape)
            if changed <= .001:
                raise ValueError(f'Fillet {feature["id"]} must change material by more than 0.001 cubic mm.')
            detail.update(changed_material_mm3=changed, selection_scope='Seed edges; the kernel may extend the fillet through connected tangent edges.')
        history.append({'id': feature['id'], 'operation': feature['operation'], 'volume_mm3': v, 'volume_delta_mm3': delta, 'span_mm': span, **detail})
        prior = v
    return shape, history, check_probes(shape, spec)

def needs_curved_runtime(spec):
    return any(feature.get('operation') == 'fillet' or feature.get('shape') == 'curve' for feature in spec['features'] + spec['probes'])

def verify_package(root):
    spec = validate(json.loads((root / 'spec.json').read_text()))
    built = json.loads((root / 'build-report.json').read_text())
    shape = read_step(root / 'solid.step')
    v, span = check_shape(shape)
    if any(not math.isclose(n, wanted, abs_tol=.03) for n, wanted in zip(span, built['outer_span_mm'])) or not math.isclose(v, built['volume_mm3'], rel_tol=1e-5, abs_tol=.01):
        raise ValueError('STEP readback differs from the build dimensions or volume.')
    mesh_span, triangles = checked_stl_span(root / 'solid.stl', span)
    probes = check_probes(shape, spec)
    rebuilt = None
    if needs_curved_runtime(spec):
        expected, _, _ = build(spec)
        expected_volume = volume(expected)
        difference = v + expected_volume - 2 * overlap_volume(shape, expected)
        if difference > max(.01, expected_volume * 1e-6):
            raise ValueError('STEP readback differs from independently reconstructed source geometry.')
        rebuilt = {'matched': True, 'symmetric_difference_mm3': max(0., difference), 'tolerance_mm3': max(.01, expected_volume * 1e-6)}
    result = {'status': 'fresh-process same-kernel readback passed; physical fit untested', 'solid_count': 1, 'outer_span_mm': span, 'volume_mm3': v, 'stl_outer_span_mm': mesh_span, 'stl_triangles': triangles, 'probes': probes,
              'sha256': {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in ('spec.json', 'solid.step', 'solid.stl')},
              'limits': ['STEP writer and reader use the same OpenCascade kernel.', 'Probe checks test only the supplied regions, not full instruction fidelity.', 'No strength, tolerances, wall thickness, fastener fit, fabrication or physical measurements were validated.']}
    if rebuilt is not None:
        result['rebuilt_source'] = rebuilt
    result['stl_check'] = check_mesh(root / 'solid.stl', shape)
    if 'stl_export' in built:
        result['stl_export'] = verify_export_mesh_record(root / 'solid.stl', built['stl_export'])
    elif (root / 'solid.raw.stl').exists() or (root / 'solid.raw.stl').is_symlink():
        raise ValueError('Raw STL exists without its export normalization receipt.')
    result['sha256']['build-report.json'] = hashlib.sha256((root / 'build-report.json').read_bytes()).hexdigest()
    if (root / 'solid.raw.stl').is_file():
        result['sha256']['solid.raw.stl'] = hashlib.sha256((root / 'solid.raw.stl').read_bytes()).hexdigest()
    (root / 'verification.json').write_text(json.dumps(result, indent=2) + '\n')
    return result

def generate(spec_path, destination):
    if destination.exists() or destination.is_symlink() or not destination.parent.is_dir():
        raise ValueError('Output must be absent and its parent must exist.')
    spec = validate(json.loads(spec_path.read_text()))
    shape, history, probes = build(spec)
    staging = Path(tempfile.mkdtemp(prefix='.solid-staging-', dir=destination.parent))
    try:
        (staging / 'spec.json').write_text(json.dumps(spec, indent=2) + '\n')
        export(shape, staging, 'solid')
        normalization = normalize_export_mesh(staging / 'solid.stl', staging / 'solid.raw.stl')
        report = {'outer_span_mm': bounds(shape), 'volume_mm3': volume(shape), 'feature_history': history, 'probes': probes, 'stl_export': normalization}
        if needs_curved_runtime(spec):
            import importlib.metadata
            report['construction'] = {'library': 'build123d', 'version': importlib.metadata.version('build123d'), 'kernel': importlib.metadata.version('cadquery-ocp-novtk')}
        (staging / 'build-report.json').write_text(json.dumps(report, indent=2) + '\n')
        subprocess.run([sys.executable, str(Path(__file__).resolve()), '--verify', str(staging)], check=True, capture_output=True, text=True, timeout=120)
        staging.rename(destination)
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--spec', type=Path)
    parser.add_argument('--out', type=Path)
    parser.add_argument('--verify', type=Path)
    args = parser.parse_args()
    if args.verify:
        print(json.dumps(verify_package(args.verify)))
    elif args.spec and args.out:
        generate(args.spec, args.out)
        print(json.dumps({'output': str(args.out)}))
    else:
        parser.error('Provide --spec and --out, or --verify.')

if __name__ == '__main__':
    try:
        main()
    except ValueError as error:
        print(json.dumps({'error': str(error)[:1000]}), file=sys.stderr)
        sys.exit(1)
