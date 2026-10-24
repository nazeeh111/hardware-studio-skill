import copy
import importlib.util
import json
import math
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('curve_profile', ROOT / 'curve_profile.py')
curve = importlib.util.module_from_spec(spec)
spec.loader.exec_module(curve)
CASES = json.loads((ROOT / 'examples/curve-contract-cases.json').read_text())

class CurveContractTests(unittest.TestCase):
    def test_shared_cases(self):
        for case in CASES:
            with self.subTest(case=case['name']):
                original = copy.deepcopy(case)
                if case['valid']:
                    normalized = curve.validate_curve_profile(case['start'], case['segments'])
                    self.assertEqual(normalized['start'], normalized['segments'][-1]['end'])
                    self.assertEqual(original, case)
                    self.assertIsNot(normalized['start'], case['start'])
                else:
                    with self.assertRaises(ValueError): curve.validate_curve_profile(case['start'], case['segments'])
    def test_nonfinite_or_coercible_input(self):
        for bad in [float('nan'), float('inf'), -float('inf'), True, None, '1']:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                curve.validate_curve_profile([bad, 0], [{'kind':'line','end':[10,0]}, {'kind':'line','end':[0,0]}])
    def test_major_arc_bounds(self):
        g = curve.arc_geometry([5,0], [-5,0], [0,5])
        self.assertAlmostEqual(g['sweep'], -1.5 * math.pi)
        self.assertEqual(curve.curve_profile_bounds([5,0], [{'kind':'arc','via':[-3,-4],'end':[0,5]},{'kind':'line','end':[5,0]}]), {'min':[-5,-5], 'max':[5,5]})

if __name__ == '__main__': unittest.main()
