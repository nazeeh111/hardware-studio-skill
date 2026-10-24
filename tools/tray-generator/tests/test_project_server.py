import base64
import hashlib
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
from urllib.error import HTTPError
from urllib.request import Request, urlopen
import zipfile

ROOT = Path(__file__).resolve().parents[1]
loader = importlib.util.spec_from_file_location('project_bundle_server', ROOT/'server.py')
server = importlib.util.module_from_spec(loader); loader.loader.exec_module(server)

def source_zip(mismatch=False):
    solid = {'schema':'hardware-studio-solid-v1','title':'Captured plate','units':'mm','features':[
        {'id':'plate','operation':'add','shape':'box','origin':[0,0,0],'size':[12,8,2]}], 'probes':[]}
    project = {'title':'Project HTTP fixture','parts':[{'id':'plate'}], 'solidSpec':solid}
    entries = {name:b'Planning record, not physical validation.' for name in ['README.md','bill-of-materials.csv','connections.csv','mounting.csv','build-plan.txt','wiring.svg','assembly.svg','review.txt']}
    entries['project.json'] = json.dumps(project).encode()
    if mismatch: solid['features'][0]['size'][0]=13
    entries['solid-spec.json'] = json.dumps(solid).encode()
    output=io.BytesIO()
    with zipfile.ZipFile(output,'w') as archive:
        for name,data in entries.items(): archive.writestr(name,data)
    return output.getvalue()

class ProjectServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        class QuietHandler(server.Handler):
            def log_message(self,*args): pass
        cls.http=server.ThreadingHTTPServer(('127.0.0.1',0),QuietHandler)
        cls.thread=threading.Thread(target=cls.http.serve_forever,daemon=True);cls.thread.start()
        cls.base=f'http://127.0.0.1:{cls.http.server_port}'
    @classmethod
    def tearDownClass(cls):
        cls.http.shutdown();cls.http.server_close();cls.thread.join(timeout=5)
    def post(self,source,origin=None):
        body=json.dumps({'schema':'hardware-studio-project-cad-v1','sourceZipBase64':base64.b64encode(source).decode()}).encode()
        return urlopen(Request(self.base+'/api/project-cad',body,{'Content-Type':'application/json','Origin':origin or self.base},method='POST'),timeout=150)
    def test_actual_source_geometry_manifest_and_http_binding(self):
        source=source_zip()
        with urlopen(self.base+'/api/health',timeout=10) as response:
            self.assertIn('project-cad-package-v1',json.load(response)['features'])
        with self.post(source) as response:
            self.assertEqual(response.headers.get_content_type(),'application/zip')
            self.assertEqual(response.headers['X-Hardware-Studio-Source-SHA256'],hashlib.sha256(source).hexdigest())
            self.assertEqual(response.headers['X-Hardware-Studio-CAD-Status'],'passed')
            output=response.read()
        with zipfile.ZipFile(io.BytesIO(output)) as archive,zipfile.ZipFile(io.BytesIO(source)) as original:
            self.assertIsNone(archive.testzip())
            for name in original.namelist():self.assertEqual(archive.read(name),original.read(name))
            manifest=json.loads(archive.read('cad-package-manifest.json'))
            self.assertEqual(manifest['source_archive_sha256'],hashlib.sha256(source).hexdigest())
            report=json.loads(archive.read('generated-cad/shared-solid/verification.json'))
            self.assertTrue(report['stl_check']['passed']);self.assertEqual(report['volume_mm3'],192)
    def test_foreign_origin_mismatched_source_and_busy_reject_without_partial_zip(self):
        with self.assertRaises(HTTPError) as denied:self.post(source_zip(),origin='https://outside.example')
        self.assertEqual(denied.exception.code,403)
        with self.assertRaises(HTTPError) as mismatch:self.post(source_zip(mismatch=True))
        self.assertEqual(mismatch.exception.code,422)
        self.assertIn('differs',json.load(mismatch.exception)['error'])
        server.build_lock.acquire()
        try:
            with self.assertRaises(HTTPError) as busy:self.post(source_zip())
            self.assertEqual(busy.exception.code,409)
        finally:server.build_lock.release()
    def test_completed_supervisor_also_stops_descendant_with_closed_output(self):
        with tempfile.TemporaryDirectory() as directory:
            ready,escaped=Path(directory)/'ready',Path(directory)/'escaped'
            child=f'from pathlib import Path;import time;Path({str(ready)!r}).write_text("ready");time.sleep(1);Path({str(escaped)!r}).write_text("escaped")'
            parent=f'import subprocess,sys,time;from pathlib import Path;subprocess.Popen([sys.executable,"-c",{child!r}],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);p=Path({str(ready)!r});deadline=time.monotonic()+3\nwhile not p.exists() and time.monotonic()<deadline:time.sleep(.01)'
            result=server.run_assembly_process([sys.executable,'-c',parent],timeout=4)
            self.assertEqual(result.returncode,0);self.assertTrue(ready.exists())
            time.sleep(1.1);self.assertFalse(escaped.exists(),'Completed worker descendants must not survive cleanup.')

if __name__=='__main__':unittest.main()
