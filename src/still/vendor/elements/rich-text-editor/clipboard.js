import { DOMParser as RichParser, Fragment, Slice } from 'prosemirror-model';
import { importClipboardRuns, validateClipboardRuns, editorClipboardLimit } from '../../primitives/interactions/editor-clipboard.js';
import { richSchema, safeEditorLink, richHTML, richDocumentFromRuns, validateRichDocument } from './document.js';
export function clipboardRuns(slice) {
    const runs = [];
    const walk = (node) => { if (node.isText)
        runs.push({ kind: 'text', text: node.text });
    else if (node.type.name === 'token')
        runs.push(node.attrs.run);
    else if (node.type.name === 'hard_break')
        runs.push({ kind: 'text', text: '\n' });
    else {
        node.forEach((child, _offset, index) => { if (index && child.isBlock)
            runs.push({ kind: 'text', text: '\n' }); walk(child); });
    } };
    slice.content.forEach((node, _offset, index) => { if (index)
        runs.push({ kind: 'text', text: '\n' }); walk(node); });
    return runs;
}
export function clipboardHTML(slice) { let html = ''; slice.content.forEach(node => { html += richHTML(node); }); return html; }
export function runsSlice(runs, marks = []) { const doc = validateRichDocument(richDocumentFromRuns(runs)); const blocks = []; doc.forEach(block => { const inline = []; block.forEach(child => inline.push(marks.length ? child.mark(marks) : child)); blocks.push(block.copy(Fragment.fromArray(inline))); }); return Slice.maxOpen(Fragment.fromArray(blocks)); }
/** Validate the rich schema before mapping tokens; never parse application HTML as tokens. */
export function importRichClipboard(value, accept, used, importToken) {
    if (!value || typeof value !== 'object')
        throw new TypeError('Invalid rich clipboard');
    const raw = value;
    if (!Array.isArray(raw.content) || !Number.isInteger(raw.openStart ?? 0) || !Number.isInteger(raw.openEnd ?? 0) || Number(raw.openStart ?? 0) < 0 || Number(raw.openEnd ?? 0) < 0)
        throw new TypeError('Invalid rich slice');
    const slice = Slice.fromJSON(richSchema, value);
    const check = (node) => { node.check(); if (node.type.name === 'heading' && ![1, 2, 3].includes(node.attrs.level))
        throw new TypeError('Invalid heading'); if (node.type.name === 'ordered_list' && (!Number.isSafeInteger(node.attrs.order) || node.attrs.order < 1))
        throw new TypeError('Invalid list'); for (const mark of node.marks)
        if (mark.type.name === 'link' && !safeEditorLink(mark.attrs.href))
            throw new TypeError('Unsafe link'); if (node.type.name === 'token')
        validateClipboardRuns([node.attrs.run]); node.forEach(check); };
    slice.content.forEach(check);
    const max = Slice.maxOpen(slice.content);
    if (slice.openStart > max.openStart || slice.openEnd > max.openEnd)
        throw new TypeError('Invalid open depths');
    const source = [];
    const collect = (node) => { if (node.type.name === 'token')
        source.push(node.attrs.run); node.forEach(collect); };
    slice.content.forEach(collect);
    const imported = importClipboardRuns(source, accept, used, importToken);
    let occurrence = 0;
    const map = (node) => { if (node.type.name === 'token') {
        const run = imported[occurrence++];
        if (run.kind === 'token') {
            used.add(run.id);
            return node.type.create({ run }, null, node.marks);
        }
        return richSchema.text(run.text, node.marks);
    } const content = []; node.forEach(child => content.push(map(child))); return node.copy(Fragment.fromArray(content)); };
    const nodes = [];
    slice.content.forEach(node => nodes.push(map(node)));
    return new Slice(Fragment.fromArray(nodes), slice.openStart, slice.openEnd);
}
/** Detached inert parse; only a small allowlist is copied to a fresh document. */
export function externalRichClipboard(html, owner) {
    if (!html || html.length > editorClipboardLimit)
        return;
    const inert = owner.implementation.createHTMLDocument('');
    const template = inert.createElement('template');
    template.innerHTML = html;
    const clean = inert.createElement('div');
    let count = 0;
    const allowed = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'UL', 'OL', 'LI', 'STRONG', 'B', 'EM', 'I', 'A', 'BR']);
    const discard = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'TEMPLATE', 'NOSCRIPT', 'HEAD']);
    const copy = (node, target, depth) => {
        if (depth > 40 || ++count > 20000)
            throw new TypeError('HTML too complex');
        if (node.nodeType === 3) {
            target.appendChild(inert.createTextNode(node.textContent ?? ''));
            return;
        }
        if (node.nodeType !== 1)
            return;
        const el = node;
        if (discard.has(el.tagName))
            return;
        let next = target;
        if (allowed.has(el.tagName)) {
            const out = inert.createElement(el.tagName === 'DIV' ? 'p' : el.tagName.toLowerCase());
            if (el.tagName === 'A') {
                const href = el.getAttribute('href');
                if (href && safeEditorLink(href))
                    out.setAttribute('href', href);
            }
            if (el.tagName === 'OL') {
                const start = Number(el.getAttribute('start'));
                if (Number.isSafeInteger(start) && start > 0)
                    out.setAttribute('start', String(start));
            }
            target.appendChild(out);
            next = out;
        }
        for (const child of node.childNodes)
            copy(child, next, depth + 1);
    };
    try {
        for (const child of template.content.childNodes)
            copy(child, clean, 0);
        const slice = RichParser.fromSchema(richSchema).parseSlice(clean);
        return slice.size ? slice : undefined;
    }
    catch {
        return;
    }
}
