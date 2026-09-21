import { noChange, type ChildPart } from 'lit';
import { AsyncDirective, directive } from 'lit/async-directive.js';

type Tooltip = HTMLElement & { open:boolean; surface:HTMLElement|null };

/** Keep the visible and accessible description stable for this tooltip's open lifetime. */
class OnboardingCopy extends AsyncDirective {
 private tooltip?:Tooltip;
 private observer?:MutationObserver;
 private latest='';
 private displayed?:string;
 private get held(){return !!(this.tooltip?.open||this.tooltip?.surface?.matches(':popover-open'));}
 render(copy:string){return copy;}
 update(part:ChildPart,[copy]:[string]){
  const tooltip=(part.parentNode as Element).closest<Tooltip>('en-tooltip')??undefined;
  if(tooltip!==this.tooltip){this.observer?.disconnect();this.tooltip=tooltip;this.displayed=undefined;this.observe();}
  this.latest=copy;
  if(this.held&&this.displayed!==undefined)return noChange;
  this.displayed=copy;
  return copy;
 }
 private flush=()=>{
  if(!this.isConnected||this.held||this.latest===this.displayed)return;
  this.displayed=this.latest;
  this.setValue(this.latest);
 };
 private observe(){
  if(!this.tooltip||!this.isConnected)return;
  // `open` reflects committed state, including silent author writes. en-change
  // is tentative/cancelable, so it must not release copy on a proposed close.
  this.observer??=new MutationObserver(this.flush);
  this.observer.observe(this.tooltip,{attributes:true,attributeFilter:['open']});
 }
 protected disconnected(){this.observer?.disconnect();}
 protected reconnected(){this.observe();this.flush();}
}

export const onboardingCopy=directive(OnboardingCopy);
