"""Actual native multi-branch handoff plus archive/source identity regressions."""
import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import time
import unittest
import zipfile

PATH = Path(__file__).resolve().parents[1] / 'project.py'
module_spec = importlib.util.spec_from_file_location('project_cad', PATH)
cad = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(cad)


def fixture():
    solid = {'schema':'hardware-studio-solid-v1','units':'mm','title':'Small block',
             'features':[{'id':'base','operation':'add','shape':'box','origin':[0,0,0],'size':[6,5,4]}], 'probes':[]}
    tray = {'schema':'hardware-studio-tray-v1','units':'mm','title':'Tray',
            'outer':{'length':24,'width':20,'height':8},'wall':2,'floor':2,'mounts':[],'cutouts':[],
            'lid':{'thickness':1,'skirtDepth':2,'skirtWall':1,'clearance':.3,'window':None}}
    assembly = {'schema':'hardware-studio-assembly-v1','units':'mm','title':'Placed blocks',
                'assets':[{'partId':'body','source':solid},{'partId':'spare','source':solid}],
                'instances':[{'id':'first','partId':'body','position':[0,0,0],'rotation':[0,0,0]},
                             {'id':'second','partId':'body','position':[10,0,0],'rotation':[0,0,0]}]}
    project = {'title':'Three branches','parts':[{'id':'body','name':'Block','qty':2},{'id':'spare','qty':1}],
               'wires':[],'steps':[],'referenceImage':None,'traySpec':tray,'solidSpec':solid,'assemblySpec':assembly}
    entries = {name: ('Original '+name+'\r\n').encode() for name in cad.BASE}
    entries['project.json'] = (json.dumps(project, indent=3)+'\r\n').encode()
    for field, name, _, _ in cad.BRANCHES: entries[name] = json.dumps(project[field]).encode()
    for i, asset in enumerate(assembly['assets'],1): entries[f'cad-sources/part-{i:03d}.json'] = json.dumps(asset['source']).encode()
    return project, entries


def rewrite_project(entries, project):
    entries['project.json'] = json.dumps(project).encode()


def write_zip(path, entries):
    with zipfile.ZipFile(path,'w',zipfile.ZIP_DEFLATED) as archive:
        for name, data in entries.items(): archive.writestr(name,data)


