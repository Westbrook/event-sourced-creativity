import { SponsorEntitlementError } from "./experience-sponsor-policy.ts";
import { reserveSponsorAudioOutputReadAttempt, takeSponsorAudioOutputReadAttempt, retireSponsorAudioOutputReadBudget } from "./experience-sponsor-audio-output-attempts.ts";
import { openSponsorAudioOutputReads, discloseSponsorAudioOutputResponse, closeSponsorAudioOutputReads,
  type SponsorAudioOutputReadOwner } from "./experience-sponsor-audio-output-reads.ts";
import { continueSponsorAudioOutputInitial, continueSponsorAudioOutputReviewAuthorize } from "./experience-output-api.ts";
import type { WorkerEnv, WorkerExecutionContext } from "./runtime.ts";

function fail(): never { throw new SponsorEntitlementError("sponsor_audio_output_initial_request_invalid"); }

/** Dormant actual-Request entry. Importing this controller registers no route,
 * selects no campaign and grants no review, admission, Run or result access. */
export async function handleSponsorAudioOutputInitial(request: Request, env: WorkerEnv, executionContext: WorkerExecutionContext): Promise<Response> {
  const url = new URL(request.url), match = /^\/api\/experiences\/drafts\/(experience-draft-[a-f0-9]{64})\/output(\/prepare)?$/u.exec(url.pathname);
  if (!match || url.search || url.hash || request.bodyUsed || request.method !== (match[2] ? "POST" : "GET")) return fail();
  if (match[2]) {
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin || request.headers.get("sec-fetch-site") === "cross-site") return fail();
  }
  const operation = match[2] ? "audio-output-prepare" : "audio-output-state";
  // Both reservations precede parsing the same actual command body. Nested
  // native stages retain this ticket's counters and original absolute lifetime.
  const attempt = await reserveSponsorAudioOutputReadAttempt(request, env, { operation, draftId: match[1]! });
  const budget = await takeSponsorAudioOutputReadAttempt(attempt, request, env);
  let owner: SponsorAudioOutputReadOwner | undefined;
  try {
    owner = await openSponsorAudioOutputReads(request, env, budget);
    const response = await continueSponsorAudioOutputInitial(owner, executionContext);
    return await discloseSponsorAudioOutputResponse(owner, response);
  } finally {
    if (owner) closeSponsorAudioOutputReads(owner);
    else {
      // Opening may already have closed its failed budget. Preserve the native
      // failure while retiring a taken budget if no owner was returned.
      try { retireSponsorAudioOutputReadBudget(budget, request, env); } catch { /* already unavailable */ }
    }
  }
}

/** Dormant continuation for an actual current review or explicit authorization.
 * This registers no public route and never selects a payer from command data. */
export async function handleSponsorAudioOutputReviewAuthorize(request: Request, env: WorkerEnv, executionContext: WorkerExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const review = /^\/api\/experiences\/sponsor\/audio\/drafts\/(experience-draft-[a-f0-9]{64})\/review$/u.exec(url.pathname);
  const authorize = /^\/api\/experiences\/drafts\/(experience-draft-[a-f0-9]{64})\/output\/authorize$/u.exec(url.pathname);
  if (url.search || url.hash || request.bodyUsed || (review ? request.method !== "GET" : !authorize || request.method !== "POST")) return fail();
  if (authorize) {
    const origin = request.headers.get("origin");
    if (origin && origin !== url.origin || request.headers.get("sec-fetch-site") === "cross-site") return fail();
  }
  const draftId = (review ?? authorize)![1]!;
  const operation = review ? "audio-output-review" : "audio-output-authorize";
  const attempt = await reserveSponsorAudioOutputReadAttempt(request, env, { operation, draftId });
  const budget = await takeSponsorAudioOutputReadAttempt(attempt, request, env);
  let owner: SponsorAudioOutputReadOwner | undefined;
  try {
    owner = await openSponsorAudioOutputReads(request, env, budget);
    const response = await continueSponsorAudioOutputReviewAuthorize(owner, executionContext);
    return await discloseSponsorAudioOutputResponse(owner, response);
  } finally {
    if (owner) closeSponsorAudioOutputReads(owner);
    else { try { retireSponsorAudioOutputReadBudget(budget, request, env); } catch { /* Already permanently retired. */ } }
  }
}
