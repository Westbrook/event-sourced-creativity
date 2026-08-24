export type CanvasViewportState={zoom:number;cameraX:number;cameraY:number;updatedAt:string};
type CanvasViewportRecord=CanvasViewportState&{schemaVersion:1};
type CanvasViewportStorage=Pick<Storage,"getItem"|"setItem">;

const STORAGE_PREFIX="forma.canvas.viewport.v1";
export const CANVAS_MIN_ZOOM=.15;
export const CANVAS_MAX_ZOOM=2;
const MAX_CAMERA_COORDINATE=1_000_000_000;

export type CanvasTouchPoint = { x: number; y: number };
export type CanvasTouchViewport = Pick<CanvasViewportState, "zoom" | "cameraX" | "cameraY">;

/** Keep the same world coordinate under the moving midpoint of a two-finger gesture. */
export function canvasPinchViewport(
  initial: CanvasTouchViewport,
  starting: readonly [CanvasTouchPoint, CanvasTouchPoint],
  current: readonly [CanvasTouchPoint, CanvasTouchPoint],
  origin: CanvasTouchPoint = { x: 0, y: 0 },
): CanvasTouchViewport {
  const values = [initial.zoom, initial.cameraX, initial.cameraY, origin.x, origin.y, ...starting.flatMap((point) => [point.x, point.y]), ...current.flatMap((point) => [point.x, point.y])];
  if (!values.every(Number.isFinite) || initial.zoom <= 0) return { ...initial };

  const initialDistance = Math.hypot(starting[1].x - starting[0].x, starting[1].y - starting[0].y);
  const currentDistance = Math.hypot(current[1].x - current[0].x, current[1].y - current[0].y);
  if (!initialDistance || !currentDistance) return { ...initial };

  const previous = { x: (starting[0].x + starting[1].x) / 2, y: (starting[0].y + starting[1].y) / 2 };
  const next = { x: (current[0].x + current[1].x) / 2, y: (current[0].y + current[1].y) / 2 };
  const zoom = bounded(Math.round(initial.zoom * currentDistance / initialDistance * 1000) / 1000, CANVAS_MIN_ZOOM, CANVAS_MAX_ZOOM);
  const worldX = initial.cameraX + (previous.x - origin.x) / initial.zoom;
  const worldY = initial.cameraY + (previous.y - origin.y) / initial.zoom;

  return {
    zoom,
    cameraX: worldX - (next.x - origin.x) / zoom,
    cameraY: worldY - (next.y - origin.y) / zoom,
  };
}

const bounded=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
const storageKey=(userId:string,canvasId:string)=>`${STORAGE_PREFIX}:${encodeURIComponent(userId||"anonymous")}:${encodeURIComponent(canvasId)}`;

export function normalizeCanvasViewportState(value:unknown):CanvasViewportState|null{
  if(!value||typeof value!=="object")return null;
  const record=value as Partial<CanvasViewportRecord>;
  if(record.schemaVersion!==1||![record.zoom,record.cameraX,record.cameraY].every((item)=>Number.isFinite(item)))return null;
  return{
    zoom:bounded(Number(record.zoom),CANVAS_MIN_ZOOM,CANVAS_MAX_ZOOM),
    cameraX:bounded(Number(record.cameraX),-MAX_CAMERA_COORDINATE,MAX_CAMERA_COORDINATE),
    cameraY:bounded(Number(record.cameraY),-MAX_CAMERA_COORDINATE,MAX_CAMERA_COORDINATE),
    updatedAt:typeof record.updatedAt==="string"&&record.updatedAt?record.updatedAt:new Date(0).toISOString(),
  };
}

export function readCanvasViewportState(storage:CanvasViewportStorage|undefined,userId:string,canvasId:string){
  if(!storage||!canvasId)return null;
  try{
    const serialized=storage.getItem(storageKey(userId,canvasId));
    return serialized?normalizeCanvasViewportState(JSON.parse(serialized)):null;
  }catch{return null;}
}

export function writeCanvasViewportState(storage:CanvasViewportStorage|undefined,userId:string,canvasId:string,state:Omit<CanvasViewportState,"updatedAt">){
  if(!storage||!canvasId)return false;
  const normalized=normalizeCanvasViewportState({schemaVersion:1,...state,updatedAt:new Date().toISOString()});
  if(!normalized)return false;
  try{storage.setItem(storageKey(userId,canvasId),JSON.stringify({schemaVersion:1,...normalized} satisfies CanvasViewportRecord));return true;}catch{return false;}
}
