"""Serve Hardware Studio locally with a same-origin, loopback-only tray CAD API.

Run from the repository root:
    sh tools/tray-generator/run-local.sh --port 4174
"""

import argparse
import io
import json
import subprocess
import sys
import tempfile
import threading
import zipfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

sys.dont_write_bytecode = True

import OCP  # Fail at startup if the CAD runtime is unavailable.

ROOT = Path(__file__).resolve().parents[2]
GENERATOR = Path(__file__).with_name('generate.py')
MAX_REQUEST_BYTES = 65_536
PACKAGE_FILES = ('spec.json', 'tray.step', 'tray.stl', 'layout.svg', 'build-report.json', 'verification.json')
build_lock = threading.Lock()


def generate_package(raw):
    """Run the existing verifier-backed CLI in an isolated temporary directory."""
    with tempfile.TemporaryDirectory(prefix='hardware-studio-cad-') as temporary:
        temporary = Path(temporary)
        source = temporary / 'input.json'
        source.write_bytes(raw)
        package = temporary / 'package'
        result = subprocess.run(
            [sys.executable, str(GENERATOR), '--spec', str(source), '--out', str(package)],
            capture_output=True, text=True, timeout=120,
        )
        if result.returncode:
            raise ValueError('The CAD generator rejected this geometry. Check dimensions, boss spacing and openings.')
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as zipped:
            for name in PACKAGE_FILES:
                zipped.write(package / name, arcname=name)
        return archive.getvalue()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def _local_origin(self):
        host = self.headers.get('Host', '')
        allowed = {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}
        if host not in allowed:
            return None
        origin = self.headers.get('Origin')
        if origin and origin not in {f'http://{item}' for item in allowed}:
            return None
        if self.headers.get('Sec-Fetch-Site', 'same-origin') not in ('same-origin', 'none'):
            return None
        return host

    def _json(self, code, payload):
        body = json.dumps(payload).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == '/api/health':
            if not self._local_origin():
                return self._json(403, {'error': 'Local origin required.'})
            return self._json(200, {'ok': True, 'cad': 'OpenCascade', 'units': 'mm', 'schema': 'hardware-studio-tray-v1'})
        if path.startswith('/api/'):
            return self._json(404, {'error': 'Unknown API route.'})
        return super().do_GET()

    def do_POST(self):
        if urlsplit(self.path).path != '/api/tray':
            return self._json(404, {'error': 'Unknown API route.'})
        if not self._local_origin():
            return self._json(403, {'error': 'Local origin required.'})
        if self.headers.get('Content-Type', '').split(';', 1)[0].strip().lower() != 'application/json':
            return self._json(415, {'error': 'Send application/json.'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            return self._json(400, {'error': 'Invalid request length.'})
        if not 0 < length <= MAX_REQUEST_BYTES:
            return self._json(413, {'error': 'The tray spec must be under 64 KB.'})
        raw = self.rfile.read(length)
        if len(raw) != length:
            return self._json(400, {'error': 'Incomplete request.'})
        try:
            spec = json.loads(raw)
            if not isinstance(spec, dict) or spec.get('schema') != 'hardware-studio-tray-v1':
                return self._json(400, {'error': 'Expected a hardware-studio-tray-v1 spec.'})
        except (UnicodeDecodeError, json.JSONDecodeError):
            return self._json(400, {'error': 'Invalid JSON.'})
        if not build_lock.acquire(blocking=False):
            return self._json(409, {'error': 'Another CAD build is running. Try again after it finishes.'})
        try:
            try:
                archive = generate_package(raw)
            except subprocess.TimeoutExpired:
                return self._json(504, {'error': 'CAD generation exceeded two minutes.'})
            except ValueError as error:
                return self._json(422, {'error': str(error)})
            except Exception:
                return self._json(500, {'error': 'CAD generation failed. Inspect the local server terminal.'})
        finally:
            build_lock.release()
        try:
            self.send_response(200)
            self.send_header('Content-Type', 'application/zip')
            self.send_header('Content-Disposition', 'attachment; filename="hardware-studio-tray-cad.zip"')
            self.send_header('Content-Length', str(len(archive)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers()
            self.wfile.write(archive)
        except (BrokenPipeError, ConnectionResetError):
            pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=4174)
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error('Port must be 0 through 65535')
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    print(f'Hardware Studio CAD server: http://127.0.0.1:{server.server_port}/', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
