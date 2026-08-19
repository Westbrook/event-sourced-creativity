import test from "node:test";
import assert from "node:assert/strict";
import {
  DOCUMENT_JOB_STALE_AFTER_MS,
  documentGenerationRequestKey,
  documentGenerationRevision,
  documentJobActionLabel,
  documentJobFailureVisible,
  documentJobTerminal,
  generationFailureGuidance,
  documentJobIsStale,
  documentJobMaxAttempts,
} from "../src/model/document-jobs.ts";
import { documentJobCompletionBindings } from "../worker/document-job-sql.ts";
import { readFile } from "node:fs/promises";

const job = (patch = {}) => ({
  jobId: "job-1",
  documentId: "doc-1",
  kind: "preview",
  status: "queued",
  sourceSurface: "studio",
  requestedSequence: 1,
  documentRevision: "rev-one",
  requestKey: "preview:rev-one",
  sourcePreviewId: null,
  parentJobId: null,
  fanKind: null,
  members: [],
  result: null,
  error: null,
  errorDetail: null,
  moderationPromptRef: null,
  dismissedAt: null,
  attemptCount: 0,
  requestedAt: "2026-08-12T00:00:00.000Z",
  startedAt: null,
  completedAt: null,
  notifiedAt: null,
  leaseExpiresAt: null,
  updatedAt: "2026-08-12T00:00:00.000Z",
  stage: "queued",
  progressMessage: "",
  ...patch,
});

test("bounds automatic retries for costly image work and avoids replaying chat turns", () => {
  assert.equal(documentJobMaxAttempts("preview"), 2);
  assert.equal(documentJobMaxAttempts("generate"), 2);
  assert.equal(documentJobMaxAttempts("extract_reference"), 2);
  assert.equal(documentJobMaxAttempts("prompt_fan"), 1);
  assert.equal(documentJobMaxAttempts("chat"), 1);
  assert.equal(documentJobMaxAttempts("structure_adaptive"), 1);
});

test("recognizes expired leases and missing heartbeats without treating queued work as stale", () => {
  const now = Date.parse("2026-08-12T00:02:00.000Z");
  assert.equal(documentJobIsStale(job({ status: "queued" }), now), false);
  assert.equal(documentJobIsStale(job({ status: "running", leaseExpiresAt: "2026-08-12T00:01:59.000Z", updatedAt: "2026-08-12T00:01:50.000Z" }), now), true);
  assert.equal(documentJobIsStale(job({ status: "running", leaseExpiresAt: "2026-08-12T00:03:00.000Z", updatedAt: new Date(now - DOCUMENT_JOB_STALE_AFTER_MS - 1).toISOString() }), now), true);
  assert.equal(documentJobIsStale(job({ status: "running", leaseExpiresAt: "2026-08-12T00:03:00.000Z", updatedAt: "2026-08-12T00:01:50.000Z" }), now), false);
});

test("reports queued and running stages truthfully", () => {
  assert.equal(documentJobActionLabel(job(), "preview"), "Draft queued…");
  assert.equal(documentJobActionLabel(job({ kind: "generate" }), "generate", true), "Full queued behind draft…");
  assert.equal(documentJobActionLabel(job({ status: "running", stage: "preparing" }), "preview"), "Draft preparing…");
  assert.equal(documentJobActionLabel(job({ status: "running", stage: "rendering" }), "preview"), "Draft rendering…");
  assert.equal(documentJobActionLabel(job({ kind: "generate", status: "running", stage: "rendering" }), "generate"), "Rendering full image…");
  assert.equal(documentJobActionLabel(job({ kind: "generate", status: "committing", stage: "rendering" }), "generate"), "Finalizing full image…");
  assert.equal(documentJobTerminal(job({ status: "canceled" })), true);
});

test("gives creators durable cancellation and administrators a force-fail escape hatch",async()=>{
  const [jobsApi,eventsApi,adapter,actions,store]=await Promise.all([
    readFile(new URL("../worker/document-jobs-api.ts",import.meta.url),"utf8"),
    readFile(new URL("../worker/events-api.ts",import.meta.url),"utf8"),
    readFile(new URL("../worker/openai-adapter.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/generation-actions.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/state/store.ts",import.meta.url),"utf8"),
  ]);
  assert.match(jobsApi,/path\.endsWith\("\/cancel"\)/);
  assert.match(jobsApi,/path\.endsWith\("\/force-fail"\)/);
  assert.match(jobsApi,/user\.role !== "admin"/);
  assert.match(jobsApi,/SET status='committing'/);
  assert.match(jobsApi,/status IN \('running','committing'\)/);
  assert.match(jobsApi,/releaseBudgetReservationsForCorrelation/);
  assert.match(eventsApi,/execution\?\.beginCommit\(\)/);
  assert.match(eventsApi,/signal:execution\?\.signal/);
  assert.match(adapter,/signal:options\.signal/);
  assert.match(actions,/Stop generation/);
  assert.match(actions,/Force fail/);
  assert.match(store,/stopDocumentJob\(jobId:string,force=false\)/);
});

test("identifies the exact document state independently of object key order", () => {
  const first = { documentId: "doc-1", snapshot: { facts: [{ block_id: "b1", properties: { weight: .5, text: "Quiet light" } }], pins: [] }, sourceBlockVersions: [{ block_id: "b1", version: 2 }] };
  const reordered = { sourceBlockVersions: [{ version: 2, block_id: "b1" }], snapshot: { pins: [], facts: [{ properties: { text: "Quiet light", weight: .5 }, block_id: "b1" }] }, documentId: "doc-1" };
  const changed = { ...first, sourceBlockVersions: [{ block_id: "b1", version: 3 }] };
  assert.equal(documentGenerationRevision(first), documentGenerationRevision(reordered));
  assert.notEqual(documentGenerationRevision(first), documentGenerationRevision(changed));
});

