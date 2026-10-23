"""Replay the two later browser proposals and verify their distinct project STEP."""
import json
from pathlib import Path
import shutil
import subprocess
import sys

sys.dont_write_bytecode = True
from verify_intent import archive_check, check_step, require, sha256

ROOT = Path(__file__).resolve().parent


def replay(directory):
    path = directory / 'proposal.json'
    proposal = json.loads(path.read_text())
    node = shutil.which('node')
    require(node is not None, 'Node is required to replay the current response validator.')
    module = (ROOT.parent.parent / 'solid-intent.js').as_uri()
    source = (f'import {{validateSolidIntentResponse}} from {json.dumps(module)};'
              'import {readFileSync} from "node:fs";'
              'const p=JSON.parse(readFileSync(process.argv[1],"utf8"));'
              'process.stdout.write(JSON.stringify(validateSolidIntentResponse(p.request,JSON.parse(p.rawResponse.response))));')
    result = subprocess.run([node, '--input-type=module', '-e', source, str(path)], check=True, capture_output=True, text=True)
    require(json.loads(result.stdout) == proposal['output'], 'Current validator replay differs from captured output.')
    return proposal


def main():
    missing_directory = ROOT / 'missing-input'
    missing_archive = archive_check(missing_directory, 'hardware-studio-cad-proposal.zip')
    missing = replay(missing_directory)
    require(missing['request']['mode'] == 'create', 'Expected create mode for missing-dimension trial.')
    require(missing['output']['status'] == 'needs-input' and missing['output']['spec'] is None, 'Missing dimensions must not produce a source.')
    require(len(missing['output']['missing']) >= 1, 'Missing information needs an explicit explanation.')
    before = json.loads((missing_directory / 'before-source.json').read_text())
    original_plate = json.loads((ROOT / 'completed' / 'proposed-source.json').read_text())
    require(before == original_plate, 'Captured baseline does not match the earlier valid plate.')
    require(before == missing['request']['base'], 'Captured before-source differs from the request baseline.')
    require('proposed-source.json' not in missing_archive['extracted_sha256'], 'A missing-input result must not export new source.')
    missing_report = {'status': 'passed', 'archive': missing_archive,
                      'proposal_path': 'missing-input/proposal.json', 'raw_response_validation_replayed': True,
                      'response_status': missing['output']['status'], 'spec': None,
                      'missing': missing['output']['missing'], 'captured_before_source_matches_original_plate': True,
                      'proposed_source_exported': False,
                      'limits': ['Captured before-source confirms the recorded baseline; live state preservation is a separate browser check.']}
    (ROOT / 'missing-input-verification.json').write_text(json.dumps(missing_report, indent=2) + '\n')

    project_directory, cad_directory = ROOT / 'project-context', ROOT / 'project-cad'
    archives = [archive_check(project_directory, 'hardware-studio-cad-proposal.zip'),
                archive_check(cad_directory, 'hardware-studio-feature-cad.zip')]
    project = replay(project_directory)
    request = project['request']
    require(request['mode'] == 'create' and request['base'] is None, 'Project trial must create without a base source.')
    require(request['instruction'] == 'Create the selected part exactly as described in the project brief, with no extra features.', 'Project trial has a different instruction.')
    require(request['context']['project']['brief'] and request['context']['target']['id'], 'Project brief and explicit target are required.')
    require(project['output']['status'] == 'ready', 'Project trial did not return ready.')
    proposed = json.loads((project_directory / 'proposed-source.json').read_text())
    actual_source = json.loads((cad_directory / 'spec.json').read_text())
    require(project['output']['spec'] == proposed == actual_source, 'Project proposal and actual CAD source differ.')
    # This is the separately downloaded project CAD export, not the standalone
    # plate package checked in intent-verification.json.
    step = cad_directory / 'solid.step'
    measurements = check_step(step)
    project_report = {'status': 'passed', 'archives': archives,
                      'proposal_path': 'project-context/proposal.json', 'step_path': 'project-cad/solid.step',
                      'step_sha256': sha256(step), 'raw_response_validation_replayed': True,
                      'proposal_and_cad_source_match': True, 'request_instruction': request['instruction'],
                      'context': request['context'], 'baseline': None,
                      'expected_geometry_basis': 'Explicit dimensions in the preserved project brief and target detail; independent constants in verify_intent.py.',
                      'measurements': measurements,
                      'cut_tool_heights_mm': [feature['height'] for feature in actual_source['features'] if feature['shape'] == 'cylinder'],
                      'limits': ['Fresh-process readback uses OpenCascade, the same kernel as generation.',
                                 'No generated probes or build reports supplied the geometry expectations.',
                                 'These trials do not establish general model accuracy or physical fit, strength, safety or fabrication performance.',
                                 'Returning to the project and exporting its current workspace are separate browser checks.']}
    (ROOT / 'project-context-verification.json').write_text(json.dumps(project_report, indent=2) + '\n')
    print(json.dumps({'missing_input': missing_report['response_status'], 'missing_spec': None,
                      'project_status': project_report['status'], 'project_step_path': str(step),
                      'project_span_mm': measurements['span_mm'], 'project_volume_mm3': measurements['volume_mm3']}, indent=2))


if __name__ == '__main__':
    main()
