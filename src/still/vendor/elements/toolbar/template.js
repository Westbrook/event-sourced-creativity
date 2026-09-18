import { html, nothing } from 'lit';
export const toolbarTemplate = (view) => html `
  <div class="en-toolbar" part="base" role=${view.nativeNavigation ? 'group' : 'toolbar'} aria-label=${view.label}
    data-orientation=${view.orientation === 'vertical' ? 'vertical' : 'horizontal'}
    aria-orientation=${view.nativeNavigation ? nothing : view.orientation === 'vertical' ? 'vertical' : 'horizontal'}>
    <slot @slotchange=${view.onSlotChange}></slot>
  </div>
`;
