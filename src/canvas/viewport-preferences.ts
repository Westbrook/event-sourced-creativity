export type CanvasViewportState={zoom:number;cameraX:number;cameraY:number;updatedAt:string};
type CanvasViewportRecord=CanvasViewportState&{schemaVersion:1};
type CanvasViewportStorage=Pick<Storage,"getItem"|"setItem">;

const STORAGE_PREFIX="forma.canvas.viewport.v1";
export const CANVAS_MIN_ZOOM=.15;
export const CANVAS_MAX_ZOOM=2;
const MAX_CAMERA_COORDINATE=1_000_000_000;

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
