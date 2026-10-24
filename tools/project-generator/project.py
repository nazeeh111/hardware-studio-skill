"""Compile an existing source-only project ZIP into one checked CAD handoff.

Supplied archive paths are never extracted. Generated artifacts use fixed paths.
All subprocesses inherit the caller's process group so the local server can
terminate the complete job. No code, models or URLs from the archive execute.
"""
import argparse
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import tempfile
import zipfile

sys.dont_write_bytecode = True
TOOLS = Path(__file__).resolve().parents[1]
MAX_SOURCE_ZIP = 12 * 1024 * 1024
MAX_SOURCE_TOTAL = 16 * 1024 * 1024
MAX_OUTPUT = 64 * 1024 * 1024
MAX_SOURCE_ENTRIES = 32
BASE = {'project.json', 'README.md', 'bill-of-materials.csv', 'connections.csv',
        'mounting.csv', 'build-plan.txt', 'wiring.svg', 'assembly.svg', 'review.txt'}
OPTIONAL = {'tray-spec.json', 'solid-spec.json', 'assembly-spec.json',
            'reference.jpg', 'reference-sketch.json'}
BRANCHES = (('traySpec', 'tray-spec.json', 'tray', 'tray-generator/generate.py'),
            ('solidSpec', 'solid-spec.json', 'shared-solid', 'solid-generator/solid.py'),
            ('assemblySpec', 'assembly-spec.json', 'assembly', 'assembly-generator/assembly.py'))
LIMITS = [
    'STEP writing, reconstruction and readback use the same OpenCascade kernel; independent CAD interoperability is unverified.',
    'Mesh boundary tests are sampled comparisons with fixed tolerances, not exhaustive surface-distance or self-intersection proof.',
    'Geometry and interference describe nominal dimensions. Physical fit, manufacturing tolerances, materials, strength, electrical behavior and assembly instructions are unverified.',
    'Tray and shared solid are project-level geometry without per-part bindings. Only explicit assembly sources and placements are bound to parts.',
    'Unplaced assembly assets are preserved and checked locally, but excluded from assembly placements and pairwise interference checks.',
    'Original project notes, diagrams, estimates and URLs are preserved as supplied. External resources are not fetched and planning claims are not validated.',
]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def reject_constant(value):
    raise ValueError('JSON must use finite numbers.')


def object_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate JSON object keys are unsupported.')
        result[key] = value
    return result


def parse_json(data, label):
    try:
        value = json.loads(data.decode('utf-8'), object_pairs_hook=object_pairs,
                           parse_constant=reject_constant)
        def check(item, depth=0):
            if depth > 48:
                raise ValueError('JSON nesting exceeds 48 levels.')
            if isinstance(item, float) and not math.isfinite(item):
                raise ValueError('JSON must use finite numbers.')
            if isinstance(item, dict):
                for child in item.values(): check(child, depth + 1)
            elif isinstance(item, list):
                for child in item: check(child, depth + 1)
        check(value)
        return value
    except (UnicodeError, json.JSONDecodeError, RecursionError, ValueError) as error:
        raise ValueError(f'{label}: invalid bounded JSON ({error}).') from None


def equal_json(a, b):
    if isinstance(a, bool) or isinstance(b, bool): return type(a) is type(b) and a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)): return a == b
    if type(a) is not type(b): return False
    if isinstance(a, dict): return a.keys() == b.keys() and all(equal_json(a[k], b[k]) for k in a)
    if isinstance(a, list): return len(a) == len(b) and all(equal_json(x, y) for x, y in zip(a, b))
    return a == b


