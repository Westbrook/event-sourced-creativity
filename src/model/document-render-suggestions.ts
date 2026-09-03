import type { CreativeEvent } from "./events.ts";
import { documentRenderGuidance } from "./document-render-guidance.ts";

export type DocumentRenderSuggestionField = "audience" | "tone";

const text=(value:unknown)=>String(value??"").trim();
const settings=(value:unknown)=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};

export function documentRenderSuggestions(events:CreativeEvent[],documentId:string,field:DocumentRenderSuggestionField,limit=12){
  const suggestions:string[]=[],seen=new Set<string>();
  for(let index=events.length-1;index>=0&&suggestions.length<limit;index-=1){
    const event=events[index];
    if(String(event.payload.document_id??"")!==documentId)continue;
    const value=event.type==="DocumentRenderRequested"?text(event.payload[field]):event.type==="DocumentRenderCompleted"?text(settings(event.payload.settings)[field]):"";
    if(!value||value==="general"||value==="document-derived"||documentRenderGuidance({[field]:value}).issues.length)continue;
    const key=value.toLocaleLowerCase();if(seen.has(key))continue;seen.add(key);suggestions.push(value);
  }
  return suggestions;
}
