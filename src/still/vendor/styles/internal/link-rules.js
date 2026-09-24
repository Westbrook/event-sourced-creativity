import { css } from 'lit';
import { token as t } from './values.js';
export const linkAppearanceStyles = css `
  .en-link {
    color: ${t('--en-color-link')};
    text-decoration: underline;
    text-underline-offset: ${t('--en-space-0-5')};
    overflow-wrap: break-word;
  }
  .en-link:not([aria-disabled='true']):active { text-decoration-thickness: .2em; }
  .en-link:visited { color: ${t('--en-color-link')}; }
`;
export const linkDisabledStyles = css `.en-link[aria-disabled='true'] { color: ${t('--en-color-text-muted')}; cursor: default; }`;
export const linkForcedColorStyles = css `.en-link, .en-link:visited { color: LinkText; }`;
