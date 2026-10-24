"""Verify captured proposal evidence offline; optionally replay JS and inspect STEP.

The default path requires only Python's standard library. Production replay uses
an existing Node executable. Native inspection imports only the sibling plate
example's check_step function, and needs OCP in this Python environment.
"""
import argparse
import base64
import hashlib
import importlib.util
import json
import math
from pathlib import Path, PurePosixPath
import shutil
import struct
import subprocess
import sys
import tempfile
import zipfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent
PREFIX = 'geometry-checks/attempt-1/'
EXPECTED_SOURCE_SHA = 'acf12227862ec6d3340ff463ff740a72c7136674cc8d899e94b0b10c7e3ba796'
EXPECTED_STL_SHA = 'eb4414280973445819f612361ee163f2fcfd27e351af324b0c6179fcddbc4cef'
EXPECTED_MODEL = 'qwen3.8:27b'
EXPECTED_DIGEST = 'aaee06c39dcf2437cde036998d960e1fc1494b8191be7cc9657d01e509097813'


def require(value, message):
    if not value:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def parsed(data):
    return json.loads(data)


def archive(name):
    path = ROOT / name
    with zipfile.ZipFile(path) as package:
        require(package.testzip() is None, f'{name}: failed CRC.')
        names = package.namelist()
        require(len(names) == len(set(names)), f'{name}: duplicate entry.')
        for name_in_zip in names:
            entry = PurePosixPath(name_in_zip)
            require(not entry.is_absolute() and '..' not in entry.parts and '\\' not in name_in_zip,
                    f'{name}: unexpected path.')
        contents = {name_in_zip: package.read(name_in_zip) for name_in_zip in names}
    return contents, {'file': name, 'sha256': digest(path.read_bytes()), 'crc': 'passed',
                      'entry_sha256': {name: digest(data) for name, data in contents.items()}}


def mesh_bounds(data):
    require(len(data) >= 84, 'Missing binary STL header.')
    count = struct.unpack_from('<I', data, 80)[0]
    require(count == 692 and len(data) == 84 + 50 * count, 'STL binary length or triangle count differs.')
    low, high = [math.inf] * 3, [-math.inf] * 3
    for triangle in range(count):
        for vertex in range(3):
            point = struct.unpack_from('<fff', data, 84 + 50 * triangle + 12 + 12 * vertex)
            require(all(math.isfinite(value) for value in point), 'STL coordinate is not finite.')
            low = [min(a, b) for a, b in zip(low, point)]
            high = [max(a, b) for a, b in zip(high, point)]
    require(low == [0, 0, 0] and high == [48, 32, 3], 'STL bounds differ from explicit instruction.')
    return {'triangles': count, 'min_mm': low, 'max_mm': high}


