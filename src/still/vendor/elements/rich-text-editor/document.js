import { Schema } from 'prosemirror-model';
import { addListNodes } from 'prosemirror-schema-list';
import { snapshotChatEditor } from '../../primitives/interactions/chat-editor.js';
import { decodeRichDocument, richDocumentFromRuns, safeEditorLink } from '../rich-document.js';
export { decodeRichDocument, richDocumentFromRuns, safeEditorLink, richDocumentText } from '../rich-document.js';
const nodes = {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*', parseDOM: [{ tag: 'p' }], toDOM: () => ['p', 0] },
    heading: { group: 'block', content: 'inline*', attrs: { level: { default: 2 } }, defining: true,
        parseDOM: [1, 2, 3].map(level => ({ tag: `h${level}`, attrs: { level } })), toDOM: node => [`h${node.attrs.level}`, 0] },
    text: { group: 'inline' },
    hard_break: { inline: true, group: 'inline', selectable: false, parseDOM: [{ tag: 'br' }], toDOM: () => ['br'] },
    token: { inline: true, group: 'inline', atom: true, selectable: true, attrs: { run: {} },
        // Clipboard HTML never reconstructs trusted application token identity.
        toDOM: node => ['span', { 'data-token': node.attrs.run.id, 'contenteditable': 'false', part: 'token' }, node.attrs.run.label] },
};
const marks = {
    strong: { parseDOM: [{ tag: 'strong' }, { tag: 'b' }], toDOM: () => ['strong', 0] },
    em: { parseDOM: [{ tag: 'em' }, { tag: 'i' }], toDOM: () => ['em', 0] },
    link: { attrs: { href: {} }, inclusive: false, parseDOM: [{ tag: 'a[href]', getAttrs: dom => {
                    const href = dom.getAttribute('href');
                    return safeEditorLink(href) ? { href } : false;
                } }], toDOM: mark => ['a', { href: mark.attrs.href, rel: 'noopener noreferrer' }, 0] },
};
const basic = new Schema({ nodes, marks });
export const richSchema = new Schema({ nodes: addListNodes(basic.spec.nodes, 'paragraph block*', 'block'), marks });
export function validateRichDocument(value) { const node = richSchema.nodeFromJSON(decodeRichDocument(value).doc); node.check(); return node; }
function freeze(value) { if (value && typeof value === 'object') {
    for (const item of Object.values(value))
        freeze(item);
    Object.freeze(value);
} return value; }
export function richSnapshot(node) { return freeze({ type: 'en-rich-text', version: 1, doc: snapshotChatEditor({ value: '', content: node.toJSON() }).content }); }
export function richText(node) { return node.textBetween(0, node.content.size, '\n', child => child.type.name === 'token' ? child.attrs.run.text : '\n'); }
const escape = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
/** Safe initial semantic HTML, also usable without a browser DOM during SSR. */
export function richHTML(node) {
    let body = node.isText ? escape(node.text) : [...Array(node.childCount)].map((_, i) => richHTML(node.child(i))).join('');
    const name = node.type.name;
    if (name === 'token')
        body = `<span part="token" contenteditable="false" aria-label="${escape(node.attrs.run.label)}"><span part="token-content">${escape(node.attrs.run.text)}</span></span>`;
    else if (name === 'hard_break')
        body = '<br>';
    else if (name !== 'doc' && name !== 'text') {
        const tag = { paragraph: 'p', heading: `h${node.attrs.level}`, bullet_list: 'ul', ordered_list: 'ol', list_item: 'li' }[name];
        body = `<${tag}${name === 'ordered_list' ? ` start="${node.attrs.order}"` : ''}>${body}</${tag}>`;
    }
    for (const mark of node.marks)
        body = mark.type.name === 'link' ? `<a href="${escape(mark.attrs.href)}" rel="noopener noreferrer">${body}</a>` : `<${mark.type.name === 'strong' ? 'strong' : 'em'}>${body}</${mark.type.name === 'strong' ? 'strong' : 'em'}>`;
    return body;
}
