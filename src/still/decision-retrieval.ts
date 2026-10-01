/** Local retrieval scores order evidence; they are not probabilities or quality judgments. */
export type DecisionRetrievalCandidate<T> = {
  id: string;
  value: T;
  projectId: string;
  documentId?: string;
  category?: string;
  title: string;
  text?: string;
  related?: boolean;
  focused?: boolean;
  changedRecently?: boolean;
};
export type DecisionRetrievalContext = { goal?: string; focusText?: string; projectId?: string; documentId?: string };

const ignoredWords = new Set(['the','and','for','from','with','this','that','into','have','has','are','was','were','will','would','could','should','can','not','but','you','your','our','their','they']);
const tokens = (value: string | undefined) => new Set((value ?? '').slice(0,4000).replace(/https?:\/\/\S+/g,'').toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]{3,}/gu)?.filter(word=>!ignoredWords.has(word)) ?? []);
const overlap = (query: Set<string>, candidate: Set<string>) => Math.min(8,[...query].filter(word=>candidate.has(word)).length);
const compareIds = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

export function selectDecisionEvidence<T>(candidates: readonly DecisionRetrievalCandidate<T>[], context: DecisionRetrievalContext, requestedLimit: number) {
  const limit = Number.isFinite(requestedLimit) ? Math.max(0,Math.floor(requestedLimit)) : 0;
  const goal = tokens(context.goal), focus = tokens(context.focusText);
  const remaining = candidates.map(candidate=>{
    const fields = tokens(`${candidate.title} ${candidate.text ?? ''}`);
    const goalMatches = overlap(goal,fields), focusMatches = overlap(focus,fields);
    const reasons: string[] = [];
    let score = 0;
    if(candidate.focused)reasons.push('current_focus');
    if(goalMatches){score += goalMatches * 4;reasons.push('goal_overlap');}
    if(focusMatches){score += focusMatches * 2;reasons.push('focus_overlap');}
    if(candidate.related){score += 6;reasons.push('explicit_relationship');}
    if(candidate.changedRecently){score += .5;reasons.push('recent_change');}
    if(context.documentId&&candidate.documentId===context.documentId){score += .5;reasons.push('current_document');}
    if(context.projectId&&candidate.projectId===context.projectId){score += .25;reasons.push('current_project');}
    return {candidate,score,reasons};
  });
  const selected: {id:string;value:T;score:number;reasons:string[]}[] = [];
  const documents = new Map<string,number>(), projects = new Map<string,number>(), categories = new Map<string,number>();
  const documentKey = (candidate: DecisionRetrievalCandidate<T>) => candidate.documentId ? `${candidate.projectId}\0${candidate.documentId}` : '';
  const penalty = (candidate: DecisionRetrievalCandidate<T>) => (documents.get(documentKey(candidate)) ?? 0)*3+(projects.get(candidate.projectId) ?? 0)+(candidate.category ? categories.get(candidate.category) ?? 0 : 0)*.5;
  while(selected.length<limit&&remaining.length){
    remaining.sort((a,b)=>Number(!!b.candidate.focused)-Number(!!a.candidate.focused)||(b.score-penalty(b.candidate))-(a.score-penalty(a.candidate))||b.score-a.score||compareIds(a.candidate.id,b.candidate.id));
    const next = remaining.shift()!, candidate = next.candidate, reasons = [...next.reasons];
    if(selected.length&&!projects.has(candidate.projectId))reasons.push('project_diversity');
    if(selected.length&&candidate.documentId&&!documents.has(documentKey(candidate)))reasons.push('document_diversity');
    if(selected.length&&candidate.category&&!categories.has(candidate.category))reasons.push('category_diversity');
    if(!reasons.length)reasons.push('deterministic_coverage');
    selected.push({id:candidate.id,value:candidate.value,score:next.score,reasons});
    projects.set(candidate.projectId,(projects.get(candidate.projectId) ?? 0)+1);
    if(candidate.documentId)documents.set(documentKey(candidate),(documents.get(documentKey(candidate)) ?? 0)+1);
    if(candidate.category)categories.set(candidate.category,(categories.get(candidate.category) ?? 0)+1);
  }
  return {selected,coverage:{candidateTotal:candidates.length,included:selected.length,omitted:candidates.length-selected.length,limit,strategy:'goal-focus-relationships-diversity-v1',omissionReason:candidates.length>selected.length?'bounded_retrieval':null}};
}
