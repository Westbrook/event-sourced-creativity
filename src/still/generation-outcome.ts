import { documentJobFailure, documentJobCanAcknowledgeSafety, documentJobCanRecoverPresentation, documentJobCanRecoverSingleProviderResult, generationFailureGuidance, type DocumentJob } from '../model/document-jobs.ts';
import { generationPreparationUnavailable } from '../model/generation-service-failure.ts';

/** Presentation only: receipts remain observations; server authorization owns every action. */
export function generationOutcome(job: DocumentJob, content: 'unknown' | 'available' | 'unavailable' = 'unknown') {
  const observed = documentJobFailure({...job, members:job.members ?? []});
  const failure = observed && typeof observed.code === 'string' ? observed : null;
  const receipt = job.result?.generationReceipt as Record<string,unknown> | undefined;
  const submission = receipt?.provider_request_status;
  const serviceBlocked = generationPreparationUnavailable(failure?.code, failure?.message ?? job.error);
  const uncertain = submission === 'submission_unknown' || failure?.code === 'provider_submission_uncertain';
  const recovery = documentJobCanRecoverPresentation(job) ? 'presentation' : documentJobCanRecoverSingleProviderResult(job) ? 'provider' : null;
  const guidance = generationFailureGuidance(failure, job.error ?? '', job);
  const facts: string[] = [];
  if(submission === 'not_submitted') facts.push('No provider request was submitted.');
  else if(submission === 'submitted' || submission === 'completed') facts.push('A provider request was recorded.');
  else if(submission === 'rejected') facts.push('The provider declined this request.');
  else if(job.status === 'failed') facts.push('Provider submission is unconfirmed.');
  if(receipt?.source_transmission_status === 'not_transmitted') facts.push('Your source was not transmitted.');
  if(typeof receipt?.settled_cost_microusd === 'number' && Number.isFinite(receipt.settled_cost_microusd) && receipt.settled_cost_microusd>=0) facts.push(`Recorded usage: $${new Intl.NumberFormat('en-US',{minimumFractionDigits:2,maximumFractionDigits:6}).format(receipt.settled_cost_microusd / 1_000_000)}.`);
  else if(job.status === 'failed') facts.push('Final usage is not recorded.');
  if(receipt?.reservation_status === 'released') facts.push('The reserved allowance was released.');
  let kind = 'unknown', title = guidance.title, summary = guidance.summary;
  let next = 'Review the recorded facts and contact support with the support summary if the cause remains unclear.';
  if(['queued','running','committing'].includes(job.status)){kind='active';title='Generation in progress';summary='This attempt is still running.';next='You can return to Results while it finishes.';}
  else if(job.status === 'completed'){kind=content==='available'?'usable':'saved-content-load-failed';title=content==='available'?'Your generation is ready':'Your generation was saved';summary=content==='available'?'Open your result to view it.':'The result is not available on this page yet.';next=content==='available'?'View your result.':'Reload the saved result. If it remains unavailable, contact support; a new paid request is not needed to reload it.';}
  else if(job.status === 'partial'){kind='partial';title='Part of your generation is ready';summary='Some work finished, but this attempt did not complete.';next='View the available results, then inspect this attempt before deciding whether to request missing work.';}
  else if(serviceBlocked&&!uncertain){kind='service-before-dispatch';title=guidance.title;next='Check service readiness. Once ready, review a new request using your current document. This failed attempt will remain in history.';}
  else if(uncertain){kind='unknown-submission';title='Provider submission is unconfirmed';summary='The provider may have received this request. A second request could duplicate usage.';next='Check the saved status and contact support if submission remains unconfirmed. Status refresh does not submit or reconcile a provider request.';}
  else if(failure?.code==='safety_preflight_flagged'||failure?.pipelineStage==='app_moderation'||documentJobCanAcknowledgeSafety(job)){kind='local-safety-preflight';next='Review the exact request and references. Acknowledge and send only if the offered review matches your intent; the provider still makes its own decision.';}
  else if(failure?.category==='safety'){kind='provider-refusal';next='Review the retained safety explanation and revise the relevant request or references. An undisclosed safety reason cannot be inferred from your document title.';}
  else if(['authentication','access','quota'].includes(failure?.category??'')){kind='account-access';next='Resolve the account or workspace issue described above before requesting another generation.';}
  else if(recovery){kind='provider-result-local-save-failure';next='Recover the original result using its retained receipt. Recovery does not start a new provider generation.';}
  else if(failure?.action==='edit_request'){kind='request-validation';next='Review the specific validation issue above and update the request before generating again.';}
  else if(submission==='not_submitted' && failure?.retryable){kind='temporary-before-dispatch';next='Check service readiness, then explicitly review a new request.';}
  else if(job.status==='canceled'){kind='canceled';title='This generation was canceled';summary='No further work is running for this attempt.';next='Review the receipt before deciding whether to start a new request.';}
  const blockedCategory=['authentication','access','quota'].includes(failure?.category??'');
  return {kind,title,summary,next,facts,serviceBlocked,recovery,uncertain,
    canStartNew:['failed','canceled'].includes(job.status)&&!uncertain&&!recovery&&!blockedCategory&&!documentJobCanAcknowledgeSafety(job),
    supportSummary:JSON.stringify({attemptId:job.jobId,documentId:job.documentId,status:job.status,code:serviceBlocked?'generation_preparation_unavailable':typeof failure?.code==='string'&&/^[a-z0-9_]{1,100}$/.test(failure.code)?failure.code:'unknown',submission:typeof submission==='string'&&['not_submitted','submitted','completed','rejected','submission_unknown'].includes(submission)?submission:'unknown',settledCostMicrousd:typeof receipt?.settled_cost_microusd==='number'&&Number.isFinite(receipt.settled_cost_microusd)&&receipt.settled_cost_microusd>=0?receipt.settled_cost_microusd:null,reservationStatus:typeof receipt?.reservation_status==='string'&&['active','executing','settled','released','not_reserved'].includes(receipt.reservation_status)?receipt.reservation_status:'unknown'},null,2)};
}
