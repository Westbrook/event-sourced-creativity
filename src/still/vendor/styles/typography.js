import { css } from 'lit';
import { token as t, override as o } from './internal/values.js';
import { sizedStyles } from './internal/sizing.js';
/** Public, opt-in typography for consumer-owned HTML; visual size does not assign semantics. */
export const typographyStyles = sizedStyles(css `
  .en-body, .en-prose, .en-heading-small, .en-heading-medium, .en-heading-large, .en-metadata, .en-data {
    margin: 0;
    overflow-wrap: break-word;
  }
  .en-body, .en-prose {
    color: ${t('--en-color-text')};
    font: ${t('--en-font-body-weight')} ${t('--en-font-body-size')} / ${t('--en-font-body-line-height')} ${t('--en-font-body-family')};
  }
  .en-prose {
    max-inline-size: ${o('--en-prose-max-inline-size', t('--en-layout-prose-max'))};
  }
  .en-prose :where(p, ul, ol, dl, blockquote) { margin-block: 0 ${t('--en-space-4')}; }
  .en-prose :where(ul, ol) { padding-inline-start: ${t('--en-space-6')}; }
  .en-heading-small {
    font: ${t('--en-font-heading-small-weight')} ${t('--en-font-heading-small-size')} / ${t('--en-font-heading-small-line-height')} ${t('--en-font-heading-small-family')};
  }
  .en-heading-medium {
    font: ${t('--en-font-heading-medium-weight')} ${t('--en-font-heading-medium-size')} / ${t('--en-font-heading-medium-line-height')} ${t('--en-font-heading-medium-family')};
  }
  .en-heading-large {
    font: ${t('--en-font-heading-large-weight')} ${t('--en-font-heading-large-size')} / ${t('--en-font-heading-large-line-height')} ${t('--en-font-heading-large-family')};
  }
  .en-metadata {
    color: ${t('--en-color-text-muted')};
    font: ${t('--en-font-metadata-weight')} ${t('--en-font-metadata-size')} / ${t('--en-font-metadata-line-height')} ${t('--en-font-metadata-family')};
  }
  .en-data {
    font: ${t('--en-font-data-weight')} ${t('--en-font-data-size')} / ${t('--en-font-data-line-height')} ${t('--en-font-data-family')};
    font-variant-numeric: tabular-nums;
  }
`);
