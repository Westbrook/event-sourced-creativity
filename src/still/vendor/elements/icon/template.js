import { html, svg, nothing } from 'lit';
export const icons = {
    bold: svg `<path d="M7 4h6a4 4 0 0 1 0 8H7V4Zm0 8h7a4 4 0 0 1 0 8H7v-8Z" />`,
    italic: svg `<path d="M10 4h9M5 20h9M15 4 9 20" />`,
    heading: svg `<path d="M5 4v16M19 4v16M5 12h14" />`,
    paragraph: svg `<path d="M13 4H9a5 5 0 0 0 0 10h4M13 4v16M18 4v16M9 4h12" />`,
    'bullet-list': svg `<circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /><path d="M9 6h12M9 12h12M9 18h12" />`,
    'ordered-list': svg `<path d="m3 4 1-1v6M3 9h3M3 15a1.5 1.5 0 0 1 3 0c0 1-3 3-3 4h3M10 6h11M10 12h11M10 18h11" />`,
    link: svg `<path d="M10 13a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-2 2M14 11a4 4 0 0 0-6 0l-4 4a4 4 0 0 0 6 6l2-2" />`,
    unlink: svg `<path d="m12 5 2-2a4 4 0 0 1 6 6l-2 2M6 13l-2 2a4 4 0 0 0 6 6l2-2M3 3l18 18" />`,
    undo: svg `<path d="M9 4 3 10l6 6M3 10h11a6 6 0 0 1 0 12" transform="translate(0 -2)" />`,
    redo: svg `<path d="m15 4 6 6-6 6M21 10H10a6 6 0 0 0 0 12" transform="translate(0 -2)" />`,
    file: svg `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" /><path d="M14 2v6h6M8 13h8M8 17h5" />`,
    calendar: svg `<rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M7 3v4m10-4v4M3 11h18"></path>`,
    check: svg `<path d="m5 12 4 4L19 6" />`,
    plus: svg `<path d="M12 5v14M5 12h14" />`,
    close: svg `<path d="m6 6 12 12M18 6 6 18" />`,
    'chevron-left': svg `<path d="m15 6-6 6 6 6" />`,
    'chevron-right': svg `<path d="m9 6 6 6-6 6" />`,
    'chevron-down': svg `<path d="m6 9 6 6 6-6" />`,
    'arrow-right': svg `<path d="M4 12h16m-6-6 6 6-6 6" />`,
    search: svg `<circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" />`,
    info: svg `<circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10v1" />`,
    warning: svg `<path d="m12 3 10 18H2L12 3Zm0 6v5m0 3v1" />`,
    sparkles: svg `<path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3ZM20 2v4m-2-2h4" />`,
};
export const iconTemplate = (name, label) => html `
  <svg
    class="en-icon"
    part="base"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-linecap="round"
    stroke-linejoin="round"
    focusable="false"
    role=${label ? 'img' : nothing}
    aria-label=${label || nothing}
    aria-hidden=${label ? nothing : 'true'}
  >${icons[name] ?? nothing}</svg>
`;
