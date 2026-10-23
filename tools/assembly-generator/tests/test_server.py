import base64
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import zipfile

ROOT = Path(__file__).resolve().parents[2]
loader = importlib.util.spec_from_file_location('assembly_test_server', ROOT/'tray-generator/server.py')
server = importlib.util.module_from_spec(loader); loader.loader.exec_module(server)

def fixture():
    return {'schema': 'hardware-studio-assembly-v1', 'title': 'HTTP fixture', 'units': 'mm',
            'assets': [{'partId': ' plate ', 'source': {'schema': 'hardware-studio-solid-v1', 'title': 'Plate', 'units': 'mm', 'features': [
                {'id': 'plate', 'operation': 'add', 'shape': 'box', 'origin': [0, 0, 0], 'size': [8, 5, 2]}], 'probes': []}}],
            'instances': [{'id': ' first ', 'partId': ' plate ', 'position': [10, 0, 0], 'rotation': [0, 0, 90]}]}

class AssemblyProcessTests(unittest.TestCase):
    def test_timeout_kills_verifier_even_after_generator_parent_has_exited(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            ready, survived = root/'child-ready', root/'child-survived'
            child = ('from pathlib import Path; import time; '
                     f'Path({str(ready)!r}).write_text("started"); '
                     f'time.sleep(3); Path({str(survived)!r}).write_text("escaped timeout")')
            # The parent exits immediately; the child inherits both captured
            # output pipes. A parent-only kill cannot stop this verifier.
            parent = f'import subprocess,sys; subprocess.Popen([sys.executable,"-c",{child!r}])'
            started = time.monotonic()
            with self.assertRaises(subprocess.TimeoutExpired):
                server.run_assembly_process([sys.executable, '-c', parent], timeout=1)
            self.assertLess(time.monotonic()-started, 2)
            self.assertTrue(ready.exists(), 'The verifier must start before timeout to exercise group cleanup.')
            time.sleep(2.2)
            self.assertFalse(survived.exists(), 'A verifier must not survive generator timeout and write later.')

class AssemblyServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        class QuietHandler(server.Handler):
            def log_message(self, *args): pass
        cls.http = server.ThreadingHTTPServer(('127.0.0.1', 0), QuietHandler)
        cls.thread = threading.Thread(target=cls.http.serve_forever, daemon=True); cls.thread.start()
        cls.url = f'http://127.0.0.1:{cls.http.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown(); cls.http.server_close(); cls.thread.join()

    def request(self, path, data=None, headers=None):
        request = Request(self.url+path, data=data, headers=headers or {})
        try:
            with urlopen(request, timeout=30) as response: return response.status, response.headers, response.read()
        except HTTPError as error: return error.code, error.headers, error.read()

    def test_real_preview_and_archive_include_world_mesh_ids_sources_and_fresh_report(self):
        raw = json.dumps(fixture()).encode()
        status, headers, body = self.request('/api/assembly-preview', raw, {'Content-Type': 'application/json'})
        self.assertEqual(status, 200, body)
        result = json.loads(body)
        self.assertEqual(result['schema'], 'hardware-studio-assembly-preview-v1')
        self.assertEqual(result['verification']['status'], 'passed')
        self.assertEqual(result['meshes'][0]['id'], ' first '); self.assertEqual(result['meshes'][0]['partId'], ' plate ')
        self.assertEqual(result['verification']['instances'][0]['id'], ' first ')
        self.assertEqual(result['verification']['instances'][0]['partId'], ' plate ')
        self.assertEqual(result['verification']['instances'][0]['min_mm'], [5.0, 0.0, 0.0])
        mesh = base64.b64decode(result['meshes'][0]['dataBase64'], validate=True)
        self.assertGreater(len(mesh), 84)
        status, headers, body = self.request('/api/assembly', raw, {'Content-Type': 'application/json'})
        self.assertEqual(status, 200, body)
        self.assertEqual(headers.get_content_type(), 'application/zip')
        with zipfile.ZipFile(io.BytesIO(body)) as archive:
            self.assertIsNone(archive.testzip())
            self.assertEqual(set(archive.namelist()), {'spec.json', 'assembly.step', 'build-report.json', 'verification.json',
                'assets/part-001/spec.json', 'assets/part-001/solid.step', 'assets/part-001/solid.stl', 'instances/instance-001.step', 'instances/instance-001.stl'})
            self.assertEqual(json.loads(archive.read('spec.json')), result['spec'])
            self.assertEqual(archive.read('instances/instance-001.stl'), mesh)

    def test_health_schema_origin_size_busy_and_validation_boundaries(self):
        status, _, body = self.request('/api/health')
        self.assertEqual(status, 200); self.assertIn('placed-assembly-v1', json.loads(body)['features'])
        raw = json.dumps(fixture()).encode()
        self.assertEqual(self.request('/api/assembly', raw, {'Content-Type': 'text/plain'})[0], 415)
        self.assertEqual(self.request('/api/assembly', raw, {'Content-Type': 'application/json', 'Origin': 'https://example.com'})[0], 403)
        self.assertEqual(self.request('/api/assembly', b' '*262145, {'Content-Type': 'application/json'})[0], 413)
        self.assertEqual(self.request('/api/assembly', b'{"schema":"wrong"}', {'Content-Type': 'application/json'})[0], 400)
        self.assertEqual(self.request('/api/assembly', b'['*1500+b'0'+b']'*1500, {'Content-Type': 'application/json'})[0], 400)
        self.assertEqual(self.request('/api/solid', raw, {'Content-Type': 'application/json'})[0], 400)
        invalid = fixture(); invalid['instances'][0]['partId'] = 'missing'
        self.assertEqual(self.request('/api/assembly', json.dumps(invalid).encode(), {'Content-Type': 'application/json'})[0], 422)
        server.build_lock.acquire()
        try: self.assertEqual(self.request('/api/assembly-preview', raw, {'Content-Type': 'application/json'})[0], 409)
        finally: server.build_lock.release()
        with patch.object(server, 'run_assembly_process', side_effect=subprocess.TimeoutExpired(['assembly'], 180)):
            status, _, body = self.request('/api/assembly-preview', raw, {'Content-Type': 'application/json'})
            self.assertEqual(status, 504)
            self.assertIn('three minutes', json.loads(body)['error'])
            self.assertFalse(server.build_lock.locked())
        # The assembly limit is independent: >64 KB valid JSON reaches the
        # assembly generator while the existing solid limit stays unchanged.
        padded = raw+b' '*65537
        with patch.object(server, 'generate_assembly_package', return_value=b'zip') as generate:
            self.assertEqual(self.request('/api/assembly', padded, {'Content-Type': 'application/json'})[0], 200)
            generate.assert_called_once()
        self.assertEqual(self.request('/api/solid', padded, {'Content-Type': 'application/json'})[0], 413)

if __name__ == '__main__': unittest.main()
