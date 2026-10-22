import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from OCP.IFSelect import IFSelect_RetDone
from OCP.Interface import Interface_Static
from OCP.STEPControl import STEPControl_AsIs, STEPControl_Writer
from generate import box
import fit
ROOT = Path(__file__).resolve().parents[1]


class FitChecks(unittest.TestCase):
    def test_nominal_clearance_wall_collision_pair_collision_and_source_tamper(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            tray = root / 'tray'
            subprocess.run([sys.executable, str(ROOT / 'generate.py'), '--spec', str(ROOT / 'examples' / 'pico-neopixel-tray.json'), '--out', str(tray)], check=True, capture_output=True, text=True)
            component = root / 'block.step'
            writer = STEPControl_Writer()
            Interface_Static.SetCVal_s('write.step.unit', 'MM')
            self.assertEqual(writer.Transfer(box(0, 0, 0, 10, 8, 2), STEPControl_AsIs), IFSelect_RetDone)
            self.assertEqual(writer.Write(str(component)), IFSelect_RetDone)
            manifest = {'schema': 'hardware-studio-fit-v1', 'trayPackage': 'tray',
                        'components': [{'id': 'board', 'step': 'block.step', 'translationMm': [20, 12, 7]}]}
            path = root / 'fit.json'
            path.write_text(json.dumps(manifest))
            clear = fit.fit_report(path)
            self.assertEqual(clear['status'], 'no modeled intersection above threshold')
            self.assertLess(clear['components'][0]['tray_overlap_mm3'], .01)
            self.assertGreater(clear['components'][0]['cavity_envelope_margins_mm']['left'], 0)
            output = root / 'clear-report'
            subprocess.run([sys.executable, str(ROOT / 'fit.py'), '--manifest', str(path), '--out', str(output)], check=True, capture_output=True, text=True)
            self.assertEqual(json.loads((output / 'fit-report.json').read_text())['status'], clear['status'])

            manifest['components'][0]['translationMm'] = [1, 25, 7]
            path.write_text(json.dumps(manifest))
            wall = fit.fit_report(path)
            self.assertEqual(wall['status'], 'modeled interference detected')
            self.assertGreater(wall['components'][0]['tray_overlap_mm3'], 20)

            manifest['components'][0]['translationMm'] = [20, 12, 7]
            manifest['components'].append({'id': 'second', 'step': 'block.step', 'translationMm': [20, 12, 7]})
            path.write_text(json.dumps(manifest))
            pair = fit.fit_report(path)
            self.assertGreater(pair['component_pairs'][0]['overlap_mm3'], 100)

            spec_path = tray / 'spec.json'
            original_spec = spec_path.read_text()
            spec_path.write_text(original_spec + ' ')
            with self.assertRaisesRegex(ValueError, 'spec hash differs'):
                fit.fit_report(path)
            spec_path.write_text(original_spec)

            legacy_spec = json.loads(original_spec)
            legacy_spec.pop('schema')
            legacy_spec.pop('units')
            spec_path.write_text(json.dumps(legacy_spec) + '\n')
            verification_path = tray / 'verification.json'
            verification = json.loads(verification_path.read_text())
            verification['sha256']['spec.json'] = fit.sha256(spec_path)
            verification_path.write_text(json.dumps(verification))
            self.assertTrue(fit.fit_report(path)['legacy_spec_rehydrated'])

            with (tray / 'tray.step').open('ab') as changed:
                changed.write(b'\n')
            with self.assertRaisesRegex(ValueError, 'hash differs'):
                fit.fit_report(path)
            failed_output = root / 'tampered-report'
            process = subprocess.run([sys.executable, str(ROOT / 'fit.py'), '--manifest', str(path), '--out', str(failed_output)], capture_output=True, text=True)
            self.assertNotEqual(process.returncode, 0)
            self.assertFalse(failed_output.exists())

    def test_rejects_reflection_as_a_rotation(self):
        with self.assertRaisesRegex(ValueError, 'reflections'):
            fit.rotation_matrix([[1, 0, 0], [0, 1, 0], [0, 0, -1]])


if __name__ == '__main__':
    unittest.main()
