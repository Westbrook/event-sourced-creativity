import assert from "node:assert/strict";
import fs from "node:fs";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import test from "node:test";
import { canonicalState, financialState, disclosureBoundary, pauseOperationLookup, pauseClaim, disclosureDbClock } from "./helpers/authoring-disclosure-boundary.mjs";
const original = new URL("./canvas-arrangements.test.mjs", import.meta.url), raw = fs.readFileSync(original, "utf8");
assert.equal(createHash("sha256").update(raw).digest("hex"), "a8cc75fc3b6962e40a02f238f4ab1a6e955a608423ef42b7f54594c4239a691e");
const marker = "test(\"Canvas arrangement previews for free and applies only one complete geometric operation in every authoring scope\"", at = raw.indexOf(marker);
assert.ok(at > 0); assert.equal(raw.indexOf(marker, at + 1), -1);
const virtual = new URL("./canvas-retained-disclosure-fixture.mjs", import.meta.url);
const hook = registerHooks({
  resolve(specifier, context, next) { return specifier === virtual.href ? { url: virtual.href, shortCircuit: true } : next(specifier, context); },
  load(url, context, next) { return url === virtual.href ? { format: "module", shortCircuit: true,
    source: raw.slice(0, at) + "\nexport { fixture, intent, preview, apply, countEvents, assertFree, append };\n" } : next(url, context); },
});
const { fixture, intent, preview, apply, countEvents, assertFree, append } = await import(virtual.href).finally(() => hook.deregister());

const faults = ["healthy", "erased", "redacted", "missing", "bytes", "source", "owner", "kind", "expiry", "bad-json", "principal", "custody"];
for (const mode of ["personal", "selected"]) for (const route of ["fresh", "retained"]) for (const fault of faults)
test("Canvas final private disclosure " + mode + "/" + route + "/" + fault, async () => {
  const state = await fixture(mode); let boundary;
  try {
    const input = await intent(state, { name: "PRIVATE_REVIEW_文書" }), saved = route === "retained" ? await preview(state, input) : null;
    const before = canonicalState(state), finances = financialState(state);
    boundary = disclosureBoundary(state, fault);
    const response = await state.call(route === "fresh" ? { ...input, action: "preview" }
      : { action: "retrieve", operationId: input.operationId, projectId: state.projectId, canvasId: state.canvasId });
    const value = await response.json(); boundary.restore();
    assert.equal(boundary.evidence.reached, 1); assert.deepEqual(canonicalState(state), before); assert.deepEqual(financialState(state), finances);
    if (fault === "healthy") {
      assert.equal(response.status, 200); assert.equal(value.status, "review"); assert.equal(value.preview.name, input.name);
      assert.equal(value.preview.previewId, saved?.previewId ?? boundary.evidence.previewId);
    } else {
      assert.equal(response.status, 403); assert.equal(value.preview, undefined);
      assert.equal(JSON.stringify(value).includes(input.name), false);
    }
    assertFree(state);
  } finally { boundary?.restore(); state.sqlite.close(); }
});

for (const mode of ["personal", "selected"]) for (const fault of ["healthy", "erased"])
test("Canvas concurrent preview winner is finally rechecked " + mode + "/" + fault, async () => {
  const state = await fixture(mode); let pause, boundary, loser;
  try {
    const input = await intent(state, { name: "PRIVATE_CONCURRENT_REVIEW" }), before = canonicalState(state), finances = financialState(state);
    pause = pauseOperationLookup(state);
    loser = state.call({ ...input, action: "preview" }); await pause.entered;
    const winner = await preview(state, input);
    boundary = disclosureBoundary(state, fault); pause.release();
    const response = await loser; loser = null; const value = await response.json();
    assert.equal(boundary.evidence.reached, 1); assert.equal(boundary.evidence.previewId, winner.previewId);
    if (fault === "healthy") { assert.equal(response.status, 200); assert.equal(value.preview.previewId, winner.previewId); }
    else { assert.equal(response.status, 403); assert.equal(value.preview, undefined); assert.equal(JSON.stringify(value).includes(input.name), false); }
    assert.deepEqual(canonicalState(state), before); assert.deepEqual(financialState(state), finances);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM private_content WHERE kind='authoring-preview'").get().n, 1);
  } finally { pause?.release(); if (loser) await loser; boundary?.restore(); pause?.restore(); state.sqlite.close(); }
});

