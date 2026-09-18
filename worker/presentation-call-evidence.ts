import { PAID_PROVIDER_FINANCIAL_FIELDS, mergeProviderSubmissions, providerSubmissions, type PaidProviderSubmission } from "../src/model/provider-submission.ts";
import { outputAssertionStatements } from "./output-requirements-ledger.ts";
import { loadPrivateProviderResponse, storePrivateContent, type ProjectExecutionScope } from "./pilot-policy.ts";
import type { WorkerEnv } from "./runtime.ts";

type Identity = { jobId: string; ownerId: string; streamId: string; correlationId: string };
type EvidenceJob = { result_json: string; request_json: string; status: string; document_id: string; output_slot_id: string | null };
const read = (env: WorkerEnv, identity: Identity) => env.DB.prepare(`SELECT result_json,request_json,status,document_id,(SELECT slot_id FROM output_operation_slots WHERE job_id=document_jobs.job_id) AS output_slot_id FROM document_jobs
  WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND kind='render_document'
    AND json_extract(request_json,'$.artifactKind')='slides'`).bind(identity.jobId, identity.ownerId, identity.streamId, identity.correlationId).first<EvidenceJob>();
const parse = (value: string): Record<string, unknown> => JSON.parse(value || "{}");
const candidates = (checkpoint: Record<string, unknown>) => Array.isArray(checkpoint.presentationCandidates)
  ? checkpoint.presentationCandidates.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)) : [];

function admittedCall(checkpoint: Record<string, unknown>, incoming: PaidProviderSubmission) {
  const prior = providerSubmissions(checkpoint).find(call => call.clientRequestId === incoming.clientRequestId);
  if (!prior || prior.provider !== "openai" || prior.operation !== "planning"
    || incoming.provider !== "openai" || incoming.operation !== "planning" || incoming.status !== "completed"
    || prior.requestDigest !== incoming.requestDigest || !incoming.requestDigest
    || prior.unitId !== incoming.unitId || prior.model !== incoming.model) throw new Error("presentation_call_evidence_not_admitted");
  return prior;
}

/** Publish private bytes and the corresponding completed call in ONE D1 transaction. */
export async function retainPresentationCallResponse(env: WorkerEnv, identity: Identity, input: {
  documentId: string; envelope: string; candidate: Record<string, unknown>; call: PaidProviderSubmission;
  projectScope?: ProjectExecutionScope;
}) {
  const row = await read(env, identity);
  if (!row || row.output_slot_id || row.status !== "running" || row.document_id !== input.documentId) throw new Error("presentation_call_retention_unavailable");
  const checkpoint = parse(row.result_json);
  admittedCall(checkpoint, input.call);
  const receipt = checkpoint.generationReceipt as Record<string, unknown> | undefined;
  if (!receipt || receipt.source_snapshot_sha256 !== input.candidate.sourceSnapshotSha256) throw new Error("presentation_call_source_changed");
  const exactReplay = async (saved: Record<string, unknown>) => {
    admittedCall(saved, input.call);
    const candidate = candidates(saved).find(entry => entry.clientRequestId === input.call.clientRequestId);
    if (!candidate) return null;
    const call = providerSubmissions(saved).find(entry => entry.clientRequestId === input.call.clientRequestId);
    if (candidate.contentSha256 !== input.candidate.contentSha256 || candidate.responseId !== input.call.providerRequestId
      || typeof candidate.contentRef !== "string" || call?.status !== "completed" || call.responseRef !== candidate.contentRef) throw new Error("presentation_call_response_changed");
    // Matching IDs alone do not prove matching usage, pricing, or retained bytes.
    mergeProviderSubmissions(saved.providerSubmissions, { [input.call.clientRequestId]: { ...input.call, responseRef: candidate.contentRef } });
    const privateBody = await loadPrivateProviderResponse(env, identity.ownerId, candidate.contentRef, input.projectScope);
    if (!privateBody || privateBody.content !== input.envelope) throw new Error("presentation_call_retention_unavailable");
    return { candidate, call, checkpoint: saved };
  };
  const existing = candidates(checkpoint).find(entry => entry.clientRequestId === input.call.clientRequestId);
  if (existing) return (await exactReplay(checkpoint))!;
  let published: { candidate: Record<string, unknown>; call: PaidProviderSubmission; checkpoint: Record<string, unknown> } | undefined;
  try {
    await storePrivateContent(env, identity.ownerId, "provider-response", input.envelope, input.projectScope, undefined, stored => {
      const candidate: Record<string, unknown> = { ...input.candidate, contentRef: stored.contentId, contentExpiresAt: stored.expiresAt };
      const call = { ...input.call, responseRef: stored.contentId };
      const receipts = mergeProviderSubmissions(checkpoint.providerSubmissions, { [call.clientRequestId]: call });
      const nextCandidates = [...candidates(checkpoint), candidate].slice(-64);
      const next = { ...checkpoint, providerSubmissionProtocol: 1, providerSubmissions: receipts, presentationCandidates: nextCandidates,
        recoverablePresentationCandidate: nextCandidates.some(entry => entry.locallyRecoverable === true),
        ...(checkpoint.presentationProviderClientRequestId === call.clientRequestId ? { presentationProviderSubmission: "confirmed" } : {}) };
      published = { candidate, call, checkpoint: next };
      return [env.DB.prepare(`UPDATE document_jobs SET result_json=? WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=?
        AND status='running' AND NOT EXISTS(SELECT 1 FROM output_operation_slots WHERE job_id=document_jobs.job_id) AND document_id=? AND result_json=? AND request_json=?`)
        .bind(JSON.stringify(next), identity.jobId, identity.ownerId, identity.streamId, identity.correlationId, input.documentId, row.result_json, row.request_json),
        // A zero-row CAS must abort INSIDE the transaction, not after bytes have committed.
        ...outputAssertionStatements(env, { sql: "changes()=1" }),
        ...outputAssertionStatements(env, { sql: `EXISTS(SELECT 1 FROM private_content WHERE content_id=? AND owner_id=? AND kind='provider-response'
          AND redacted_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now'))`, bindings: [stored.contentId, identity.ownerId] })];
    });
  } catch (error) {
    // A lost acknowledgement is not a lost transaction. Recognize the exact
    // already-published response without repeating a provider request or body write.
    const latest = await read(env, identity);
    const saved = latest ? parse(latest.result_json) : {};
    if (latest && !latest.output_slot_id && latest.document_id === input.documentId) {
      const replay = await exactReplay(saved);
      if (replay) return replay;
    }
    throw error;
  }
  if (!published) throw new Error("presentation_call_retention_unavailable");
  return published;
}