def check_proposal(contents):
    proposal = parsed(contents['proposal.json'])
    source_bytes = contents[PREFIX + 'source.json']
    source = parsed(source_bytes)
    receipt = parsed(contents[PREFIX + 'check.json'])
    binding = parsed(contents[PREFIX + 'proposal-binding.json'])
    response_bytes = contents[PREFIX + 'response.json']
    response = parsed(response_bytes)
    raw = parsed(proposal['rawResponse']['response'])
    require(digest(source_bytes) == EXPECTED_SOURCE_SHA, 'Captured prepared source differs from retained first trial.')
    require(receipt['sourceSha256'] == digest(source_bytes) and receipt['sourceBytes'] == len(source_bytes),
            'Receipt does not bind exact prepared source bytes.')
    require(receipt['responseSha256'] == digest(response_bytes), 'Raw HTTP response hash mismatch.')
    require(receipt['schema'] == 'hardware-studio-solid-proposal-check-v1' and receipt['status'] == 'passed'
            and receipt['code'] == 'passed' and receipt['httpStatus'] == 200 and receipt['error'] is None,
            'First proposal did not record a successful check.')
    require(binding['request'] == proposal['request'] and binding['model'] == proposal['model']
            and binding['proposalCapturedAt'] == proposal['capturedAt'], 'Attempt binding differs from proposal.')
    require(binding['staleAtCompletion'] is False and len(proposal['geometryChecks']) == 1
            and proposal['geometryChecks'][0]['entry'] == PREFIX, 'Unexpected attempt or stale-at-completion record.')
    require(proposal['model']['name'] == EXPECTED_MODEL and proposal['model']['digest'] == EXPECTED_DIGEST
            and proposal['model']['identityCheckedBeforeAndAfter'] is True
            and proposal['rawResponse']['model'] == EXPECTED_MODEL and proposal['rawResponse']['done'] is True,
            'Recorded model identity differs from first trial.')
    require(proposal['request']['mode'] == 'create' and raw['status'] == 'ready', 'Expected original create-mode proposal.')
    require(source == parsed(contents['proposed-source.json']) == proposal['output']['spec'] == raw['spec']
            == response['spec'], 'Raw model, normalized output, exported source and HTTP source differ.')
    require(proposal['output']['assumptions'] == raw['assumptions'] == []
            and proposal['output']['missing'] == raw['missing'] == [], 'Unexpected assumptions or missing input.')
    require(parsed(proposal['output']['base']) == proposal['request']['base']
            == parsed(contents['before-source.json']), 'Captured baseline mismatch.')
    require(len(source['features']) == 3 and source['probes'] == [], 'Expected three features and no generated probes.')
    stl = contents[PREFIX + 'solid.stl']
    decoded = base64.b64decode(response['meshes'][0]['dataBase64'], validate=True)
    require(stl == decoded and digest(stl) == EXPECTED_STL_SHA == receipt['stlSha256']
            == response['verification']['sha256']['solid.stl'] and len(stl) == receipt['stlBytes'],
            'Retained STL is not the verified response mesh.')
    bounds = mesh_bounds(stl)
    require(receipt['checks']['triangles'] == bounds['triangles']
            and receipt['checks']['min'] == bounds['min_mm'] and receipt['checks']['max'] == bounds['max_mm']
            and receipt['checks']['probes'] == 0, 'Receipt mesh checks differ from actual STL.')
    require(abs(receipt['checks']['volumeMm3'] - (48 * 32 * 3 - 2 * math.pi * 2**2 * 3)) < 1e-6,
            'Declared STEP volume differs from analytic instruction volume.')
    require(receipt['limits']['stepAvailable'] is False and receipt['limits']['rawMeshAvailable'] is False
            and receipt['limits']['physicalValidation'] is False and receipt['limits']['semanticIntentValidation'] is False,
            'Preview evidence overstates its limits.')
    require(not any(name.endswith('.step') for name in contents), 'Preview ZIP unexpectedly contains STEP.')
    return {'source_sha256': digest(source_bytes), 'raw_http_response_sha256': digest(response_bytes),
            'stl_sha256': digest(stl), 'stl_bytes': len(stl), 'mesh_readback': bounds,
            'model': proposal['model'], 'instruction': proposal['request']['instruction'],
            'three_features_zero_generated_probes': True, 'receipt_bound_to_request_and_model': True}


