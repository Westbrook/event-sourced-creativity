/** Optional draft completions, not actions, user intent or independent evidence.
 * This parser is shared by native receipt decoding and the actual resource UI. */
export function memoryResourceNextQuestions(value:unknown):string[]|null{
 if(!Array.isArray(value)||value.length>3||value.some(v=>typeof v!=='string'||!v.isWellFormed()||v.trim()!==v||!v||Array.from(v).length>240||Array.from(v).some(c=>c.charCodeAt(0)<32||c.charCodeAt(0)===127))||new Set(value).size!==value.length)return null;
 return [...value];
}
