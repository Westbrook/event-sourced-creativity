import { Slice, type Mark } from 'prosemirror-model';
import { type TokenImportHandler } from '../../primitives/interactions/editor-clipboard.js';
import type { Run } from '../../primitives/state/token-document.js';
export declare function clipboardRuns(slice: Slice): Run[];
export declare function clipboardHTML(slice: Slice): string;
export declare function runsSlice(runs: readonly Run[], marks?: readonly Mark[]): Slice;
/** Validate the rich schema before mapping tokens; never parse application HTML as tokens. */
export declare function importRichClipboard(value: unknown, accept: (type: string) => boolean, used: Set<string>, importToken?: TokenImportHandler): Slice;
/** Detached inert parse; only a small allowlist is copied to a fresh document. */
export declare function externalRichClipboard(html: string, owner: Document): Slice | undefined;
