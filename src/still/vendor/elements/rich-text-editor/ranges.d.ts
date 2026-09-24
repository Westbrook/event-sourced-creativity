import type { Node as PMNode } from 'prosemirror-model';
/** Ordered half-open UTF-16 readable offsets or structured positions, bound to one revision. */
export interface RichRange {
    readonly coordinate: 'text' | 'structured';
    readonly from: number;
    readonly to: number;
    readonly expectedText: string;
    readonly revision: number;
}
export interface RichRangeDecoration {
    readonly id: string;
    readonly range: RichRange;
}
export interface ResolvedRichRange {
    readonly from: number;
    readonly to: number;
}
/** Pure resolution: never move selection or snap a stale, token-cutting or grapheme-cutting passage. */
export declare function resolveRichRange(doc: PMNode, revision: number, range: RichRange): ResolvedRichRange | undefined;
