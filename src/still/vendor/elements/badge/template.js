import { html } from 'lit';
export const badgeTemplate = (variant) => html `
  <span class="en-badge" part="base" data-variant=${variant}>
    <slot class="en-badge__prefix" name="prefix"></slot><span class="en-badge__label" part="label"><slot name="label"><slot></slot></slot></span>
  </span>
`;