class ProjectArchive(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.project, self.entries = fixture()
    def tearDown(self): self.temporary.cleanup()
    def source(self):
        path = self.root/'source.zip'; write_zip(path,self.entries); return path

    def test_actual_three_branch_handoff_preserves_source_and_checks_tray_lid(self):
        source = self.source(); output = self.root/'complete.zip'
        result = subprocess.run([sys.executable,str(PATH),'--source-zip',str(source),'--out',str(output)],
                                capture_output=True,text=True,timeout=90)
        self.assertEqual(result.returncode,0,result.stderr)
        with zipfile.ZipFile(output) as archive:
            manifest = json.loads(archive.read('cad-package-manifest.json'))
            self.assertEqual(manifest['source_archive_sha256'],cad.sha(source.read_bytes()))
            captured = archive.read(manifest['source_archive_entry'])
            self.assertEqual(captured,source.read_bytes())
            self.assertEqual(cad.sha(captured),manifest['source_archive_sha256'])
            self.assertEqual(manifest['files']['captured-source.zip'],
                             {'sha256':cad.sha(captured),'bytes':len(captured)})
            self.assertEqual(manifest['project_json_sha256'],cad.sha(self.entries['project.json']))
            self.assertEqual(len(manifest['branches']),3)
            for name,data in self.entries.items(): self.assertEqual(archive.read(name),data)
            self.assertEqual(manifest['part_bindings'][0]['instance_ids'],['first','second'])
            self.assertFalse(manifest['part_bindings'][1]['placed'])
            self.assertEqual(manifest['part_bindings'][1]['instance_ids'],[])
            self.assertIn('generated-cad/assembly/assets/part-002/solid.step',archive.namelist())
            strict = json.loads(archive.read('generated-cad/tray/strict-mesh-verification.json'))
            self.assertEqual(strict['status'],'passed')
            for stem in ('tray','lid'): self.assertTrue(strict['parts'][stem]['stl_check']['passed'])
            for name,record in manifest['files'].items():
                data = archive.read(name)
                self.assertEqual(cad.sha(data),record['sha256'])
                self.assertEqual(len(data),record['bytes'])

    def test_sidecar_mismatch_missing_and_orphan(self):
        for mutation in ('mismatch','missing','orphan'):
            with self.subTest(mutation=mutation):
                entries = copy.deepcopy(self.entries)
                if mutation == 'mismatch': entries['solid-spec.json'] = b'{}'
                elif mutation == 'missing': entries.pop('solid-spec.json')
                else:
                    project = copy.deepcopy(self.project); project['solidSpec'] = None
                    rewrite_project(entries,project)
                with self.assertRaises(ValueError): cad.validate_sources(entries)

    def test_actual_interference_is_explicit_in_completed_manifest(self):
        for field,name in (('traySpec','tray-spec.json'),('solidSpec','solid-spec.json')):
            self.project[field]=None; self.entries.pop(name)
        self.project['assemblySpec']['instances'][1]['position']=[2,0,0]
        self.entries['assembly-spec.json']=json.dumps(self.project['assemblySpec']).encode()
        rewrite_project(self.entries,self.project)
        output=self.root/'overlap.zip'
        manifest=cad.generate(self.source(),output)
        self.assertEqual(manifest['status'],'interference')
        self.assertEqual(manifest['branches'][0]['geometry_status'],'interference')
        with zipfile.ZipFile(output) as archive:
            readback=json.loads(archive.read('generated-cad/assembly/verification.json'))
            self.assertTrue(readback['pairs'][0]['interference'])

    def test_part_bindings_missing_duplicate_orphan_and_unplaced_assembly(self):
        for mutation in ('asset','instance','duplicate','none-placed','asset-type','instance-type'):
            with self.subTest(mutation=mutation):
                project, entries = fixture()
                if mutation == 'asset': project['assemblySpec']['assets'][0]['partId'] = 'orphan'
                if mutation == 'instance': project['assemblySpec']['instances'][0]['partId'] = 'orphan'
                if mutation == 'duplicate': project['parts'][1]['id'] = 'body'
                if mutation == 'none-placed': project['assemblySpec']['instances'] = []
                if mutation == 'asset-type': project['assemblySpec']['assets'][1]['partId'] = []
                if mutation == 'instance-type': project['assemblySpec']['instances'][0]['partId'] = []
                entries['assembly-spec.json'] = json.dumps(project['assemblySpec']).encode()
                rewrite_project(entries,project)
                with self.assertRaises(ValueError): cad.validate_sources(entries)

    def test_orphan_part_source_and_missing_ordered_source(self):
        for mutation in ('extra','missing','mismatch'):
            entries = copy.deepcopy(self.entries)
            if mutation == 'extra': entries['cad-sources/part-003.json'] = b'{}'
            if mutation == 'missing': entries.pop('cad-sources/part-001.json')
            if mutation == 'mismatch': entries['cad-sources/part-001.json'] = b'{}'
            with self.assertRaises(ValueError): cad.validate_sources(entries)

    def test_no_cad_rejected(self):
        for field,name,_,_ in cad.BRANCHES:
            self.project[field] = None; self.entries.pop(name)
        self.entries = {k:v for k,v in self.entries.items() if not k.startswith('cad-sources/')}
        rewrite_project(self.entries,self.project)
        with self.assertRaisesRegex(ValueError,'At least one'): cad.validate_sources(self.entries)

    def test_unsafe_unexpected_duplicate_symlink_and_wrong_zip(self):
        for name in ('../escape','/absolute','cad-sources/../escape','generated-cad/solid.step','captured-source.zip','bad\\name','unknown.txt'):
            path = self.root/'bad.zip'
            write_zip(path,{**self.entries,name:b'x'})
            with self.assertRaises(ValueError): cad.read_source(path)
        path = self.root/'duplicate.zip'
        with zipfile.ZipFile(path,'w') as archive:
            archive.writestr('project.json',b'{}'); archive.writestr('project.json',b'{}')
        with self.assertRaises(ValueError): cad.read_source(path)
        path = self.root/'symlink.zip'
        with zipfile.ZipFile(path,'w') as archive:
            info=zipfile.ZipInfo('project.json'); info.external_attr=(stat.S_IFLNK|0o777)<<16
            archive.writestr(info,b'/tmp/target')
        with self.assertRaises(ValueError): cad.read_source(path)
        path = self.root/'not.zip'; path.write_bytes(b'x'*100)
        with self.assertRaises(ValueError): cad.read_source(path)

    def test_encrypted_crc_and_size_limits(self):
        path = self.source(); raw=bytearray(path.read_bytes())
        for magic, offset in ((b'PK\x03\x04',6),(b'PK\x01\x02',8)):
            position=0
            while True:
                position=raw.find(magic,position)
                if position<0: break
                raw[position+offset] |= 1; position +=4
        path.write_bytes(raw)
        with self.assertRaises(ValueError): cad.read_source(path)
        path=self.root/'many.zip'
        with zipfile.ZipFile(path,'w') as archive:
            for i in range(33): archive.writestr(f'{i}.txt',b'x')
        with self.assertRaisesRegex(ValueError,'32 entries'): cad.read_source(path)
        path=self.root/'large.zip'
        with zipfile.ZipFile(path,'w',zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('project.json',b'0'*(cad.MAX_SOURCE_TOTAL+1))
        with self.assertRaisesRegex(ValueError,'16 MiB'): cad.read_source(path)
        path=self.source(); raw=bytearray(path.read_bytes())
        raw[raw.index(b'PK\x01\x02')+16] ^=1  # actual central-directory CRC
        path.write_bytes(raw)
        with self.assertRaises(ValueError): cad.read_source(path)

    def test_invalid_branch_leaves_no_partial_output_and_preserves_source(self):
        self.project['solidSpec']['features'][0]['size'][0] = -1
        self.entries['solid-spec.json'] = json.dumps(self.project['solidSpec']).encode()
        # Same source object is also present in assembly fixture; update its raw
        # sidecars to reach the actual native geometry validator deliberately.
        self.entries['assembly-spec.json'] = json.dumps(self.project['assemblySpec']).encode()
        for i, asset in enumerate(self.project['assemblySpec']['assets'],1):
            self.entries[f'cad-sources/part-{i:03d}.json'] = json.dumps(asset['source']).encode()
        rewrite_project(self.entries,self.project)
        source=self.source(); original=source.read_bytes(); output=self.root/'failure.zip'
        with self.assertRaisesRegex(ValueError,r'Shared solid \(solid-spec.json\) rejected the source:'): cad.generate(source,output)
        self.assertFalse(output.exists()); self.assertEqual(source.read_bytes(),original)
        self.assertFalse(list(self.root.glob('.project-cad-*')))

    def test_actual_missed_cut_has_plain_branch_error_and_no_partial_zip(self):
        self.project['traySpec'] = self.project['assemblySpec'] = None
        self.project['solidSpec']['features'].append({'id':'miss','operation':'cut','shape':'box',
            'origin':[100,100,100],'size':[1,1,1]})
        self.entries={name:data for name,data in self.entries.items()
                      if name not in ('tray-spec.json','assembly-spec.json') and not name.startswith('cad-sources/')}
        self.entries['solid-spec.json']=json.dumps(self.project['solidSpec']).encode()
        rewrite_project(self.entries,self.project)
        source=self.source(); original=source.read_bytes(); output=self.root/'rejected.zip'
        previous=self.root/'previous.zip'; previous.write_bytes(b'last valid download')
        with self.assertRaises(ValueError) as failure: cad.generate(source,output)
        self.assertEqual(str(failure.exception),
            'Shared solid (solid-spec.json) rejected the source: Feature miss must change volume by more than 0.001 cubic mm.')
        self.assertNotIn('{"error"',str(failure.exception))
        self.assertFalse(output.exists())
        self.assertEqual(source.read_bytes(),original)
        self.assertEqual(previous.read_bytes(),b'last valid download')
        self.assertFalse(list(self.root.glob('.project-cad-*')))

    def test_branch_error_detail_is_bounded_and_unrecognized_stderr_is_private(self):
        label='Assembly (assembly-spec.json)'
        generic=label+' failed a generation or readback check.'
        for diagnostic in ('Traceback: /private/tmp/project-cad-secret/source.json',
                           '{"error": "secret", "traceback":"/tmp/path"}',
                           '{"error":12}', '{"error":"/Users/name/private-file"}',
                           '{"error":"Traceback from kernel"}', '{"error":"   "}'):
            self.assertEqual(cad.failure_message(diagnostic,label),generic)
        message=cad.failure_message(json.dumps({'error':'x'*500}),label)
        self.assertEqual(len(message.split('rejected the source: ',1)[1]),240)
        self.assertTrue(message.endswith('...'))
        self.assertEqual(cad.failure_message('{"error":"Bad\\n source\\tvalue"}',label),
                         label+' rejected the source: Bad source value')
        script=self.root/'native-failure.py'
        script.write_text('import sys\nsys.stderr.write("Traceback: /private/tmp/secret/source.json")\nraise SystemExit(1)\n')
        with self.assertRaisesRegex(ValueError,'Assembly') as failure:
            cad.run([script],3,label)
        self.assertEqual(str(failure.exception),generic)

    def test_existing_destination_and_symlink_are_preserved(self):
        source=self.source(); output=self.root/'existing.zip'; output.write_bytes(b'keep')
        with self.assertRaises(ValueError): cad.generate(source,output)
        self.assertEqual(output.read_bytes(),b'keep')
        link=self.root/'link.zip'; link.symlink_to(self.root/'absent')
        with self.assertRaises(ValueError): cad.generate(source,link)
        self.assertTrue(link.is_symlink())
        with self.assertRaises(ValueError): cad.generate(source,Path('relative.zip'))

    def test_json_duplicate_keys_nonfinite_and_type_mismatch(self):
        for raw in (b'{"x":1,"x":2}',b'{"x":NaN}',b'{"x":1e999}'):
            with self.assertRaises(ValueError): cad.parse_json(raw,'fixture')
        self.assertFalse(cad.equal_json({'x':True},{'x':1}))

    def test_output_limit_failure_preserves_absent_destination(self):
        # Keep the archive structurally valid and run actual native generation;
        # lower only the packaging threshold to exercise the real failure path.
        limit=cad.MAX_OUTPUT
        try:
            cad.MAX_OUTPUT=100
            output=self.root/'too-large.zip'
            with self.assertRaisesRegex(ValueError,'64 MiB'): cad.generate(self.source(),output)
            self.assertFalse(output.exists())
            self.assertFalse(list(self.root.glob('.project-cad-*')))
        finally: cad.MAX_OUTPUT=limit

    def test_supervisor_kills_descendants_after_exit_and_timeout(self):
        for timeout in (False,True):
            with self.subTest(timeout=timeout):
                marker=self.root/('late-timeout' if timeout else 'late-exit')
                child=f'import time; from pathlib import Path; time.sleep(.5); Path({str(marker)!r}).write_text("late")'
                parent=f'import subprocess,sys,time; subprocess.Popen([sys.executable,"-c",{child!r}]); time.sleep({2 if timeout else 0})'
                if timeout:
                    with self.assertRaises(ValueError): cad.supervise([sys.executable,'-c',parent],timeout=.1)
                else: self.assertEqual(cad.supervise([sys.executable,'-c',parent],timeout=2),0)
                time.sleep(.65)
                self.assertFalse(marker.exists())


if __name__ == '__main__': unittest.main()
