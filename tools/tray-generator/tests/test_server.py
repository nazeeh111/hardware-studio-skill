import base64
import io
import http.client
import json
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import zipfile
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import Handler
from OCP.IFSelect import IFSelect_RetDone
from OCP.Interface import Interface_Static
from OCP.STEPControl import STEPControl_AsIs, STEPControl_Writer
from generate import box

EXAMPLE = Path(__file__).resolve().parents[1] / 'examples' / 'pico-neopixel-tray.json'
COVER_EXAMPLE = EXAMPLE.with_name('pico-neopixel-cover-study.json')
WINDOW_EXAMPLE = EXAMPLE.with_name('pico-neopixel-window-cover.json')


class LocalServerTests(unittest.TestCase):
    def test_generated_preview_uses_verified_meshes_and_origin_gate(self):
        import hashlib
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        base = f'http://127.0.0.1:{server.server_port}'
        try:
            def post(origin, spec=WINDOW_EXAMPLE):
                request = urllib.request.Request(base + '/api/tray-preview', spec.read_bytes(), {'Content-Type': 'application/json', 'Origin': origin}, method='POST')
                return urllib.request.urlopen(request, timeout=150)
            with self.assertRaises(urllib.error.HTTPError) as denied:
                post('https://outside.example')
            self.assertEqual(denied.exception.code, 403)
            with post(base) as response:
                preview = json.load(response)
            self.assertEqual(preview['schema'], 'hardware-studio-cad-preview-v1')
            self.assertEqual([entry['name'] for entry in preview['meshes']], ['tray.stl', 'lid.stl'])
            for entry in preview['meshes']:
                self.assertEqual(hashlib.sha256(base64.b64decode(entry['dataBase64'])).hexdigest(), preview['verification']['sha256'][entry['name']])
            self.assertEqual(preview['verification']['outer_span_mm'], [66., 45., 14.])
            self.assertEqual(preview['verification']['lid']['outer_span_mm'], [71., 50., 5.5])
            with post(base, EXAMPLE) as response:
                uncovered = json.load(response)
            self.assertEqual([entry['name'] for entry in uncovered['meshes']], ['tray.stl'])
            self.assertIsNone(uncovered['verification']['lid'])
        finally:
            server.shutdown()
            server.server_close()
            worker.join(timeout=5)

    def test_static_files_require_local_host_and_do_not_list_directories(self):
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        try:
            for method in ('GET', 'HEAD'):
                for host, path, expected in (
                    ('outside.example', '/index.html', 403),
                    ('127.0.0.1', '/index.html', 403),
                    (f'127.0.0.1:{server.server_port}', '/index.html', 200),
                    (f'127.0.0.1:{server.server_port}', '/tools/tray-generator/', 403),
                ):
                    connection = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=10)
                    try:
                        connection.request(method, path, headers={'Host': host})
                        response = connection.getresponse()
                        self.assertEqual(response.status, expected, (method, host, path))
                        response.read()
                    finally:
                        connection.close()
        finally:
            server.shutdown()
            server.server_close()
            worker.join(timeout=5)

    def test_browser_fit_endpoint_clear_collision_and_origin_gate(self):
        with tempfile.TemporaryDirectory() as temporary:
            component = Path(temporary) / 'block.step'
            writer = STEPControl_Writer()
            Interface_Static.SetCVal_s('write.step.unit', 'MM')
            self.assertEqual(writer.Transfer(box(0, 0, 0, 10, 8, 2), STEPControl_AsIs), IFSelect_RetDone)
            self.assertEqual(writer.Write(str(component)), IFSelect_RetDone)
            encoded = base64.b64encode(component.read_bytes()).decode('ascii')
            request = {'schema': 'hardware-studio-browser-fit-v1', 'traySpec': json.loads(EXAMPLE.read_text()),
                       'components': [{'id': 'block', 'translationMm': [20, 12, 7],
                                       'rotation': [[1, 0, 0], [0, 1, 0], [0, 0, 1]], 'dataBase64': encoded}]}
            server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            base = f'http://127.0.0.1:{server.server_port}'
            try:
                def post(origin):
                    raw = json.dumps(request).encode()
                    upload = urllib.request.Request(f'{base}/api/fit', raw, {'Content-Type': 'application/json', 'Origin': origin}, method='POST')
                    return urllib.request.urlopen(upload, timeout=250)
                with self.assertRaises(urllib.error.HTTPError) as denied:
                    post('https://example.com')
                self.assertEqual(denied.exception.code, 403)
                with post(base) as response:
                    clear = json.load(response)
                self.assertEqual(clear['status'], 'no modeled intersection above threshold')
                self.assertEqual(len(clear['components']), 1)
                request['components'][0]['translationMm'] = [1, 25, 7]
                with post(base) as response:
                    collision = json.load(response)
                self.assertEqual(collision['status'], 'modeled interference detected')
                self.assertGreater(collision['components'][0]['tray_overlap_mm3'], 20)
                request['traySpec'] = json.loads(COVER_EXAMPLE.read_text())
                request['components'][0]['translationMm'] = [20, 12, 13]
                with post(base) as response:
                    cover_collision = json.load(response)
                self.assertEqual(cover_collision['status'], 'modeled interference detected')
                self.assertLessEqual(cover_collision['components'][0]['tray_overlap_mm3'], .01)
                self.assertGreater(cover_collision['components'][0]['lid_overlap_mm3'], 20)
                self.assertTrue(cover_collision['components'][0]['lid_interference_above_threshold'])
                request['traySpec'] = json.loads(WINDOW_EXAMPLE.read_text())
                request['components'][0]['translationMm'] = [20, 30, 13]
                with post(base) as response:
                    through_window = json.load(response)
                self.assertEqual(through_window['status'], 'no modeled intersection above threshold')
                self.assertLessEqual(through_window['components'][0]['lid_overlap_mm3'], .01)
            finally:
                server.shutdown()
                server.server_close()
                worker.join(timeout=5)

    def test_same_origin_cad_export_and_foreign_origin_rejection(self):
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        base = f'http://127.0.0.1:{server.server_port}'
        raw = EXAMPLE.read_bytes()
        try:
            with urllib.request.urlopen(f'{base}/api/health', timeout=10) as response:
                self.assertEqual(json.load(response)['schema'], 'hardware-studio-tray-v1')
            foreign = urllib.request.Request(f'{base}/api/tray', raw, {'Content-Type': 'application/json', 'Origin': 'https://example.com'}, method='POST')
            with self.assertRaises(urllib.error.HTTPError) as rejected:
                urllib.request.urlopen(foreign, timeout=10)
            self.assertEqual(rejected.exception.code, 403)
            own = urllib.request.Request(f'{base}/api/tray', raw, {'Content-Type': 'application/json', 'Origin': base}, method='POST')
            with urllib.request.urlopen(own, timeout=150) as response:
                self.assertEqual(response.headers['Content-Type'], 'application/zip')
                body = response.read()
            with zipfile.ZipFile(io.BytesIO(body)) as package:
                self.assertIsNone(package.testzip())
                report = json.loads(package.read('verification.json'))
                self.assertEqual(report['outer_span_mm'], [66.0, 45.0, 14.0])
                self.assertEqual(report['stl_outer_span_mm'], [66.0, 45.0, 14.0])
            covered = urllib.request.Request(f'{base}/api/tray', COVER_EXAMPLE.read_bytes(), {'Content-Type': 'application/json', 'Origin': base}, method='POST')
            with urllib.request.urlopen(covered, timeout=150) as response:
                with zipfile.ZipFile(io.BytesIO(response.read())) as package:
                    self.assertIsNone(package.testzip())
                    self.assertIn('lid.step', package.namelist())
                    self.assertIn('lid.stl', package.namelist())
                    lid_report = json.loads(package.read('verification.json'))['lid']
                    self.assertEqual(lid_report['outer_span_mm'], [71.0, 50.0, 5.5])
                    self.assertGreater(lid_report['shifted_overlap_mm3'], 1)
        finally:
            server.shutdown()
            server.server_close()
            worker.join(timeout=5)


if __name__ == '__main__':
    unittest.main()
