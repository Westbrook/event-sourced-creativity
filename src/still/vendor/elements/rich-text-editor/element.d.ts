import { type EditorMessages } from '../editor/messages.js';
import type { ChangeEvent } from '../../primitives/interactions/events.js';
import type { EditorEventMap } from '../editor/events.js';
export type { EditorInputEvent, EditorActionEvent } from '../editor/events.js';
import { type PropertyValues } from 'lit';
import { EnElement } from '../internal/en-element.js';
import { type RichRange, type RichRangeDecoration } from './ranges.js';
export type { RichRange, RichRangeDecoration } from './ranges.js';
export interface RichRangeReplacement {
    readonly range: RichRange;
    readonly runs: readonly Run[];
}
import { type EditorBookmark } from '../../primitives/interactions/editor-extensions.js';
import { type Run } from '../../primitives/state/token-document.js';
import { richDocumentFromRuns, type RichDocument } from './document.js';
import type { EditorExtension, TokenRenderer, TokenOptions } from '../editor/extensions.js';
export type { RichDocument, RichNode } from './document.js';
export { richDocumentFromRuns };
export type RichEditorCommand = 'bold' | 'italic' | 'paragraph' | 'heading' | 'bullet-list' | 'ordered-list' | 'link' | 'unlink' | 'undo' | 'redo';
export interface RichCommandState {
    readonly enabled: boolean;
    readonly active: boolean;
    readonly mixed: boolean;
}
export type RichTextEditorChangeReason = 'input' | 'extension' | 'paste' | 'cut' | RichEditorCommand;
export type RichTextEditorChangeEvent = ChangeEvent<RichDocument, RichTextEditorChangeReason>;
export interface RichTextEditorEventMap extends EditorEventMap {
    'en-change': RichTextEditorChangeEvent;
    'en-editor-state': CustomEvent<null>;
    /** Direct-host association protocol: cancelable, not bubbling or composed. */
    'en-toolbar-request': CustomEvent<null>;
}
/**
 * Optional block editor with application-owned reference/tool/picker extensions.
 * @cssprop --en-editor-token-pressed-scale - editor-token held-state refinement; geometry is bounded and reduced motion wins.
 * @cssprop --en-editor-token-pressed-offset - editor-token held-state refinement; geometry is bounded and reduced motion wins.
 * @cssprop --en-editor-token-press-duration - editor-token held-state refinement; geometry is bounded and reduced motion wins.
 * @cssprop --en-editor-token-release-duration - editor-token held-state refinement; geometry is bounded and reduced motion wins.
 * @cssprop --en-editor-token-pressed-shadow - editor-token held-state refinement; geometry is bounded and reduced motion wins.
 * @cssprop --en-editor-token-pressed-color - editor-token held-state refinement; geometry is bounded and reduced motion wins.
 * @cssprop --en-editor-token-pressed-border-color - editor-token held-state refinement; geometry is bounded and reduced motion wins.
 * @tagname en-rich-text-editor
 * @slot description - Supporting content; replaces the description attribute/property fallback.
 * @csspart description - Supporting content below the editing surface.
 * @slot label - Visible label; label supplies the accessible textbox name.
 * @csspart label - Visible editor label.
 * @csspart control - Semantic multiline editing surface.
 * @csspart range-decoration - Revision-bound passage highlight.
 * @csspart token - Atomic inline token wrapper, sharing token-editor theme hooks.
 * @csspart token-interactive - Token wrappers configured with an edit extension; disabled while unavailable.
 * @csspart token-content - Noninteractive token contents, including custom renderer output.
 * @csspart popup - Extension list/picker surface.
 * @csspart option - Extension suggestion.
 * @cssprop --en-input-background - Editing surface paint; refines shared control background.
 * @cssprop --en-input-color - Editing foreground; refines shared control color.
 * @cssprop --en-input-inline-padding - Editing inset; refines shared control inline padding.
 * @cssprop --en-field-gap - Space between label and editor.
 * @cssprop --en-option-list-max-block-size - Suggestion list ceiling, further constrained by available viewport space.
 * @cssprop --en-option-list-gap - Space between standard suggestion rows.
 * @cssprop --en-option-list-padding - Suggestion inset, with focus clearance.
 * @cssprop --en-option-list-radius - Suggestion surface radius.
 * @cssprop --en-option-list-color - Suggestion foreground, falling back through overlay color.
 * @cssprop --en-option-block-padding - Standard suggestion row block padding.
 * @cssprop --en-option-inline-padding - Standard suggestion row inline padding.
 * @cssprop --en-option-radius - Standard suggestion row radius, otherwise concentric with its list.
 * @cssprop --en-editor-max-size - Maximum editor block size before scrolling.
 * @cssprop --en-editor-token-radius - Inline token contour.
 * @cssprop --en-editor-token-background - Inline token background.
 * @cssprop --en-editor-token-color - Inline token foreground.
 * @cssprop --en-editor-token-border-color - Token boundary color.
 * @cssprop --en-editor-token-hover-background - Hover-capable token action background.
 * @cssprop --en-editor-token-pressed-background - Pressed token action background.
 * @cssprop --en-editor-token-inline-padding - Inline token padding.
 * @cssprop --en-editor-token-block-padding - Block token padding.
 * @cssprop --en-editor-token-gap - Space between adjacent tokens.
 * @cssprop --en-editor-token-min-size - Minimum token size; interactive target floors still apply.
 * @fires {RichTextEditorChangeEvent} en-change - Cancelable rich document transaction with previous/proposed and reason.
 * @fires {EditorInputEvent} en-input - Native draft input, including composition state.
 * @fires {EditorActionEvent} en-action - Cancelable application extension action.
 * @fires {CustomEvent<null>} en-toolbar-request - Cancelable direct-host toolbar association protocol; does not bubble or cross roots.
 * @fires {CustomEvent<null>} en-editor-state - Document/selection/availability changed; toolbar consumers reread state.
 */
