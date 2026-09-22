import { canonical, hash } from './core.mjs';

/** Translate K's legacy receipt shapes without mutating or upgrading their evidence. */
export function legacyResumeView(receipt) {
  if (!receipt || receipt.status==='completed') return receipt;
  const signals=[receipt.status,receipt.dispatchState,receipt.submissionStatus,receipt.providerSubmission?.status,receipt.detail?.code,receipt.storyboardProviderSubmission,receipt.generationReceipt?.provider_request_status];
  const pending=Object.values(receipt.providerSubmissions??{}).filter(r=>['pending','accepted','uncertain'].includes(r.status));
  const uncertain=signals.some(s=>['pending','submitted','accepted','uncertain','unknown','dispatch_unknown','submission_unknown','confirmed','provider_submission_uncertain'].includes(s)) || pending.length>0 || !signals.includes('rejected')&&(Boolean(receipt.providerRequestId||receipt.providerJobId)||['network','server'].includes(receipt.detail?.category));
  if (!uncertain) return receipt;
  const original=receipt.providerSubmission??(pending.length===1?pending[0]:null);
  return {...receipt,status:'uncertain',provider:original?.provider??receipt.provider,
    providerRequestId:pending.length>1?null:receipt.providerRequestId??receipt.providerJobId??original?.providerRequestId??null};
}

/** A retained request is an immutable purchase, not a cache hint. Never returns permission to submit. */
export function reuseDecision(trial, retained, artifactBytes = null) {
  retained=legacyResumeView(retained);
  if (!retained) return { action:'new_trial_required', generationSubmissions:0, reason:'missing_evidence' };
  const identityMatches=retained.trialId===trial.id && retained.cellId===trial.cellId;
  if (['accepted','submitted','uncertain','dispatch_unknown'].includes(retained.status)) {
    return { action:retained.providerRequestId?'reconcile_original':'hold_unknown_original', originalRequestId:retained.providerRequestId??null, generationSubmissions:0, identityMatches };
  }
  if (retained.status==='completed') {
    const valid=identityMatches && artifactBytes !== null && hash(artifactBytes)===retained.contentHash;
    return { action:valid?'reuse_completed':'hold_completed_evidence_mismatch', generationSubmissions:0, providerCalls:0 };
  }
  return { action:'new_trial_required', generationSubmissions:0, reason:identityMatches?'prior_failure_is_not_retry_permission':'identity_mismatch' };
}
export async function reconcileOriginal(trial, retained, transport, { maxReads = 2, artifactBytes = null } = {}) {
  retained=legacyResumeView(retained);
  const decision=reuseDecision(trial,retained,artifactBytes);
  const counts={generationSubmissions:0,statusReads:0,resultReads:0};
  if(decision.action!=='reconcile_original') return {...decision,counts};
  if (!Number.isInteger(maxReads)||maxReads<0||maxReads>2) throw new Error('bounded_reconciliation_required');
  const identity={provider:retained.provider,providerRequestId:retained.providerRequestId};
  if(!identity.provider) return {...decision,counts,reason:'original_provider_unknown'};
  if(maxReads===0) return {...decision,counts};
  counts.statusReads++;
  // No submit method is read or called, even if supplied by a caller.
  const status=await transport.status(Object.freeze({...identity}));
  if(status.providerRequestId!==identity.providerRequestId || status.provider!==identity.provider) throw new Error('original_request_reconciliation_mismatch');
  if(status.state==='completed'&&maxReads>1){
    counts.resultReads++;
    const result=await transport.result(Object.freeze({...identity}));
    if(canonical({provider:result.provider,providerRequestId:result.providerRequestId})!==canonical(identity)) throw new Error('original_result_identity_mismatch');
    return {...decision,counts,result};
  }
  return {...decision,counts,status};
}
