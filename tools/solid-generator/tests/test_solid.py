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

if __name__=='__main__':unittest.main()
