import type { CreativeProjection } from '../model/events.ts';
import { evaluateActions, evaluateEligibility, evaluateFormats, POLICY_VERSION, questionsFor, type Abilities, type Answer, type Position, type Question } from './decisions.ts';

export function inspectAnswer(question: Question, answer?: Answer) {
  const warnings: string[] = [];
  if (!answer) return { status:'Missing answer', warnings };
  const number = (value: unknown, max: number) => typeof value==='number' && Number.isFinite(value) && value>=0 && value<=max ? value : undefined;
  const score = question.type==='score' ? number(answer.score,question.criteria.length-1) : undefined;
  const confidence = question.type!=='noul' ? number(answer.confidence,1) : undefined;
  const noul = question.type==='noul' ? number(answer.noul,1) : undefined;
  const choice = question.type==='choice' && typeof answer.choice==='string' && Object.hasOwn(question.criteria,answer.choice) ? answer.choice : undefined;
  const valid = answer.type===question.type && (question.type==='score' ? score!==undefined&&confidence!==undefined : question.type==='noul' ? noul!==undefined : choice!==undefined&&confidence!==undefined);
  const keys = question.type==='score' ? question.criteria.map((_,i)=>String(i)) : question.type==='choice' ? Object.keys(question.criteria) : [];
  let probabilities: Record<string,number> | undefined;
  if (keys.length) {
    const raw = answer.probabilities;
    if (!raw || typeof raw!=='object' || Array.isArray(raw)) warnings.push('Distribution unavailable');
    else if (keys.some(key=>number(raw[key],1)===undefined) || Object.keys(raw).some(key=>!keys.includes(key))) warnings.push('Invalid distribution');
    else {
      const sum=keys.reduce((n,key)=>n+raw[key],0);
      if(Math.abs(sum-1)>.02) warnings.push('Distribution does not sum to 1');
      else probabilities=Object.fromEntries(keys.map(key=>[key,raw[key]]));
    }
  }
  return { status:valid?'Answered':'Invalid answer', score, confidence, noul, choice, probabilities, warnings };
}

// Pure diagnostics, using the selectors themselves. No full state, secrets, provider headers,
// arbitrary answer keys, or provider-supplied legends are copied to the browser.
export function decisionDiagnostics(p: CreativeProjection, position: Position, abilities: Abilities, options: {
  head: number; source: string; reason?: string; model?: string; answers?: Record<string,Answer>;
  asked?: boolean; artifactKind?: string; coverage?: unknown; observedAnswers?: Record<string,Answer>;
}) {
  const eligibility=evaluateEligibility(p,position,abilities), candidates=eligibility.filter(r=>r.eligible).map(r=>r.action);
  const questions=questionsFor(candidates,position,options.artifactKind), answers=options.answers??{};
  const formats=position.view==='choose-format';
  const evaluation=formats?evaluateFormats(candidates,answers):evaluateActions(candidates,position,answers);
  return {
    version:1 as const, policy:POLICY_VERSION, source:options.source, reason:options.reason, model:typeof options.model==='string'?options.model.slice(0,100):undefined, head:options.head,
    channel:formats?'formats':'actions',
    position:{projectId:position.projectId,documentId:position.documentId,blockId:position.blockId,outputId:position.outputId,view:position.view,itemIndex:position.itemIndex??0,hasIntent:!!position.intent.trim()},
    context:{blocks:p.blocks.filter(b=>!b.removed).length,libraryBlocks:p.libraryBlocks.filter(b=>!b.removed).length,outputs:p.outputs.length,artifacts:p.artifacts.length,coverage:options.coverage},
    recommended:formats?(evaluation.selected as string[]):(evaluation.selected as {id:string}[]).map(a=>a.id),
    actions:eligibility.map(row=>({...row,...evaluation.rows.find(r=>r.id===row.action.id),eligibilityReason:row.reason})),
    questions:Object.entries(questions).map(([id,question])=>({id,question,asked:!!options.asked,...inspectAnswer(question,(options.observedAnswers??answers)[id])})),
  };
}
export type DecisionDiagnostics = ReturnType<typeof decisionDiagnostics>;
export type DecisionResponse = { source:string; reason?:string; model?:string; head:number; policy:string; actions?:{id:string}[]; formats?:string[]; diagnostics?:DecisionDiagnostics };
export type ReceivedDecision = { at:string; disposition:string; trace?:DecisionDiagnostics; source:string; reason?:string; recommended:string[] };

export function responseDisposition(result: DecisionResponse, state: { stale:boolean; focused?:boolean; touched?:boolean; head:number; headChanged?:boolean; formats?:boolean }) {
  if(state.stale)return 'Ignored: position, scope, or mode changed';
  if(state.headChanged||result.head!==state.head)return 'Ignored: event head changed';
  if(state.focused)return 'Ignored: preserving focused action';
  if(state.touched)return 'Ignored: format controls already used';
  if(result.policy!==POLICY_VERSION)return 'Ignored: policy mismatch';
  if(state.formats ? result.source!=='jev'||!Array.isArray(result.formats) : !Array.isArray(result.actions)||!result.actions.length&&result.source!=='jev')return 'Kept local controls';
  return 'Applied';
}
