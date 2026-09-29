import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
const source=await readFile(new URL('../worker/storyboard-read-diagnostic.ts',import.meta.url),'utf8');
const {recordStoryboardReadFailure,storyboardReadFailureDiagnostic,logStoryboardReadFailure}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source,{mode:'transform'})).toString('base64'));
test('fixed Storyboard stages preserve original errors, inner stages and redaction',()=>{
 const error=new Error('private prompt SQL key'),before=JSON.stringify(error);
 assert.equal(recordStoryboardReadFailure(error,'completion_frame'),error);
 recordStoryboardReadFailure(error,'completion_evidence');
 assert.equal(storyboardReadFailureDiagnostic(error),'completion_frame');
 assert.equal(JSON.stringify(error),before);
 const logs=[];logStoryboardReadFailure(error,'read_evidence',(...args)=>logs.push(args));
 assert.deepEqual(logs,[['storyboard_retained_read_refused',{stage:'completion_frame'}]]);
 assert.doesNotMatch(JSON.stringify(logs),/private|prompt|SQL|key/);
 assert.doesNotThrow(()=>logStoryboardReadFailure(error,'read_evidence',()=>{throw Error('logging unavailable');}));
});
test('untrusted fields, prototypes, accessors and arbitrary labels cannot manufacture stages',()=>{
 let accessed=0;
 const forged=Object.defineProperty({},'stage',{get(){accessed++;throw Error('private');}});
 for(const value of [null,undefined,'completion_frame',forged,Object.create(new Error('completion_frame'))]){
  assert.equal(storyboardReadFailureDiagnostic(value),undefined);
 }
 const error=new Error('private');recordStoryboardReadFailure(error,'private prompt');
 assert.equal(storyboardReadFailureDiagnostic(error),undefined);
 const logs=[];logStoryboardReadFailure(error,'private prompt',(...args)=>logs.push(args));
 assert.deepEqual(logs,[]);assert.equal(accessed,0);
});
