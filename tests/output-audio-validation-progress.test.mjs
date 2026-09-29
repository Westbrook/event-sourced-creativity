import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {audioRecoveryFixture} from './output-audio-recovery-fixture.mjs';
import {persistOutputAudioValidation} from '../worker/output-audio-validation-progress.ts';
import {paidProviderObserver} from '../worker/provider-submission.ts';
import * as helpers from '../src/model/provider-submission.ts';

const source=readFileSync(new URL('../worker/document-jobs-api.ts',import.meta.url),'utf8'),ast=ts.createSourceFile('jobs.ts',source,ts.ScriptTarget.Latest,true);
const names=new Set(['updateJobProgress','parseResult','parseRequest','requiresForegroundDocumentExecution']);
const extracted=ast.statements.filter(n=>ts.isFunctionDeclaration(n)&&names.has(n.name?.text)).map(n=>n.getText(ast)).join('\n');
const ports={...helpers,persistOutputAudioValidation};
const progress=new Function(...Object.keys(ports),ts.transpile(extracted,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None})+'\nreturn updateJobProgress;')(...Object.values(ports));
async function fixture(t){
 const f=await audioRecoveryFixture();t.after(()=>f.close());
 f.cp.providerSubmissions[f.planner.clientRequestId].validationStatus='pending';
 f.sqlite.prepare("UPDATE document_jobs SET status='running',result_json=?").run(JSON.stringify(f.cp));return f;
}
for(const verdict of ['valid','invalid'])test('real observer/progress persists private '+verdict+' after financial dedupe',async t=>{
 const f=await fixture(t),job=f.job(),memory=structuredClone(f.cp);let financial=0;
 const observe=paidProviderObserver(memory,(stage,message,patch,options)=>progress(f.env,job,stage,message,patch,!options?.financialReceiptPersisted),{},async()=>{financial++;});
 const pending={...f.planner,validationStatus:'pending'};await observe(pending);
 const next={...pending,validationStatus:verdict,validationIssueCount:verdict==='valid'?0:1};
 await observe(next);assert.equal(financial,1);
 const read=()=>JSON.parse(f.job().result_json).providerSubmissions;
 assert.deepEqual(read()[next.clientRequestId],next);assert.deepEqual(read()[f.attempt.clientRequestId],f.mediaReceipt);
 await observe(next);assert.equal(financial,1);assert.deepEqual(read()[next.clientRequestId],next);
 // A later whole-checkpoint progress write cannot put the old pending label back.
 await progress(f.env,job,'planning','Retained plan',{artifactPlan:f.cp.artifactPlan});
 assert.equal(read()[next.clientRequestId].validationStatus,verdict);
});
test('private validation cannot alter costs or regress another receipt',async t=>{
 const f=await fixture(t),job=f.job(),candidate={...f.planner,validationStatus:'valid',validationIssueCount:0,costMicrousd:1};
 await persistOutputAudioValidation(f.env,job,{providerSubmissions:{[candidate.clientRequestId]:candidate}});
 const retained=JSON.parse(f.job().result_json).providerSubmissions;
 assert.equal(retained[candidate.clientRequestId].costMicrousd,300);assert.deepEqual(retained[f.attempt.clientRequestId],f.mediaReceipt);
});
for(const [name,change] of [
 ['wrong response',x=>{x.providerRequestId='other';}],['wrong model',x=>{x.model='other';}],
 ['valid with issues',x=>{x.validationIssueCount=1;}],['missing issue count',x=>{delete x.validationIssueCount;}]
])test('private validation refuses '+name,async t=>{const f=await fixture(t),next={...f.planner,validationStatus:'valid',validationIssueCount:0};change(next);const before=f.job().result_json;await assert.rejects(persistOutputAudioValidation(f.env,f.job(),{providerSubmissions:{[next.clientRequestId]:next}}));assert.equal(f.job().result_json,before);});
test('private validation refuses conflicting verdict and canceled job',async t=>{
 const f=await fixture(t),next={...f.planner,validationStatus:'valid',validationIssueCount:0};
 await persistOutputAudioValidation(f.env,f.job(),{providerSubmissions:{[next.clientRequestId]:next}});
 await assert.rejects(persistOutputAudioValidation(f.env,f.job(),{providerSubmissions:{[next.clientRequestId]:{...next,validationStatus:'invalid',validationIssueCount:1}}}));
 f.sqlite.exec("UPDATE document_jobs SET status='canceled'");await assert.rejects(persistOutputAudioValidation(f.env,f.job(),{providerSubmissions:{[next.clientRequestId]:next}}));
});
