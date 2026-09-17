import { exactKeys, freeze, jsonIssues, record } from "../src/experiences/compiler.ts";
import { acquireGuestClaimLease } from "./experience-guest-claim-lease.ts";
import { adoptGuestContextSource, guestContextAdoptionData, inspectGuestContextAdoption, readGuestContextAdoption } from "./experience-guest-context-adoption.ts";
import { inspectGuestContextInventory } from "./experience-guest-context-inventory.ts";
import { retainGuestContextPlan } from "./experience-guest-plan-custody.ts";
import { guestFail, guestHash, guestId, type GuestClaimProof } from "./experience-guest-session.ts";
import type { WorkerEnv } from "./runtime.ts";

export type GuestContextClaimRequest = Readonly<{ sessionId: string; requestId: string; approvedManifestDigest: string; proof?: GuestClaimProof }>;
type Receipt = NonNullable<Awaited<ReturnType<typeof readGuestContextAdoption>>>;

/** Dormant internal context-only coordination. No public route, identity
 * bootstrap, cookie mutation, generated-result custody or provider authority. */
export async function claimGuestContext(request: Request, env: WorkerEnv, input: GuestContextClaimRequest) {
  if (jsonIssues(input).length || !record(input) || !exactKeys(input, ["sessionId", "requestId", "approvedManifestDigest", ...(Object.hasOwn(input, "proof") ? ["proof"] : [])])
    || !guestId(input.sessionId) || !guestId(input.requestId) || !guestHash(input.approvedManifestDigest)) return guestFail("claim_invalid");
  const captured = structuredClone(input), db = env.DB, url = new URL(request.url), site = request.headers.get("sec-fetch-site");
  if (request.method !== "POST" || url.protocol !== "https:" || url.username || url.password || url.search || url.hash
    || request.headers.get("origin") !== url.origin || (site !== null && site !== "same-origin" && site !== "none")) return guestFail("origin_required");
  if (Object.hasOwn(captured, "proof") && (!record(captured.proof) || !exactKeys(captured.proof, ["sessionId", "sessionToken", "claimToken"])
    || captured.proof.sessionId !== captured.sessionId || typeof captured.proof.sessionToken !== "string" || typeof captured.proof.claimToken !== "string"
    || !/^forma-guest-session-v1\.[a-f0-9]{64}$/u.test(captured.proof.sessionToken)
    || !/^forma-guest-claim-v1\.[a-f0-9]{64}$/u.test(captured.proof.claimToken))) return guestFail("claim_invalid");
  const bound = () => { if (env.DB !== db) guestFail("database_changed"); if (request.signal.aborted) guestFail("claim_aborted"); };
  const exact = (receipt: Receipt) => {
    if (receipt.sessionId !== captured.sessionId || receipt.requestId !== captured.requestId || receipt.manifestDigest !== captured.approvedManifestDigest) return guestFail("claim_conflict");
    return receipt;
  };
  const completed = async () => { bound(); const saved = await readGuestContextAdoption(request, env, { sessionId: captured.sessionId }); bound(); return saved ? exact(saved) : null; };
  // Successful custody revokes guest authority. Completed canonical recovery
  // must therefore precede any requirement for the old browser credentials.
  let receipt = await completed(); bound();
  if (!receipt) {
    if (!captured.proof) return guestFail("proof_unavailable");
    try {
      const inventory = await inspectGuestContextInventory(request, env, { proof: captured.proof }); bound();
      if (inventory.sessionId !== captured.sessionId || inventory.manifestDigest !== captured.approvedManifestDigest) return guestFail("claim_conflict");
      const lease = await acquireGuestClaimLease(request, env, { proof: captured.proof, requestId: captured.requestId, manifestDigest: inventory.manifestDigest }); bound();
      receipt = exact(await adoptGuestContextSource(request, env, { inventory, leaseId: lease.leaseId, requestId: captured.requestId })); bound();
    } catch (error) {
      // Recover only an actual exact completed receipt after an uncertain
      // acknowledgment. Never retry a lease, mutation or new inventory here.
      bound(); receipt = await completed(); bound(); if (!receipt) throw error;
    }
  }
  const witness = await inspectGuestContextAdoption(request, env, { sessionId: captured.sessionId }); bound();
  if (!witness) return guestFail("adoption_unavailable");
  // The returned receipt is this current canonical reread. Its replayed flag
  // does not claim that adoption predated this coordinator invocation.
  const data = guestContextAdoptionData(env, witness); receipt = exact(data.result);
  const lineageDigest = data.row.lineage_digest;
  let retained: Awaited<ReturnType<typeof retainGuestContextPlan>>;
  try {
    // Keep this the final awaited success operation: it proves current native
    // custody AND the retained private plan together at its own final SQL read.
    retained = await retainGuestContextPlan(request, env, { sessionId: captured.sessionId }); bound();
  } catch {
    // A failed/expired copy cannot roll back already completed context custody.
    // Reauthorize the source-free receipt; never disclose an older private plan
    // after only checking the context baseline or disguise revoked access as success.
    bound(); const current = await completed(); bound(); if (!current) return guestFail("adoption_unavailable");
    return freeze({ version: 1 as const, status: "context-claimed" as const, contextCustodyTransferred: true as const,
      generationAvailable: false as const, miniAppClaimComplete: false as const, receipt: current, planRetention: "unavailable" as const });
  }
  const custody = retained.custody;
  if (custody.sessionId !== receipt.sessionId || custody.destinationUserId !== receipt.destinationUserId
    || custody.manifestDigest !== receipt.manifestDigest || custody.lineageDigest !== lineageDigest
    || custody.projectId !== receipt.projectId || custody.documentId !== receipt.documentId
    || custody.head !== receipt.head || custody.eventIds.join("\n") !== receipt.eventIds.join("\n")) return guestFail("claim_conflict");
  return freeze({ version: 1 as const, status: "context-claimed" as const, contextCustodyTransferred: true as const,
    generationAvailable: false as const, miniAppClaimComplete: false as const, receipt, planRetention: "retained" as const, retained });
}
