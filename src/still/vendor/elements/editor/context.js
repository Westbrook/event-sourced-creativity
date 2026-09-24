import { createContext } from '@lit/context';
// Versioned string keys interoperate across independently bundled copies.
export const editorExtensionContext = createContext('../../editor-extension/v1');
export const richEditorCommandContext = createContext('../../rich-editor-command/v1');
export function isEditorExtensionHost(value) {
    const host = value;
    return !!host && host.nodeType === 1 && typeof host.registerExtension === 'function';
}
export function isRichEditorCommandHost(value) {
    const host = value;
    return !!host && host.nodeType === 1
        && ['captureBookmark', 'restoreBookmark', 'execute', 'getCommandState', 'getSelectionRect'].every(key => typeof Reflect.get(host, key) === 'function')
        && typeof host.revision === 'number' && typeof host.selectionKey === 'string'
        && ['hasSelection', 'disabled', 'readOnly', 'composing', 'extensionOpen'].every(key => typeof Reflect.get(host, key) === 'boolean');
}