def production_replay(contents):
    node = shutil.which('node')
    require(node is not None, 'Production replay requires an existing Node executable.')
    studio = ROOT.parent.parent
    script = f"""
import {{readFileSync}} from 'node:fs';
import {{validateSolidIntentResponse}} from {json.dumps((studio / 'solid-intent.js').as_uri())};
import {{validateSolidSpec}} from {json.dumps((studio / 'solid-spec.js').as_uri())};
import {{solidMeshes}} from {json.dumps((studio / 'solid-preview.js').as_uri())};
const data=JSON.parse(readFileSync(0,'utf8'));
const result=validateSolidIntentResponse(data.proposal.request,JSON.parse(data.proposal.rawResponse.response));
if(JSON.stringify(result)!==JSON.stringify(data.proposal.output))throw new Error('Normalized production intent differs.');
if(JSON.stringify(validateSolidSpec(result.spec))!==data.source)throw new Error('Production prepared source differs.');
const mesh=(await solidMeshes(data.response,result.spec))[0];
process.stdout.write(JSON.stringify({{normalized_intent_replayed:true,production_mesh_validator_replayed:true,triangles:mesh.triangles}}));
"""
    data = {'proposal': parsed(contents['proposal.json']), 'source': contents[PREFIX + 'source.json'].decode(),
            'response': parsed(contents[PREFIX + 'response.json'])}
    process = subprocess.run([node, '--input-type=module', '-e', script], input=json.dumps(data),
                             capture_output=True, text=True, timeout=30, check=True)
    return parsed(process.stdout)


