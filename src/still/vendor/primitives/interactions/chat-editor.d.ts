/** JSON-compatible data detached from an editor's live model. */
export type ChatEditorData = null | boolean | number | string | readonly ChatEditorData[] | {
    readonly [key: string]: ChatEditorData;
};
export interface ChatEditorSnapshot {
    readonly value: string;
    /** Optional application-defined, versioned structured document. */
    readonly content?: ChatEditorData;
}
/** Explicit opt-in for a custom editor slotted into en-chat-composer. */
export interface ChatEditorAdapter {
    readonly value: string;
    readonly disabled?: boolean;
    readonly readOnly?: boolean;
    readonly composing?: boolean;
    focus(options?: FocusOptions): void;
    reportValidity?(): boolean;
    /** Synchronous capture; must not select suggestions or mutate the draft. */
    getSnapshot(): ChatEditorSnapshot;
}
/** Register on the actual slotted editor host. Dispose on teardown. Latest registration wins. */
export declare function registerChatEditor(editor: Element, adapter: ChatEditorAdapter): () => void;
/** Resolve only explicitly registered editors. Ordinary value-bearing elements are not editors. */
export declare function getChatEditorAdapter(editor: Element): ChatEditorAdapter | undefined;
/** Copy and deeply freeze structured data; reject live objects, cycles and lossy JSON values. */
export declare function snapshotChatEditor(snapshot: ChatEditorSnapshot): ChatEditorSnapshot;
/** Detach and deeply freeze JSON-bearing editor action data. Reject cycles, accessors and non-JSON values. */
export declare function snapshotEditorData(data: ChatEditorData): ChatEditorData;
