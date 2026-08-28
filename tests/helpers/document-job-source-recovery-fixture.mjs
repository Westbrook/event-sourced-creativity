// Full current Store/source Worker; only SQLite/native ports and provider setup are simulated.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire,registerHooks} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {after} from 'node:test';
const ROOT=fileURLToPath(new URL('../../',import.meta.url)).replace(/\/$/u,'');
const rootUrl=pathToFileURL(ROOT+'/').href,file=relative=>pathToFileURL(path.join(ROOT,relative)).href;
const sha=value=>createHash('sha256').update(value).digest('hex');

const resolution=registerHooks({resolve(specifier,context,next){
 if(context.parentURL?.startsWith(rootUrl)&&!context.parentURL.includes('/node_modules/')&&specifier.startsWith('.')&&!/\.[a-z0-9]+$/iu.test(specifier)){
  const target=new URL(specifier+'.ts',context.parentURL);if(fs.existsSync(target))return {url:target.href,shortCircuit:true};
 }
 return next(specifier,context);
}});

const require=createRequire(path.join(ROOT,'package.json'));

const ts=require('typescript');

const source=fs.readFileSync(path.join(ROOT,'tests/document-generation-reliability.test.mjs'),'utf8');

const tree=ts.createSourceFile('reliability.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);

const fixtureNames=new Set(['reliabilityDatabase','reliabilityWorker','json','INDEPENDENT_SLIDE_SCORES','INDEPENDENT_SLIDE_QUOTE','INDEPENDENT_SLIDE_TITLES','seedIndependentPresentation','independentProviderResponse','presentationAdmission','originalSourceAudioFixture']);

const declarations=tree.statements.filter(node=>ts.isFunctionDeclaration(node)?fixtureNames.has(node.name?.text):ts.isVariableStatement(node)&&node.declarationList.declarations.some(value=>fixtureNames.has(value.name.getText(tree))));

// Only the legacy fixture's dist import is replaced by the current source Worker.
// These are unchanged fixture declarations; no production method is extracted/replaced.
const fixtureSource=`import assert from 'node:assert/strict';\nimport {DatabaseSync} from 'node:sqlite';\nimport worker from ${JSON.stringify(file('worker/index.ts'))};\nimport {appendAuditEvent} from ${JSON.stringify(file('worker/runtime.ts'))};\nimport {documentJobCanRecoverProviderRender,generationFailureGuidance} from ${JSON.stringify(file('src/model/document-jobs.ts'))};\n`+declarations.map(node=>node.getFullText(tree)).join('\n')+'\nexport {'+[...fixtureNames].join(',')+'};';

const {reliabilityWorker,json,seedIndependentPresentation,independentProviderResponse,presentationAdmission,originalSourceAudioFixture}=await import('data:text/javascript;base64,'+Buffer.from(fixtureSource).toString('base64'));

const {createSceneStoreHost,sceneDeferred}=await import(file('tests/helpers/scene-cost-store-host.mjs'));

const storyboardText=fs.readFileSync(path.join(ROOT,'tests/storyboard-reconcile-provider-route.test.mjs'),'utf8');

const storyboardTree=ts.createSourceFile('storyboard.mjs',storyboardText,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);

const storyboardNames=new Set(['ownerId','providerModel','providerEndpoint','historyEndpoint','recoveredProviderJobId','queueRoot','mediaUrl','storyboardPlan','admitStoryboard','providerMock','reservationStates','failedUnknownStoryboard']);

const storyboardDeclarations=storyboardTree.statements.filter(node=>ts.isFunctionDeclaration(node)?storyboardNames.has(node.name?.text):ts.isVariableStatement(node)&&node.declarationList.declarations.some(value=>storyboardNames.has(value.name.getText(storyboardTree))));

const storyboard=await import('data:text/javascript;base64,'+Buffer.from("import assert from 'node:assert/strict';\n"+storyboardDeclarations.map(node=>node.getFullText(storyboardTree)).join('\n')+'\nexport {providerMock,failedUnknownStoryboard};').toString('base64'));

const financialTables=['budget_reservations','budget_counters','cost_budget_reservations','cost_budget_counters','project_budget_reservation_scopes','pilot_cost_reservation_scopes'];

const money=fixture=>Object.fromEntries(financialTables.map(table=>[table,fixture.sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)?fixture.sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all():null]));

const privateView=job=>({present:!!job,status:job?.status??null,jobId:job?.jobId??null,
  plannerInput:!!job?.result?.plannerInput,artifactPlan:!!job?.result?.artifactPlan,
  generationReceipt:!!job?.result?.generationReceipt,moderationPromptRef:!!job?.moderationPromptRef,
  sourceText:/RESPONSIVE ASSESSMENT|Original restrained material texture|Original felt piano|Independent evidence for|One protected context|An adult designer/u.test(JSON.stringify(job??{})),
  bytes:Buffer.byteLength(JSON.stringify(job??null)),sha256:sha(JSON.stringify(job??null))});

const sourceView=h=>({events:h.store.events.get().length,content:Object.keys(h.store.content.get()).length,project:h.store.projection.get().projectId,routeDataReady:h.store.routeDataReady()});

