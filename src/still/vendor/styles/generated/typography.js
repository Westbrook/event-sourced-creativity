// Generated from src/css/typography.css; edit the CSS source.
import { css } from 'lit';
import { sizedStyles } from '../internal/sizing.js';
export const typographyStyles = sizedStyles(css `.en-body, .en-prose, .en-heading-small, .en-heading-medium, .en-heading-large, .en-metadata, .en-data {
  margin: 0;
  overflow-wrap: break-word;
}
.en-body, .en-prose {
  color: var(--en-color-text, rgb(27 31 36 / 1));
    font: var(--en-font-body-weight, 400) var(--_en-sized-font-body-size, var(--en-font-body-size, 1rem)) / var(--en-font-body-line-height, 1.5) var(--en-font-body-family, system-ui, sans-serif);
  font-style: var(--en-font-body-style, normal);
  letter-spacing: var(--en-font-body-tracking, 0px);
}
.en-prose {
  max-inline-size: var(--en-prose-max-inline-size, var(--en-layout-prose-max, 66ch));
}
.en-prose :where(p, ul, ol, dl, blockquote) { margin-block: 0 var(--en-space-4, 1rem); }
.en-prose :where(ul, ol) { padding-inline-start: var(--en-space-6, 1.5rem); }
.en-heading-small {
    font: var(--en-font-heading-small-weight, 600) var(--_en-sized-font-heading-small-size, var(--en-font-heading-small-size, 1.125rem)) / var(--en-font-heading-small-line-height, 1.4) var(--en-font-heading-small-family, system-ui, sans-serif);
  font-style: var(--en-font-heading-small-style, normal);
  letter-spacing: var(--en-font-heading-small-tracking, 0px);
}
.en-heading-medium {
    font: var(--en-font-heading-medium-weight, 600) var(--_en-sized-font-heading-medium-size, var(--en-font-heading-medium-size, 1.5rem)) / var(--en-font-heading-medium-line-height, 1.3) var(--en-font-heading-medium-family, system-ui, sans-serif);
  font-style: var(--en-font-heading-medium-style, normal);
  letter-spacing: var(--en-font-heading-medium-tracking, 0px);
}
.en-heading-large {
    font: var(--en-font-heading-large-weight, 600) var(--_en-sized-font-heading-large-size, var(--en-font-heading-large-size, 2rem)) / var(--en-font-heading-large-line-height, 1.2) var(--en-font-heading-large-family, system-ui, sans-serif);
  font-style: var(--en-font-heading-large-style, normal);
  letter-spacing: var(--en-font-heading-large-tracking, 0px);
}
.en-metadata {
  color: var(--en-color-text-muted, rgb(86 97 113 / 1));
    font: var(--en-font-metadata-weight, 400) var(--_en-sized-font-metadata-size, var(--en-font-metadata-size, 0.8125rem)) / var(--en-font-metadata-line-height, 1.5) var(--en-font-metadata-family, system-ui, sans-serif);
  font-style: var(--en-font-metadata-style, normal);
  letter-spacing: var(--en-font-metadata-tracking, 0px);
}
.en-data {
    font: var(--en-font-data-weight, 400) var(--_en-sized-font-data-size, var(--en-font-data-size, 0.875rem)) / var(--en-font-data-line-height, 1.5) var(--en-font-data-family, system-ui, sans-serif);
  font-style: var(--en-font-data-style, normal);
  letter-spacing: var(--en-font-data-tracking, 0px);
  font-variant-numeric: tabular-nums;
}
`);
