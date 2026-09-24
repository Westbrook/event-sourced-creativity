export type PaginationReason = 'previous' | 'next' | 'page';
export interface PaginationView {
    page: number;
    pageCount: number;
    hasNext: boolean;
    disabled: boolean;
    label: string;
    previousLabel: string;
    nextLabel: string;
    pageLabel: string;
    statusLabel: string;
    unknownStatusLabel: string;
    windowPage?: number;
    directLabel: string;
    pageNumberLabel: string;
    goLabel: string;
    cancelLabel: string;
}
export declare function paginationTemplate(view: PaginationView, change: (page: number, reason: PaginationReason) => boolean, toggleJump: (event: Event) => void, observeJump: (event: Event) => void, dismissJump: (event: KeyboardEvent) => void, closeJump: () => void): import("lit-html").TemplateResult<1>;
