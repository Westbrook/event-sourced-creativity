/** A UI client for one server-owned decision. No prices or billing evidence are accepted from the browser. */
export const VIDEO_RECONCILIATION_JOB = "01a040b4-5c90-7ba3-aff1-7af8227dad00";
const operationId = "forma-video-reconciliation-20260911-01a040b4";
const path = "/api/admin/managed-video-reconciliation";
type Command = { treatmentId: string; treatmentSha256: string; snapshotSha256: string; evidenceSha256: string; acknowledgement: string };
type Ports = { ownerId: string; current: () => boolean; changed: () => void; fetch: (url: string, init: RequestInit, current: () => boolean) => Promise<Response> };
type Result = { preview?: Record<string, unknown>; verification?: Record<string, unknown> };
export type ReconciliationState = { status: "idle" | "loading" | "ready" | "applying" | "verified" | "review" | "uncertain" | "unavailable"; receipt: Result | null; error: string | null };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const hash = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
const treatment = (value: unknown) => object(value) && value.id === operationId && value.jobId === VIDEO_RECONCILIATION_JOB
  && value.period === "2026-08" && value.kind === "operator_adjudicated_zero" && value.providerVerified === false
  && value.usedMicrousd === 98484 && value.usedTokens === 15580 && value.unusedMicrousd === 19545516 && value.unusedTokens === 136420;
async function readResponse(response: Response, ownerId: string): Promise<Result> {
  if (!response.ok || !response.headers.get("content-type")?.startsWith("application/json")) {
    await response.body?.cancel(); throw new Error("reconciliation_response_unavailable");
  }
  const reader = response.body?.getReader(); if (!reader) throw new Error("reconciliation_response_unavailable");
  const decoder = new TextDecoder("utf-8", { fatal: true }); let text = "", size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > 131072) throw new Error("reconciliation_response_unavailable");
      text += decoder.decode(value, { stream: true });
    }
    const body: unknown = JSON.parse(text + decoder.decode());
    if (!object(body)) throw new Error("reconciliation_response_unavailable");
    if (object(body.verification) && body.verification.treatmentId === operationId) {
      const v = body.verification;
      if (v.found === false && v.verified === false && v.transactionVerified !== true) return { verification: v };
      if (v.found === true && v.transactionVerified === true && typeof v.verified === "boolean"
        && v.requiresReview === !v.verified && v.providerVerified === false && hash(v.recordSha256)
        && typeof v.createdAt === "string" && Number.isFinite(Date.parse(v.createdAt)) && treatment(v.treatment)
        && object(v.record) && v.record.operatorId === ownerId && treatment(v.record.treatment)
        && hash(v.record.commandSha256) && hash(v.record.treatmentSha256)
        && object(v.record.command) && v.record.command.treatmentId === operationId) return { verification: v };
      throw new Error("reconciliation_response_unavailable");
    }
    if (object(body.preview) && object(body.preview.treatment) && body.preview.treatment.id === operationId
      && body.preview.treatment.jobId === VIDEO_RECONCILIATION_JOB && body.preview.treatment.period === "2026-08"
      && body.preview.treatment.kind === "operator_adjudicated_zero" && body.preview.treatment.providerVerified === false
      && body.preview.treatment.usedMicrousd === 98484 && body.preview.treatment.usedTokens === 15580
      && body.preview.treatment.unusedMicrousd === 19545516 && body.preview.treatment.unusedTokens === 136420
      && [body.preview.treatmentSha256, body.preview.snapshotSha256, body.preview.evidenceSha256].every(value => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value))
      && body.preview.ownerId === ownerId
      && typeof body.preview.acknowledgement === "string" && body.preview.acknowledgement.length < 300) return { preview: body.preview };
    throw new Error("reconciliation_response_unavailable");
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}
export function createVideoReconciliationController() {
  let state: ReconciliationState = { status: "idle", receipt: null, error: null };
  let controller: AbortController | null = null;
  let command: Command | null = null;
  let applyAttempted = false;
  const cancel = () => { controller?.abort(); controller = null; command = null; applyAttempted = false; state = { status: "idle", receipt: null, error: null }; };
  const run = async (mode: "preview" | "verify" | "apply", ports: Ports) => {
    if (!ports.ownerId || !ports.current() || state.status === "loading" || state.status === "applying" || mode === "apply" && (!command || applyAttempted)) return;
    const submitted = command;
    controller?.abort(); const owned = new AbortController(); controller = owned;
    const current = () => controller === owned && !owned.signal.aborted && ports.current();
    state = { ...state, status: mode === "apply" ? "applying" : "loading", error: null }; ports.changed();
    try {
      let result: Result;
      if (mode === "apply") {
        // Consume the apply affordance before dispatch. Every later action verifies
        // this operation; this controller never automatically repeats a POST.
        command = null; applyAttempted = true;
        const response = await ports.fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(submitted), signal: owned.signal, cache: "no-store" }, current);
        if (!current()) { await response.body?.cancel(); return; }
        await readResponse(response, ports.ownerId);
        if (!current()) return;
        const verification = await ports.fetch(path + "?treatmentId=" + operationId, { method: "GET", cache: "no-store", signal: owned.signal }, current);
        result = await readResponse(verification, ports.ownerId);
      } else {
        const url = mode === "verify" ? path + "?treatmentId=" + operationId : path + "?jobId=" + VIDEO_RECONCILIATION_JOB;
        result = await readResponse(await ports.fetch(url, { method: "GET", cache: "no-store", signal: owned.signal }, current), ports.ownerId);
      }
      if (!current()) return;
      if (result.preview) {
        const p = result.preview;
        command = { treatmentId: operationId, treatmentSha256: String(p.treatmentSha256), snapshotSha256: String(p.snapshotSha256),
          evidenceSha256: String(p.evidenceSha256), acknowledgement: String(p.acknowledgement) };
        state = { status: "ready", receipt: result, error: null };
      } else {
        command = null;
        state = { status: result.verification?.verified === true && result.verification.transactionVerified === true ? "verified" : "review", receipt: result, error: null };
      }
    } catch {
      if (!current()) return;
      command = null; state = { status: applyAttempted ? "uncertain" : "unavailable", receipt: null, error: "reconciliation_unavailable" };
    } finally { if (current()) ports.changed(); }
  };
  return { state: () => state, cancel, read: (ports: Ports) => run("preview", ports),
    verify: (ports: Ports) => run("verify", ports), apply: (ports: Ports) => run("apply", ports) };
}
