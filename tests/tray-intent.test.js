import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTrayProposal,trayIntentPrompt} from '../tray-intent.js';
const base={schema:'hardware-studio-tray-v1',units:'mm',title:'Test',outer:{length:80,width:55,height:18},wall:2.5,floor:2.5,mounts:[],cutouts:[]};
test('text parameter proposals validate without altering current geometry',()=>{
 const before=JSON.stringify(base);const output={spec:{...base,outer:{length:120,width:80,height:25},wall:3,floor:3},assumptions:[],missing:[]};
 const proposal=validateTrayProposal(base,output);assert.equal(proposal.spec.outer.length,120);assert.equal(JSON.stringify(base),before);assert.match(trayIntentPrompt(base,'widen'),/Preserve every unrequested/);
});
test('unsupported code, unresolved dimensions, invalid geometry and empty proposals are rejected',()=>{
 assert.throws(()=>validateTrayProposal(base,{spec:base,code:'anything',assumptions:[],missing:[]}),/not code/);
 assert.throws(()=>validateTrayProposal(base,{spec:base,assumptions:[],missing:['hole diameter']}),/hole diameter/);
 assert.throws(()=>validateTrayProposal(base,{spec:{...base,wall:40},assumptions:[],missing:[]}),/Wall/);
 assert.throws(()=>validateTrayProposal(base,{spec:base,assumptions:[],missing:[]}),/no parameter changes/);
});
