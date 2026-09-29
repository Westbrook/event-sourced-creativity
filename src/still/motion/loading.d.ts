export interface LoadingSurface extends HTMLDivElement {setWaitingProgress(value:number):this;refreshWaitingSurface():this;setInfusionPhase(phase:{position:number;opacity:number}|null):this;}
export function createLoadingSurface(getWidth:()=>number):LoadingSurface;
