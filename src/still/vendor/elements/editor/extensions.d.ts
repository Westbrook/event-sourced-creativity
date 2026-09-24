import type { TokenImportContext } from '../../primitives/interactions/editor-clipboard.js';
export type { TokenImportContext } from '../../primitives/interactions/editor-clipboard.js';
import type { TemplateResult } from 'lit';
import type { ChatEditorData } from '../../primitives/interactions/chat-editor.js';
import type { Run } from '../../primitives/state/token-document.js';
export type TokenRun = Extract<Run, {
    kind: 'token';
}>;
/** data is provider-owned JSON input; en-action receives a detached, deeply immutable snapshot. */
export interface EditorChoice {
    id: string;
    label: string;
    description?: string;
    insert?: readonly Run[];
    action?: string;
    data?: ChatEditorData;
}
export interface EditorQuery {
    query: string;
    signal: AbortSignal;
}
/** Application picker lifecycle, shared by native/external and rendered pickers. */
export interface EditorPickerSession {
    query: string;
    /** Existing token when this session edits an occurrence. */
    token?: TokenRun;
    /** Current viewport rectangle of the edited token, typed trigger or manual caret; falls back to the editor. */
    getAnchorRect(): DOMRectReadOnly;
    /** Hand off to an external picker synchronously while retaining this edit and cancellation signal. */
    openPicker(open: (session: EditorPickerSession) => void): boolean;
    signal: AbortSignal;
    commit(choice: EditorChoice): boolean;
    cancel(): void;
}
export interface EditorExtension {
    id: string;
    trigger: string;
    label: string;
    /** Optional custom boundary matcher; return the matched trigger/query span ending at the caret. */
    match?(textBeforeCaret: string): {
        from: number;
        query: string;
    } | undefined;
    /** Async providers are canceled on query changes; stale results cannot be selected. */
    provide?(context: EditorQuery): readonly EditorChoice[] | Promise<readonly EditorChoice[]>;
    /** Noninteractive option contents; the editor retains role, name, selection and keyboard handling. */
    renderOption?(choice: EditorChoice): TemplateResult;
    /** Optional selection handler. Commit, cancel, or open another picker through the session. */
    select?(choice: EditorChoice, session: EditorPickerSession): void;
    /** Open an application-owned/native picker synchronously from the triggering interaction. */
    open?(session: EditorPickerSession): void;
    /** Interactive custom picker, such as a color input. Focus enters this dialog explicitly with Enter or ArrowDown. Mark a custom element with data-picker-focus and implement focus() to delegate to its first field. */
    render?(session: EditorPickerSession): TemplateResult;
}
/** Return noninteractive token content. Both editors use token.text if absent or if rendering throws. */
export type TokenRenderer = (token: TokenRun) => Node;
/** Optional token behavior; the editor owns the accessible activation wrapper. */
export interface TokenOptions {
    /** Reconcile original source tokens within context.scope. Undefined keeps original readable text. Throwing/invalid hooks fall back to plain text for the entire paste. Destination occurrence IDs remain editor-owned. */
    importToken?(token: TokenRun, context: TokenImportContext): TokenRun | undefined;
    /** Configures a stable button wrapper with token-interactive; disabled until the extension is registered or while the editor is unavailable. */
    extension?: string;
    /** Optional extra CSS Part name on this token type's wrapper. */
    part?: string;
    /** Collapsed adjacent deletion restores the trigger and picker; range deletion still removes. */
    deleteBehavior?: 'remove' | 'edit';
}
/** Explicit capability accepted by en-editor-trigger; independent of an editor backend. */
export interface EditorExtensionHost extends HTMLElement {
    registerExtension(extension: EditorExtension): () => void;
}
/** Minimal selection capability shared by token and rich editors. */
export interface EditorSelectionHost extends HTMLElement {
    captureBookmark(): import('../../primitives/interactions/editor-extensions.js').EditorBookmark;
    restoreBookmark(bookmark: import('../../primitives/interactions/editor-extensions.js').EditorBookmark): boolean;
    replaceBookmark(bookmark: import('../../primitives/interactions/editor-extensions.js').EditorBookmark, runs: readonly Run[]): boolean;
}
