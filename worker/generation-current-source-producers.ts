import { foldEvents, type CreativeEvent } from '../src/model/events.ts';
import { contextSourceHash } from './context-authoring-authority.ts';
import { canonicalConsent, consentHash } from './consequential-consent.ts';
import { currentIdentifier, refuseCurrent as fail } from './generation-current-source-proof.ts';
type Row=Record<string,unknown>;
const record=(v:unknown):Row=>v&&typeof v==='object'&&!Array.isArray(v)?v as Row:{};
const parse=(v:unknown)=>record(JSON.parse(String(v)));
const equal=(a:unknown,b:unknown)=>canonicalConsent(a)===canonicalConsent(b);
const MAX_CELL=2_200_000;
const ids=(v:unknown):string[]=>{if(!Array.isArray(v)||v.length>128||v.some(x=>!currentIdentifier(x)))return fail('producer_references_invalid');return [...new Set(v as string[])];};
/** Current-only producer observation. Complete custody/continuity must have
 * qualified before invocation; no original generation job or source is used. */
export async function readCurrentProducers(input:{events:CreativeEvent[];facts:Row[]; qualifiedSourceEvents:Row[]; owner:string; stream:string; document:string; project:string;
 read:(sql:string,args?:unknown[])=>Promise<Row[]>; readContent:(id:string,kind:string)=>Promise<Row>}) {
 const {events,facts,qualifiedSourceEvents,owner,stream,document,project,read,readContent}=input;
  const candidates = facts.map((fact, factIndex) => ({ fact, factIndex, properties: record(fact.properties) })).filter(f => f.fact.active !== false && f.properties.created_from === 'approved-context-proposal');
  if (!candidates.length) fail('approved_proposal_facts_unavailable');
  if (candidates.length > 16) fail('producer_capacity_exceeded');
  const producerChains: unknown[] = [], seen = new Set<string>();
  for (const candidate of candidates) {
    const created = qualifiedSourceEvents.find(e => e.type === 'BlockCreated' && parse(e.private_json ?? e.payload).block_id === candidate.fact.block_id);
    const prefix = `authoring:${owner}:`;
    if (!created || created.actor !== `user:${owner}` || created.client_id !== 'web:context-approval' || !String(created.correlation_id).startsWith(prefix)) fail('approval_origin_unavailable');
    const previewId = String(created.correlation_id).slice(prefix.length); ids([previewId]);
    if (seen.has(previewId)) continue; seen.add(previewId);
    const receipt = (await read(`SELECT * FROM authoring_commits WHERE preview_id=? AND actor_user_id=? AND operation='context-proposal'
      AND project_id=? AND document_id=? AND organization_id IS NULL AND project_access_id IS NULL AND verified=1
      AND length(CAST(result_json AS BLOB))<=${MAX_CELL}`, [previewId, owner, project, document]))[0];
    if (!receipt) fail('approval_receipt_unavailable');
    const preview = await readContent(previewId, 'authoring-preview'), saved = parse(preview.content), plan = record(saved.plan), binding = record(plan.binding), result = record(plan.result), review = record(plan.review);
    if (saved.state !== 'applied' || !Number.isSafeInteger(plan.sourceHead) || Number(plan.sourceHead) >= Number(created.sequence) || plan.operation !== 'context-proposal' || binding.actorUserId !== owner || binding.streamId !== stream || binding.documentId !== document || binding.projectId !== project || binding.scope !== null
      || receipt.block_id !== binding.blockId || (receipt.canvas_id ?? null) !== (binding.canvasId ?? null)
      || await consentHash(plan) !== receipt.approval_hash || saved.approvalHash !== receipt.approval_hash || !equal(result, parse(receipt.result_json))) fail('approval_binding_mismatch');
    const prefixEvents=events.filter(e=>e.sequence<=Number(plan.sourceHead));
    if(Number(plan.sourceHead)<1||prefixEvents.at(-1)?.sequence!==plan.sourceHead||binding.canvasId!==null)fail('approval_source_boundary_unavailable');
    const prefixProjection=foldEvents(prefixEvents,Infinity,document,project);
    const target=prefixProjection.blocks.find(b=>b.id===binding.blockId);
    if(!target||await contextSourceHash(project,document,target,prefixProjection,prefixEvents)!==binding.sourceHash)fail('approval_source_binding_mismatch');
    const approvalEvents = qualifiedSourceEvents.filter(e => e.correlation_id === created.correlation_id);
    const plannedEvents = Array.isArray(plan.events) ? plan.events.map(record) : [];
    if (!plannedEvents.length || approvalEvents.length > 256 || approvalEvents.length !== plannedEvents.length || approvalEvents.at(-1)?.event_id !== receipt.last_event_id
      || approvalEvents.some((e, i) => e.actor !== `user:${owner}` || e.client_id !== 'web:context-approval' || (i > 0 && Number(e.sequence) !== Number(approvalEvents[i-1].sequence)+1) || e.type !== plannedEvents[i].type || !equal(parse(e.private_json ?? e.payload), plannedEvents[i].payload))) fail('approval_events_mismatch');
    const selections = Array.isArray(review.selections) ? review.selections.map(record) : [];
    const proposals = Array.isArray(review.proposals) ? review.proposals.map(record) : [];
    if (!selections.length || selections.length > 48) fail('approval_selections_unavailable');
    const executions: unknown[] = [];
    for (const executionId of ids(selections.map(s => s.executionId))) {
      const execution = (await read(`SELECT * FROM consequential_executions WHERE execution_id=? AND actor_user_id=? AND stream_id=? AND project_id=? AND document_id=? AND organization_id IS NULL AND project_access_id IS NULL`, [executionId, owner, stream, project, document]))[0];
      if (execution?.status !== 'completed' || !['context-research','context-decompose'].includes(String(execution.operation)) || !execution?.consent_ref || !execution.result_ref) fail('execution_evidence_unavailable');
      const consent = await readContent(String(execution.consent_ref), 'execution-consent'), output = await readContent(String(execution.result_ref), 'context-proposal');
      const consentBody = parse(consent.content), cb = record(consentBody.binding), outputBody = parse(output.content);
      if (cb.operation !== execution.operation || record(consentBody.preview).bindingHash !== execution.binding_hash
        || outputBody.executionId !== executionId || outputBody.bindingHash !== execution.binding_hash || outputBody.sourceHash !== binding.sourceHash
        || cb.streamId !== stream || cb.actorUserId !== owner || cb.projectId !== binding.projectId || cb.documentId !== binding.documentId || cb.blockId !== binding.blockId || (cb.canvasId ?? null) !== (binding.canvasId ?? null)
        || cb.scope !== null || cb.sourceHash !== binding.sourceHash || await consentHash(cb) !== execution.binding_hash || record(consentBody.preview).executionId !== executionId) fail('execution_binding_mismatch');
      for (const selection of selections.filter(s => s.executionId === executionId)) {
        const proposal = proposals.find(p => p.executionId === executionId && p.proposalId === selection.proposalId);
        const report = record(outputBody.report), decomposition = record(outputBody.plan);
        const research = ['inferred', 'related', 'learned'].flatMap(k => Array.isArray(report[k]) ? report[k] as unknown[] : []).map(record).find(p => p.id === selection.proposalId);
        const decomposed = (Array.isArray(decomposition.proposals) ? decomposition.proposals : []).map(record).find(p => p.id === selection.proposalId);
        if (!proposal || selection.bindingHash !== execution.binding_hash || !equal(proposal.edit, selection.edit)
          || (research ? !equal(proposal.research, research) : !decomposed || !equal(proposal.decomposition, { ...decomposed, addendum: Boolean(record(cb.request).addedText) }))) fail('selected_proposal_mismatch');
      }
      executions.push({ execution, consent, output });
    }
    for (const c of candidates.filter(c => qualifiedSourceEvents.some(e => e.correlation_id === created.correlation_id && e.type === 'BlockCreated' && parse(e.private_json ?? e.payload).block_id === c.fact.block_id))) {
      const event = plannedEvents.find(e => e.type === 'BlockCreated' && record(e.payload).block_id === c.fact.block_id), props = record(record(event?.payload).properties);
      if (props.created_from !== 'approved-context-proposal' || props.context_detail !== true || props.authority !== 'authored'
        || props.source_execution_id !== c.properties.source_execution_id || props.source_proposal_id !== c.properties.source_proposal_id
        || !selections.some(s => s.executionId === props.source_execution_id && s.proposalId === props.source_proposal_id)) fail('fact_producer_mismatch');
    }
    producerChains.push({ preview, receipt, approvalEvents, executions });
  }
  const bindings=candidates.map(c=>({kind:'approved-context-proposal-v1' as const,factIndex:c.factIndex,blockId:String(c.fact.block_id),propertiesJson:JSON.stringify(c.properties)}));
  if(bindings.some((b,i)=>!currentIdentifier(b.blockId)||candidates[i].properties.context_detail!==true||candidates[i].properties.authority!=='authored'))fail('fact_producer_mismatch');
  return {producerChains,bindings};
}
