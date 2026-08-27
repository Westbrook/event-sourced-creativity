import { contextDiff, foldEvents, type CreativeEvent, type CreativeOutput } from "./events.ts";

// Completion-time document history is evidence about saved history, not proof of
// the provider's submitted request or the cause of a visual difference.
export function outputComparisonHistory(events:readonly CreativeEvent[],outputs:readonly CreativeOutput[],scope:{projectId:string;documentId:string}){
  const unavailable={available:false,diff:[] as ReturnType<typeof contextDiff>,outputs:[...outputs],tied:false};
  if(outputs.length!==2||new Set(outputs.map((output)=>output.id)).size!==2||outputs.some((output)=>output.documentId!==scope.documentId))return unavailable;
  const ordered=[...events].sort((a,b)=>a.sequence-b.sequence);
  const sides=outputs.map((output)=>{
    const matches=ordered.filter((event)=>event.eventId===output.sourceEventId);
    if(matches.length!==1)return null;
    const receipt=matches[0]!;
    if(!["GenerationCompleted","IdeationPreviewCompleted"].includes(receipt.type)||receipt.sequence!==output.sequence||receipt.payload.document_id&&receipt.payload.document_id!==scope.documentId||receipt.payload.project_id&&receipt.payload.project_id!==scope.projectId)return null;
    const history=foldEvents(ordered,receipt.sequence,scope.documentId,scope.projectId);
    if(history.documentId!==scope.documentId||history.projectId!==scope.projectId)return null;
    const recorded=history.outputs.find((candidate)=>candidate.id===output.id);
    if(!recorded||recorded.sourceEventId!==receipt.eventId||recorded.documentId!==output.documentId||recorded.generationId!==output.generationId||recorded.canvasId!==output.canvasId)return null;
    return{output,receipt,history};
  });
  if(!sides[0]||!sides[1])return unavailable;
  const [earlier,later]=[sides[0],sides[1]].sort((a,b)=>a.receipt.sequence-b.receipt.sequence);
  return{available:true,diff:contextDiff(earlier!.history,later!.history),outputs:[earlier!.output,later!.output],tied:earlier!.receipt.eventId===later!.receipt.eventId};
}
