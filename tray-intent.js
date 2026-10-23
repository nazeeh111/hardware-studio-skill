import {validateTraySpec} from './tray-spec.js?v=4';
export const TRAY_PROPOSAL_FORMAT={type:'object',properties:{spec:{type:'object',properties:{schema:{const:'hardware-studio-tray-v1'},units:{const:'mm'},title:{type:'string'},outer:{type:'object',properties:{length:{type:'number'},width:{type:'number'},height:{type:'number'}},required:['length','width','height'],additionalProperties:false},wall:{type:'number'},floor:{type:'number'},mounts:{type:'array',items:{type:'object'}},cutouts:{type:'array',items:{type:'object'}},lid:{type:['object','null']}},required:['schema','units','title','outer','wall','floor','mounts','cutouts'],additionalProperties:false},assumptions:{type:'array',items:{type:'string'}},missing:{type:'array',items:{type:'string'}}},required:['spec','assumptions','missing'],additionalProperties:false};
export function validateTrayProposal(base, output) {
  const prior=validateTraySpec(base);
  if(!output||typeof output!=='object'||Array.isArray(output)||Object.keys(output).some(key=>!['spec','assumptions','missing'].includes(key)))throw new Error('Return a parameter proposal, not code or other fields.');
  for(const key of ['assumptions','missing'])if(!Array.isArray(output[key])||output[key].length>12||output[key].some(item=>typeof item!=='string'||!item.trim()||item.length>240))throw new Error('The proposal needs short assumptions and missing-information lists.');
  if(output.missing.length)throw new Error('More information needed: '+output.missing.join('; '));
  const spec=validateTraySpec(output.spec);
  if(JSON.stringify(prior)===JSON.stringify(spec))throw new Error('The model proposed no parameter changes.');
  return {base:JSON.stringify(prior),spec,assumptions:output.assumptions.map(item=>item.trim())};
}
export function trayIntentPrompt(base,instruction){
 return `Edit this existing rectangular tray parameter record. All lengths are millimeters. Preserve every unrequested field, mounting point, opening and cover. Use only supported tray features. Do not produce executable code. Do not invent dimensions for an unspecified new feature: list what is missing instead. A user instruction may change explicit dimensions; it cannot make fit or safety verified. Return JSON with exactly spec (the complete tray record), assumptions (short text array), missing (short text array, empty only when enough information is given).\nCurrent spec: ${JSON.stringify(validateTraySpec(base))}\nInstruction: ${instruction}`;
}
export function installTrayIntent({readSpec,applySpec}){
 const $=selector=>document.querySelector(selector),endpoint='http://127.0.0.1:11434';
 let pending=null,controller=null;
 const status=text=>{$('#intent-status').textContent=text;};
 const discard=()=>{pending=null;$('#intent-review').hidden=true;};
 async function models(){
  if(!['127.0.0.1','localhost','[::1]'].includes(location.hostname)){status('Run the local workbench to propose text edits with Ollama.');return;}
  try{const response=await fetch(endpoint+'/api/tags',{signal:AbortSignal.timeout(5000)});if(!response.ok)throw new Error();const data=await response.json();const names=(data.models||[]).filter(m=>typeof m.name==='string'&&!/cloud/i.test(m.name)).sort((a,b)=>(a.size||0)-(b.size||0)).map(m=>m.name);if(!names.length)throw new Error();for(const name of names){const option=document.createElement('option');option.value=name;option.textContent=name;$('#intent-model').append(option);}$('#intent-propose').disabled=false;status('Optional local text edits. Review the proposed parameters before applying.');}
  catch{status('Local Ollama unavailable. The dimension fields and CAD generator still work.');}
 }
 $('#intent-propose').addEventListener('click',async()=>{
  if(controller)return;const instruction=$('#intent-instruction').value.trim();if(!instruction)return status('Describe the requested changes, including needed dimensions.');
  let base;try{base=validateTraySpec(readSpec());}catch(error){return status(error.message);}
  discard();controller=new AbortController();const timer=setTimeout(()=>controller?.abort(),180000);$('#intent-propose').disabled=true;$('#intent-cancel').hidden=false;status('Proposing parameter changes with the selected local model…');
  try{const response=await fetch(endpoint+'/api/generate',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({model:$('#intent-model').value,stream:false,think:false,format:TRAY_PROPOSAL_FORMAT,options:{temperature:0,num_predict:2200,num_ctx:8192},prompt:trayIntentPrompt(base,instruction)})});if(!response.ok)throw new Error('Local model request failed. Check Ollama.');const text=await response.text();if(text.length>200000)throw new Error('Model response was too large.');const body=JSON.parse(text);if(typeof body.response!=='string'||body.response.length>65000)throw new Error('Model did not return a bounded parameter record.');pending=validateTrayProposal(base,JSON.parse(body.response));$('#intent-preview').textContent=JSON.stringify(pending.spec,null,2);$('#intent-assumptions').textContent=pending.assumptions.length?'Model assumptions: '+pending.assumptions.join('; '):'No model assumptions listed. Check the complete record against your instruction.';$('#intent-review').hidden=false;status('Proposal validated as generator input. Inspect all dimensions and features; no CAD has been built yet.');}
  catch(error){status(error.name==='AbortError'?'Proposal cancelled or timed out. Current dimensions are retained.':error.message);}
  finally{clearTimeout(timer);controller=null;$('#intent-propose').disabled=false;$('#intent-cancel').hidden=true;}
 });
 $('#intent-cancel').addEventListener('click',()=>controller?.abort());
 $('#intent-discard').addEventListener('click',()=>{discard();status('Proposal discarded. Current dimensions retained.');});
 $('#intent-apply').addEventListener('click',()=>{
  if(!pending)return;
  try{if(JSON.stringify(validateTraySpec(readSpec()))!==pending.base)throw new Error('Dimensions changed while drafting. Request a new proposal from the current form.');const spec=pending.spec;applySpec(spec);discard();status('Proposed dimensions applied to the form. Check its save status, then generate CAD and inspect readback.');}
  catch(error){status(error.message);}
 });
 void models();
}
