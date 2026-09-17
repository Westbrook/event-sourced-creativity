import type { Answer } from './decisions.ts';
import { inspectAnswer } from './diagnostics.ts';
export const PRIMARY_POLICY={score:2.4,confidence:.7,gap:.3,usefulProbability:.8};
export type EmphasisEvidence={score?:number;confidence?:number;usefulProbability?:number};
export type Emphasis=EmphasisEvidence&{variant:'primary'|'secondary'|'ghost';size:'small'|'medium'|'large';tier:'lead'|'peer'|'alternative';reason:string;gap?:number};
const valid=(n:number|undefined,max:number):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=max;
const meets=(value:number,minimum:number)=>value+1e-9>=minimum;

/** Compare only the choices on screen, without changing their order or inventing evidence. */
export function presentEvidence(ids:string[],evidence:Record<string,EmphasisEvidence>={}):Record<string,Emphasis>{
  const choices=[...new Set(ids)], scores=choices.map(id=>({id,...evidence[id]}));
  const complete=scores.every(a=>valid(a.score,3)&&valid(a.confidence,1));
  const best=scores.reduce<(typeof scores)[number]|undefined>((leader,a)=>valid(a.score,3)&&(!leader||a.score>leader.score!)?a:leader,undefined);
  const runner=Math.max(0,...scores.filter(a=>a.id!==best?.id).map(a=>valid(a.score,3)?a.score:3));
  const gap=best?best.score!-runner:0,p=PRIMARY_POLICY;
  const failure=!best||!complete?'Missing or invalid score/confidence':!meets(best.score!,p.score)?`Leading score below ${p.score}/3`:!meets(best.confidence!,p.confidence)?`Leading confidence below ${p.confidence*100}%`:!valid(best.usefulProbability,1)?'Leading distribution unavailable or invalid':!meets(best.usefulProbability,p.usefulProbability)?`Useful probability below ${p.usefulProbability*100}%`:!meets(gap,p.gap)?`Lead below ${p.gap} points`:'';
  return Object.fromEntries(scores.map(a=>{
    const lead=!failure&&a.id===best?.id,alternative=!failure&&!lead&&(a.score!<2||a.confidence!<.55);
    return [a.id,{score:a.score,confidence:a.confidence,usefulProbability:a.usefulProbability,gap:a.id===best?.id?gap:undefined,variant:lead?'primary':alternative?'ghost':'secondary',size:lead&&choices.length===1?'large':alternative?'small':'medium',tier:lead?'lead':alternative?'alternative':'peer',reason:lead?`Clear leader: score ${a.score!.toFixed(2)}/3, confidence ${Math.round(a.confidence!*100)}%, lead ${gap.toFixed(2)}`:failure?`Equal emphasis: ${failure}`:alternative?'Optional alternative':'Another visible action has stronger evidence'} satisfies Emphasis];
  }));
}
export function presentActions(ids:string[],answers:Record<string,Answer>={},prefix='use_'):Record<string,Emphasis>{
  const evidence=Object.fromEntries(ids.map(id=>{
    const a=answers[prefix+id],inspected=a?.type==='score'?inspectAnswer({type:'score',instructions:'',criteria:['0','1','2','3']},a):undefined;
    const distribution=inspected?.probabilities;
    return [id,{score:inspected?.score,confidence:inspected?.confidence,usefulProbability:distribution?Math.min(1,distribution['2']+distribution['3']):undefined}];
  }));
  return presentEvidence(ids,evidence);
}
