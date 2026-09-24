import type { EditorMessages } from './editor/messages.js';
import type { ColorPickerMessages } from './color-picker/messages.js';
/** Missing local fields inherit from the nearest provider, then built-in defaults. */
export declare const editorMessagesContext: {
    __context__: EditorMessages | undefined;
};
export declare const colorMessagesContext: {
    __context__: ColorPickerMessages | undefined;
};
/** Merge only defined fields; empty strings remain intentional overrides. */
export declare function mergeMessageOverrides<T extends object>(context: T | undefined, local: T | undefined): T | undefined;
