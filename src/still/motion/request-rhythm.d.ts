export type Timing={right:number;hold:number;left:number;rest:number;active?:number;total?:number;expand?:number};
export type Frame={stage:'loading'|'waiting';surface:'loading'|'waiting';groupCycle:number;cycleIndex:number;phase:string;phaseProgress:number;waitingProgress:number;shinePosition:number;tint:number;logicalTime:number;cycleTime:number;checkpointNumber:number;openingPending:boolean;status:string;timing:Timing;openAt:number|null};
export const REQUEST_RHYTHM_TIMING:Readonly<Timing>;
export function getRequestGroupDuration(timing?:Timing):number;
export function sampleRequestRhythm(time:number,timing?:Timing):Frame;
export type Options={getTiming?:()=>Timing;isReady?:(f:Frame)=>boolean;canOpen?:(f:Frame)=>boolean;onFrame?:(f:Frame)=>void;onCheckpoint?:(f:Frame & {ready:boolean;eligible:boolean})=>void;onOpen?:(f:Frame)=>void;openPause?:number};
export function createRequestRhythm(options?:Options):{advance:(delta?:number)=>Frame;cancel:()=>Frame;getSnapshot:()=>Frame};
export function startRequestRhythm(options?:Options & {getScale?:()=>number;isSuspended?:()=>boolean;signal?:AbortSignal;requestFrame?:(fn:FrameRequestCallback)=>number;cancelFrame?:(id:number)=>void;now?:()=>number}):{cancel:()=>Frame;sync:()=>Frame;getSnapshot:()=>Frame};
