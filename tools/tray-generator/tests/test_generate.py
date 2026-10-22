import copy
import json
import struct
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from generate import bounds, make_tray, validate, volume


EXAMPLE = Path(__file__).resolve().parents[1] / 'examples' / 'pico-neopixel-tray.json'


class TrayGeneratorTests(unittest.TestCase):
    def test_export_readback_rejects_corrupt_stl_coordinates(self):
        root = EXAMPLE.parents[1]
        with tempfile.TemporaryDirectory() as temporary:
            package = Path(temporary) / 'tray'
            subprocess.run([sys.executable, str(root / 'generate.py'), '--spec', str(EXAMPLE), '--out', str(package)], check=True, capture_output=True, text=True)
            self.assertEqual(validate(json.loads((package / 'spec.json').read_text()))['outer'], {'length': 66.0, 'width': 45.0, 'height': 14.0})
            self.assertEqual(json.loads((package / 'verification.json').read_text())['stl_outer_span_mm'], [66.0, 45.0, 14.0])
            stl = bytearray((package / 'tray.stl').read_bytes())
            struct.pack_into('<f', stl, 84 + 12, float('nan'))
            (package / 'tray.stl').write_bytes(stl)
            check = subprocess.run([sys.executable, str(root / 'verify.py'), '--package', str(package)], capture_output=True, text=True)
            self.assertNotEqual(check.returncode, 0)
            self.assertIn('non-finite coordinate', check.stderr)

    def test_reproduces_existing_pico_tray_geometry(self):
        spec = validate(json.loads(EXAMPLE.read_text()))
        shape = make_tray(spec)
        self.assertEqual(bounds(shape), [66.0, 45.0, 14.0])
        self.assertAlmostEqual(volume(shape), 13556.364475159604, places=4)

    def test_through_hole_removes_material_without_changing_outer_size(self):
        raw = {'schema': 'hardware-studio-tray-v1', 'units': 'mm', 'outer': {'length': 40, 'width': 30, 'height': 10}, 'wall': 2, 'floor': 2,
               'mounts': [{'id': 'a', 'x': 20, 'y': 15, 'bossRadius': 3, 'bossTopZ': 6}], 'cutouts': []}
        solid = make_tray(validate(raw))
        raw['mounts'][0]['holeRadius'] = 1.2
        drilled = make_tray(validate(raw))
        self.assertEqual(bounds(drilled), [40.0, 30.0, 10.0])
        self.assertGreater(volume(solid) - volume(drilled), 25)

    def test_rejects_geometry_that_cannot_form_the_requested_tray(self):
        template = json.loads(EXAMPLE.read_text())
        cases = []
        case = copy.deepcopy(template); case['wall'] = 35; cases.append(case)
        case = copy.deepcopy(template); case['mounts'][0]['x'] = 2; cases.append(case)
        case = copy.deepcopy(template); case['mounts'][1]['x'] = case['mounts'][0]['x']; case['mounts'][1]['y'] = case['mounts'][0]['y']; cases.append(case)
        case = copy.deepcopy(template); case['mounts'][0]['holeRadius'] = 1; cases.append(case)
        case = copy.deepcopy(template); case['cutouts'][0]['bottom'] = 1; cases.append(case)
        for candidate in cases:
            with self.subTest(candidate=candidate):
                with self.assertRaises(ValueError):
                    validate(candidate)


if __name__ == '__main__':
    unittest.main()
