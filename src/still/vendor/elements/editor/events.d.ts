import type { ActionDetail, DraftInputDetail } from '../../primitives/interactions/events.js';
import type { ChatEditorData } from '../../primitives/interactions/chat-editor.js';
export type EditorInputEvent = CustomEvent<DraftInputDetail>;
/** JSON data is detached from provider objects and deeply frozen before dispatch. */
export type EditorActionEvent = CustomEvent<ActionDetail<string, ChatEditorData | undefined>>;
export interface EditorEventMap {
    'en-input': EditorInputEvent;
    'en-action': EditorActionEvent;
}
