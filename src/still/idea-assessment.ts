import type { Position } from './decisions.ts';
export type IdeaAssessmentStatus='Pending'|'Answered'|'Missing response'|'Invalid response'|'Failed'|'Unavailable';
export type IdeaAssessmentCell={status:IdeaAssessmentStatus;probability?:number;reason?:string;assessedAt?:number;cached?:boolean};
export type IdeaAssessmentBlock={id:string;label:string;truncated:boolean;selectionReasons?:string[];actions:Record<string,IdeaAssessmentCell>};
export type IdeaAssessment={scope:{projectId:string;documentId:string;blockId:string;intent:string;head:number};phase:'pending'|'complete';complete:boolean;coverage:{total:number;eligible:number;included:number;omitted:number;assessed:number;cached:number;strategy?:string;omissionReason?:string};blocks:IdeaAssessmentBlock[];actions:Record<string,IdeaAssessmentCell & {targetId?:string;assessed:number;eligible:number}>};
export function matchingIdeaAssessment(report:IdeaAssessment|undefined,position:Pick<Position,'projectId'|'documentId'|'blockId'|'view'|'intent'>,head:number){
 return report&&position.view==='document'&&report.scope.head===head&&report.scope.intent===position.intent&&(['projectId','documentId','blockId'] as const).every(k=>report.scope[k]===position[k])?report:undefined;
}
export function assessmentAge(at:number|undefined,now=Date.now()){
 if(at===undefined)return '';
 const seconds=Math.max(0,Math.floor((now-at)/1000));return seconds<60?`${seconds}s ago`:`${Math.floor(seconds/60)}m ago`;
}

/** Whole-decision cache hits also reuse the enclosed per-idea assessments. */
export function cachedIdeaAssessment(report:IdeaAssessment|undefined,cached:boolean){
 if(!report||!cached)return report;
 const copy=structuredClone(report);
 for(const b of copy.blocks)for(const a of Object.values(b.actions))if(a.status==='Answered')a.cached=true;
 for(const a of Object.values(copy.actions))if(a.status==='Answered')a.cached=true;
 copy.coverage.cached=copy.blocks.filter(b=>Object.values(b.actions).every(a=>a.cached)).length;
 return copy;
}
