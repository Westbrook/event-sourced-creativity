/** Same predicates and SQL three-valued AND semantics, with logarithmic
 * expression depth. This does not evaluate, omit, reorder or grant any proof. */
export function balancedOutputRetainedConjunction(predicates:readonly string[]):string{
 if(!predicates.length)throw new Error("output_retained_witness_empty");
 let level=[...predicates];
 while(level.length>1){
  const next:string[]=[];
  for(let index=0;index<level.length;index+=2)next.push(index+1<level.length?"("+level[index]+" AND "+level[index+1]+")":level[index]!);
  level=next;
 }
 return level[0]!;
}
