import type {IdeaAssessment} from './idea-assessment.ts';
import { evaluateLocalActions, localFormatRules, isIdeaPage, DOCUMENT_RETURN_REASON } from './local-policy.ts';
import type { DecisionCacheInfo } from './decision-cache.ts';
import type { compactHistoryEvent } from './history.ts';
import type { Emphasis } from './presentation.ts';
import { questionComposition, type MenuAdjustment } from './assessments.ts';
import type { CreativeProjection } from '../model/events.ts';
import { evaluateActions, evaluateEligibility, evaluateFormats, rankAllFormats, POLICY_VERSION, questionsFor, type Abilities, type Answer, type Position, type Question } from './decisions.ts';
import { inspectDecisionAnswer as inspectAnswer } from './decision-answer.ts';
export { inspectAnswer };

export type DecisionExchange = {
  requestId:string;
  requestedAt:string;
  request:{model:string;state:unknown;questions:Record<string,Question>};
  responseStatus?:number;
};

export type InspectedQuestion=ReturnType<typeof inspectAnswer>&{id:string;question:Question;asked:boolean};
export type DecisionPass={id:string;parentId?:string;label:string;status:'answered'|'failed'|'skipped';reason?:string;elapsedMs:number;compositionIds:string[];evidenceIds:string[];exchange?:DecisionExchange;model?:string;requestedModel?:string;usage?:Record<string,number>;questions:InspectedQuestion[]};

