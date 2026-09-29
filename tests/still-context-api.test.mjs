import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryMedia } from './helpers/still-media-fixture.mjs';
import { createSceneCostFixture } from './helpers/scene-cost-fixture.mjs';
import { StillClient } from '../src/still/client.ts';
import { ContextWorkflow } from '../src/still/context-workflow.ts';
import { acquiredReferenceEvents } from '../src/still/reference.ts';
import { compositionPlan } from '../src/still/composition.ts';

for(const shared of [false,true])test(`Still context uses real retained authoring in ${shared?'shared':'personal'} scope`,async()=>{
  const f=await createSceneCostFixture(1,'visual',{shared}),saved=globalThis.fetch;
  f.env.MEDIA=memoryMedia(); // Standard Still tools do not require Assistant pilot enrollment.
  let providerCalls=0,loseExecute=false,loseApply=false;
  globalThis.fetch=async(url,init)=>{
    if(String(url).startsWith('/')) {
      const body=init?.body?JSON.parse(init.body):{};
      const response=await f.request(String(url),init);
      if(loseExecute&&url==='/api/context/decompose'&&body.action==='execute'&&response.ok){loseExecute=false;throw new Error('lost analysis reply');}
      if(loseApply&&url==='/api/context/apply'&&body.action==='apply'&&response.ok){loseApply=false;throw new Error('lost authoring reply');}
      return response;
    }
    assert.equal(String(url),'https://api.openai.com/v1/responses');providerCalls++;
    const request=JSON.parse(init.body),payload=JSON.parse(request.input);
    return Response.json({id:'fixture-context-response',model:request.model,output_text:JSON.stringify({proposals:[{type:'subject',subtype:'Hero subject',label:'keeper',text:'keeper',source_excerpt:'keeper',participants:[]}]}),usage:{input_tokens:100,output_tokens:50,total_tokens:150}});
  };
  try {
    const c=new StillClient();await c.load();c.position={...c.position,projectId:f.projectId,documentId:f.documentId,blockId:'scene-reuse-direction',view:'document'};
    const flow=new ContextWorkflow(c,'decompose');await flow.resume();assert.equal(flow.status,'start');
    assert.equal(providerCalls,0);loseExecute=true;await assert.rejects(flow.startAnalysis(),/lost analysis/);await flow.startAnalysis();assert.equal(providerCalls,1);
    assert.equal(flow.candidates.length,1);flow.candidates[0].included=true;await flow.prepareChanges();
    assert.ok(flow.preview.changes.some(c=>c.kind==='create'));loseApply=true;
    await assert.rejects(flow.apply(),/lost authoring/);await flow.apply();assert.equal(flow.status,'applied');
    const child=c.projection.blocks.find(b=>b.properties.source_execution_id===flow.quote.executionId);assert.ok(child);
    assert.equal(child.properties.text,'keeper');assert.equal(c.projection.blocks.find(b=>b.id==='scene-reuse-direction').properties.text,'The keeper checks the harbor.');
    assert.ok(c.projection.blockRelations.some(r=>r.fromBlockId==='scene-reuse-direction'&&r.toBlockId===child.id));
    const resumed=new ContextWorkflow(c,'research');await resumed.resume();assert.equal(resumed.status,'applied');await resumed.dismiss();await resumed.resume();assert.equal(resumed.status,'start');
    await c.append([c.blockEvent('Evening light','Light','style')]);
    const extra=c.projection.blocks.find(b=>b.handle==='Light');const plan=compositionPlan(c.projection,'scene-reuse-direction',[extra.id,child.id],'ordered');
    await c.append(plan);assert.equal(c.projection.blocks.find(b=>b.id==='scene-reuse-direction').properties.context_group.application,'ordered');
    const form=new FormData();form.append('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7y8AAAAASUVORK5CYII=','base64')],{type:'image/png'}),'reference.png');form.append('rightsConfirmed','true');form.append('nonSensitiveConfirmed','true');
    const uploaded=await f.request('/api/media',{method:'POST',body:form});assert.equal(uploaded.ok,true,await uploaded.clone().text());const media=await uploaded.json();
    const reference={selection:{executionId:'fixture-research',bindingHash:'fixture-binding',proposalId:'image'},research:{id:'image',blockId:null,area:'learned',type:'reference',label:'Reference',text:'A ceramic study',imageUrl:'https://upload.wikimedia.org/fixture.png',sourceUrl:'https://commons.wikimedia.org/wiki/File:fixture.png',license:'CC0',attribution:'Fixture artist'}};
    const referencePlan=acquiredReferenceEvents(c.projection.blocks.find(b=>b.id==='scene-reuse-direction'),c.projection,reference,media);await c.append(referencePlan);
    const attached=c.projection.blocks.find(b=>b.properties.source_proposal_id==='image');assert.ok(attached);assert.equal(attached.properties.source_license,'CC0');assert.equal(attached.properties.pixel_reference_mode,'context_only');assert.ok(c.projection.blockRelations.some(r=>r.toBlockId===attached.id));
    assert.equal(providerCalls,1);assert.equal(f.counts().document_jobs,0);
  } finally {globalThis.fetch=saved;await f.drainBackground();f.close();}
});