def read_source(path):
    if path.is_symlink() or not path.is_file() or not 22 <= path.stat().st_size <= MAX_SOURCE_ZIP:
        raise ValueError('Source must be a regular ZIP file of at most 12 MiB.')
    raw = path.read_bytes()
    if not 22 <= len(raw) <= MAX_SOURCE_ZIP: raise ValueError('Source ZIP changed or exceeds 12 MiB.')
    entries = {}
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            infos = archive.infolist()
            if not 1 <= len(infos) <= MAX_SOURCE_ENTRIES:
                raise ValueError('Source ZIP must contain at most 32 entries.')
            total = 0
            for info in infos:
                name = info.filename
                if (name != info.orig_filename or name in entries or
                    name not in BASE | OPTIONAL and not re.fullmatch(r'cad-sources/part-00[1-8]\.json', name)):
                    raise ValueError(f'Duplicate, unsafe or unexpected ZIP entry: {name!r}.')
                mode = (info.external_attr >> 16) & 0xffff
                if (info.flag_bits & 1 or info.is_dir() or
                    stat.S_IFMT(mode) not in (0, stat.S_IFREG) or
                    info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)):
                    raise ValueError('ZIP entries must be unencrypted regular stored/deflated files.')
                total += info.file_size
                if total > MAX_SOURCE_TOTAL or info.file_size > MAX_SOURCE_TOTAL:
                    raise ValueError('Source ZIP exceeds 16 MiB uncompressed.')
                # read() checks CRC; its maximum allocation is bounded above.
                data = archive.read(info)
                if len(data) != info.file_size: raise ValueError('ZIP entry length differs from its directory.')
                entries[name] = data
    except (zipfile.BadZipFile, NotImplementedError, RuntimeError, EOFError) as error:
        raise ValueError(f'Invalid source ZIP: {error}.') from None
    if not BASE <= entries.keys():
        raise ValueError('Source ZIP is missing required project export entries.')
    return raw, entries


def validate_sources(entries):
    project = parse_json(entries['project.json'], 'project.json')
    if not isinstance(project, dict) or not isinstance(project.get('parts'), list) or len(project['parts']) > 200:
        raise ValueError('Project requires a bounded parts list.')
    ids = set()
    for part in project['parts']:
        part_id = part.get('id') if isinstance(part, dict) else None
        if (not isinstance(part_id, str) or not part_id.strip() or len(part_id) > 80 or
            any(ord(c) < 32 or ord(c) == 127 for c in part_id) or part_id in ids):
            raise ValueError('Project part IDs must be distinct nonempty strings of at most 80 characters.')
        ids.add(part_id)
    active = []
    for field, name, branch, script in BRANCHES:
        source = project.get(field)
        if (source is not None) != (name in entries):
            raise ValueError(f'{name} is missing or orphaned against project.{field}.')
        if source is not None:
            if not isinstance(source, dict) or not equal_json(source, parse_json(entries[name], name)):
                raise ValueError(f'{name} differs from project.{field}.')
            active.append((field, name, branch, script))
    if not active: raise ValueError('At least one non-null CAD source is required.')
    assembly = project.get('assemblySpec')
    bindings, expected_sidecars = [], set()
    if assembly is not None:
        # Trusted generator performs complete geometry and transform validation.
        assets, instances = assembly.get('assets'), assembly.get('instances')
        if not isinstance(assets, list) or not 1 <= len(assets) <= 8 or not isinstance(instances, list) or not 1 <= len(instances) <= 16:
            raise ValueError('Assembly needs 1–8 sources and 1–16 placed instances.')
        asset_ids = set()
        for asset in assets:
            part = asset.get('partId') if isinstance(asset, dict) else None
            if not isinstance(part, str) or part not in ids or part in asset_ids:
                raise ValueError('Assembly source has an orphan, missing or duplicate project part binding.')
            asset_ids.add(part)
        for instance in instances:
            part = instance.get('partId') if isinstance(instance, dict) else None
            if not isinstance(part, str) or part not in ids or part not in asset_ids:
                raise ValueError('Assembly instance references a missing source or project part.')
        for index, asset in enumerate(assets, 1):
            part = asset['partId']
            sidecar = f'cad-sources/part-{index:03d}.json'
            expected_sidecars.add(sidecar)
            if sidecar not in entries or not equal_json(asset.get('source'), parse_json(entries[sidecar], sidecar)):
                raise ValueError(f'{sidecar} is missing or differs from its assembly source.')
            placed = []
            for instance in instances:
                if instance.get('partId') == part: placed.append(instance.get('id'))
            bindings.append({'partId': part, 'source_entry': sidecar, 'asset_index': index,
                             'instance_ids': placed, 'placed': bool(placed),
                             'generated_asset': f'generated-cad/assembly/assets/part-{index:03d}'})
    if {name for name in entries if name.startswith('cad-sources/')} != expected_sidecars:
        raise ValueError('Orphan CAD source sidecar is unsupported.')
    reference = project.get('referenceImage')
    has_reference = reference is not None
    if has_reference != ('reference.jpg' in entries): raise ValueError('Visual reference entry is missing or orphaned.')
    if has_reference:
        import base64
        url = reference.get('dataUrl') if isinstance(reference, dict) else None
        if not isinstance(url, str) or not url.startswith('data:image/jpeg;base64,'):
            raise ValueError('Reference needs the exported JPEG data URL.')
        try: image = base64.b64decode(url.split(',', 1)[1], validate=True)
        except ValueError: raise ValueError('Invalid reference JPEG encoding.') from None
        if image != entries['reference.jpg']: raise ValueError('reference.jpg differs from project reference bytes.')
    sketch = reference.get('sketch') if isinstance(reference, dict) else None
    if (sketch is not None) != ('reference-sketch.json' in entries): raise ValueError('Reference sketch entry is missing or orphaned.')
    if sketch is not None and not equal_json(sketch, parse_json(entries['reference-sketch.json'], 'reference-sketch.json')):
        raise ValueError('Reference sketch differs from project reference.')
    return active, bindings