test("distinguishes updated draft work and full generations promoted from different drafts", () => {
  assert.equal(documentGenerationRequestKey("preview", "rev-one"), "preview:rev-one");
  assert.notEqual(documentGenerationRequestKey("preview", "rev-one"), documentGenerationRequestKey("preview", "rev-two"));
  assert.notEqual(documentGenerationRequestKey("generate", "rev-one", "draft-a"), documentGenerationRequestKey("generate", "rev-one", "draft-b"));
  assert.equal(documentGenerationRequestKey("generate", "rev-one"), "generate:rev-one:document");
  assert.notEqual(documentGenerationRequestKey("preview", "rev-one", null, "json"), documentGenerationRequestKey("preview", "rev-one", null, "xml"));
  assert.notEqual(documentGenerationRequestKey("preview", "rev-one", null, "prose", "fan-a"), documentGenerationRequestKey("preview", "rev-one", null, "prose", "fan-b"));
});

test("explains safety, application budgets, and project quotas without suggesting futile retries",()=>{
  const base={code:"failure",category:"quota",scope:"project",action:"raise_limit",message:"limit",retryable:false,retryAfterMs:null,requestId:null,httpStatus:429};
  assert.equal(generationFailureGuidance({...base,code:"moderation_blocked",category:"safety",scope:"request",action:"edit_request"}).retryAllowed,false);
  assert.match(generationFailureGuidance({...base,code:"budget_hard_cap_reached",scope:"user",action:"review_budget"}).title,/Your generation budget/);
  assert.match(generationFailureGuidance(base).title,/OpenAI project limit/);
  assert.equal(generationFailureGuidance({...base,category:"rate_limit",action:"wait_and_retry",retryable:true,retryAfterMs:2500}).retryAllowed,true);
});

test("keeps every terminal D1 placeholder paired with one binding",()=>{
  const values=documentJobCompletionBindings({status:"completed",result:{stage:"completed"},errorMessage:null,completedAt:"2026-08-14T12:00:00.000Z",parentId:null,jobId:"job-1",ownerId:"user-1",correlationId:"job-1:attempt:1"});
  assert.equal(values.length,10);
  assert.equal(values[3],"2026-08-14T12:00:00.000Z");
  assert.equal(values[4],null);
  assert.equal(values[7],"job-1");
});

test("keeps terminal failures visible until their durable notice is dismissed",()=>{
  assert.equal(documentJobFailureVisible(job({status:"failed",dismissedAt:null})),true);
  assert.equal(documentJobFailureVisible(job({status:"partial",dismissedAt:null})),true);
  assert.equal(documentJobFailureVisible(job({status:"failed",dismissedAt:"2026-08-14T12:00:00.000Z"})),false);
  assert.equal(documentJobFailureVisible(job({status:"completed",dismissedAt:null})),false);
});

test("settles generation capacity by reservation identity and repairs orphaned failures",async()=>{
  const [policy,eventsApi,jobsApi,runtime,actions]=await Promise.all([
    readFile(new URL("../worker/pilot-policy.ts",import.meta.url),"utf8"),
    readFile(new URL("../worker/events-api.ts",import.meta.url),"utf8"),
    readFile(new URL("../worker/document-jobs-api.ts",import.meta.url),"utf8"),
    readFile(new URL("../worker/runtime.ts",import.meta.url),"utf8"),
    readFile(new URL("../src/components/generation-actions.ts",import.meta.url),"utf8"),
  ]);
  assert.match(runtime,/CREATE TABLE IF NOT EXISTS budget_reservations/);
  assert.match(policy,/WHERE reservation_id=\? AND owner_id=\? AND status='active'/);
  assert.match(policy,/orphaned_failed_reservation_reconciled/);
  assert.match(policy,/NOT EXISTS \(SELECT 1 FROM document_jobs job[\s\S]*status IN \('queued','running','committing'\)/);
  assert.match(jobsApi,/releaseBudgetReservationsForCorrelation\(env,user,row\.correlation_id/);
  assert.doesNotMatch(jobsApi,/releaseBudget\(env, user\.userId, reservedTokens\)/);
  assert.doesNotMatch(eventsApi,/releaseBudget\(env,ownerId,reserved\)/);
  assert.match(eventsApi,/const billingOwnerId=auth\.user\.billingUserId\?\?ownerId/);
  assert.match(eventsApi,/settleBudget\(env,billingOwnerId,reservation\.reservationId/);
  assert.match(actions,/aria-describedby=\$\{previewFanBudgetBlocked&&budgetNoteVisible\?this\.#budgetNoteId:nothing\}/);
  assert.match(actions,/Failed work releases its reservation automatically/);
  assert.match(actions,/Dismiss generation capacity notification/);
  assert.match(actions,/sessionStorage\.setItem\(key,"dismissed"\)/);
  assert.match(actions,/budgetBand/);
  assert.match(actions,/<button class="button ghost compact" aria-label="Dismiss this generation issue"/);
  assert.doesNotMatch(actions,/category==="safety"\?html`<button class="button ghost compact" aria-label="Dismiss/);
});