// The opt-in exchange is the serialized, authorized request body only. Never attach
// provider headers, credentials, arbitrary answer keys, or provider-supplied legends.
export function decisionDiagnostics(p: CreativeProjection, position: Position, abilities: Abilities, options: {
  opportunities?:IdeaAssessment; head: number; source: string; reason?: string; model?: string; answers?: Record<string,Answer>;
  localEvents?: ReturnType<typeof compactHistoryEvent>[]; asked?: boolean; artifactKind?: string; coverage?: unknown; observedAnswers?: Record<string,Answer>; exchange?:DecisionExchange; passes?:DecisionPass[]; presentation?:Record<string,Emphasis>; adjustments?:MenuAdjustment[]; recommended?:string[]; metrics?:Record<string,unknown>;
}) {
  const eligibility=evaluateEligibility(p,position,abilities), candidates=eligibility.filter(r=>r.eligible).map(r=>r.action);
  const questions=questionsFor(candidates,position,options.artifactKind), answers=options.answers??{};
  const formats=position.view==='choose-format'&&!position.palette;
  const evaluation=formats?evaluateFormats(candidates,answers):evaluateActions(candidates,position,answers,p);
  if (formats) {
    const order=rankAllFormats(candidates,answers,{projection:p,position});
    evaluation.selected=order.slice(0,3);
    for (const row of evaluation.rows) {
      const index=order.indexOf(row.id);
      if (index<0) continue;
      row.rank=index+1;row.selected=index<3?index+1:undefined;
      row.reason=index<3?row.reason:row.reason && row.reason!=='Three-format limit'?`Menu · ${row.reason}`:'Menu · lower priority';
    }
  }
  return {
    toolbarNavigation:isIdeaPage(position)&&candidates.some(a=>a.id==='context')?DOCUMENT_RETURN_REASON:undefined,
    localStartingPoint:formats?localFormatRules(p,position).filter(r=>candidates.some(a=>a.id===r.id)).slice(0,3):evaluateLocalActions(candidates,p,position).rows.filter(r=>r.selected).sort((a,b)=>a.selected!-b.selected!).map(r=>({id:r.id,reason:r.localReason??'Local page rule'})),
    version:1 as const, policy:POLICY_VERSION, source:options.source, reason:options.reason, model:typeof options.model==='string'?options.model.slice(0,100):undefined, head:options.head,
    opportunities:options.opportunities,
    channel:position.palette?'palette':formats?'formats':'actions',
    ...(options.exchange?{exchange:options.exchange}:{}),
    passes:options.passes??[],presentation:options.presentation??{},menuAdjustments:options.adjustments??[],metrics:options.metrics??{},
    position:{projectId:position.projectId,documentId:position.documentId,blockId:position.blockId,outputId:position.outputId,view:position.view,...(position.palette?{palette:position.palette}:{}),itemIndex:position.itemIndex??0,hasIntent:!!position.intent.trim(),recentActions:position.recentActions.slice(-12)},
    context:{blocks:p.blocks.filter(b=>!b.removed).length,libraryBlocks:p.libraryBlocks.filter(b=>!b.removed).length,outputs:p.outputs.length,artifacts:p.artifacts.length,coverage:options.coverage,localEvents:options.localEvents},
    recommended:options.recommended??(formats?(evaluation.selected as string[]):(evaluation.selected as {id:string}[]).map(a=>a.id)),
    actions:eligibility.map(row=>{const initial=evaluation.rows.find(r=>r.id===row.action.id),index=options.recommended?.indexOf(row.action.id),change=options.adjustments?.find(a=>a.actionId===row.action.id||a.replacedId===row.action.id);return {...row,...initial,eligibilityReason:row.reason,initialSelection:initial?.selected,...(index!==undefined?{selected:index>=0?index+1:undefined,reason:index>=0?'':change?.replacedId===row.action.id?`Replaced by ${change.actionId}: ${change.reason}`:initial?.reason||'Not selected by final menu'}:{})};}),
    questions:Object.entries(questions).map(([id,question])=>({id,composition:questionComposition(id),question,asked:!!options.asked&&!(options.opportunities&&id.startsWith('benefit_')),derived:!!options.opportunities&&id.startsWith('benefit_'),...inspectAnswer(question,(options.observedAnswers??answers)[id])})),
  };
}
export type DecisionDiagnostics = ReturnType<typeof decisionDiagnostics>;
export type PreparationTiming={source:string;eventsRead:number;head:number;elapsedMs:number;readPages?:number;readMs?:number;cacheReadMs?:number;cacheWriteMs?:number;focusedReadMs?:number;focusedEventsRead?:number;persisted?:boolean;sessionMs:number;selectedContentMs:number;totalMs:number};
export type DecisionDelivery={stage:"initial"|"complete";serverMs:number;cacheWriteMs?:number;firstAssessmentMs?:number;enrichmentMs?:number;enrichment?:"pending"|"complete"|"interrupted"};
export type OriginalTiming={preparation?:PreparationTiming;delivery?:DecisionDelivery};
export type DecisionResponse = { decisionId?:string; assessmentId?:string; expiresAt?:string; retainedActionContext?:boolean; opportunities?:IdeaAssessment; nextBest?:import('./next-best.ts').NextBestAnswer; delivery?:DecisionDelivery; originalTiming?:OriginalTiming; preparation?:PreparationTiming; cache?:DecisionCacheInfo; source:string; reason?:string; model?:string; head:number; policy:string; actions?:{id:string}[]; rankedActions?:{id:string}[]; paletteActions?:{id:string}[]; formats?:string[]; rankedFormats?:string[]; presentation?:Record<string,Emphasis>; targets?:Record<string,string>; resolvedAction?:string; diagnostics?:DecisionDiagnostics; provider?:{requestedModel:string;resolvedModels:string[];usage:Record<string,number>;passes:{id:string;status:string;model?:string;usage?:Record<string,number>;elapsedMs:number}[]}; evidenceExpiresAt?:number };
export type ReceivedDecision = { firstResponseMs?:number; delivery?:DecisionDelivery; originalTiming?:OriginalTiming; preparation?:PreparationTiming; receivedAt?:number; cache?:DecisionCacheInfo; at:string; requestElapsedMs?:number; disposition:string; trace?:DecisionDiagnostics; source:string; reason?:string; recommended:string[] };

export function responseDisposition(result: DecisionResponse, state: { stale:boolean; focused?:boolean; touched?:boolean; head:number; headChanged?:boolean; formats?:boolean }) {
  if(state.stale)return 'Ignored: position, scope, or mode changed';
  if(state.headChanged||result.head!==state.head)return 'Ignored: event head changed';
  if(state.focused)return 'Ignored: preserving focused action';
  if(state.touched)return 'Ignored: format controls already used';
  if(result.policy!==POLICY_VERSION)return 'Ignored: policy mismatch';
  if(state.formats ? result.source!=='jev'||!Array.isArray(result.formats) : !Array.isArray(result.actions)||!result.actions.length&&result.source!=='jev')return 'Kept local controls';
  return 'Applied';
}
