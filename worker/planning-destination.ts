import type { WorkerEnv } from "./runtime.ts";

/** A removed board cannot become a planning destination through a stale admission read. */
export function livePlanningBoardGuard(streamId:string,projectId:string,canvasId:string){
  return{sql:`EXISTS(SELECT 1 FROM events created WHERE created.stream_id=? AND created.type='CanvasCreated'
    AND json_extract(created.payload,'$.project_id')=? AND json_extract(created.payload,'$.canvas_id')=?)
    AND COALESCE((SELECT lifecycle.type FROM events lifecycle WHERE lifecycle.stream_id=?
      AND json_extract(lifecycle.payload,'$.project_id')=? AND json_extract(lifecycle.payload,'$.canvas_id')=?
      AND lifecycle.type IN('CanvasCreated','CanvasRemoved','CanvasRestored') ORDER BY lifecycle.sequence DESC LIMIT 1),'')!='CanvasRemoved'`,bindings:[streamId,projectId,canvasId,streamId,projectId,canvasId]};
}
export async function planningBoardCurrent(env:WorkerEnv,streamId:string,projectId:string,canvasId:string){
  if(!projectId||!canvasId)return false;
  const guard=livePlanningBoardGuard(streamId,projectId,canvasId);
  return Boolean(await env.DB.prepare(`SELECT 1 AS live_canvas WHERE ${guard.sql}`).bind(...guard.bindings).first());
}
