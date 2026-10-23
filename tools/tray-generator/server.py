"""Serve Hardware Studio locally with a same-origin, loopback-only tray CAD API.

Run from the repository root:
    sh tools/tray-generator/run-local.sh --port 4174
"""

import argparse
import base64
import binascii
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
FIT = Path(__file__).with_name('fit.py')
MAX_REQUEST_BYTES = 65_536
MAX_FIT_REQUEST_BYTES = 24_000_000
MAX_STEP_BYTES = 8_000_000
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
            extras = ('lid.step', 'lid.stl') if (package / 'lid.step').is_file() and (package / 'lid.stl').is_file() else ()
            for name in PACKAGE_FILES + extras:
                zipped.write(package / name, arcname=name)
        return archive.getvalue()


def check_fit_request(raw):
    """Generate the submitted tray and compare bounded, caller-supplied STEP files."""
    request = json.loads(raw)
    if not isinstance(request, dict) or request.get('schema') != 'hardware-studio-browser-fit-v1':
        raise ValueError('Expected a hardware-studio-browser-fit-v1 request.')
    spec = request.get('traySpec')
    components = request.get('components')
    if not isinstance(spec, dict) or spec.get('schema') != 'hardware-studio-tray-v1':
        raise ValueError('Choose a valid tray spec.')
    if not isinstance(components, list) or not 1 <= len(components) <= 4:
        raise ValueError('Choose one to four STEP files.')
    with tempfile.TemporaryDirectory(prefix='hardware-studio-fit-') as temporary:
        root = Path(temporary)
        source = root / 'input.json'
        source.write_text(json.dumps(spec))
        package = root / 'package'
        generated = subprocess.run([sys.executable, str(GENERATOR), '--spec', str(source), '--out', str(package)],
                                   capture_output=True, text=True, timeout=120)
        if generated.returncode:
            raise ValueError('The CAD generator rejected this tray geometry.')
        manifest_components = []
        for index, item in enumerate(components):
            if not isinstance(item, dict) or not isinstance(item.get('dataBase64'), str):
                raise ValueError(f'Component {index + 1} needs a STEP file.')
            try:
                step_bytes = base64.b64decode(item['dataBase64'], validate=True)
            except (binascii.Error, ValueError):
                raise ValueError(f'Component {index + 1} is not valid base64.') from None
            if not 0 < len(step_bytes) <= MAX_STEP_BYTES:
                raise ValueError(f'Component {index + 1} must be under 8 MB.')
            filename = f'component-{index + 1}.step'
            (root / filename).write_bytes(step_bytes)
            manifest_components.append({'id': item.get('id'), 'step': filename,
                                        'translationMm': item.get('translationMm'),
                                        'rotation': item.get('rotation')})
        manifest = root / 'manifest.json'
        manifest.write_text(json.dumps({'schema': 'hardware-studio-fit-v1', 'trayPackage': 'package',
                                        'components': manifest_components, 'overlapLimitMm3': 0.01}))
        result = subprocess.run([sys.executable, str(FIT), '--manifest', str(manifest), '--out', str(root / 'report')],
                                capture_output=True, text=True, timeout=120)
        if result.returncode:
            raise ValueError('Fit analysis rejected a model or placement. Check STEP solids and axis settings.')
        report = json.loads((root / 'report' / 'fit-report.json').read_text())
        report.pop('manifest_sha256', None)  # The temporary manifest contains ephemeral local paths.
        return report


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
        if not self._local_origin():
            return self._json(403, {'error': 'Local origin required.'})
        path = urlsplit(self.path).path
        if path == '/api/health':
            return self._json(200, {'ok': True, 'cad': 'OpenCascade', 'units': 'mm', 'schema': 'hardware-studio-tray-v1'})
        if path.startswith('/api/'):
            return self._json(404, {'error': 'Unknown API route.'})
        return super().do_GET()

    def do_HEAD(self):
        if not self._local_origin():
            return self.send_error(403, 'Local origin required.')
        return super().do_HEAD()

    def list_directory(self, path):
        self.send_error(403, 'Directory listing disabled.')
        return None

    def do_POST(self):
        path = urlsplit(self.path).path
        if path not in ('/api/tray', '/api/fit'):
            return self._json(404, {'error': 'Unknown API route.'})
        if not self._local_origin():
            return self._json(403, {'error': 'Local origin required.'})
        if self.headers.get('Content-Type', '').split(';', 1)[0].strip().lower() != 'application/json':
            return self._json(415, {'error': 'Send application/json.'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            return self._json(400, {'error': 'Invalid request length.'})
        limit = MAX_FIT_REQUEST_BYTES if path == '/api/fit' else MAX_REQUEST_BYTES
        if not 0 < length <= limit:
            return self._json(413, {'error': 'The request is too large.'})
        raw = self.rfile.read(length)
        if len(raw) != length:
            return self._json(400, {'error': 'Incomplete request.'})
        try:
            spec = json.loads(raw)
            expected = 'hardware-studio-browser-fit-v1' if path == '/api/fit' else 'hardware-studio-tray-v1'
            if not isinstance(spec, dict) or spec.get('schema') != expected:
                return self._json(400, {'error': f'Expected a {expected} request.'})
        except (UnicodeDecodeError, json.JSONDecodeError):
            return self._json(400, {'error': 'Invalid JSON.'})
        if not build_lock.acquire(blocking=False):
            return self._json(409, {'error': 'Another CAD build is running. Try again after it finishes.'})
        try:
            try:
                output = check_fit_request(raw) if path == '/api/fit' else generate_package(raw)
            except subprocess.TimeoutExpired:
                return self._json(504, {'error': 'CAD generation exceeded two minutes.'})
            except ValueError as error:
                return self._json(422, {'error': str(error)})
            except Exception:
                return self._json(500, {'error': 'CAD generation failed. Inspect the local server terminal.'})
        finally:
            build_lock.release()
        try:
            body = json.dumps(output).encode('utf-8') if path == '/api/fit' else output
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8' if path == '/api/fit' else 'application/zip')
            if path == '/api/tray':
                self.send_header('Content-Disposition', 'attachment; filename="hardware-studio-tray-cad.zip"')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.end_headers()
            self.wfile.write(body)
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
