/** Journal-only accounting. A dispatch intent is not proof that a provider received it. */
export function executionSummary(plan,journal) {
  const state=journal.read(),events=journal.events();
  const operations=Object.values(state.operations).filter(o=>o.planId===plan.id);
  const unknown=operations.filter(o=>o.reconciliationAccounting==='unknown'||Object.values(o.stages).some(s=>s.accountingState==='unknown')||Object.values(o.custody).some(s=>s.accountingState==='unknown'));
  const counts={planned:plan.manifest.trials.length,initiated:operations.length,
    dispatched:operations.filter(o=>o.stages.image.status!=='planned').length,
    completed:operations.filter(o=>o.status==='completed').length,blocked:operations.filter(o=>o.status==='hold').length,
    unexecuted:plan.manifest.trials.length-operations.length};
  const stageCounts={};
  for(const stage of ['moderation','image','storage']) {
    const rows=operations.map(o=>o.stages[stage]);
    stageCounts[stage]={planned:counts.planned,initiated:rows.filter(s=>s.status!=='planned').length,
      dispatched:rows.filter(s=>s.status!=='planned').length,completed:rows.filter(s=>s.status==='completed').length,
      unknownAccounting:rows.filter(s=>s.accountingState==='unknown').length,unexecuted:counts.planned-rows.filter(s=>s.status!=='planned').length};
  }
  const own=new Set(operations.map(o=>o.id)),ownEvents=events.filter(e=>own.has(e.operationId));
  for(const [stage,intent,complete,planned] of [
    ['evidenceStorage','custody-intent','custody-checkpoint',counts.planned*9],
    ['reconciliation','reconciliation-intent','reconciliation-receipt',counts.planned*2],
  ]) {
    const started=ownEvents.filter(e=>e.type===intent).length,completed=ownEvents.filter(e=>e.type===complete).length;
    stageCounts[stage]={planned,initiated:started,dispatched:started,completed,unexecuted:planned-started};
  }
  stageCounts.preparation={planned:plan.preparation.required?1:0,initiated:0,dispatched:0,completed:0,unexecuted:plan.preparation.required?1:0};
  return {planId:plan.id,counts,stageCounts,dispatchMeaning:'durable intent; may have reached provider, never proof of receipt',
    maximumConcurrency:1,unknownExposureOperations:unknown.map(o=>o.id),unknownExposureMicrousd:unknown.length?null:0,
    measuredKnownCostMicrousd:operations.reduce((n,o)=>n+o.chargedMicrousd,0),maximumCostMicrousd:plan.maximumCostMicrousd,
    providerEnforcedChargeCap:false,contentSuccessSeparateFromAccounting:true,
    currentContentOutcomes:operations.map(o=>({operationId:o.id,outcome:o.stages.image.contentOutcome,accountingState:o.stages.image.accountingState})),
    note:'Mock receipts are fixture evidence only. No production cost or usable-output measurement.'};
}
