import assert from 'node:assert/strict';
import test from 'node:test';
import {sameOwnerPublishedFixture} from './output-published-package-fixture.mjs';
import {saveDeck,meter,deckWithActiveReference,handleDocumentJobs,inspectOutputAsset} from './output-native-journey-test-helpers.mjs';

for(const sameProject of[false,true])test(`uninterrupted published/adopted same-owner licensed delivery, sameProject=${sameProject}`,async t=>{
 let paid=0;t.mock.method(globalThis,'fetch',()=>{throw new Error('provider forbidden before explicit authorization');});
 const f=await sameOwnerPublishedFixture({sameProject});t.after(()=>{console.log(JSON.stringify({label:'uninterrupted final evidence',sameProject,steps:f.steps,sourceCursorAtStart:f.initialSourceCursor,sourceCursorAtEnd:f.sourceCursor(),paid,...f.d1Contract}));f.close();});
 const m=meter(f),step=async(name,action)=>{const response=await m.profile(name,action),body=await response.json();console.log(JSON.stringify({label:'uninterrupted response',sameProject,name,status:response.status,error:body.error??null,total:m.metrics.d1+m.metrics.r2+m.metrics.provider}));assert.equal(response.status,200,`${name}: ${JSON.stringify(body)}`);f.checkSource();assert.ok(m.metrics.d1+m.metrics.r2+m.metrics.provider<=50,`${name} exceeds agreed application request budget`);return body;};
 const initial=await step('initial Output read',()=>f.request());assert.equal(initial.sourceVerification.status,'verified');
 const plan=await saveDeck(f);f.checkSource();
 const pre=await step('uninterrupted preflight',()=>f.send({action:'preflight',planRevisionId:plan.planId,targetIds:[plan.targetId]})),terms=pre.command.preflight;assert.ok(terms.targets[0].available);
 const authorized=await step('uninterrupted authorization',()=>f.send({action:'authorize',preflightId:terms.id,termsDigest:terms.termsDigest,maximumMicrousd:terms.maximumMicrousd,explicitAuthorization:true}));
 await step('uninterrupted Start',()=>f.send({action:'run',grantId:authorized.command.grantId}));
 const jobId=f.sqlite.prepare('SELECT job_id FROM document_jobs').get().job_id;
 t.mock.method(globalThis,'fetch',async(url,request)=>{m.metrics.provider++;paid++;assert.equal(String(url),'https://api.openai.com/v1/responses');return Response.json({id:`uninterrupted-${paid}`,model:'gpt-5.6-terra',output_text:JSON.stringify(deckWithActiveReference(request)),usage:{input_tokens:120,output_tokens:80,total_tokens:200}});});
 await step('uninterrupted native execution',()=>handleDocumentJobs(new Request(`http://localhost/api/document-jobs/${jobId}/run`,{method:'POST',headers:f.headers}),f.env,`${jobId}/run`));
 const job=f.sqlite.prepare('SELECT status,error_message,source_surface FROM document_jobs').get();assert.equal(job.status,'completed',JSON.stringify(job));assert.equal(job.source_surface,'outputs','the real job handler supplies the canonical native surface; the fixture must not invent one');assert.equal(paid,1);
 const bound=await step('uninterrupted bind',()=>f.send({action:'bind',planRevisionId:plan.planId,targetId:plan.targetId,nativeJobId:jobId}));assert.equal(bound.snapshot.results[0].checksStatus,'passed');assert.equal(bound.snapshot.results[0].review,'pending');
 const file=await f.request(bound.snapshot.assets[0].downloadUrl);assert.equal(file.status,200);const inspection=await inspectOutputAsset(new Uint8Array(await file.arrayBuffer()),'licensed-deck.pptx');assert.equal(inspection.facts.slideCount,10);f.checkSource();
 const selfReview=await f.send({action:'review',resultId:bound.command.resultId,decision:'approve',reviewedCoverage:true,reviewedRights:true});assert.equal(selfReview.status,403);assert.equal((await selfReview.json()).errorCode,'independent_output_reviewer_required');f.checkSource();
 const reviewed=await step('uninterrupted independent review',()=>f.reviewSend({action:'review',resultId:bound.command.resultId,decision:'approve',reviewedCoverage:true,reviewedRights:true}));assert.equal(reviewed.snapshot.results[0].review,'approved');
 const complete=await f.send({action:'export',planRevisionId:plan.planId});assert.equal(complete.status,409,'one accepted deck must not complete the authored podcast/video assignment');
 const partial=await step('uninterrupted partial export',()=>f.send({action:'export',planRevisionId:plan.planId,allowPartial:true}));assert.equal(partial.snapshot.sourceVerification.status,'verified');
 const archive=await m.profile('uninterrupted export part',()=>f.request(partial.command.downloadUrl));assert.equal(archive.status,200,await archive.clone().text());assert.equal(archive.headers.get('x-output-delivery-completion'),'partial');assert.equal(new Uint8Array(await archive.arrayBuffer())[0],0x50);f.checkSource();
 const cost=f.sqlite.prepare('SELECT used_microusd,status FROM cost_budget_reservations').get();assert.equal(cost.status,'settled');assert.ok(cost.used_microusd>0);assert.equal(paid,1);
 assert.ok(partial.snapshot.confirmedPlan.plan.obligations.some(item=>item.media_kind==='audio'));assert.ok(partial.snapshot.confirmedPlan.plan.obligations.some(item=>item.media_kind==='video'));
});
