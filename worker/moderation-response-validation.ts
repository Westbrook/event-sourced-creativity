/** Shared structural validation; JSON size, unique keys, abort and custody remain caller responsibilities. */
const record = (value:unknown): value is Record<string,unknown> => Boolean(value) && typeof value==='object' && !Array.isArray(value);
export function validModerationResults(value:unknown, expectedResultCount:number): boolean {
  if(!Number.isSafeInteger(expectedResultCount)||expectedResultCount<1||!record(value)||value.error!=null||!Array.isArray(value.results)||value.results.length!==expectedResultCount)return false;
  return value.results.every(result=>{
    if(!record(result)||typeof result.flagged!=='boolean'||!record(result.categories)||Object.values(result.categories).some(flag=>typeof flag!=='boolean'))return false;
    if(result.flagged===false&&Object.values(result.categories).some(flag=>flag===true))return false;
    if(result.category_scores!==undefined&&(!record(result.category_scores)||Object.values(result.category_scores).some(score=>typeof score!=='number'||!Number.isFinite(score)||score<0||score>1)))return false;
    return true;
  });
}
