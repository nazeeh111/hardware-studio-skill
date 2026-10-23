import copy
import importlib.util
import json
import math
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
loader = importlib.util.spec_from_file_location('solid_kernel', ROOT / 'solid.py')
solid = importlib.util.module_from_spec(loader)
loader.loader.exec_module(solid)

class SolidTests(unittest.TestCase):
    def setUp(self):
        self.spec = json.loads((ROOT / 'examples/mounting-bracket.json').read_text())

    def test_bracket_analytic_volume_axis_holes_and_fresh_readback(self):
        spec = solid.validate(self.spec)
        shape, history, probes = solid.build(spec)
        expected = 60*30*4 + 4*30*40 - 4*30*4 - 3*math.pi*2.5**2*4
        self.assertAlmostEqual(solid.volume(shape), expected, places=5)
        self.assertEqual(solid.bounds(shape), [60,30,40])
        self.assertEqual(len(history),5)
        self.assertTrue(all(p['passed'] for p in probes))
        with tempfile.TemporaryDirectory() as root:
            out=Path(root)/'generated'
            solid.generate(ROOT/'examples/mounting-bracket.json',out)
            report=json.loads((out/'verification.json').read_text())
            self.assertEqual(report['solid_count'],1)
            self.assertAlmostEqual(report['volume_mm3'],expected,places=4)
            self.assertTrue(all(p['passed'] for p in report['probes']))
            # A real hole omission is caught by the independent expected-void probe.
            bad=copy.deepcopy(spec);bad['features']=bad['features'][:2]
            with self.assertRaisesRegex(ValueError,'Probe'):solid.build(bad)

    def test_no_effect_disconnected_excessive_and_invalid_records_fail(self):
        for feature in [dict(id='miss',operation='cut',shape='box',origin=[100,100,100],size=[1,1,1]),dict(id='island',operation='add',shape='box',origin=[100,100,100],size=[1,1,1]),dict(id='inside',operation='add',shape='box',origin=[1,1,1],size=[1,1,1])]:
            spec=copy.deepcopy(self.spec);spec['features'].append(feature)
            with self.assertRaises(ValueError):solid.build(solid.validate(spec))
        for mutate in [lambda s:s.update(code='anything'),lambda s:s['features'][0]['size'].__setitem__(0,1e-300),lambda s:s['features'][0]['origin'].__setitem__(0,float('nan')),lambda s:s['features'][0].update(operation='cut'),lambda s:s['features'][0]['size'].__setitem__(0,True),lambda s:s.update(features=s['features']*8)]:
            spec=copy.deepcopy(self.spec);mutate(spec)
            with self.assertRaises(ValueError):solid.validate(spec)

    def test_x_y_z_cylinders_have_expected_spans_and_invalid_probe_fails(self):
        for axis,index in [('x',0),('y',1),('z',2)]:
            feature=dict(shape='cylinder',origin=[-5,-4,-3],axis=axis,radius=3,height=20)
            shape=solid.make_primitive(feature);span=solid.bounds(shape)
            expected=[6,6,6];expected[index]=20
            for actual,wanted in zip(span,expected):self.assertAlmostEqual(actual,wanted,places=6)
        spec=copy.deepcopy(self.spec);spec['probes'][0]['expect']='material'
        with self.assertRaisesRegex(ValueError,'Probe'):solid.build(solid.validate(spec))

    def test_concave_profile_hole_analytic_volume_and_fresh_export_readback(self):
        source = ROOT / 'examples/profile-plate.json'
        spec = solid.validate(json.loads(source.read_text()))
        shape, history, probes = solid.build(spec)
        # Independent rectangle-minus-notch area, then subtract the round through-hole.
        expected = (60 * 40 - 24 * 24) * 4 - math.pi * 3**2 * 4
        self.assertAlmostEqual(solid.volume(shape), expected, places=5)
        self.assertEqual(solid.bounds(shape), [60, 40, 4])
        self.assertEqual(len(history), 2)
        self.assertTrue(all(p['passed'] for p in probes))
        with tempfile.TemporaryDirectory() as root:
            # Rotate the whole independent fixture to each right-handed basis,
            # including the hole and probes, before fresh-process STEP/STL checks.
            for axis, span in [('x', [4, 60, 40]), ('y', [40, 4, 60]), ('z', [60, 40, 4])]:
                rotated = copy.deepcopy(spec)
                for record in rotated['features'] + rotated['probes']:
                    a, b, c = record['origin']
                    record['origin'] = {'x': [c, a, b], 'y': [b, c, a], 'z': [a, b, c]}[axis]
                    record['axis'] = axis
                with self.subTest(axis=axis):
                    rotated_source, out = Path(root) / f'{axis}.json', Path(root) / f'plate-{axis}'
                    rotated_source.write_text(json.dumps(rotated))
                    solid.generate(rotated_source, out)
                    report = json.loads((out / 'verification.json').read_text())
                    self.assertEqual(report['solid_count'], 1)
                    for actual, wanted in zip(report['outer_span_mm'], span):
                        self.assertAlmostEqual(actual, wanted, places=5)
                    self.assertAlmostEqual(report['volume_mm3'], expected, places=4)
                    self.assertTrue(all(p['passed'] for p in report['probes']))
                    self.assertGreater(report['stl_triangles'], 12)
        missing_hole = copy.deepcopy(spec)
        missing_hole['features'].pop()
        with self.assertRaisesRegex(ValueError, 'hole-is-open'):
            solid.build(missing_hole)
        # Rectangularizing the outline retains its span but must fail the concavity probe.
        rectangular = copy.deepcopy(spec)
        rectangular['features'][0]['points'] = [[0, 0], [60, 0], [60, 40], [0, 40]]
        with self.assertRaisesRegex(ValueError, 'concavity-is-void'):
            solid.build(rectangular)

    def test_profile_axes_origins_positive_extrusion_and_triangle_export(self):
        # Asymmetric triangle makes swapped U/V axes observable. Each tuple has
        # the independently expected min corner, XYZ span and interior box.
        axes = {
            'x': ([-5, -2, 0], [6, 10, 4], [-4, -1.5, .5, 1, .5, .5]),
            'y': ([-2, -4, -1], [4, 6, 10], [.5, -3, -.5, .5, 1, .5]),
            'z': ([-3, -1, -3], [10, 4, 6], [-2.5, -.5, -2, .5, .5, 1]),
        }
        from OCP.BRepBndLib import BRepBndLib
        from OCP.Bnd import Bnd_Box
        for axis, (minimum, expected_span, interior) in axes.items():
            with self.subTest(axis=axis):
                raw = dict(schema=solid.SCHEMA, title='Triangle extrusion', units='mm', features=[dict(id='triangle', operation='add', shape='profile', origin=[-5, -4, -3], axis=axis, height=6, points=[[2, 3], [2, 7], [12, 3]])])
                spec = solid.validate(raw)
                self.assertEqual(spec['features'][0]['points'], [[2, 3], [12, 3], [2, 7]])
                shape, _, _ = solid.build(spec)
                self.assertAlmostEqual(solid.volume(shape), 120, places=6)
                for actual, expected in zip(solid.bounds(shape), expected_span):
                    self.assertAlmostEqual(actual, expected, places=6)
                boundary = Bnd_Box()
                BRepBndLib.AddOptimal_s(shape, boundary, False, False)
                corner = boundary.CornerMin()
                for actual, expected in zip([corner.X(), corner.Y(), corner.Z()], minimum):
                    self.assertAlmostEqual(actual, expected, places=6)
                inside = solid.box(*interior)
                self.assertAlmostEqual(solid.overlap_volume(shape, inside), solid.volume(inside), places=6)
                with tempfile.TemporaryDirectory() as root:
                    source, out = Path(root) / 'triangle.json', Path(root) / 'triangle'
                    source.write_text(json.dumps(raw))
                    solid.generate(source, out)
                    report = json.loads((out / 'verification.json').read_text())
                    self.assertAlmostEqual(report['volume_mm3'], 120, places=5)
                    self.assertEqual(report['stl_triangles'], 8)

    def test_profile_cut_preserves_material_and_void_probes(self):
        # An angular profile slot through an ordinary box verifies profile cut tools.
        spec = dict(schema=solid.SCHEMA, title='Angular slot', units='mm', features=[
            dict(id='base', operation='add', shape='box', origin=[0, 0, 0], size=[20, 20, 4]),
            dict(id='slot', operation='cut', shape='profile', origin=[5, 5, -1], axis='z', height=6, points=[[0, 0], [8, 0], [0, 8]])], probes=[
            dict(id='slot-open', expect='void', shape='profile', origin=[6, 6, 0], axis='z', height=4, points=[[0, 0], [2, 0], [0, 2]]),
            dict(id='corner-remains', expect='material', shape='profile', origin=[16, 16, 0], axis='z', height=4, points=[[0, 0], [2, 0], [0, 2]])])
        shape, _, probes = solid.build(solid.validate(spec))
        self.assertAlmostEqual(solid.volume(shape), 20 * 20 * 4 - .5 * 8 * 8 * 4, places=5)
        self.assertTrue(all(probe['passed'] for probe in probes))

    def test_profile_topology_bounds_and_record_validation(self):
        bad_points = [
            [], [[0, 0], [1, 0]], [[0, 0]] * 65,
            [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
            [[0, 0], [4, 0], [4, 4], [0, 4], [4, 0]],
            [[0, 0], [.009, 0], [0, 1]],
            [[0, 0], [2, 0], [4, 0], [0, 4]],
            [[0, 0], [4, 4], [0, 4], [4, 0]],
            [[0, 0], [6, 5], [0, 6], [4, 0]],
            [[0, 0], [4, 0], [4, 4], [2, 0], [0, 4]],
            [[0, 0], [6, 0], [6, 4], [2, 4], [2, 0], [4, 0], [4, 6], [0, 6]],
            [[0, 0], [1, 1], [2, 2]], [[0, 0], [1, 0], [0, float('inf')]],
            [[0, 0], [1, 0], [0, float('nan')]], [[0, 0], [501, 0], [0, 1]],
            [[0, 0], [True, 0], [0, 1]], [[0, 0], [1, 0], [0]],
            [[[0, 0], [4, 0], [4, 4], [0, 4]], [[1, 1], [2, 1], [1, 2]]],
        ]
        base = json.loads((ROOT / 'examples/profile-plate.json').read_text())
        for points in bad_points:
            with self.subTest(points=points):
                for record in ('features', 'probes'):
                    spec = copy.deepcopy(base)
                    spec[record][0]['points'] = points
                    with self.assertRaises(ValueError):
                        solid.validate(spec)
        for field, value in [('axis', 'w'), ('height', .009), ('height', 501), ('height', True), ('origin', [0, 0]), ('size', [1, 1, 1]), ('radius', 1), ('holes', [])]:
            spec = copy.deepcopy(base)
            spec['features'][0][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                solid.validate(spec)
        sixty_four = [[100 * math.cos(i * 2 * math.pi / 64), 100 * math.sin(i * 2 * math.pi / 64)] for i in range(64)]
        spec = copy.deepcopy(base)
        spec['features'][0]['points'] = sixty_four
        self.assertEqual(len(solid.validate(spec)['features'][0]['points']), 64)

if __name__=='__main__':unittest.main()