const privateJob=(h,id)=>h.store.documentJobs.get().find(job=>job.jobId===id);

async function presentationSetup(t){
 const fixture=await reliabilityWorker();await fixture.drainBackground();
 const documentId=await seedIndependentPresentation(fixture);
 const calls=[];t.mock.method(globalThis,'fetch',async(input,init={})=>{
  assert.equal(String(input),'https://api.openai.com/v1/responses','only the explicit deterministic setup provider mock');
  calls.push({method:init.method??'GET',url:String(input)});assert.equal(calls.length,1);
  return Response.json({id:'late-recovery-retained-1',model:'gpt-5.6-terra',output_text:JSON.stringify(independentProviderResponse(init.body)),usage:{input_tokens:1200,output_tokens:800,total_tokens:2000}});
 });
 const admitted=await fixture.request('/api/document-jobs',json(presentationAdmission(documentId,'late-source-'+crypto.randomUUID())));assert.equal(admitted.status,202,await admitted.clone().text());
 const initial=(await admitted.json()).job;
 fixture.sqlite.exec("CREATE TRIGGER fail_presentation_artifact_persistence BEFORE INSERT ON private_content WHEN NEW.kind='document-artifact' BEGIN SELECT RAISE(FAIL,'forced_local_presentation_persistence_failure'); END");
 const run=await fixture.runJob(initial),failed=(await run.json()).job;
 assert.equal(failed.status,'failed');assert.equal(failed.result.recoverablePresentationCandidate,true);assert.equal(calls.length,1);
 fixture.sqlite.exec('DROP TRIGGER fail_presentation_artifact_persistence');
 return hostFor(t,fixture,documentId,failed,calls);
}

async function hostFor(t,fixture,documentId,job,calls){
 const worker={...fixture,env:fixture.environment,documentId,projectId:'project-atmosphere',requestId:job.jobId,payload:{},owner:'dev-local-creative',streamId:'creative:dev-local-creative',close(){fixture.sqlite.close();}};
 const h=await createSceneStoreHost({workerFixture:worker});h.store.documentJobs.set([job]);h.store.loading.set(false);
 const originalAuth=h.store.captureAuthorizationScope(),originalSource=h.store.captureSourceOwnership();
 assert.ok(h.store.authorizationScopeActive(originalAuth));assert.ok(h.store.sourceOwnershipActive(originalSource));
 t.after(()=>h.close());
 return {fixture,h,job,calls,originalAuth,originalSource,
  revoke(){fixture.environment.FORMA_PILOT_COHORT_ID='synthetic-missing-controlled-cohort';},
  restore(){delete fixture.environment.FORMA_PILOT_COHORT_ID;}};
}

async function audioSetup(t,options={}){
 const fixture=await originalSourceAudioFixture(options);t.after(()=>fixture.restore());
 const response=await fixture.request('/api/document-jobs/'+fixture.job.jobId);assert.equal(response.status,200);
 return hostFor(t,fixture,'doc-atmosphere',(await response.json()).job,fixture.calls);
}

async function storyboardSetup(t){
 const fixture=await reliabilityWorker();await fixture.drainBackground();
 Object.assign(fixture.environment,{FAL_KEY:'synthetic-existing-fal-key',FORMA_IMAGE_PROVIDER:'fal-ideogram'});
 fixture.env=fixture.environment;fixture.route=(path='',init={})=>fixture.request('/api/document-jobs'+(path?'/'+path:''),init);
 const provider=storyboard.providerMock(fixture);t.after(()=>provider.restore());
 const job=await storyboard.failedUnknownStoryboard(fixture);
 return hostFor(t,fixture,'doc-atmosphere',job,provider.calls);
}

async function deny(x){
 x.revoke();await assert.rejects(x.h.store.refreshEvents(),/403/);
 assert.ok(x.h.store.authorizationScopeActive(x.originalAuth),'same actual authenticated scope');
 assert.ok(x.h.store.sourceOwnershipScopeActive(x.originalSource),'same source scope, different current generation');
 assert.equal(x.h.store.sourceOwnershipActive(x.originalSource),false);
 assert.equal(x.h.store.projection.get().projectId,'');assert.equal(Object.keys(x.h.store.content.get()).length,0);
 assert.equal(privateView(privateJob(x.h,x.job.jobId)).plannerInput,false,'genuine source barrier removed the old private planner');
}

const operations={
 presentation:{method:'recoverDocumentPresentation',suffix:'recover'},
 dismiss:{method:'dismissDocumentJobFailure',suffix:'dismiss'},
 stop:{method:'stopDocumentJob',suffix:'cancel',setup:audioSetup},
 render:{method:'recoverDocumentRender',suffix:'retry',setup:audioSetup},
 reconcile:{method:'reconcileDocumentProviderReceipt',suffix:'reconcile-provider',setup:storyboardSetup},
};
after(()=>resolution.deregister());
export {hostFor,file,money,privateView,sourceView,privateJob,presentationSetup,audioSetup,storyboardSetup,deny,operations,sceneDeferred};
