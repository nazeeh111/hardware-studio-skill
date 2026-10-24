import copy
import importlib.util
import json
import math
from pathlib import Path
import shutil
import tempfile
import unittest
ROOT=Path(__file__).resolve().parents[1]
loader=importlib.util.spec_from_file_location('advanced_solid_kernel',ROOT/'solid.py')
solid=importlib.util.module_from_spec(loader);loader.loader.exec_module(solid)
@unittest.skipUnless(importlib.util.find_spec('build123d'), 'Optional build123d runtime unavailable')
class AdvancedTests(unittest.TestCase):
 def setUp(self):self.spec=json.loads((ROOT/'examples/rounded-pull-tab.json').read_text())
 def test_round_tab_analytic_fillet_volume_and_fresh_source_readback(self):
  perimeter=40+20*math.pi;r=1
  removed=perimeter*r*r*(1-math.pi/4)-math.pi*r**3*(5/3-math.pi/2)
  expected=(400+100*math.pi)*6-math.pi*3**2*6-removed
  shape,history,probes=solid.build(solid.validate(self.spec))
  self.assertAlmostEqual(solid.volume(shape),expected,places=6)
  self.assertEqual(history[-1]['selected_edge_count'],4)
  self.assertTrue(all(p['passed'] for p in probes))
  with tempfile.TemporaryDirectory() as directory:
   out=Path(directory)/'tab';solid.generate(ROOT/'examples/rounded-pull-tab.json',out)
   verification=json.loads((out/'verification.json').read_text())
   self.assertTrue(verification['rebuilt_source']['matched']);self.assertAlmostEqual(verification['volume_mm3'],expected,places=5)
   self.assertEqual(json.loads((out/'build-report.json').read_text())['construction']['library'],'build123d')
 def test_same_volume_shifted_bore_step_cannot_replace_the_requested_geometry(self):
  with tempfile.TemporaryDirectory() as directory:
   directory=Path(directory);out=directory/'original';input_spec=copy.deepcopy(self.spec);input_spec['probes']=[];source=directory/'input.json';source.write_text(json.dumps(input_spec));solid.generate(source,out)
   wrong=copy.deepcopy(self.spec);wrong['features'][1]['origin'][0]=12;wrong['probes']=[]
   shape,_,_=solid.build(solid.validate(wrong));solid.export(shape,directory,'wrong')
   shutil.copyfile(directory/'wrong.step',out/'solid.step')
   with self.assertRaisesRegex(ValueError,'reconstructed source'):solid.verify_package(out)
 def test_two_arc_circle_has_correct_axis_and_origin_without_polygon_approximation(self):
  for axis,span in [('x',[5,10,10]),('y',[10,5,10]),('z',[10,10,5])]:
   feature={'id':'circle','operation':'add','shape':'curve','origin':[3,4,5],'axis':axis,'height':5,'start':[-5,0],'segments':[{'kind':'arc','via':[0,5],'end':[5,0]},{'kind':'arc','via':[0,-5],'end':[-5,0]}]}
   spec={'schema':solid.SCHEMA,'title':'Circle','units':'mm','features':[feature],'probes':[]};shape,_,_=solid.build(solid.validate(spec));self.assertAlmostEqual(solid.volume(shape),math.pi*25*5,places=6)
   for actual,expected in zip(solid.bounds(shape),span):self.assertAlmostEqual(actual,expected,places=5)
 def test_seed_selection_rejects_corners_missing_edges_duplicate_edges_and_impossible_radius(self):
  spec={'schema':solid.SCHEMA,'title':'Filleted box','units':'mm','features':[{'id':'body','operation':'add','shape':'box','origin':[0,0,0],'size':[40,20,6]},{'id':'round','operation':'fillet','radius':2,'edges':[[0,0,3]],'tolerance':.01}],'probes':[]}
  shape,_,_=solid.build(solid.validate(spec));self.assertAlmostEqual(solid.volume(shape),4800-(4-math.pi)*6,places=6)
  for edges,radius in [([[0,0,0]],2),([[50,50,50]],2),([[0,0,2],[0,0,4]],2),([[0,0,3]],100)]:
   bad=copy.deepcopy(spec);bad['features'][1].update(edges=edges,radius=radius)
   with self.subTest(edges=edges,radius=radius),self.assertRaises(ValueError):solid.build(solid.validate(bad))
if __name__=='__main__':unittest.main()
