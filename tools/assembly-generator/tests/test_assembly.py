import copy
import importlib.util
import json
import math
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
loader = importlib.util.spec_from_file_location('assembly_kernel', ROOT/'assembly.py')
assembly = importlib.util.module_from_spec(loader)
loader.loader.exec_module(assembly)

def box(title='Block', origin=None, size=None):
    return {'schema': 'hardware-studio-solid-v1', 'title': title, 'units': 'mm', 'features': [
        {'id': 'body', 'operation': 'add', 'shape': 'box', 'origin': origin or [0, 0, 0], 'size': size or [10, 4, 2]}], 'probes': []}

def fixture():
    return {'schema': assembly.SCHEMA, 'title': 'Placed fixture', 'units': 'mm',
            'assets': [{'partId': 'base', 'source': box()}, {'partId': 'offset', 'source': box('Offset', [1, 2, 3], [2, 3, 4])}],
            'instances': [{'id': 'base-a', 'partId': 'base', 'position': [-20, 0, 0], 'rotation': [0, 0, 0]},
                          {'id': 'base-b', 'partId': 'base', 'position': [20, 10, 0], 'rotation': [0, 0, 90]},
                          {'id': 'offset-c', 'partId': 'offset', 'position': [10, 20, 30], 'rotation': [90, 90, 90]}]}

