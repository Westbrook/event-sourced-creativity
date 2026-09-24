import { EditorDocument } from '../state/token-document.js';
/** Browser clipboard interoperability, independently versioned from saved drafts. */
export const editorClipboardType = 'application/x-en-editor+json';
export const editorClipboardLimit = 1_000_000;
let occurrence = 0;
/** Reject oversized/deep payloads before walking application data or editor nodes. */
export function boundedClipboardJSON(text) {
    if (text.length > editorClipboardLimit)
        throw new TypeError('Clipboard payload too large');
    const value = JSON.parse(text);
    let count = 0;
    const visit = (item, depth) => { if (depth > 40 || ++count > 20000)
        throw new TypeError('Clipboard payload too complex'); if (item && typeof item === 'object')
        for (const child of Object.values(item))
            visit(child, depth + 1); };
    visit(value, 0);
    return value;
}
export function validateClipboardRuns(value) {
    if (!Array.isArray(value) || value.length > 10000)
        throw new TypeError('Invalid clipboard runs');
    for (const run of value) {
        if (!run || typeof run !== 'object' || typeof run.text !== 'string' || !['text', 'token'].includes(run.kind))
            throw new TypeError('Invalid clipboard run');
        if (run.kind === 'token' && (!Object.hasOwn(run, 'data') || ['id', 'type', 'text', 'label'].some(key => typeof run[key] !== 'string' || !run[key])))
            throw new TypeError('Invalid clipboard token');
    }
    return new EditorDocument(value).document.runs;
}
export function readEditorClipboard(data) {
    try {
        const raw = data.getData(editorClipboardType);
        if (!raw)
            return;
        const value = boundedClipboardJSON(raw);
        if (value?.type !== 'en-editor-clipboard' || value.version !== 1)
            return;
        return { type: value.type, version: 1, runs: validateClipboardRuns(value.runs), rich: value.rich };
    }
    catch {
        return;
    }
}
/** Hooks see original occurrences. Validate all results before callers commit; errors abort structured import. */
export function importClipboardRuns(runs, accept, used = new Set(), importToken) {
    const source = validateClipboardRuns(runs);
    const sourceTokens = Object.freeze(source.filter((run) => run.kind === 'token'));
    const scope = Object.freeze({}), ids = new Set([...used, ...sourceTokens.map(run => run.id)]);
    const result = source.map((run, sourceIndex) => {
        if (run.kind === 'text' || !accept(run.type))
            return { kind: 'text', text: run.text };
        const context = Object.freeze({ scope, sourceId: run.id, sourceIndex, sourceTokens });
        const imported = importToken ? importToken(run, context) : run;
        if (imported === undefined)
            return { kind: 'text', text: run.text };
        // A transform may change payload/type, but may never set occurrence identity.
        // Validate before allocating IDs and before any editor transaction is committed.
        const checked = validateClipboardRuns([imported])[0];
        boundedClipboardJSON(JSON.stringify(checked));
        if (checked?.kind !== 'token')
            throw new TypeError('Token import must return a token or undefined');
        ids.add(checked.id);
        if (!accept(checked.type))
            return { kind: 'text', text: run.text };
        return checked;
    });
    return result.map(run => {
        if (run.kind === 'text')
            return run;
        let id;
        do {
            id = `paste-${Date.now().toString(36)}-${++occurrence}`;
        } while (ids.has(id));
        ids.add(id);
        return { ...run, id };
    });
}
export function sliceClipboardRuns(runs, from, to) {
    let offset = 0;
    const result = [];
    for (const run of runs) {
        const end = offset + run.text.length;
        if (end > from && offset < to)
            result.push(run.kind === 'token' ? run : { kind: 'text', text: run.text.slice(Math.max(0, from - offset), Math.min(run.text.length, to - offset)) });
        offset = end;
    }
    return result;
}
/** Plain text is mandatory; custom MIME is best effort for browsers/apps that strip it. */
export function writeEditorClipboard(data, runs, rich, html) {
    try {
        data.setData('text/plain', runs.map(run => run.text).join(''));
    }
    catch {
        return false;
    }
    try {
        const value = JSON.stringify({ type: 'en-editor-clipboard', version: 1, runs, ...(rich === undefined ? {} : { rich }) });
        if (value.length <= editorClipboardLimit)
            data.setData(editorClipboardType, value);
    }
    catch { /* readable fallback remains */ }
    if (html)
        try {
            data.setData('text/html', html);
        }
        catch { /* plain text remains */ }
    return true;
}
