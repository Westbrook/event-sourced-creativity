import { html } from 'lit';
/** The actual description target is the slotted light-DOM content, not this surface. */
export function tooltipTemplate(view) {
    return html `
    <div class="en-tooltip" part="surface" popover="manual" @toggle=${view.nativeToggle}
      @pointerenter=${view.pointerEnter} @pointerleave=${view.pointerLeave} @pointermove=${view.pointerMove}>
      <slot name="content" @slotchange=${view.contentSlotChange}></slot>
    </div>`;
}
