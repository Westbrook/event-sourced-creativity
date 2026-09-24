/** Prefer the actual trigger glyph; fall back to the saved caret only when it is visible. */
export declare function editorTriggerAnchor(editor: HTMLElement, trigger: DOMRectReadOnly, caret: DOMRectReadOnly): DOMRectReadOnly;
/** Position an editor-owned top-layer popup without changing selection or scrolling it. */
export declare function positionEditorPopup(popup: HTMLElement, editor: HTMLElement, anchor: DOMRectReadOnly, richPicker?: boolean, caret?: DOMRectReadOnly): void;
/** Track wrapping and scrollports across shadow boundaries while the picker is open. */
export declare function observeEditorPopup(editor: HTMLElement | null | undefined, popup: HTMLElement | null | undefined, position: () => void): {
    disconnect(): void;
} | undefined;