/** Late usage can outlive private-source authority. Never restore erased source content. */
export async function retainLegacyPresentationFinancialReceipt(env: WorkerEnv, identity: Identity, receipt: PaidProviderSubmission) {
  if (receipt.status === "pending") return;
  // An explicit allowlist keeps private body references and source text out of a tombstone.
  const financial = Object.fromEntries(PAID_PROVIDER_FINANCIAL_FIELDS.filter(key => receipt[key] !== undefined).map(key => [key, receipt[key]])) as PaidProviderSubmission;
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await read(env, identity);
    if (!row || row.output_slot_id) throw new Error("presentation_call_accounting_unavailable");
    const checkpoint = parse(row.result_json);
    const previous = providerSubmissions(checkpoint).find(call => call.clientRequestId === receipt.clientRequestId);
    // Only an already-recorded exact request may receive monetary evidence.
    if (!previous) throw new Error("presentation_call_evidence_not_admitted");
    const receipts = mergeProviderSubmissions(checkpoint.providerSubmissions, { [receipt.clientRequestId]: financial });
    const durable = receipts[receipt.clientRequestId];
    const patch = { providerSubmissions: receipts, ...(checkpoint.presentationProviderClientRequestId === receipt.clientRequestId ? { presentationProviderSubmission: durable.status === "pending" ? "pending" : "confirmed" } : {}) };
    const next = JSON.stringify({ ...checkpoint, ...patch });
    // Raw-response publication may already have committed this exact receipt.
    // The scoped read and immutable merge still validate replay; no rewrite is needed.
    if (next === row.result_json) return;
    // JSON Merge Patch removes nested nulls, including a legitimately undisclosed
    // reasoning count. Preserve the exact immutable receipt with a full CAS.
    const result = await env.DB.prepare(`UPDATE document_jobs SET result_json=?
      WHERE job_id=? AND owner_id=? AND stream_id=? AND correlation_id=? AND result_json=? AND NOT EXISTS(SELECT 1 FROM output_operation_slots WHERE job_id=document_jobs.job_id)`)
      .bind(next, identity.jobId, identity.ownerId, identity.streamId, identity.correlationId, row.result_json).run();
    if (Number(result.meta.changes ?? 0) === 1) return;
  }
  throw new Error("presentation_call_accounting_conflict");
}
