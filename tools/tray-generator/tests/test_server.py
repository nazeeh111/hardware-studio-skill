import io
import json
import sys
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

EXAMPLE = Path(__file__).resolve().parents[1] / 'examples' / 'pico-neopixel-tray.json'


class LocalServerTests(unittest.TestCase):
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
        finally:
            server.shutdown()
            server.server_close()
            worker.join(timeout=5)


if __name__ == '__main__':
    unittest.main()
