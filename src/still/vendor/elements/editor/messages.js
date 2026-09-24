import { resolveMessages } from '../internal/messages.js';
export function editorMessages(messages) {
    return {
        suggestions: resolveMessages({ label: 'Suggestions', loading: 'Loading…', unavailable: 'Suggestions unavailable.', empty: 'No matches.', keyboardHint: 'Up/Down to choose, Enter to insert, Escape to dismiss.' }, messages?.suggestions),
        instructions: resolveMessages({ picker: 'Press Enter or Down Arrow to enter the picker. Escape cancels.', richText: 'Enter starts a paragraph. Alt+F10 opens formatting controls.' }, messages?.instructions),
        commands: resolveMessages({ bold: 'Bold', italic: 'Italic', heading: 'Heading', paragraph: 'Paragraph', 'bullet-list': 'Bullet list', 'ordered-list': 'Numbered list', link: 'Link', unlink: 'Remove link', undo: 'Undo', redo: 'Redo' }, messages?.commands),
        link: resolveMessages({ label: 'Link URL', placeholder: 'https://example.com', applyLabel: 'Apply link', cancelLabel: 'Cancel', invalid: 'Use an https, http, mailto or relative link.' }, messages?.link),
    };
}
