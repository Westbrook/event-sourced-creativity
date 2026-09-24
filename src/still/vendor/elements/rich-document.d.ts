/** DOM-free portable rich document boundary. No editor runtime or browser globals. */
import type { ChatEditorData } from '../primitives/interactions/chat-editor.js';
import type { Run } from '../primitives/state/token-document.js';
export type TokenRun = Extract<Run, {
    kind: 'token';
}>;
export interface RichNode {
    readonly type: string;
    readonly attrs?: Readonly<Record<string, ChatEditorData>>;
    readonly text?: string;
    readonly marks?: readonly {
        readonly type: string;
        readonly attrs?: Readonly<Record<string, ChatEditorData>>;
    }[];
    readonly content?: readonly RichNode[];
}
/** Separately versioned block document; never inferred from a token-editor version-1 draft. */
export interface RichDocument {
    readonly type: 'en-rich-text';
    readonly version: 1;
    readonly doc: RichNode;
}
export declare function safeEditorLink(href: string): boolean;
export interface RichDocumentLimits {
    /** RichNode depth including the doc root (depth 1). Default 32. */
    readonly maxDepth?: number;
    /** RichNode count including the doc root. Default 10,000. */
    readonly maxNodes?: number;
    /** UTF-8 bytes of JSON.stringify(input), including envelope and token payloads. Default 1,000,000. */
    readonly maxBytes?: number;
}
/** Decode detached public JSON without a browser. No text normalization or identity inference. */
export declare function decodeRichDocument(input: unknown, limits?: RichDocumentLimits): RichDocument;
/** Same readable projection as the editor: block boundaries and hard breaks are newlines. */
export declare function richDocumentText(value: RichDocument, limits?: RichDocumentLimits): string;
/** Explicit conversion; never interprets plain @ text as identity. */
export declare function richDocumentFromRuns(runs: readonly Run[], limits?: RichDocumentLimits): RichDocument;