def validate_tray_fields(source):
    """Reject fields the older tray validator otherwise silently ignores."""
    def allowed(item, keys, label):
        if not isinstance(item, dict) or set(item) - set(keys):
            raise ValueError(f'{label} contains unsupported fields.')
    allowed(source, ('schema','title','units','outer','wall','floor','mounts','cutouts','lid'), 'Tray')
    allowed(source.get('outer'), ('length','width','height'), 'Tray outer')
    if not isinstance(source.get('mounts', []), list) or not isinstance(source.get('cutouts', []), list):
        raise ValueError('Tray mounts and cutouts must be arrays.')
    for item in source.get('mounts', []):
        allowed(item, ('id','x','y','bossRadius','bossTopZ','locatorRadius','locatorHeight','holeRadius'), 'Tray mount')
    for item in source.get('cutouts', []): allowed(item, ('edge','start','end','bottom','top'), 'Tray cutout')
    if source.get('lid') is not None:
        allowed(source['lid'], ('thickness','skirtDepth','skirtWall','clearance','window'), 'Tray lid')
        if source['lid'].get('window') is not None: allowed(source['lid']['window'], ('x','y','length','width'), 'Tray lid window')


def failure_message(diagnostic, label):
    """Expose only the trusted CLI's bounded structured validation message.

    Native tracebacks can contain private staging paths. Unrecognized output
    receives a useful branch label without copying that diagnostic to the UI.
    """
    message = f'{label} failed a generation or readback check.'
    try:
        result = json.loads(diagnostic)
    except (ValueError, RecursionError):
        return message
    if not isinstance(result, dict) or set(result) != {'error'} or not isinstance(result['error'], str):
        return message
    detail = ' '.join(''.join(c if ord(c) >= 32 and ord(c) != 127 else ' ' for c in result['error']).split())
    if not detail: return message
    if 'Traceback' in detail or re.search(r'/(?:private|tmp|Users|var/folders)/', detail): return message
    if len(detail) > 240: detail = detail[:237] + '...'
    return f'{label} rejected the source: {detail}'