for (const mode of ["personal", "selected"]) for (const erased of [false, true])
test("Canvas exact canonical receipt stays content-free after private retention " + mode + "/" + erased, async () => {
  const state = await fixture(mode);
  try {
    const input = await intent(state), saved = await preview(state, input);
    const applied = await apply(state, input, saved); assert.equal(applied.status, 200); const receipt = await applied.json();
    if (erased) state.sqlite.prepare("UPDATE private_content SET content='',redacted_at=? WHERE content_id=?").run(new Date().toISOString(), saved.previewId);
    const before = canonicalState(state), finances = financialState(state), changes = Number(state.sqlite.prepare("SELECT total_changes() AS n").get().n);
    const response = await state.call({ action: "retrieve", operationId: input.operationId, projectId: state.projectId, canvasId: state.canvasId }), value = await response.json();
    assert.equal(response.status, 200); assert.equal(value.status, "applied"); assert.equal(value.arrangementId, receipt.arrangementId);
    assert.equal(value.previewId, saved.previewId); assert.equal(value.approvalHash, saved.approvalHash); assert.equal(value.preview, undefined);
    assert.deepEqual(canonicalState(state), before); assert.deepEqual(financialState(state), finances);
    assert.equal(Number(state.sqlite.prepare("SELECT total_changes() AS n").get().n), changes);
  } finally { state.sqlite.close(); }
});

for (const mode of ["personal", "selected"]) test("Canvas removed current source cannot disclose retained review " + mode, async () => {
  const state = await fixture(mode);
  try {
    const input = await intent(state); await preview(state, input);
    append(state, [["CanvasRemoved", { project_id: state.projectId, canvas_id: state.canvasId }]]);
    const before = canonicalState(state), response = await state.call({ action: "retrieve", operationId: input.operationId, projectId: state.projectId, canvasId: state.canvasId });
    assert.ok(response.status >= 400); assert.equal((await response.json()).preview, undefined); assert.deepEqual(canonicalState(state), before);
  } finally { state.sqlite.close(); }
});

