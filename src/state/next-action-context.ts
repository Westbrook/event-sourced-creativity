import { foldEvents } from "../model/events.ts";
import { scopedFormaActivity } from "../model/activity.ts";
import type { CreativeWorkspaceFacts } from "../model/workspace-intelligence.ts";
import type { FormaStore } from "./store.ts";

/** All consumers use the same authorized canonical projection; no surface-local output store. */
export function nextActionFacts(store:FormaStore,documentId:string,canvasId:string|null=null):CreativeWorkspaceFacts{
  const session=store.session.get(),current=store.projection.get(),authorization=store.captureAuthorizationScope(),context=session?.projectContext;
  const document=current.documents.find((item)=>item.id===documentId&&item.projectId===current.projectId);
  const board=store.canvasProjection.get();
  const scopeValid=Boolean(session&&authorization&&document&&(!context||context.projectId===current.projectId)&&(!canvasId||board.selectedCanvasId===canvasId&&board.canvases.some((item)=>item.id===canvasId&&item.projectId===current.projectId)));
  const permissions=context?.permissions??session?.capabilities??[];
  const canRead=scopeValid&&permissions.includes("project.read");
  const canAuthor=canRead&&permissions.includes("project.author")&&(!context||["owner","editor"].includes(context.role));
  const projection=foldEvents(store.eventView.get(),store.asOf.get(),documentId,current.projectId);
  const activity=scopedFormaActivity(session,current,store.projectNotifications.get(),store.reviewInbox.get(),store.documentJobs.get());
  return{projectId:current.projectId,documentId,canvasId,authorityKey:authorization?.key??"",canRead,canAuthor,canConfigure:canAuthor&&permissions.includes("project.output.request"),blocks:canRead?projection.blocks:[],outputs:canRead?projection.outputs:[],artifacts:canRead?projection.artifacts:[],jobs:canRead?activity.jobs:[],events:canRead?store.eventView.get():[]};
}