def run(command, timeout, label='CAD branch'):
    # Do not start a new process group: server supervisor owns the complete job.
    # Regular temporary output files avoid inherited pipe descriptors keeping
    # communicate() blocked after the immediate generator times out. The outer
    # supervisor must kill the complete worker group on every terminal outcome.
    with tempfile.TemporaryFile() as stdout, tempfile.TemporaryFile() as stderr:
        process = subprocess.Popen([sys.executable, *map(str, command)], stdout=stdout, stderr=stderr)
        try: process.wait(timeout=timeout)
        except BaseException:
            process.kill(); process.wait()
            raise ValueError(f'{label} exceeded its bounded generation/readback time.') from None
        if process.returncode:
            stderr.seek(0, os.SEEK_END)
            stderr.seek(max(0, stderr.tell() - 1800))
            diagnostic = stderr.read().decode('utf-8', errors='replace').strip()
            raise ValueError(failure_message(diagnostic, label))


def strict_tray(root):
    sys.path.insert(0, str(TOOLS / 'solid-generator'))
    sys.path.insert(0, str(TOOLS / 'tray-generator'))
    from mesh_check import check_mesh, normalize_export_mesh, verify_export_mesh_record
    from verify import read_step
    spec = parse_json((root / 'spec.json').read_bytes(), 'generated tray source')
    receipt = {}
    for stem in ('tray', 'lid') if spec.get('lid') else ('tray',):
        mesh = root / f'{stem}.stl'
        record = normalize_export_mesh(mesh, root / f'{stem}.raw.stl')
        replay = verify_export_mesh_record(mesh, record)
        receipt[stem] = {'stl_export': record, 'stl_export_readback': replay,
                         'stl_check': check_mesh(mesh, read_step(root / f'{stem}.step'))}
    # Hashes/readback must describe final STL bytes, including after normalization.
    run([TOOLS / 'tray-generator/verify.py', '--package', root], 90, 'Tray (tray-spec.json) final readback')
    (root / 'strict-mesh-verification.json').write_text(json.dumps({
        'status': 'passed', 'parts': receipt, 'limits': LIMITS[:3]}, indent=2) + '\n')


