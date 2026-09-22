import { ideasInDocument } from './project-ideas.ts';
import type { CanvasProjection, CanvasItem } from "../canvas/model.ts";
import type { CreativeProjection } from "./events.ts";
import type { DocumentJob } from "./document-jobs.ts";

/** A board may contain many documents. Resolve a unique selection or explicit choice,
 * never array order, the most recently opened unrelated document, or a stale board. */
export function canvasDocumentTarget(projection:CreativeProjection,canvas:CanvasProjection,selectedIds:readonly string[]=[],chosenId=""):string{
  if(!canvas.selectedCanvasId||canvas.projectId!==projection.projectId||!canvas.canvases.some((board)=>board.id===canvas.selectedCanvasId&&board.projectId===projection.projectId))return"";
  const available=new Set(projection.documents.filter((document)=>document.projectId===projection.projectId).map((document)=>document.id));
  const documentsFor=(item:CanvasItem):string[]=>item.sourceKind==="document"?[item.sourceId]:item.sourceKind==="context"?canvas.contextSets.find((set)=>set.id===item.sourceId)?.documentIds??[]:item.sourceKind==="output"?[projection.libraryOutputs.find((output)=>output.id===item.sourceId)?.documentId??""]:item.sourceKind==="artifact"?[projection.libraryArtifacts.find((artifact)=>artifact.id===item.sourceId)?.documentId??""]:projection.documents.filter(document=>ideasInDocument(projection,document.id).some(block=>block.id===item.sourceId)).map(document=>document.id);
  const unique=(items:readonly CanvasItem[])=>[...new Set(items.flatMap(documentsFor).filter((id)=>available.has(id)))];
  // An explicit selection is authoritative even after a collaborator removes it.
  // Dropping unresolved members would silently turn B (or A+B) into another target.
  if(selectedIds.length){
    const selectedItems=selectedIds.map((id)=>canvas.items.find((item)=>item.id===id));
    if(selectedItems.some((item)=>!item))return"";
    const selectedDocuments=selectedItems.flatMap((item)=>documentsFor(item!));
    if(!selectedDocuments.length||selectedDocuments.some((id)=>!available.has(id)))return"";
    const selected=[...new Set(selectedDocuments)];
    return selected.length===1?selected[0]!:"";
  }
  if(chosenId)return available.has(chosenId)?chosenId:"";
  const onBoard=unique(canvas.items);
  if(onBoard.length)return onBoard.length===1?onBoard[0]!:"";
  return available.size===1?[...available][0]!:"";
}

export function documentJobMatchesSurface(job:DocumentJob,surface:{documentId:string;canvasId:string|null;documentView?:string|null}):boolean{
  if(job.documentId!==surface.documentId)return false;
  if(job.canvasId||job.sourceSurface==="canvas")return Boolean(job.canvasId&&surface.canvasId===job.canvasId);
  if(surface.canvasId)return false;
  if(job.kind==="chat")return surface.documentView==="chat";
  if(job.kind==="structure_adaptive")return surface.documentView==="adaptive";
  return true;
}
