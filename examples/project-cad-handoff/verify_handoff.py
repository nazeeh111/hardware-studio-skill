"""Inspect retained handoff bytes and actual STEP without the Studio builder.

Archive verification uses only the Python standard library. Full inspection also
uses OCP and the sibling explicit pull-tab analytic inspector, never build123d,
the Studio source interpreter, builder, or package verifier.
"""
import argparse
import hashlib
import importlib.util
import io
import json
import math
from pathlib import Path
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent
PINNED = {
    'actual-browser-bundle.zip': '1eb30da64767ac2719f7d278c4d16530b04eaa7af33fb9ac1fa37483991c2a07',
    'retained-captured-bundle.zip': 'f6aa40c3f2dd6b8fb4c667bc7883bef0dbd461d6e9249e0976c2e9ac258253f5',
    'before-project.json': '6b2680685123c00aae293ea147b094b0103119918942af8161bb75213eb8bf29',
    'after-project.json': '2d66108d71d3c75d4659c4722c0246b77c3e2d055706ab5452dca546a9cbe78c',
    'interference-bundle.zip': '14316f24c4f0cf2e1613344bd5ee9342256086bedf711b1023dd5d96311af7a7',
    'browser-failure-retention.json': '24fd0ce4d7ba9a70865234aba20dbeae384e8a879f9093f7a3033469039c5742',
    'interference-manifest.json': '2c6aaf4289b7fb6c8285e9db7584294684249447a3797f183bd1a3c6fd364557',
    'interference-verification.json': '7d9c8cc9023023fc220b56db40545bb28c16e0afdcdf7809636ad15b3b555090',
}
SOURCE_HASHES = {
    'actual-browser-bundle.zip': '72c7c89c538224f95db87eddccc8e4e0b5fb922bebdf588a135911ec9767fb8c',
    'retained-captured-bundle.zip': '3dd28c80128bf88d464aeeda6315f01d76f42445f1f84176915895198ab7ff32',
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def read_archive(data):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        names = archive.namelist()
        require(len(names) == len(set(names)), 'Duplicate ZIP paths.')
        require(all(not n.startswith('/') and '\\' not in n and all(x not in ('', '.', '..') for x in n.split('/')) for n in names), 'Unsafe ZIP paths.')
        require(archive.testzip() is None, 'ZIP CRC failure.')
        return {name: archive.read(name) for name in names}


def check_record(data, record, name):
    require(len(data) == record['bytes'] and sha(data) == record['sha256'], f'Manifest bytes/hash mismatch: {name}.')


def json_at(files, name):
    return json.loads(files[name])


def verify_interference():
    for name in ('interference-bundle.zip','browser-failure-retention.json','interference-manifest.json','interference-verification.json'):
        require(sha((ROOT/name).read_bytes()) == PINNED[name], f'Additional pinned evidence changed: {name}.')
    files = read_archive((ROOT/'interference-bundle.zip').read_bytes())
    manifest = json_at(files,'cad-package-manifest.json')
    require(manifest == json.loads((ROOT/'interference-manifest.json').read_bytes()), 'Interference manifest differs from actual browser ZIP.')
    require(manifest['status'] == 'interference' and set(files)-{'cad-package-manifest.json'} == set(manifest['files']), 'Interference status/coverage differs.')
    for name, record in manifest['files'].items():
        check_record(files[name],record,name)
    source = read_archive(files['captured-source.zip'])
    require(sha(files['captured-source.zip']) == manifest['source_archive_sha256'] and set(source) == set(manifest['source_entries']), 'Interference captured-source mismatch.')
    for name, data in source.items():
        check_record(data,manifest['source_entries'][name],name)
        require(data == files[name], 'Interference nested source bytes differ.')
    report = json_at(files,'generated-cad/assembly/verification.json')
    require(report == json.loads((ROOT/'interference-verification.json').read_bytes()) and report['status'] == 'interference', 'Interference readback differs from retained ZIP.')
    overlapping = [pair for pair in report['pairs'] if pair['overlap_mm3'] > report['overlap_limit_mm3']]
    require(len(overlapping) == 1 and math.isclose(overlapping[0]['overlap_mm3'],4093.542869885118,abs_tol=1e-6), 'Expected one fully overlapping tab pair.')
    receipt = json.loads((ROOT/'browser-failure-retention.json').read_bytes())
    require(receipt['byte_identical'] and not receipt['partial_package_downloaded'] and receipt['failure'].startswith('Feature miss must change volume'), 'Failure-retention receipt differs.')
    return files, {'archive':'interference-bundle.zip','sha256':PINNED['interference-bundle.zip'],
                   'status':'interference','file_count':len(files),'manifest_covered_files':len(manifest['files']),
                   'exact_source_entries':len(source),'overlapping_pair':overlapping[0],
                   'failure_retention_receipt':receipt,
                   'failure_receipt_limit':'This script verifies the retained receipt bytes; it does not replay browser failure or retain duplicate prior-download bytes.'}


def verify_archive(name):
    raw = (ROOT/name).read_bytes()
    require(sha(raw) == PINNED[name], f'Pinned archive changed: {name}.')
    files = read_archive(raw)
    manifest = json_at(files, 'cad-package-manifest.json')
    require(manifest['schema'] == 'hardware-studio-project-cad-v1' and manifest['status'] == 'passed', 'Unexpected manifest schema/status.')
    require(set(files)-{'cad-package-manifest.json'} == set(manifest['files']), 'Manifest must cover every non-manifest file exactly.')
    for path, record in manifest['files'].items():
        check_record(files[path], record, path)
    source_bytes = files['captured-source.zip']
    require(sha(source_bytes) == SOURCE_HASHES[name] == manifest['source_archive_sha256'], 'Captured source archive bytes differ from this recorded run.')
    source = read_archive(source_bytes)
    require(set(source) == set(manifest['source_entries']), 'Nested source members differ from manifest.')
    for path, data in source.items():
        check_record(data, manifest['source_entries'][path], path)
        require(data == files[path], f'Nested source bytes differ from package source: {path}.')
    require(sha(files['project.json']) == manifest['project_json_sha256'], 'Captured project digest mismatch.')
    project = json_at(files, 'project.json')
    require(files['project.json'] == (ROOT/'captured-project.json').read_bytes(), 'Captured project snapshot changed.')
    before, after = (json.loads((ROOT/(n+'-project.json')).read_bytes()) for n in ('before', 'after'))
    for n in ('before', 'after'):
        require(sha((ROOT/(n+'-project.json')).read_bytes()) == PINNED[n+'-project.json'], f'{n} snapshot changed.')
    before_diff = sorted(k for k in set(before)|set(project) if before.get(k) != project.get(k))
    after_diff = sorted(k for k in set(after)|set(project) if after.get(k) != project.get(k))
    require(before_diff == ['createdAt', 'id', 'starterId', 'updatedAt'], 'Import changed more than identity/timestamps.')
    require(after_diff == ['notes', 'updatedAt'], 'Later workspace edit differs from the retained evidence scope.')
    require(project['notes'] != after['notes'] and project['id'] == after['id'], 'Expected later note edit in the same project.')
    branches = manifest['branches']
    require({b['branch'] for b in branches} == {'tray', 'shared-solid', 'assembly'} and len(branches) == 3, 'Expected all three CAD branches.')
    for branch in branches:
        require(json_at(source, branch['source_entry']) == project[branch['project_field']], 'Source branch does not match captured project.')
        require(sha(source[branch['source_entry']]) == branch['source_sha256'], 'Branch digest mismatch.')
        generated_spec = json_at(files, 'generated-cad/'+branch['branch']+'/spec.json')
        captured_spec = project[branch['project_field']]
        if branch['branch'] == 'tray':
            # Legacy tray normalization explicitly writes null optional holes.
            captured_spec = {**captured_spec, 'mounts':[{**m,'holeRadius':m.get('holeRadius')} for m in captured_spec['mounts']]}
        require(generated_spec == captured_spec, 'Generated source differs beyond the documented tray null-hole normalization.')
    assembly = project['assemblySpec']
    require(len(assembly['assets']) == 1 and len(assembly['instances']) == 5, 'Expected one bound asset and five explicit instances.')
    require(assembly['assets'][0]['partId'] == 'curved-tab' and project['parts'][0]['id'] == 'curved-tab' and project['parts'][0]['qty'] == 5, 'Part/BOM binding differs.')
    require(json_at(source, 'cad-sources/part-001.json') == assembly['assets'][0]['source'] == project['solidSpec'], 'Shared and bound source differ.')
    for i, instance in enumerate(assembly['instances']):
        require(instance == {'id':f'tab-{i+1}', 'partId':'curved-tab', 'position':[50*i,0,0], 'rotation':[0,0,0]}, 'Unexpected instance placement.')
    require(manifest['part_bindings'] == [{'partId':'curved-tab','source_entry':'cad-sources/part-001.json','asset_index':1,'instance_ids':[f'tab-{i+1}' for i in range(5)],'placed':True,'generated_asset':'generated-cad/assembly/assets/part-001'}], 'Manifest part bindings differ.')
    report = json_at(files, 'generated-cad/assembly/verification.json')
    require(report['status'] == 'passed' and len(report['instances']) == 5 and len(report['pairs']) == 10, 'Assembly readback report incomplete.')
    require(all(r['stl_check']['passed'] for r in report['instances']) and all(r['stl_check']['passed'] for r in report['assets']), 'Expected retained mesh reports for every asset/instance.')
    require(json_at(files, 'generated-cad/shared-solid/verification.json')['stl_check']['passed'], 'Shared-solid mesh report failed.')
    strict = json_at(files, 'generated-cad/tray/strict-mesh-verification.json')
    require(set(strict['parts']) == {'tray','lid'} and all(p['stl_check']['passed'] for p in strict['parts'].values()), 'Tray/cover mesh report failed.')
    return files, {'archive':name, 'sha256':sha(raw), 'file_count':len(files), 'all_zip_crcs_passed':True,
                   'manifest_covered_files':len(manifest['files']), 'captured_source_sha256':sha(source_bytes),
                   'exact_source_entries':len(source), 'project_sha256':sha(files['project.json']),
                   'branches':[b['branch'] for b in branches], 'assembly_instances':5,
                   'import_only_changes':before_diff, 'later_edit_changes':after_diff}


def inspect_geometry(files, interference_files):
    helper_path = ROOT.parent/'curved-pull-tab'/'verify_intent.py'
    spec = importlib.util.spec_from_file_location('retained_pull_tab_analytic_inspector', helper_path)
    inspector = importlib.util.module_from_spec(spec)
    sys.dont_write_bytecode = True
    spec.loader.exec_module(inspector)
    from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
    from OCP.BRepCheck import BRepCheck_Analyzer
    from OCP.IFSelect import IFSelect_RetDone
    from OCP.STEPControl import STEPControl_Reader
    from OCP.TopAbs import TopAbs_SOLID
    from OCP.TopExp import TopExp_Explorer
    from OCP.gp import gp_Trsf, gp_Vec

    with tempfile.TemporaryDirectory(prefix='handoff-inspect-') as directory:
        def read(name, compound=False):
            path = Path(directory)/Path(name).name
            path.write_bytes(files[name])
            if not compound:
                return inspector.read_step(path)
            require(b'.MILLI.' in files[name] and b'.METRE.' in files[name], 'Compound STEP length units differ.')
            reader = STEPControl_Reader()
            require(reader.ReadFile(str(path)) == IFSelect_RetDone and reader.TransferRoots() >= 1, 'Compound STEP read failed.')
            shape = reader.OneShape()
            require(not shape.IsNull() and BRepCheck_Analyzer(shape).IsValid(), 'Compound STEP invalid.')
            return shape

        def untranslate(shape, x):
            transform = gp_Trsf()
            transform.SetTranslation(gp_Vec(-x,0,0))
            return BRepBuilderAPI_Transform(shape,transform,True).Shape()

        results = {}
        for branch in ('shared-solid', 'assembly/assets/part-001'):
            shape = read(f'generated-cad/{branch}/solid.step')
            results[branch] = inspector.inspect_shape(shape)
        placements = []
        for i in range(5):
            shape = read(f'generated-cad/assembly/instances/instance-{i+1:03d}.step')
            result = inspector.inspect_shape(untranslate(shape,50*i))
            placements.append({'instance':f'tab-{i+1}', 'translation_mm':[50*i,0,0],
                               'volume_mm3':result['volume_mm3'], 'analytic_faces':len(result['analytic_faces']),
                               'independent_regions':len(result['independent_regions'])})
        compound = read('generated-cad/assembly/assembly.step',compound=True)
        require(inspector.count(compound,TopAbs_SOLID) == 5, 'Compound STEP must contain exactly five solids.')
        inspector.vector(inspector.bbox(compound)[0],[0,0,0], 'Assembly minimum')
        inspector.vector(inspector.bbox(compound)[1],[240,20,6], 'Assembly maximum')
        inspector.close(inspector.volume(compound),5*inspector.EXPECTED_VOLUME,'Five-tab analytic volume')
        solids, explorer = [], TopExp_Explorer(compound,TopAbs_SOLID)
        while explorer.More():
            solids.append(explorer.Current());explorer.Next()
        solids.sort(key=lambda shape:inspector.bbox(shape)[0][0])
        for i, shape in enumerate(solids):
            inspector.inspect_shape(untranslate(shape,50*i))
        tray, lid = read('generated-cad/tray/tray.step'), read('generated-cad/tray/lid.step')
        # Exact dimensions are recorded in the captured study, not read from
        # generated reports. Circular boss volumes are integrated above floor.
        tray_volume = 66*45*14 - 61*40*11.5 - 2.5*15*11 + math.pi*(4*2.2**2+2*1.7**2)*5.5 + 6*math.pi*.8**2*1.2
        # Plate minus54x14 window; skirt annulus minus16x2x3 side access gap.
        lid_volume = (71*50-54*14)*2.5 + (71*50-67*46)*3 - 16*2*3
        for shape, low, high, expected, label in [(tray,[0,0,0],[66,45,14],tray_volume,'tray'),(lid,[-2.5,-2.5,11],[68.5,47.5,16.5],lid_volume,'cover')]:
            inspector.vector(inspector.bbox(shape)[0],low,label+' minimum')
            inspector.vector(inspector.bbox(shape)[1],high,label+' maximum')
            inspector.close(inspector.volume(shape),expected,label+' independent integrated volume')
        overlap_shapes = []
        for i in (1,2):
            path = Path(directory)/f'overlap-{i}.step'
            path.write_bytes(interference_files[f'generated-cad/assembly/instances/instance-{i:03d}.step'])
            overlap_shapes.append(inspector.read_step(path))
        from OCP.BRepAlgoAPI import BRepAlgoAPI_Common
        measured_overlap = inspector.volume(inspector.boolean(BRepAlgoAPI_Common,*overlap_shapes))
        inspector.close(measured_overlap,inspector.EXPECTED_VOLUME,'Independent nominal overlap of tab-1 and tab-2')
        return {'same_kernel_independent_inspection':True, 'builder_imported':False,
                'curved_source_shapes':results, 'placed_steps':placements,
                'compound':{'solid_count':5,'bounds_mm':inspector.bbox(compound),'volume_mm3':inspector.volume(compound)},
                'tray':{'bounds_mm':inspector.bbox(tray),'volume_mm3':inspector.volume(tray),'analytic_volume_mm3':tray_volume},
                'cover':{'bounds_mm':inspector.bbox(lid),'volume_mm3':inspector.volume(lid),'analytic_volume_mm3':lid_volume},
                'interference_pair_common_volume_mm3':measured_overlap}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archives-only', action='store_true', help='Verify bytes and reports without requiring OCP.')
    parser.add_argument('--output', type=Path, help='Optionally save this newly produced report.')
    args = parser.parse_args()
    archives, reports = [], []
    for name in SOURCE_HASHES:
        files, report = verify_archive(name)
        archives.append(files);reports.append(report)
    require(archives[0]['project.json'] == archives[1]['project.json'], 'Separate captures must preserve identical project source.')
    require(archives[0]['captured-source.zip'] != archives[1]['captured-source.zip'], 'These separate captures have distinct export timestamps.')
    interference_files, interference_report = verify_interference()
    # Independent generation can change STEP header bytes, so inspect both runs
    # even though their captured source project is identical.
    steps = [name for name in archives[0] if name.endswith('.step')]
    result = {'status':'passed', 'archives':reports,
              'step_files_per_run':len(steps), 'byte_identical_step_files_across_runs':sum(archives[0][name] == archives[1][name] for name in steps),
              'interference':interference_report,
              'geometry':None if args.archives_only else [inspect_geometry(files,interference_files) for files in archives],
              'limits':['Hashes bind these retained bytes, not general application correctness.',
                        'Retained server reports are checked for consistency; sampled mesh/STEP checks are not independently rerun here.',
                        'Independent analytic STEP inspection uses the same OpenCascade kernel family as generation.',
                        'Tray and shared solid are distinct unbound branches, not a fitted assembly of the five tabs.',
                        'No physical fit, manufacturing tolerance, material, strength, electrical or hardware behavior is validated.']}
    if args.output:
        args.output.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2))


if __name__ == '__main__':
    main()