class AssemblyTests(unittest.TestCase):
    def generate(self, temporary, spec):
        source, out = Path(temporary)/'input.json', Path(temporary)/'package'
        source.write_text(json.dumps(spec))
        assembly.generate(source, out)
        return out, json.loads((out/'verification.json').read_text())

    def assertVector(self, actual, expected, places=5):
        for value, wanted in zip(actual, expected): self.assertAlmostEqual(value, wanted, places=places)

    def test_two_assets_three_instances_compound_and_independent_analytic_placements(self):
        with tempfile.TemporaryDirectory() as tmp:
            out, report = self.generate(tmp, fixture())
            self.assertEqual(report['status'], 'passed')
            self.assertEqual(report['assembly']['solid_count'], 3)
            self.assertAlmostEqual(report['assembly']['volume_mm3'], 184, places=5)
            expected = [([-20, 0, 0], [-10, 4, 2], 80), ([16, 10, 0], [20, 20, 2], 80), ([13, 22, 27], [17, 25, 29], 24)]
            for item, (low, high, volume) in zip(report['instances'], expected):
                self.assertVector(item['min_mm'], low); self.assertVector(item['max_mm'], high)
                self.assertVector(item['stl_min_mm'], low); self.assertVector(item['stl_max_mm'], high)
                self.assertAlmostEqual(item['volume_mm3'], volume, places=5)
                self.assertEqual(item['stl_triangles'], 12)
                self.assertEqual(item['sha256']['step'], assembly.sha(out/'instances'/item['name'].replace('.stl', '.step')))
            self.assertAlmostEqual(report['pairs'][0]['minimum_distance_mm'], math.sqrt(26**2+6**2), places=5)
            self.assertEqual(len(report['assets']), 2)
            self.assertEqual(report, assembly.verify_package(out))

    def test_known_gap_touch_and_interference_are_reported_and_exported(self):
        for translation, status, gap, overlap in [(12, 'passed', 2, 0), (10, 'passed', 0, 0), (9, 'interference', 0, 8), (0, 'interference', 0, 80)]:
            with self.subTest(translation=translation), tempfile.TemporaryDirectory() as tmp:
                spec = fixture(); spec['assets'] = spec['assets'][:1]
                spec['instances'] = [{'id': 'a', 'partId': 'base', 'position': [0, 0, 0], 'rotation': [0, 0, 0]},
                                     {'id': 'b', 'partId': 'base', 'position': [translation, 0, 0], 'rotation': [0, 0, 0]}]
                out, report = self.generate(tmp, spec)
                self.assertEqual(report['status'], status)
                self.assertAlmostEqual(report['pairs'][0]['minimum_distance_mm'], gap, places=5)
                self.assertAlmostEqual(report['pairs'][0]['overlap_mm3'], overlap, places=5)
                self.assertTrue((out/'assembly.step').is_file())
                self.assertEqual(report['assembly']['solid_count'], 2)

    def test_readback_detects_same_volume_wrong_placement_and_compound(self):
        with tempfile.TemporaryDirectory() as tmp:
            spec = fixture(); out, report = self.generate(tmp, spec)
            shape, _, _ = assembly.solid.build(spec['assets'][0]['source'])
            wrong = copy.deepcopy(spec['instances'][0]); wrong['position'][0] += 1
            assembly.export(assembly.place(shape, wrong), out/'instances', 'instance-001')
            with self.assertRaisesRegex(ValueError, 'placement'): assembly.verify_package(out)
        with tempfile.TemporaryDirectory() as tmp:
            spec = fixture(); out, report = self.generate(tmp, spec)
            # Replacing the combined file with a local part must not pass even
            # though each individual exported instance remains correct.
            (out/'assembly.step').write_bytes((out/'assets/part-001/solid.step').read_bytes())
            with self.assertRaisesRegex(ValueError, 'unfused'): assembly.verify_package(out)

    def test_strict_validation_references_limits_control_characters_and_no_code(self):
        mutations = [lambda s:s.update(code='anything'), lambda s:s.update(title='bad\nline'),
            lambda s:s['assets'][0].update(path='/tmp/source.step'), lambda s:s['assets'].append(copy.deepcopy(s['assets'][0])),
            lambda s:s['instances'][0].update(partId='missing'), lambda s:s['instances'][0].update(id='\x00'),
            lambda s:s['instances'][0].update(rotation=[0, 361, 0]), lambda s:s['instances'][0].update(position=[0, 501, 0]),
            lambda s:s['instances'][0].update(position=[False, 0, 0]), lambda s:s['instances'][0].update(rotation=[0, float('nan'), 0]),
            lambda s:s['instances'].append(copy.deepcopy(s['instances'][0])), lambda s:s.update(instances=[]),
            lambda s:s['assets'][0]['source']['features'][0].update(id='bad\tfeature'), lambda s:s['instances'][0].update(verified=True),
            lambda s:s.update(assets=s['assets']*5), lambda s:s.update(instances=s['instances']*6)]
        for mutate in mutations:
            spec = fixture(); mutate(spec)
            with self.subTest(spec=spec), self.assertRaises(ValueError): assembly.validate(spec)
        # Each source is valid in isolation, but five 32-feature sources exceed
        # the assembly-wide limit before any expensive geometry work.
        spec = fixture(); spec['assets'] = []
        for i in range(5):
            source = box(); source['features'] *= 32
            source['features'] = [dict(feature, id=f'f{j}') for j, feature in enumerate(source['features'])]
            spec['assets'].append({'partId': f'p{i}', 'source': source})
        spec['instances'] = [{'id': 'a', 'partId': 'p0', 'position': [0, 0, 0], 'rotation': [0, 0, 0]}]
        with self.assertRaisesRegex(ValueError, '128'): assembly.validate(spec)

    def test_absent_destination_source_limit_unplaced_and_safe_filenames(self):
        with tempfile.TemporaryDirectory() as tmp:
            spec = fixture(); spec['assets'][1]['partId'] = '../unplaced-source'
            spec['instances'] = spec['instances'][:2]
            out, report = self.generate(tmp, spec)
            self.assertEqual(len(report['assets']), 2)
            self.assertEqual(len(report['instances']), 2)
            self.assertTrue((out/'assets/part-002/solid.step').exists())
            with self.assertRaisesRegex(ValueError, 'absent'): assembly.generate(Path(tmp)/'input.json', out)
            oversized = Path(tmp)/'huge.json'; oversized.write_text(' '*262145)
            with self.assertRaisesRegex(ValueError, '262144'): assembly.generate(oversized, Path(tmp)/'new')
            self.assertFalse((Path(tmp)/'new').exists())

    def test_identifiers_preserve_exact_whitespace_and_reject_c0_del(self):
        spec = fixture()
        spec['assets'][1]['partId'] = ' base '
        spec['instances'][2]['partId'] = ' base '
        spec['instances'][2]['id'] = ' base-a '
        normalized = assembly.validate(spec)
        self.assertEqual(normalized['assets'][1]['partId'], ' base ')
        self.assertEqual(normalized['instances'][2]['id'], ' base-a ')
        self.assertEqual(normalized['instances'][2]['partId'], ' base ')
        for char in ('\x00', '\x1f', '\x7f'):
            invalid = copy.deepcopy(spec); invalid['instances'][2]['id'] = 'bad'+char
            with self.assertRaises(ValueError): assembly.validate(invalid)

if __name__ == '__main__': unittest.main()
