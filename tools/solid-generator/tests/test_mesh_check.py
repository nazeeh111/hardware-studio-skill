"""Native, dependency-free negative controls for STL/STEP semantic checks."""
import copy
import hashlib
import math
from pathlib import Path
import struct
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tray-generator'))
from mesh_check import check_mesh, normalize_export_mesh, verify_export_mesh_record, MAX_TRIANGLES, CENTER_TOLERANCE_MM, _point_triangle_distance2
from generate import export, box, cylinder, boolean
from verify import read_step
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut
from OCP.BRepPrimAPI import BRepPrimAPI_MakeCylinder


class MeshCheckTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix='studio-mesh-tests-')
        cls.root = Path(cls.temporary.name)
        cls.shapes = {
            'box': box(0, 0, 0, 20, 15, 6),
            'bore': boolean(BRepAlgoAPI_Cut, box(0, 0, 0, 20, 15, 6), cylinder(5, 7.5, -1, 2, 8)),
            'shifted': boolean(BRepAlgoAPI_Cut, box(0, 0, 0, 20, 15, 6), cylinder(15, 7.5, -1, 2, 8)),
            'cavity': boolean(BRepAlgoAPI_Cut, box(0, 0, 0, 20, 15, 6), box(5, 5, 2, 4, 4, 2)),
        }
        for name, shape in cls.shapes.items():
            folder = cls.root / name
            folder.mkdir()
            export(shape, folder, 'solid')
        cls.source = read_step(cls.root/'bore'/'solid.step')

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def edited(self, name, transform):
        raw = bytearray((self.root/'box'/'solid.stl').read_bytes())
        transform(raw)
        path = self.root / name
        path.write_bytes(raw)
        return path

    def test_positive_box_and_bore_reopened_step(self):
        for name in ['box', 'bore']:
            with self.subTest(name=name):
                result = check_mesh(self.root/name/'solid.stl', read_step(self.root/name/'solid.step'))
                self.assertTrue(result['passed'])
                self.assertEqual(result['checked_triangle_centers'], result['stl_triangles'])
                self.assertLessEqual(result['maximum_center_distance_mm'], CENTER_TOLERANCE_MM)
                self.assertEqual(result['boundary_components'], 1)

    def test_placed_mesh_numeric_range_includes_large_rigid_placements(self):
        folder = self.root/'placed-high-coordinate'
        folder.mkdir()
        export(box(2200,0,0,20,15,6),folder,'solid')
        self.assertFalse(normalize_export_mesh(folder/'solid.stl',folder/'solid.raw.stl')['changed'])
        self.assertTrue(check_mesh(folder/'solid.stl',read_step(folder/'solid.step'))['passed'])

    def test_internal_cavity_keeps_legitimate_separate_boundary_shell(self):
        result = check_mesh(self.root/'cavity'/'solid.stl', read_step(self.root/'cavity'/'solid.step'))
        self.assertEqual(result['boundary_components'], 2)
        self.assertAlmostEqual(result['signed_volume_mm3'], 20*15*6-4*4*2, places=5)

    def test_same_bounds_filled_hole_rejects(self):
        with self.assertRaisesRegex(ValueError, 'volume|trimmed STEP boundary|STEP face .* witness'):
            check_mesh(self.root/'box'/'solid.stl', self.source)

    def test_shifted_bore_same_volume_and_bounds_rejects(self):
        # Both bores have radius 2 and identical height, with identical outer box.
        # Volume and bounds alone cannot distinguish them.
        with self.assertRaisesRegex(ValueError, 'trimmed STEP boundary'):
            check_mesh(self.root/'shifted'/'solid.stl', self.source)

    def test_unrelated_same_bounds_box_rejects(self):
        # A smaller bore reduces removed volume below the area-based allowance;
        # its filled-hole box still fails the trimmed-face center test.
        tiny = boolean(BRepAlgoAPI_Cut, box(0, 0, 0, 20, 15, 6), cylinder(5, 7.5, -1, .5, 8))
        with self.assertRaisesRegex(ValueError, 'STEP face .* witness'):
            check_mesh(self.root/'box'/'solid.stl', tiny)

    def test_open_triangle_boundary_rejects(self):
        def edit(raw):
            count = struct.unpack_from('<I', raw, 80)[0]
            del raw[-50:]
            struct.pack_into('<I', raw, 80, count-1)
        with self.assertRaisesRegex(ValueError, 'closed and consistently oriented'):
            check_mesh(self.edited('open.stl', edit), self.shapes['box'])

    def test_one_reversed_triangle_rejects(self):
        def edit(raw):
            a, b = bytes(raw[96:108]), bytes(raw[108:120])
            raw[96:108], raw[108:120] = b, a
        with self.assertRaisesRegex(ValueError, 'closed and consistently oriented'):
            check_mesh(self.edited('one-reversed.stl', edit), self.shapes['box'])

    def test_all_inward_triangles_reject(self):
        def edit(raw):
            for index in range(struct.unpack_from('<I', raw, 80)[0]):
                start = 84+50*index+12
                a, b = bytes(raw[start:start+12]), bytes(raw[start+12:start+24])
                raw[start:start+12], raw[start+12:start+24] = b, a
        with self.assertRaisesRegex(ValueError, 'orientations|positive signed volume'):
            check_mesh(self.edited('all-reversed.stl', edit), self.shapes['box'])

    def test_nonfinite_zero_area_and_oversized_count_reject(self):
        def nan(raw): struct.pack_into('<f', raw, 96, math.nan)
        def zero(raw): raw[108:120] = raw[96:108]
        def huge(raw): struct.pack_into('<I', raw, 80, MAX_TRIANGLES+1)
        for name, transform, message in [('nan',nan,'non-finite'),('zero',zero,'degenerate'),('huge',huge,'triangle count')]:
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, message):
                check_mesh(self.edited(name+'.stl',transform), self.shapes['box'])

    def test_exact_point_triangle_distance_interior_edge_and_vertex(self):
        triangle = [(0,0,0),(2,0,0),(0,2,0)]
        self.assertAlmostEqual(_point_triangle_distance2((.5,.5,3),triangle),9)
        self.assertAlmostEqual(_point_triangle_distance2((1,-1,0),triangle),1)
        self.assertAlmostEqual(_point_triangle_distance2((-1,-1,0),triangle),2)
        self.assertAlmostEqual(_point_triangle_distance2((2,2,0),triangle),2)

    def test_export_normalization_preserves_actual_raw_bytes_and_only_removes_numeric_zero_area(self):
        original = (self.root/'box'/'solid.stl').read_bytes()
        record = bytearray(original[84:134])
        record[24:36] = record[12:24]
        count = struct.unpack_from('<I', original, 80)[0]
        path, raw = self.root/'with-zero.stl', self.root/'with-zero.raw.stl'
        malformed = original[:80]+struct.pack('<I',count+1)+original[84:]+record
        path.write_bytes(malformed)
        with self.assertRaisesRegex(ValueError,'degenerate'):
            check_mesh(path,self.shapes['box'])
        report = normalize_export_mesh(path,raw)
        self.assertEqual(report['removed_zero_area_facets'],1)
        self.assertEqual(raw.read_bytes(),malformed)
        self.assertEqual(path.read_bytes(),original)
        self.assertTrue(check_mesh(path,self.shapes['box'])['passed'])
        with self.assertRaisesRegex(ValueError,'already exists'):
            normalize_export_mesh(path,raw)
        self.assertEqual(raw.read_bytes(),malformed)

    def test_export_normalization_does_not_repair_nonzero_missing_facet(self):
        original = (self.root/'box'/'solid.stl').read_bytes()
        count = struct.unpack_from('<I', original, 80)[0]
        missing = original[:80]+struct.pack('<I',count-1)+original[84:-50]
        path, raw = self.root/'missing-normalized.stl', self.root/'missing-normalized.raw.stl'
        path.write_bytes(missing)
        report = normalize_export_mesh(path,raw)
        self.assertFalse(report['changed'])
        self.assertFalse(raw.exists())
        self.assertEqual(path.read_bytes(),missing)
        with self.assertRaisesRegex(ValueError,'closed and consistently oriented'):
            check_mesh(path,self.shapes['box'])

    def receipt_fixture(self, name, changed=True):
        original = (self.root/'box'/'solid.stl').read_bytes()
        path, raw = self.root/(name+'.stl'), self.root/(name+'.raw.stl')
        if changed:
            record = bytearray(original[84:134])
            record[24:36] = record[12:24]
            count = struct.unpack_from('<I',original,80)[0]
            original = original[:80]+struct.pack('<I',count+1)+original[84:]+record
        path.write_bytes(original)
        return path, raw, normalize_export_mesh(path,raw)

    def test_receipt_verifies_changed_and_unchanged_exact_bytes_without_mutation(self):
        for changed in (False,True):
            with self.subTest(changed=changed):
                path, raw, record = self.receipt_fixture('receipt-good-'+str(changed),changed)
                before = {p:p.read_bytes() for p in (path,raw) if p.exists()}
                record_before = copy.deepcopy(record)
                result = verify_export_mesh_record(path,record)
                self.assertTrue(result['passed'])
                self.assertTrue(result['exact_byte_replay'])
                self.assertEqual(result['changed'],changed)
                self.assertEqual(result['replayed_zero_area_removals'],int(changed))
                self.assertEqual(before,{p:p.read_bytes() for p in before})
                self.assertEqual(record,record_before)

    def test_receipt_rejects_missing_or_changed_preserved_raw(self):
        path, raw, record = self.receipt_fixture('receipt-missing')
        original = raw.read_bytes()
        raw.unlink()
        with self.assertRaisesRegex(ValueError,'raw STL is missing'):
            verify_export_mesh_record(path,record)
        changed = bytearray(original)
        changed[0] ^= 1
        raw.write_bytes(changed)
        with self.assertRaisesRegex(ValueError,'raw STL bytes'):
            verify_export_mesh_record(path,record)

    def test_receipt_rejects_modified_final_even_with_forged_final_hash(self):
        path, raw, record = self.receipt_fixture('receipt-final')
        changed = bytearray(path.read_bytes())
        changed[0] ^= 1
        path.write_bytes(changed)
        with self.assertRaisesRegex(ValueError,'Final STL bytes'):
            verify_export_mesh_record(path,record)
        record['final_sha256'] = hashlib.sha256(changed).hexdigest()
        with self.assertRaisesRegex(ValueError,'exact zero-area-only removal replay'):
            verify_export_mesh_record(path,record)

    def test_receipt_rejects_removed_nonzero_facet_with_consistent_forged_metadata(self):
        path, raw, record = self.receipt_fixture('receipt-nonzero',False)
        original = path.read_bytes()
        count = struct.unpack_from('<I',original,80)[0]
        missing = original[:80]+struct.pack('<I',count-1)+original[84:-50]
        raw.write_bytes(original)
        path.write_bytes(missing)
        record.update(changed=True,final_triangles=count-1,removed_zero_area_facets=1,
                      raw_file=raw.name,final_sha256=hashlib.sha256(missing).hexdigest())
        with self.assertRaisesRegex(ValueError,'exact zero-area-only removal replay'):
            verify_export_mesh_record(path,record)

    def test_receipt_rejects_metadata_tampering_and_uncontrolled_raw_paths(self):
        path, raw, record = self.receipt_fixture('receipt-metadata')
        patches = [
            {'maximum_removed_area_mm2':1e-3}, {'source_triangles':True},
            {'changed':False}, {'removed_zero_area_facets':2}, {'final_triangles':3},
            {'criterion':'Remove unwanted triangles'}, {'limit':'Validated for manufacturing'},
            {'raw_file':'../elsewhere.raw.stl'}, {'raw_file':'another.raw.stl'},
            {'raw_sha256':'0'*64}, {'final_sha256':'X'*64}, {'extra':1},
        ]
        for patch in patches:
            with self.subTest(patch=patch), self.assertRaises(ValueError):
                verify_export_mesh_record(path,{**record,**patch})
        missing = dict(record)
        del missing['criterion']
        with self.assertRaisesRegex(ValueError,'unsupported or missing fields'):
            verify_export_mesh_record(path,missing)

    def test_receipt_rejects_raw_symlink_and_unreported_raw_sibling(self):
        path, raw, record = self.receipt_fixture('receipt-link')
        preserved = self.root/'preserved-normalization-bytes.stl'
        raw.rename(preserved)
        raw.symlink_to(preserved)
        with self.assertRaisesRegex(ValueError,'raw STL is missing or is not a regular file'):
            verify_export_mesh_record(path,record)
        path, raw, record = self.receipt_fixture('receipt-unreported',False)
        raw.write_bytes(path.read_bytes())
        with self.assertRaisesRegex(ValueError,'unreported raw sibling'):
            verify_export_mesh_record(path,record)

    def test_unfinished_full_check_fails_closed(self):
        with self.assertRaisesRegex(ValueError, 'time budget'):
            check_mesh(self.root/'bore'/'solid.stl', self.source, time_budget_seconds=1e-12)

    def test_curved_cylinder_tessellation_stays_within_fixed_allowance(self):
        folder = self.root/'cylinder'
        folder.mkdir()
        export(BRepPrimAPI_MakeCylinder(25, 10).Shape(), folder, 'solid')
        result = check_mesh(folder/'solid.stl', read_step(folder/'solid.step'))
        self.assertTrue(result['passed'])
        self.assertGreater(result['stl_triangles'], 100)
        self.assertLessEqual(result['maximum_center_distance_mm'], CENTER_TOLERANCE_MM)


if __name__ == '__main__':
    unittest.main()
