import assert from "node:assert/strict";
import { createSceneCostFixture } from "./scene-cost-fixture.mjs";

/** Actual approved Scene and native terminal transition; no fabricated zero-call receipt. */
export async function createUnusedSceneFixture({shared=false,medium="visual",reason="cancel",depth=true,beforeTerminal}={}){
  const fixture=await createSceneCostFixture(9,medium,{shared,depth});
  try{
    if(shared)assert.equal((await fixture.request("/api/events?after=0&limit=2000&content=0")).status,200);
    const inspected=await fixture.preview();assert.equal(inspected.response.status,200,JSON.stringify(inspected.body));
    const originalPreview=inspected.body.sceneCostPreview;
    const approved=await fixture.approve(originalPreview);assert.equal(approved.response.status,202,JSON.stringify(approved.body));
    let job;
    const originalSourceExpiry=fixture.sqlite.prepare("SELECT expires_at FROM private_content WHERE content_id=?").get(fixture.contentRef).expires_at;
    await beforeTerminal?.(fixture);
    if(reason==="cancel"){
      const response=await fixture.request("/api/document-jobs/"+fixture.requestId+"/cancel",fixture.json({}));
      assert.equal(response.status,200,await response.clone().text());job=(await response.json()).job;
      assert.equal(job.status,"canceled");assert.equal(job.attemptCount,0);assert.equal(job.startedAt,null);
    }else{
      assert.equal(reason,"source-expired");
      fixture.sqlite.prepare("UPDATE private_content SET expires_at='2000-01-01T00:00:00Z' WHERE content_id=?").run(fixture.contentRef);
      const result=await fixture.run();assert.equal(result.response.status,200,JSON.stringify(result.body));job=result.body.job;
      assert.equal(job.status,"failed");assert.equal(job.errorDetail.code,"workflow_source_unavailable");assert.equal(job.attemptCount,1);
    }
    assert.equal(job.leaseExpiresAt,null);assert.equal(fixture.counts().budget_reservations,0);assert.equal(fixture.counts().cost_budget_reservations,0);
    return Object.assign(fixture,{originalPreview,job,originalSourceExpiry,
      originalRow(){return fixture.sqlite.prepare("SELECT * FROM document_jobs WHERE job_id=?").get(fixture.requestId);},
      checkpoint(){return JSON.parse(this.originalRow().result_json);},
      updateCheckpoint(change){const checkpoint=this.checkpoint();change(checkpoint);fixture.sqlite.prepare("UPDATE document_jobs SET result_json=? WHERE job_id=?").run(JSON.stringify(checkpoint),fixture.requestId);},
      sourceReceipt(){const id=this.checkpoint().generationReceipt.input_ref;return fixture.sqlite.prepare("SELECT * FROM private_content WHERE content_id=?").get(id);},
      repairSource(){fixture.sqlite.prepare("UPDATE private_content SET expires_at=? WHERE content_id=?").run(originalSourceExpiry,fixture.contentRef);},
    });
  }catch(error){fixture.close();throw error;}
}