for (const mode of ["personal", "selected"]) test("Canvas changed approved source bytes fail their original hash " + mode, async () => {
  const state = await fixture(mode);
  try {
    const input = await intent(state), saved = await preview(state, input);
    state.sqlite.prepare("UPDATE private_content SET content=json_set(content,'$.plan.binding.sourceHash','defensive-source-hash') WHERE content_id=?").run(saved.previewId);
    const before = canonicalState(state), response = await state.call({ action: "retrieve", operationId: input.operationId, projectId: state.projectId, canvasId: state.canvasId });
    assert.equal(response.status, 403); assert.equal((await response.json()).preview, undefined); assert.deepEqual(canonicalState(state), before);
  } finally { state.sqlite.close(); }
});
const deferred=()=>{let resolve;const promise=new Promise(value=>{resolve=value;});return{promise,resolve};};
for(const mode of["personal","selected"])for(const expired of[false,true])test("Canvas actual retained lease retrieval is read-only: "+mode+"/"+expired,async()=>{
 const state=await fixture(mode),input=await intent(state),saved=await preview(state,input),entered=deferred(),release=deferred();
 const prepare=state.env.DB.prepare.bind(state.env.DB);let applying,leaseWrites=0;
 try{
  state.env.DB.prepare=sql=>{const statement=prepare(sql),bind=statement.bind.bind(statement);
   statement.bind=(...values)=>{const bound=bind(...values),run=bound.run.bind(bound);
    if(sql.startsWith("UPDATE private_content SET content=json_set(content,'$.state','applying'"))bound.run=async()=>{const value=await run();if(value.meta.changes===1){entered.resolve();await release.promise;}return value;};
    if(sql.startsWith("UPDATE private_content SET content=json_set(content,'$.state','review','$.leaseId','')"))bound.run=async()=>{leaseWrites++;return run();};
    return bound;};return statement;};
  applying=apply(state,input,saved);await entered.promise;
  if(expired)state.sqlite.prepare("UPDATE private_content SET content=json_set(content,'$.leaseExpiresAt',?) WHERE content_id=?").run(new Date(Date.now()-1000).toISOString(),saved.previewId);
  const before=state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(saved.previewId).content;
  const changes=Number(state.sqlite.prepare("SELECT total_changes() AS n").get().n),events=countEvents(state);leaseWrites=0;
  const read=await state.call({action:"retrieve",operationId:input.operationId,projectId:state.projectId,canvasId:state.canvasId}),body=await read.json();
  const after=state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(saved.previewId).content;
  const evidence={mode,expired,status:read.status,phase:body.status,leaseWrites,totalChanges:Number(state.sqlite.prepare("SELECT total_changes() AS n").get().n)-changes,retainedBytesUnchanged:before===after,canonicalEventsUnchanged:countEvents(state)===events};
  release.resolve();const old=await applying;applying=null;const outcome=await old.json();
  if(expired){assert.notEqual(outcome.status,"applied");state.env.DB.prepare=prepare;const retry=await apply(state,input,saved);assert.equal(retry.status,200);assert.equal((await retry.json()).status,"applied");}
  else{assert.equal(old.status,200);assert.equal(outcome.status,"applied");}
  assert.equal(countEvents(state)-events,1+2*state.selectedItemIds.length);assertFree(state);
  console.log("CANVAS_LEASE_READ_BEFORE "+JSON.stringify(evidence));
  assert.equal(evidence.retainedBytesUnchanged,true,"Read-only retrieval cannot release the original expired writer lease");
  assert.equal(evidence.totalChanges,0,"Read-only retrieval has no durable write");
 }finally{release.resolve();if(applying)await applying;state.env.DB.prepare=prepare;state.sqlite.close();}
});
for(const mode of["personal","selected"])for(const action of["apply","dismiss"])test("Canvas healthy explicit original action remains available: "+mode+"/"+action,async()=>{
 const state=await fixture(mode);try{const input=await intent(state),saved=await preview(state,input),before=countEvents(state);
 const response=action==="apply"?await apply(state,input,saved):await state.call({action,operationId:input.operationId,projectId:state.projectId,canvasId:state.canvasId,previewId:saved.previewId,approvalHash:saved.approvalHash});
 assert.equal(response.status,200);assert.equal((await response.json()).status,action==="apply"?"applied":"dismissed");
 assert.equal(countEvents(state)-before,action==="apply"?1+2*state.selectedItemIds.length:0);assertFree(state);
 }finally{state.sqlite.close();}
});

for (const mode of ["personal", "selected"]) for (const action of ["apply", "dismiss"])
test("Canvas DB-expired plan and lease still permit only explicit original disposition " + mode + "/" + action, async () => {
  const state = await fixture(mode); let clock, claim, old;
  try {
    const input = await intent(state), saved = await preview(state, input), before = canonicalState(state), finances = financialState(state);
    claim = pauseClaim(state); old = apply(state, input, saved); await claim.entered;
    clock = disclosureDbClock(state); clock.set(new Date(Date.parse(saved.expiresAt) + 1).toISOString());
    const raw = state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(saved.previewId).content;
    const changes = Number(state.sqlite.prepare("SELECT total_changes() AS n").get().n);
    const checked = await state.call({ action: "retrieve", operationId: input.operationId, projectId: state.projectId, canvasId: state.canvasId });
    assert.equal(checked.status, 403); assert.equal((await checked.json()).preview, undefined);
    assert.equal(state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(saved.previewId).content, raw);
    assert.equal(Number(state.sqlite.prepare("SELECT total_changes() AS n").get().n), changes);
    const explicit = action === "apply" ? await apply(state, input, saved) : await state.call({ action, operationId: input.operationId,
      projectId: state.projectId, canvasId: state.canvasId, previewId: saved.previewId, approvalHash: saved.approvalHash });
    const value = await explicit.json();
    if (action === "dismiss") { assert.equal(explicit.status, 200); assert.equal(value.status, "dismissed"); }
    else { assert.ok(explicit.status >= 400); assert.notEqual(value.status, "applied"); }
    assert.deepEqual(canonicalState(state), before); assert.deepEqual(financialState(state), finances);
    claim.release(); const late = await old; old = null; assert.notEqual((await late.json()).status, "applied");
    assert.deepEqual(canonicalState(state), before);
  } finally { claim?.release(); if (old) await old; claim?.restore(); clock?.close(); state.sqlite.close(); }
});

