import { type Run } from '../state/token-document.js';
/** Browser clipboard interoperability, independently versioned from saved drafts. */
export declare const editorClipboardType = "application/x-en-editor+json";
export declare const editorClipboardLimit = 1000000;
export interface EditorClipboard {
    type: 'en-editor-clipboard';
    version: 1;
    runs: readonly Run[];
    rich?: unknown;
}
/** Reject oversized/deep payloads before walking application data or editor nodes. */
export declare function boundedClipboardJSON(text: string): unknown;
export declare function validateClipboardRuns(value: unknown): readonly Run[];
export declare function readEditorClipboard(data: Pick<DataTransfer, 'getData'>): EditorClipboard | undefined;
/** One opaque scope object is shared by every hook in one paste. Use a WeakMap for per-paste reconciliation. */
export interface TokenImportContext {
    readonly scope: object;
    readonly sourceId: string;
    /** Index in the original run sequence, including text runs. */
    readonly sourceIndex: number;
    /** Detached, frozen source token occurrences in clipboard order. */
    readonly sourceTokens: readonly Extract<Run, {
        kind: 'token';
    }>[];
}
export type TokenImportHandler = (token: Extract<Run, {
    kind: 'token';
}>, context: TokenImportContext) => Extract<Run, {
    kind: 'token';
}> | undefined;
/** Hooks see original occurrences. Validate all results before callers commit; errors abort structured import. */
export declare function importClipboardRuns(runs: readonly Run[], accept: (type: string) => boolean, used?: ReadonlySet<string>, importToken?: TokenImportHandler): Run[];
export declare function sliceClipboardRuns(runs: readonly Run[], from: number, to: number): Run[];
/** Plain text is mandatory; custom MIME is best effort for browsers/apps that strip it. */
export declare function writeEditorClipboard(data: Pick<DataTransfer, 'setData'>, runs: readonly Run[], rich?: unknown, html?: string): boolean;
