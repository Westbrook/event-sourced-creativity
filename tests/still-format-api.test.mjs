import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneCostFixture } from './helpers/scene-cost-fixture.mjs';
import { POLICY_VERSION } from '../src/still/decisions.ts';

test('the format chooser accepts fit-only Jev answers without selecting or generating',async()=>{
  const f=await createSceneCostFixture(1,'visual'), saved=globalThis.fetch;
  f.env.JEV_API_KEY='test-only-no-external-network';
  let calls=0;
  globalThis.fetch=async(url,init)=>{
    assert.equal(String(url),'https://api.typesafe.ai/v1/systemone');calls++;
    const body=JSON.parse(init.body);
    assert.equal(body.state.current.view,'choose-format');
    assert.equal(body.state.current.documentId,f.documentId);
    assert.ok(body.state.history.coverage.accessibleEvents>0);
    assert.ok(body.questions.fit_image);assert.equal(body.questions.use_image,undefined);
    assert.equal(body.questions.fit_model3d,undefined);
    const score=(score,confidence)=>({type:'score',score,confidence});
    return Response.json({model:'simulated-jev',answers:{fit_short_story:score(3,.95),fit_scene:score(3,.9),fit_image:score(2,.9),fit_model3d:score(3,1),fit_invented:score(3,1)}});
  };
  try {
    const before=f.counts();
    const initial=await (await f.request('/api/events?after=0')).json();
    const response=await f.request('/api/still/decision',f.json({projectId:f.projectId,documentId:f.documentId,view:'choose-format',intent:'',recentActions:[]}));
    assert.equal(response.status,200,await response.clone().text());
    const body=await response.json();
    assert.equal(body.policy,POLICY_VERSION);assert.equal(body.source,'jev');assert.equal(body.head,initial.head);
    assert.deepEqual(body.formats,['short_story','scene','image']);assert.deepEqual(body.actions,[]);
    assert.equal(calls,1);assert.deepEqual(f.counts(),before);
    assert.equal((await (await f.request('/api/events?after=0')).json()).head,initial.head);
  }finally{globalThis.fetch=saved;await f.drainBackground();f.close();}
});
