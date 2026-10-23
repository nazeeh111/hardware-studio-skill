import test from 'node:test';
import assert from 'node:assert/strict';
import {writeWorkspace,WorkspaceConflictError} from '../workspace-store.js';
test('stale workspace writes cannot replace another tab creation, edit or deletion',()=>{
 let raw=null;
 const storage={getItem(){return raw;},setItem(key,value){raw=value;}};
 const first=writeWorkspace(storage,'workspace',null,'{"projects":["A"]}');
 for(const next of ['{"projects":["A","B"]}','{"projects":["edited-A"]}','{"projects":[]}']){
  raw=next;
  assert.throws(()=>writeWorkspace(storage,'workspace',first,'{"projects":["stale-A"]}'),WorkspaceConflictError);
  assert.equal(raw,next);
 }
 assert.equal(writeWorkspace(storage,'workspace',raw,'{"projects":["C"]}'),raw);
});
test('failed workspace writes preserve the saved bytes',()=>{
 const raw='original';const storage={getItem(){return raw;},setItem(){throw new Error('quota');}};
 assert.throws(()=>writeWorkspace(storage,'workspace',raw,'changed'),/quota/);
 assert.equal(storage.getItem(),raw);
});
