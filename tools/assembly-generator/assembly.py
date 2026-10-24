"""Bounded, explicit placements of declarative solids. No joint or fit solver."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
TOOLS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(TOOLS / 'solid-generator'))
sys.path.insert(0, str(TOOLS / 'tray-generator'))
import solid
from mesh_check import check_mesh, normalize_export_mesh, verify_export_mesh_record
from generate import export
from verify import read_step, volume, solid_count, overlap_volume
from OCP.BRep import BRep_Builder
from OCP.BRepBndLib import BRepBndLib
from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepExtrema import BRepExtrema_DistShapeShape
from OCP.Bnd import Bnd_Box
from OCP.IFSelect import IFSelect_RetDone
from OCP.Interface import Interface_Static
from OCP.STEPControl import STEPControl_Writer, STEPControl_AsIs
from OCP.TopAbs import TopAbs_SOLID
from OCP.TopExp import TopExp_Explorer
from OCP.TopoDS import TopoDS_Compound
from OCP.gp import gp_Ax1, gp_Dir, gp_Pnt, gp_Trsf, gp_Vec

SCHEMA = 'hardware-studio-assembly-v1'
MAX_BYTES = 262144
OVERLAP_LIMIT = .01
LIMITS = [
    'Explicit nominal placements only; no mating constraints, joint solver or motion analysis.',
    'Euler degrees apply around the source origin in X, Y, Z order, then XYZ translation (T*Rz*Ry*Rx).',
    'Pairwise interference means overlap greater than 0.01 cubic mm; touching is allowed. Smaller intersections remain in the report.',
    'Fresh-process readback and source reconstruction use the same OpenCascade kernel; this is not independent-kernel verification.',
    'No manufacturing tolerances, load, strength, fastener fit, supplier geometry or physical fit were validated.',
    'Unplaced assets are exported but are excluded from the assembly and pair checks.',
]

def text(value, label, maximum, trim=False):
    if not isinstance(value, str) or not value.strip() or len(value) > maximum or any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise ValueError(f'{label} needs 1–{maximum} characters without control characters.')
    return value.strip() if trim else value

def exact(raw, fields, label):
    if not isinstance(raw, dict) or set(raw) != set(fields):
        raise ValueError(f'{label} needs exactly the supported fields: {", ".join(fields)}.')

def no_controls(raw):
    if isinstance(raw, str) and any(ord(c) < 32 or ord(c) == 127 for c in raw):
        raise ValueError('Control characters are unsupported.')
    if isinstance(raw, dict):
        for key, value in raw.items():
            no_controls(key); no_controls(value)
    elif isinstance(raw, list):
        for value in raw: no_controls(value)

def vector(raw, limit, label):
    if not isinstance(raw, list) or len(raw) != 3:
        raise ValueError(f'{label} needs three numbers.')
    if any(isinstance(n, bool) or not isinstance(n, (float, int)) or not math.isfinite(n) or abs(n) > limit for n in raw):
        raise ValueError(f'{label} needs finite numbers within +/-{limit}.')
    return [float(n) for n in raw]

def validate(raw):
    exact(raw, ('schema', 'title', 'units', 'assets', 'instances'), 'Assembly')
    no_controls(raw)
    if raw['schema'] != SCHEMA or raw['units'] != 'mm':
        raise ValueError(f'Use {SCHEMA} and mm units.')
    title = text(raw['title'], 'Title', 100, trim=True)
    if not isinstance(raw['assets'], list) or not 1 <= len(raw['assets']) <= 8:
        raise ValueError('Use 1–8 assets.')
    if not isinstance(raw['instances'], list) or not 1 <= len(raw['instances']) <= 16:
        raise ValueError('Use 1–16 placed instances.')
    assets, parts, count = [], set(), 0
    for item in raw['assets']:
        exact(item, ('partId', 'source'), 'Asset')
        part = text(item['partId'], 'Part ID', 80)
        if part in parts: raise ValueError('Part IDs must be unique.')
        parts.add(part)
        source = solid.validate(item['source'])
        count += len(source['features'])
        assets.append({'partId': part, 'source': source})
    if count > 128: raise ValueError('Use at most 128 features across all assets.')
    instances, ids = [], set()
    for item in raw['instances']:
        exact(item, ('id', 'partId', 'position', 'rotation'), 'Instance')
        id_ = text(item['id'], 'Instance ID', 80)
        part = text(item['partId'], 'Instance part ID', 80)
        if id_ in ids or part not in parts: raise ValueError('Instances need unique IDs and an existing part ID.')
        ids.add(id_)
        instances.append({'id': id_, 'partId': part, 'position': vector(item['position'], 500, 'Position mm'), 'rotation': vector(item['rotation'], 360, 'Rotation degrees')})
    return {'schema': SCHEMA, 'title': title, 'units': 'mm', 'assets': assets, 'instances': instances}

def bbox(shape):
    boundary = Bnd_Box()
    BRepBndLib.AddOptimal_s(shape, boundary, False, False)
    a, b = boundary.CornerMin(), boundary.CornerMax()
    return {'min_mm': [a.X(), a.Y(), a.Z()], 'max_mm': [b.X(), b.Y(), b.Z()]}

def place(shape, instance):
    x, y, z = [math.radians(n) for n in instance['rotation']]
    cx, cy, cz, sx, sy, sz = math.cos(x), math.cos(y), math.cos(z), math.sin(x), math.sin(y), math.sin(z)
    matrix = [[cz*cy, cz*sy*sx-sz*cx, cz*sy*cx+sz*sx], [sz*cy, sz*sy*sx+cz*cx, sz*sy*cx-cz*sx], [-sy, cy*sx, cy*cx]]
    t = gp_Trsf()
    p = instance['position']
    t.SetValues(*[value for row, translation in zip(matrix, p) for value in [*row, translation]])
    result = BRepBuilderAPI_Transform(shape, t, True).Shape()
    check_one(result)
    return result

def reconstruct_placement(shape, instance):
    # Deliberately separate from the closed-form matrix used by the writer.
    for axis, angle in zip(((1, 0, 0), (0, 1, 0), (0, 0, 1)), instance['rotation']):
        t = gp_Trsf()
        t.SetRotation(gp_Ax1(gp_Pnt(0, 0, 0), gp_Dir(*axis)), math.radians(angle))
        shape = BRepBuilderAPI_Transform(shape, t, True).Shape()
    t = gp_Trsf(); t.SetTranslation(gp_Vec(*instance['position']))
    return BRepBuilderAPI_Transform(shape, t, True).Shape()

def check_one(shape):
    if shape.IsNull() or not BRepCheck_Analyzer(shape).IsValid() or solid_count(shape) != 1 or not math.isfinite(volume(shape)) or volume(shape) <= .001:
        raise ValueError('Each instance must contain exactly one valid positive-volume solid.')

def matches(actual, expected):
    a, b = bbox(actual), bbox(expected)
    if any(abs(n-m) > .0001 for key in ('min_mm', 'max_mm') for n, m in zip(a[key], b[key])):
        return False
    av, ev = volume(actual), volume(expected)
    tolerance = max(.001, ev * 1e-6)
    return abs(av-ev) <= tolerance and abs(overlap_volume(actual, expected) - ev) <= tolerance

def stl_info(path, expected):
    data = path.read_bytes()
    if len(data) < 84: raise ValueError('Incomplete STL.')
    count = struct.unpack_from('<I', data, 80)[0]
    if count < 4 or count > 400000 or len(data) != 84 + count*50: raise ValueError('Invalid or excessive STL triangles.')
    low, high = [math.inf]*3, [-math.inf]*3
    for i in range(count):
        values = struct.unpack_from('<12f', data, 84+i*50)
        if not all(math.isfinite(n) for n in values): raise ValueError('Non-finite STL data.')
        for vertex in range(3):
            for axis in range(3):
                n = values[3+vertex*3+axis]
                low[axis], high[axis] = min(low[axis], n), max(high[axis], n)
    if any(abs(n-m) > .05 for a, b in ((low, expected['min_mm']), (high, expected['max_mm'])) for n, m in zip(a, b)):
        raise ValueError('STL world-space placement or bounds differ from STEP.')
    return {'stl_min_mm': low, 'stl_max_mm': high, 'stl_triangles': count}

def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def dump(path, value): path.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')

def write_step(shape, path):
    writer = STEPControl_Writer()
    Interface_Static.SetCVal_s('write.step.unit', 'MM')
    if writer.Transfer(shape, STEPControl_AsIs) != IFSelect_RetDone or writer.Write(str(path)) != IFSelect_RetDone:
        raise ValueError('Assembly STEP export failed.')

def verify_package(root):
    spec = validate(json.loads((root/'spec.json').read_text()))
    built = json.loads((root/'build-report.json').read_text())
    reconstructed, assets = {}, []
    for i, asset in enumerate(spec['assets'], 1):
        folder = root/'assets'/f'part-{i:03d}'
        source = solid.validate(json.loads((folder/'spec.json').read_text()))
        if source != asset['source']: raise ValueError('Asset source differs from assembly specification.')
        original, history, probes = solid.build(source)
        saved = read_step(folder/'solid.step'); check_one(saved)
        if not matches(saved, original): raise ValueError('Local asset STEP differs from its reconstructed source.')
        reconstructed[asset['partId']] = original
        assets.append({'partId': asset['partId'], 'directory': f'assets/part-{i:03d}', **bbox(saved), 'volume_mm3': volume(saved), **stl_info(folder/'solid.stl', bbox(saved)), 'stl_check': check_mesh(folder/'solid.stl', saved), 'probes': probes, 'sha256': {name: sha(folder/name) for name in ('spec.json', 'solid.step', 'solid.stl')}})
        if 'stl_export' in built['assets'][i-1]:
            assets[-1]['stl_export'] = verify_export_mesh_record(folder/'solid.stl', built['assets'][i-1]['stl_export'])
        elif (folder/'solid.raw.stl').exists() or (folder/'solid.raw.stl').is_symlink():
            raise ValueError('Raw asset STL exists without its export normalization receipt.')
    shapes, instances, total_bytes, total_triangles = [], [], 0, 0
    for i, item in enumerate(spec['instances'], 1):
        name = f'instance-{i:03d}'
        path = root/'instances'/name
        shape = read_step(path.with_suffix('.step')); check_one(shape)
        expected = reconstruct_placement(reconstructed[item['partId']], item)
        if not matches(shape, expected): raise ValueError('Instance STEP differs from independently reconstructed placement.')
        bb = bbox(shape)
        mesh = {**stl_info(path.with_suffix('.stl'), bb), 'stl_check': check_mesh(path.with_suffix('.stl'), shape)}
        total_bytes += path.with_suffix('.stl').stat().st_size; total_triangles += mesh['stl_triangles']
        shapes.append(shape)
        instances.append({'id': item['id'], 'partId': item['partId'], 'name': name+'.stl', **bb, 'volume_mm3': volume(shape), **mesh, 'sha256': {ext: sha(path.with_suffix('.'+ext)) for ext in ('step', 'stl')}})
        if 'instance_exports' in built:
            exported = built['instance_exports'][i-1]
            if exported['id'] != item['id']: raise ValueError('Instance export record differs from its source ID.')
            instances[-1]['stl_export'] = verify_export_mesh_record(path.with_suffix('.stl'), exported['stl_export'])
        elif path.with_suffix('.raw.stl').exists() or path.with_suffix('.raw.stl').is_symlink():
            raise ValueError('Raw instance STL exists without its export normalization receipt.')
    if total_bytes > 16000000 or total_triangles > 400000: raise ValueError('Combined instance meshes exceed 16 MB or 400,000 triangles.')
    assembly = read_step(root/'assembly.step')
    if solid_count(assembly) != len(shapes): raise ValueError('Assembly STEP must retain one unfused solid per instance.')
    remaining = list(shapes)
    explorer = TopExp_Explorer(assembly, TopAbs_SOLID)
    while explorer.More():
        candidate = explorer.Current()
        match = next((j for j, shape in enumerate(remaining) if matches(candidate, shape)), None)
        if match is None: raise ValueError('Assembly STEP contains a missing, extra or misplaced instance.')
        remaining.pop(match); explorer.Next()
    if remaining: raise ValueError('Assembly STEP lost instances.')
    pairs = []
    for i, first in enumerate(shapes):
        for j in range(i+1, len(shapes)):
            overlap = max(0., overlap_volume(first, shapes[j]))
            distance = BRepExtrema_DistShapeShape(first, shapes[j]); distance.Perform()
            if not distance.IsDone() or not math.isfinite(distance.Value()): raise ValueError('Pair distance calculation failed.')
            pairs.append({'firstId': instances[i]['id'], 'secondId': instances[j]['id'], 'overlap_mm3': overlap, 'minimum_distance_mm': max(0., distance.Value()), 'interference': overlap > OVERLAP_LIMIT})
    actual = {'status': 'interference' if any(p['interference'] for p in pairs) else 'passed', 'readback': 'fresh-process same-kernel source and placement readback passed', 'instances': instances, 'assets': assets, 'pairs': pairs,
              'assembly': {**bbox(assembly), 'volume_mm3': volume(assembly), 'solid_count': len(shapes), 'sha256': sha(root/'assembly.step')}, 'overlap_limit_mm3': OVERLAP_LIMIT, 'sha256': {'spec.json': sha(root/'spec.json'), 'build-report.json': sha(root/'build-report.json')}, 'limits': LIMITS}
    if not math.isclose(actual['assembly']['volume_mm3'], built['volume_mm3'], rel_tol=1e-6, abs_tol=.001): raise ValueError('Combined STEP volume differs from build.')
    dump(root/'verification.json', actual)
    return actual

def generate(spec_path, destination):
    if destination.exists() or destination.is_symlink() or not destination.parent.is_dir(): raise ValueError('Output must be absent and its parent must exist.')
    raw = spec_path.read_bytes()
    if len(raw) > MAX_BYTES: raise ValueError('Assembly source exceeds 262144 bytes.')
    spec = validate(json.loads(raw))
    staging = Path(tempfile.mkdtemp(prefix='.assembly-staging-', dir=destination.parent))
    try:
        dump(staging/'spec.json', spec)
        (staging/'assets').mkdir(); (staging/'instances').mkdir()
        parts, reports = {}, []
        for i, asset in enumerate(spec['assets'], 1):
            folder = staging/'assets'/f'part-{i:03d}'; folder.mkdir()
            dump(folder/'spec.json', asset['source'])
            shape, history, probes = solid.build(asset['source'])
            export(shape, folder, 'solid'); parts[asset['partId']] = shape
            normalization = normalize_export_mesh(folder/'solid.stl', folder/'solid.raw.stl')
            reports.append({'partId': asset['partId'], 'feature_history': history, 'probes': probes, 'stl_export': normalization})
        compound, builder = TopoDS_Compound(), BRep_Builder()
        builder.MakeCompound(compound)
        instance_exports = []
        for i, instance in enumerate(spec['instances'], 1):
            shape = place(parts[instance['partId']], instance)
            export(shape, staging/'instances', f'instance-{i:03d}')
            normalization = normalize_export_mesh(staging/'instances'/f'instance-{i:03d}.stl', staging/'instances'/f'instance-{i:03d}.raw.stl')
            instance_exports.append({'id': instance['id'], 'stl_export': normalization})
            builder.Add(compound, shape)
        write_step(compound, staging/'assembly.step')
        dump(staging/'build-report.json', {'volume_mm3': volume(compound), **bbox(compound), 'assets': reports, 'instance_exports': instance_exports, 'placement_convention': 'T*Rz*Ry*Rx; degrees around source origin; mm translation'})
        subprocess.run([sys.executable, str(Path(__file__).resolve()), '--verify', str(staging)], capture_output=True, text=True, check=True, timeout=170)
        staging.rename(destination)
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--spec', type=Path); parser.add_argument('--out', type=Path); parser.add_argument('--verify', type=Path)
    args = parser.parse_args()
    if args.verify: print(json.dumps(verify_package(args.verify)))
    elif args.spec and args.out:
        generate(args.spec, args.out); print(json.dumps({'output': str(args.out)}))
    else: parser.error('Provide --spec and --out, or --verify.')

if __name__ == '__main__': main()
