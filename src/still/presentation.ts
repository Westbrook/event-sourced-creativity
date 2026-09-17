import type { Answer } from './decisions.ts';
import { inspectAnswer } from './diagnostics.ts';
export type Emphasis={variant:'primary'|'secondary'|'ghost';size:'small'|'medium'|'large';tier:'lead'|'peer'|'alternative';reason:string;score?:number;confidence?:number;gap?:number};
export function presentActions(ids:string[],answers:Record<string,Answer>={},prefix='use_'):Record<string,Emphasis>{
  const score=(id:string)=>{const a=answers[prefix+id];return a?.type==='score'&&Number.isFinite(a.score)&&a.score!>=0&&a.score!<=3&&Number.isFinite(a.confidence)&&a.confidence!>=0&&a.confidence!<=1?a:undefined;};
  const first=score(ids[0]),next=Math.max(0,...ids.slice(1).map(id=>score(id)?.score??3));
  const distribution=first?inspectAnswer({type:'score',instructions:'',criteria:['0','1','2','3']},first).probabilities:undefined;
 const gap=first?first.score!-next:0,clear=!!first&&first.score!>=2.6&&first.confidence!>=.8&&gap>=.5&&!!distribution&&(distribution['2']+distribution['3'])>=.8;
  return Object.fromEntries(ids.map((id,index)=>{
    const a=score(id),lead=clear&&index===0,alternative=clear&&!!a&&(a.score!<2||a.confidence!<.55);
    return [id,{variant:lead?'primary':alternative?'ghost':'secondary',size:lead&&ids.length===1?'large':alternative?'small':'medium',tier:lead?'lead':alternative?'alternative':'peer',reason:lead?'Useful, confident leader with a clear score gap':alternative?'Optional alternative':'Similar, uncertain, or unavailable evidence: equal emphasis',score:a?.score,confidence:a?.confidence,gap:index===0?gap:undefined} satisfies Emphasis];
  }));
}
