import type { VirtualCollection } from '../state/virtual-collection.js';
interface VirtualRowOptions<T> {
    /** Optional author-owned presentation and state; stable DOM identity comes from the model key. */
    rowClass?: (item: T, index: number) => string;
}
export interface VirtualListRowsOptions<T> extends VirtualRowOptions<T> {
    renderItem: (item: T, index: number) => unknown;
}
export interface VirtualTableRowsOptions<T> extends VirtualRowOptions<T> {
    rowSelected?: (item: T, index: number) => boolean | undefined;
    /** Number of native columns; virtual rows with row/column spans are not supported. */
    columns: number;
    /** Return native td/th cells, not a second tr wrapper. */
    renderCells: (item: T, index: number) => unknown;
    /** Include every persistent header row in the table's aria-rowcount and index those rows too. */
    headerRows?: number;
}
/** Native list adapter. Use a margin/padding-free list with no row gaps or collapsing margins. */
export declare function virtualListRows<T>(model: VirtualCollection<T>, options: VirtualListRowsOptions<T>): unknown;
/** Native tbody adapter. The containing table owns aria-rowcount and fixed column geometry. */
export declare function virtualTableRows<T>(model: VirtualCollection<T>, options: VirtualTableRowsOptions<T>): unknown;
export {};