def generate(source, destination):
    if not destination.is_absolute() or destination.exists() or destination.is_symlink() or not destination.parent.is_dir():
        raise ValueError('--out must be an absent absolute ZIP path whose parent exists.')
    raw, entries = read_source(source)
    active, bindings = validate_sources(entries)
    with tempfile.TemporaryDirectory(prefix='.project-cad-', dir=destination.parent) as temporary:
        staging = Path(temporary)
        branches = []
        generated_root = staging / 'generated-cad'
        generated_root.mkdir()
        for field, name, branch, script in active:
            if branch == 'tray': validate_tray_fields(parse_json(entries[name], name))
            spec = staging / name
            spec.write_bytes(entries[name])
            output = generated_root / branch
            label = {'tray': 'Tray', 'shared-solid': 'Shared solid', 'assembly': 'Assembly'}[branch] + f' ({name})'
            run([TOOLS / script, '--spec', spec, '--out', output], 240, label)
            if branch == 'tray': run([Path(__file__).resolve(), '--strict-tray', output], 160, label + ' strict mesh readback')
            verification = output / 'verification.json'
            if not verification.is_file(): raise ValueError('Generator omitted fresh readback evidence.')
            readback = parse_json(verification.read_bytes(), 'generated verification')
            branches.append({'branch': branch, 'project_field': field, 'source_entry': name,
                             'source_sha256': sha(entries[name]),
                             'status': 'generated and fresh-process readback passed',
                             'geometry_status': readback.get('status'),
                             'build_report': f'generated-cad/{branch}/build-report.json',
                             'verification': f'generated-cad/{branch}/verification.json',
                             'strict_mesh_verification': 'generated-cad/tray/strict-mesh-verification.json' if branch == 'tray' else None})
        payloads = dict(entries)
        # Keep the exact container as well as its entry bytes. Rebuilding a ZIP
        # changes directory metadata, so entry hashes alone cannot replay the
        # captured source_archive_sha256 without these original archive bytes.
        payloads['captured-source.zip'] = raw
        total = sum(map(len, payloads.values()))
        for file in sorted(generated_root.rglob('*')):
            if file.is_symlink(): raise ValueError('Generated package must not contain symlinks.')
            if file.is_dir(): continue
            if not file.is_file(): raise ValueError('Generated package contains a nonregular artifact.')
            size = file.stat().st_size
            total += size
            if total > MAX_OUTPUT: raise ValueError('Combined handoff exceeds 64 MiB uncompressed.')
            name = file.relative_to(staging).as_posix()
            payloads[name] = file.read_bytes()
        manifest = {'schema': 'hardware-studio-project-cad-v1',
                    'status': 'interference' if any(b['geometry_status'] == 'interference' for b in branches) else 'passed',
                    'readback': 'All requested CAD branches generated and fresh-process readback passed.',
                    'source_archive_sha256': sha(raw), 'project_json_sha256': sha(entries['project.json']),
                    'source_archive_entry': 'captured-source.zip',
                    'source_entries': {name: {'sha256': sha(data), 'bytes': len(data)} for name, data in entries.items()},
                    'part_bindings': bindings, 'branches': branches,
                    'files': {name: {'sha256': sha(data), 'bytes': len(data)} for name, data in payloads.items()},
                    'manifest_self_hash': 'excluded to avoid a circular digest', 'limits': LIMITS}
        manifest_bytes = (json.dumps(manifest, indent=2) + '\n').encode()
        if total + len(manifest_bytes) > MAX_OUTPUT: raise ValueError('Combined handoff manifest exceeds 64 MiB limit.')
        payloads['cad-package-manifest.json'] = manifest_bytes
        archive_path = staging / 'handoff.zip'
        with zipfile.ZipFile(archive_path, 'x', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for name, data in payloads.items(): archive.writestr(name, data)
        if archive_path.stat().st_size > MAX_OUTPUT: raise ValueError('Combined ZIP exceeds 64 MiB.')
        with archive_path.open('rb') as archive: os.fsync(archive.fileno())
        # Atomic create-if-absent: unlike replace/rename this never overwrites a
        # destination created while generation was running, including symlinks.
        os.link(archive_path, destination)
        return manifest


def supervise(command, timeout=480):
    worker = subprocess.Popen(command, start_new_session=True)
    try:
        try: return worker.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            raise ValueError('Project CAD exceeded its bounded lifetime.') from None
    finally:
        try: os.killpg(worker.pid, signal.SIGKILL)
        except ProcessLookupError: pass
        worker.wait()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-zip', type=Path)
    parser.add_argument('--out', type=Path)
    parser.add_argument('--strict-tray', type=Path, help=argparse.SUPPRESS)
    parser.add_argument('--worker', action='store_true', help='Inherit an external supervisor process group (server only).')
    args = parser.parse_args()
    try:
        if args.strict_tray:
            strict_tray(args.strict_tray)
            return
        if not args.source_zip or not args.out: parser.error('Provide --source-zip and --out.')
        if not args.worker:
            # Standalone callers receive the same bounded group supervision as
            # server jobs, without ever signaling the caller's process group.
            code = supervise([sys.executable, str(Path(__file__).resolve()),
                '--worker', '--source-zip', str(args.source_zip), '--out', str(args.out)])
            raise SystemExit(code)
        result = generate(args.source_zip, args.out)
        print(json.dumps({'output': str(args.out), 'status': result['status'], 'branches': result['branches']}))
    except (ValueError, OSError, zipfile.BadZipFile) as error:
        print(json.dumps({'error': str(error)}), file=sys.stderr)
        raise SystemExit(1)


if __name__ == '__main__': main()
