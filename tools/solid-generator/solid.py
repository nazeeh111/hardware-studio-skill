"""Original bounded feature-solid builder. Data only: boxes/cylinders, add/cut, probes."""
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
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tray-generator'))
from generate import export, boolean, box
from verify import read_step, bounds, volume, solid_count, checked_stl_span, overlap_volume
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepAlgoAPI import BRepAlgoAPI_Fuse, BRepAlgoAPI_Cut
from OCP.BRepPrimAPI import BRepPrimAPI_MakeCylinder
from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt

SCHEMA = 'hardware-studio-solid-v1'

def number(value, label, positive=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or abs(value) > 500 or not math.isfinite(value) or (positive and value < .01):
        raise ValueError(f'{label} must be a finite number {"at least 0.01 mm and " if positive else ""}within 500 mm.')
    return float(value)

def keys(value, allowed, label):
    if not isinstance(value, dict) or set(value) - set(allowed):
        raise ValueError(f'{label} has unsupported fields.')

def primitive(raw, label, metadata=()):
    keys(raw, ['shape', 'origin', 'size', 'axis', 'radius', 'height', *metadata], label)
    shape = raw.get('shape')
    origin = raw.get('origin')
    if not isinstance(origin, list) or len(origin) != 3:
        raise ValueError(f'{label} needs three origin coordinates.')
    result = {'shape': shape, 'origin': [number(n, f'{label}.origin') for n in origin]}
    if shape == 'box':
        if any(key in raw for key in ('axis', 'radius', 'height')) or not isinstance(raw.get('size'), list) or len(raw['size']) != 3:
            raise ValueError(f'{label} box needs size only.')
        result['size'] = [number(n, f'{label}.size', True) for n in raw['size']]
    elif shape == 'cylinder':
        if 'size' in raw or raw.get('axis') not in ('x', 'y', 'z'):
            raise ValueError(f'{label} cylinder needs an x, y or z axis.')
        result.update(axis=raw['axis'], radius=number(raw.get('radius'), f'{label}.radius', True), height=number(raw.get('height'), f'{label}.height', True))
    else:
        raise ValueError(f'{label} supports box or cylinder only.')
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
    if feature['shape'] == 'box':
        return box(*feature['origin'], *feature['size'])
    direction = {'x': (1, 0, 0), 'y': (0, 1, 0), 'z': (0, 0, 1)}[feature['axis']]
    return BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(*feature['origin']), gp_Dir(*direction)), feature['radius'], feature['height']).Shape()

def check_shape(shape):
    if shape.IsNull() or not BRepCheck_Analyzer(shape).IsValid() or solid_count(shape) != 1:
        raise ValueError('Every feature must leave one connected valid solid.')
    v, span = volume(shape), bounds(shape)
    if not math.isfinite(v) or v <= .001 or any(not math.isfinite(n) or n <= 0 or n > 500.001 for n in span):
        raise ValueError('Result needs positive volume and dimensions at most 500 mm.')
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
        tool = make_primitive(feature)
        shape = tool if shape is None else boolean(BRepAlgoAPI_Fuse if feature['operation'] == 'add' else BRepAlgoAPI_Cut, shape, tool)
        v, span = check_shape(shape)
        delta = v - prior
        if (feature['operation'] == 'add' and delta <= .001) or (feature['operation'] == 'cut' and delta >= -.001):
            raise ValueError(f'Feature {feature["id"]} has no material effect.')
        history.append({'id': feature['id'], 'operation': feature['operation'], 'volume_mm3': v, 'volume_delta_mm3': delta, 'span_mm': span})
        prior = v
    return shape, history, check_probes(shape, spec)

def verify_package(root):
    spec = validate(json.loads((root / 'spec.json').read_text()))
    built = json.loads((root / 'build-report.json').read_text())
    shape = read_step(root / 'solid.step')
    v, span = check_shape(shape)
    if any(not math.isclose(n, wanted, abs_tol=.03) for n, wanted in zip(span, built['outer_span_mm'])) or not math.isclose(v, built['volume_mm3'], rel_tol=1e-5, abs_tol=.01):
        raise ValueError('STEP readback differs from the build dimensions or volume.')
    mesh_span, triangles = checked_stl_span(root / 'solid.stl', span)
    probes = check_probes(shape, spec)
    result = {'status': 'fresh-process same-kernel readback passed; physical fit untested', 'solid_count': 1, 'outer_span_mm': span, 'volume_mm3': v, 'stl_outer_span_mm': mesh_span, 'stl_triangles': triangles, 'probes': probes,
              'sha256': {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in ('spec.json', 'solid.step', 'solid.stl')},
              'limits': ['STEP writer and reader use the same OpenCascade kernel.', 'Probe checks test only the supplied regions, not full instruction fidelity.', 'No strength, tolerances, wall thickness, fastener fit, fabrication or physical measurements were validated.']}
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
        report = {'outer_span_mm': bounds(shape), 'volume_mm3': volume(shape), 'feature_history': history, 'probes': probes}
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
    main()