for (const mode of ["personal", "selected"]) for (const winnerKind of ["live", "committed"])
test("Canvas explicit expired-lease recovery preserves a later " + winnerKind + " winner " + mode, async () => {
  const state = await fixture(mode), oldClaim = pauseClaim(state), releaseEntered = deferred(), releaseProceed = deferred();
  const winnerEntered = deferred(), winnerProceed = deferred(); let old, contender, winner, originalPrepare;
  try {
    const input = await intent(state), saved = await preview(state, input), events = countEvents(state);
    old = apply(state, input, saved); await oldClaim.entered;
    state.sqlite.prepare("UPDATE private_content SET content=json_set(content,'$.leaseExpiresAt',?) WHERE content_id=?")
      .run(new Date(Date.now() - 1000).toISOString(), saved.previewId);
    originalPrepare = state.env.DB.prepare.bind(state.env.DB); let releaseHeld = false, winnerHeld = false;
    state.env.DB.prepare = sql => {
      const statement = originalPrepare(sql), bind = statement.bind.bind(statement);
      statement.bind = (...values) => {
        const bound = bind(...values), run = bound.run.bind(bound);
        if (sql.startsWith("UPDATE private_content SET content=json_set(content,'$.state','review','$.leaseId','')")) bound.run = async () => {
          if (!releaseHeld) { releaseHeld = true; releaseEntered.resolve(); await releaseProceed.promise; }
          return run();
        };
        if (winnerKind === "live" && sql.startsWith("UPDATE private_content SET content=json_set(content,'$.state','applying'")) bound.run = async () => {
          const value = await run();
          if (!winnerHeld && Number(value.meta.changes) === 1) { winnerHeld = true; winnerEntered.resolve(); await winnerProceed.promise; }
          return value;
        };
        return bound;
      };
      return statement;
    };
    contender = apply(state, input, saved); await releaseEntered.promise;
    winner = apply(state, input, saved);
    if (winnerKind === "live") await winnerEntered.promise;
    else { const committed = await winner; winner = null; assert.equal(committed.status, 200); assert.equal((await committed.json()).status, "applied"); }
    const currentRaw = state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(saved.previewId).content;
    const before = canonicalState(state), changes = Number(state.sqlite.prepare("SELECT total_changes() AS n").get().n);
    releaseProceed.resolve(); const checked = await contender; contender = null; const value = await checked.json();
    assert.equal(checked.status, winnerKind === "live" ? 202 : 200);
    assert.equal(value.status, winnerKind === "live" ? "applying" : "applied"); assert.equal(value.preview, undefined);
    assert.equal(state.sqlite.prepare("SELECT content FROM private_content WHERE content_id=?").get(saved.previewId).content, currentRaw);
    assert.equal(Number(state.sqlite.prepare("SELECT total_changes() AS n").get().n), changes);
    assert.deepEqual(canonicalState(state), before);
    oldClaim.release(); const late = await old; old = null; await late.json(); assert.deepEqual(canonicalState(state), before);
    if (winner) { winnerProceed.resolve(); const completed = await winner; winner = null; assert.equal(completed.status, 200); assert.equal((await completed.json()).status, "applied"); }
    assert.equal(countEvents(state) - events, 1 + 2 * state.selectedItemIds.length);
    assert.equal(state.sqlite.prepare("SELECT COUNT(*) AS n FROM authoring_commits").get().n, 1); assertFree(state);
  } finally {
    releaseProceed.resolve(); winnerProceed.resolve(); oldClaim.release();
    if (contender) await contender; if (winner) await winner; if (old) await old;
    if (originalPrepare) state.env.DB.prepare = originalPrepare; oldClaim.restore(); state.sqlite.close();
  }
});
