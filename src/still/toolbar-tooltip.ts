import { noChange, type ElementPart } from 'lit';
import { AsyncDirective, directive } from 'lit/async-directive.js';

/** End the owned tooltip's open lifetime before Lit removes its toolbar content. */
class ToolbarTooltip extends AsyncDirective {
 private tooltip?:HTMLElement & {open:boolean};
 render(){return noChange;}
 update(part:ElementPart){this.tooltip=part.element as HTMLElement & {open:boolean};return noChange;}
 protected disconnected(){
  // Author teardown is unconditional; hover/focus dismissal can be canceled.
  // The element's disconnect cleanup releases timers, listeners and the native surface.
  if(this.tooltip)this.tooltip.open=false;
 }
}

export const toolbarTooltip=directive(ToolbarTooltip);