export declare class EnRichTextEditor extends EnElement<RichTextEditorEventMap> {
    private readonly editorExtensionContextProvider;
    private readonly richEditorCommandContextProvider;
    private readonly messageContext;
    private get effectiveMessages();
    static properties: {
        label: {
            useDefault: boolean;
        };
        description: {};
        messages: {
            attribute: boolean;
        };
        disabled: {
            type: BooleanConstructor;
            reflect: boolean;
        };
        readOnly: {
            type: BooleanConstructor;
            attribute: string;
            reflect: boolean;
        };
        value: {
            noAccessor: boolean;
        };
        document: {
            attribute: boolean;
            noAccessor: boolean;
        };
        sessionVersion: {
            state: boolean;
        };
    };
    static styles: import("lit").CSSResult[];
    /** Partial translations; replace the object to update. Missing/nullish entries use English defaults. */
    messages: EditorMessages | undefined;
    /** Plain supporting text; slot=description takes precedence. @default '' */
    description: string;
    label: string;
    disabled: boolean;
    readOnly: boolean;
    private sessionVersion;
    private state;
    private view?;
    private viewModule?;
    private mountGeneration;
    private version;
    private rangeDecorations;
    private authorVersion;
    private initialMarkup?;
    private deferred?;
    private unregister?;
    private bookmarks;
    private registry;
    private queryTask;
    private renderers;
    private session?;
    private dismissed;
    private committing;
    private frame;
    private get popup();
    constructor();
    private createState;
    /** Detached, immutable, independently versioned block document. Author writes reset history. */
    get document(): RichDocument;
    set document(value: RichDocument);
    /** Plain-text projection. Setting explicitly replaces all formatting/tokens and history. */
    get value(): string;
    set value(value: string);
    get revision(): number;
    /** Live native text, including an unfinished composition; falls back to value before mounting. */
    get draftValue(): string;
    /** Whether a native IME composition is active. */
    get composing(): boolean;
    get hasSelection(): boolean;
    get selectionKey(): string;
    get extensionOpen(): boolean;
    captureBookmark(): EditorBookmark;
    restoreBookmark(bookmark: EditorBookmark): boolean;
    /** Capture the user's current passage or caret as an explicit validated public range. */
    captureRange(): RichRange | undefined;
    /** Validate arbitrary text/structured offsets against this exact document revision. */
    validateRange(range: RichRange): boolean;
    /** Decorations do not focus the editor, change selection, or enter undo history. */
    decorateRanges(decorations: readonly RichRangeDecoration[]): boolean;
    clearRangeDecorations(): void;
    private decorations;
    /** Apply accepted nonoverlapping passages in one undoable transaction; selection maps normally. */
    replaceRanges(replacements: readonly RichRangeReplacement[]): boolean;
    /** Viewport selection bounds, or undefined before hydration. No live DOM Range is exposed. */
    getSelectionRect(): DOMRectReadOnly | undefined;
    replaceBookmark(bookmark: EditorBookmark, runs: readonly Run[]): boolean;
    private get editable();
    private replace;
    private command;
    getCommandState(name: RichEditorCommand): RichCommandState;
    /** Execute against the current selection or an explicit opaque bookmark. */
    execute(name: RichEditorCommand, value?: string, bookmark?: EditorBookmark): boolean;
    undo(): boolean;
    redo(): boolean;
    registerExtension(extension: EditorExtension): () => void;
    registerToken(type: string, render: TokenRenderer, options?: TokenOptions): () => void;
    private refreshNodeViews;
    openExtension(id: string, options?: {
        tokenId?: string;
    }): boolean;
    /** Convert a token to editable trigger/query text and open its picker as one undoable edit. */
    editToken(tokenId: string, options?: {
        query?: string;
    }): boolean;
    private deleteToken;
    private deleteAdjacentToken;
    private nodeViews;
    /** Focus the native textbox and restore editor selection; no-op before the asynchronous view mounts. */
    focus(options?: FocusOptions): void;
    connectedCallback(): void;
    disconnectedCallback(): void;
    protected firstUpdated(): void;
    private mount;
    private copy;
    private paste;
    private draftText;
    private attributesForEditor;
    protected updated(changed: PropertyValues): void;
    private commit;
    private notify;
    private signature;
    private detect;
    private start;
    private valid;
    private pickerSession;
    private restoreSessionFocus;
    private pickerRect;
    private caretRect;
    private complete;
    private choose;
    private keydown;
    private close;
    private refresh;
    private outside;
    private popupResize?;
    private track;
    private position;
    protected render(): import("lit-html").TemplateResult;
}
declare global {
    interface HTMLElementTagNameMap {
        'en-rich-text-editor': EnRichTextEditor;
    }
}