def run(native=False, replay=False):
    captured, captured_report = archive('first-checked-proposal.zip')
    final, final_report = archive('final-checked-proposal.zip')
    stale, stale_report = archive('first-stale-proposal.zip')
    rejected, rejected_report = archive('rejected-check.zip')
    cad, cad_report = archive('first-proposed-cad.zip')
    proposal_check = check_proposal(captured)
    final_proposal_check = check_proposal(final)
    final_browser = parsed((ROOT / 'final-browser-check.json').read_bytes())
    final_working = (ROOT / 'final-working-source.json').read_bytes()
    require(final_browser['candidate_ui'] == 17 and final_browser['checker_import'] == 2
            and final_browser['model_name'] == EXPECTED_MODEL and final_browser['source_applied'] is False
            and final_browser['working_source_before_after_byte_identical'] is True,
            'Final browser observation did not record current versions and source preservation.')
    require(final_browser['receipt'] == parsed(final[PREFIX + 'check.json']), 'Final observed and exported receipts differ.')
    require(final_working == (ROOT / 'before-source.json').read_bytes()
            and final_browser['working_source_sha256'] == digest(final_working)
            and parsed(final_working) == parsed(final['before-source.json']), 'Final working source changed.')
    require(parsed(final['proposal.json'])['capturedAt'] != parsed(captured['proposal.json'])['capturedAt'],
            'Final trial reused the first capture identity.')
    require(captured == stale, 'Later stale download changed captured ZIP entry names or bytes.')
    before, after = (ROOT / 'before-source.json').read_bytes(), (ROOT / 'after-check-source.json').read_bytes()
    require(before == after and parsed(before) == parsed(captured['before-source.json']),
            'Working source changed during the proposal/check trial.')
    browser = parsed((ROOT / 'first-browser-check.json').read_bytes())
    for key in ['working_source_byte_identical_before_after_check', 'all_captured_zip_entries_identical_after_later_instruction',
                'browser_stale_check_and_apply_disabled']:
        require(browser[key] is True, f'Browser observation {key} was not recorded.')
    require(browser['current_source_applied'] is False and browser['working_source_sha256'] == digest(before),
            'Browser observation disagrees with source hashes.')
    rejection = parsed(rejected['check.json'])
    require(rejection == parsed((ROOT / 'rejected-receipt.json').read_bytes()), 'Rejected receipt copy differs.')
    require(rejection['status'] == 'rejected' and rejection['httpStatus'] == 422
            and rejection['sourceSha256'] == digest(rejected['source.json'])
            and rejection['sourceBytes'] == len(rejected['source.json']) and rejection['stlSha256'] is None
            and rejection['stlBytes'] == 0 and rejection['checks'] is None and not any(n.endswith('.stl') for n in rejected),
            'Rejected evidence has inconsistent source binding or a mesh.')
    binding = parsed((ROOT / 'full-cad-binding.json').read_bytes())
    require(binding['source_sha256'] == proposal_check['source_sha256']
            and binding['cad_zip_sha256'] == cad_report['sha256'] and parsed(cad['spec.json'])
            == parsed(captured[PREFIX + 'source.json']), 'Separate full CAD is not bound to captured source.')
    require(cad['solid.stl'] == captured[PREFIX + 'solid.stl'] and binding['preview_stl_byte_identical_to_full_CAD']
            and binding['stl_sha256'] == digest(cad['solid.stl'])
            and binding['step_sha256'] == digest(cad['solid.step']), 'Full CAD geometry binding differs.')
    require(final[PREFIX + 'source.json'] == captured[PREFIX + 'source.json']
            and final[PREFIX + 'solid.stl'] == cad['solid.stl'],
            'Final source/STL does not match the independently inspected full CAD case.')
    cad_verification = parsed(cad['verification.json'])
    for name, expected in cad_verification['sha256'].items():
        require(name in cad and digest(cad[name]) == expected, f'Full CAD reported hash differs: {name}.')
    report = {'status': 'passed', 'first_browser_versions': {'solid_ui': 16, 'proposal_checker': 1},
              'final_browser_versions': {'solid_ui': 17, 'proposal_checker': 2},
              'archives': [captured_report, final_report, stale_report, rejected_report, cad_report], 'first_proposal': proposal_check,
              'final_proposal': final_proposal_check, 'final_browser_observations': final_browser,
              'final_working_source_byte_identical': True,
              'working_source_byte_identical': True, 'working_source_sha256': digest(before),
              'later_stale_download_entry_bytes_identical': True,
              'browser_observations': browser, 'rejected_case': {'status': rejection['status'], 'error': rejection['error'],
                  'source_sha256': rejection['sourceSha256'], 'verified_mesh_present': False},
              'separate_full_cad': {'same_prepared_source': True, 'stl_byte_identical': True,
                  'first_and_final_prepared_source_byte_identical': True, 'final_stl_byte_identical': True,
                  'step_sha256': digest(cad['solid.step']), 'transport': 'Existing HTTP /api/solid from first captured source; no apply'},
              'production_replay': {'first': production_replay(captured), 'final': production_replay(final)} if replay else {'status': 'not-run'},
              'independent_step': {'status': 'not-run'},
              'limits': ['Browser observations are preserved observations, not reconstructed from archive bytes.',
                         'Preview evidence has no STEP or raw pre-normalization STL; native verifier reports are not browser topology recomputation.',
                         'Optional native inspection uses the same OpenCascade kernel, not a different CAD system.',
                         'Two successful trials of the same plate instruction are not a general model accuracy benchmark or physical validation.']}
    if native:
        checker_path = ROOT.parent / 'first-part-generation' / 'verify_intent.py'
        module_spec = importlib.util.spec_from_file_location('instruction_plate_checker', checker_path)
        checker = importlib.util.module_from_spec(module_spec)
        module_spec.loader.exec_module(checker)
        with tempfile.TemporaryDirectory(prefix='proposal-evidence-step-') as temporary:
            step = Path(temporary) / 'captured-source.step'
            step.write_bytes(cad['solid.step'])
            report['independent_step'] = {'status': 'passed', 'step_sha256': digest(step.read_bytes()),
                                          'first_and_final_prepared_source_and_stl_match_this_cad': True,
                                          'measurements': checker.check_step(step)}
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--native', action='store_true', help='Inspect the separate matched STEP with OCP.')
    parser.add_argument('--production-replay', action='store_true', help='Replay current JS intent and viewer validators with Node.')
    parser.add_argument('--out', type=Path, default=ROOT / 'verification.json')
    args = parser.parse_args()
    report = run(native=args.native, replay=args.production_replay)
    args.out.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'status': report['status'], 'production_replay': report['production_replay'],
                      'native': report['independent_step']['status'], 'report': str(args.out)}, indent=2))


if __name__ == '__main__':
    main()
