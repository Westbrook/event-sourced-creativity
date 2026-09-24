/** Pagination uses safe one-based integer pages; zero totals explicitly mean unknown. */
export declare function normalizePage(value: unknown): number;
export declare function normalizePageCount(value: unknown): number;
export declare function currentPage(page: number, count: number): number;
export type PaginationItem = {
    kind: 'page';
    page: number;
    key: string;
} | {
    kind: 'gap';
    key: string;
};
/** Seven positions keep the navigation geometry stable as the window advances. */
export declare function paginationItems(page: number, count: number): PaginationItem[];
export declare function paginationText(template: string, page: number, count: number): string;
