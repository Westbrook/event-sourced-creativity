export function safeEditorLink(href) {
    // Relative and same-page links are allowed; protocol-relative and executable URLs are not.
    const value = href.trim();
    return !!value && !/[\u0000-\u0020\u007f\\]/u.test(value) && !value.startsWith('//') &&
        (!/^[a-z][a-z\d+.-]*:/iu.test(value) || /^(https?:|mailto:)/iu.test(value));
}
/** Decode detached public JSON without a browser. No text normalization or identity inference. */
export function decodeRichDocument(input, limits = {}) {
    const maxDepth = limits.maxDepth ?? 32, maxNodes = limits.maxNodes ?? 10000, maxBytes = limits.maxBytes ?? 1000000;
    for (const limit of [maxDepth, maxNodes, maxBytes])
        if (!Number.isSafeInteger(limit) || limit < 1)
            throw new TypeError('Positive integer document limits required');
    // Bound hostile JSON and reject accessors before snapshotting or serializing it.
    const stack = [{ value: input, depth: 0 }], ancestors = new Set();
    let values = 0;
    while (stack.length) {
        const { value, depth, exit } = stack.pop();
        if (!exit && ++values > maxNodes * 32)
            throw new TypeError('Rich document data value limit exceeded');
        if (value === null || typeof value === 'string' || typeof value === 'boolean')
            continue;
        if (typeof value === 'number' && Number.isFinite(value))
            continue;
        if (typeof value !== 'object')
            throw new TypeError('Rich documents require JSON data');
        if (exit) {
            ancestors.delete(value);
            continue;
        }
        if (depth > Math.max(128, maxDepth * 4) || ancestors.has(value))
            throw new TypeError('Rich document data limit or cycle');
        if (!Array.isArray(value) && ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
            throw new TypeError('Rich documents require plain records');
        if (Array.isArray(value) && (Object.keys(value).length !== value.length || Object.keys(value).some((key, index) => key !== String(index))))
            throw new TypeError('Rich documents require dense JSON arrays');
        ancestors.add(value);
        stack.push({ value, depth, exit: true });
        for (const key of Reflect.ownKeys(value)) {
            if (Array.isArray(value) && key === 'length')
                continue;
            const property = Object.getOwnPropertyDescriptor(value, key);
            if (typeof key !== 'string' || !property.enumerable || !('value' in property))
                throw new TypeError('Rich documents require enumerable data properties');
            stack.push({ value: property.value, depth: depth + 1 });
        }
    }
    if (new TextEncoder().encode(JSON.stringify(input)).byteLength > maxBytes)
        throw new TypeError('Rich document byte limit exceeded');
    const record = (value) => { if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new TypeError('Expected rich record'); return value; };
    const keys = (value, allowed) => { if (Object.keys(value).some(key => !allowed.includes(key)))
        throw new TypeError('Unsupported rich document field'); };
    const envelope = record(input);
    keys(envelope, ['type', 'version', 'doc']);
    if (envelope.type !== 'en-rich-text' || envelope.version !== 1)
        throw new TypeError('Expected an en-rich-text version 1 document');
    const pending = [{ node: envelope.doc, depth: 1 }], ids = new Set();
    let count = 0;
    while (pending.length) {
        const { node: raw, depth } = pending.pop(), node = record(raw);
        keys(node, ['type', 'attrs', 'text', 'marks', 'content']);
        if (++count > maxNodes || depth > maxDepth)
            throw new TypeError('Rich document node limit exceeded');
        if (typeof node.type !== 'string' || !['doc', 'paragraph', 'heading', 'text', 'hard_break', 'token', 'bullet_list', 'ordered_list', 'list_item'].includes(node.type))
            throw new TypeError('Unsupported rich node');
        if (node.text !== undefined && (node.type !== 'text' || typeof node.text !== 'string' || !node.text))
            throw new TypeError('Invalid rich text');
        if (node.type === 'text' && typeof node.text !== 'string')
            throw new TypeError('Text node requires text');
        const attrs = node.attrs === undefined ? {} : record(node.attrs);
        keys(attrs, node.type === 'heading' ? ['level'] : node.type === 'ordered_list' ? ['order'] : node.type === 'token' ? ['run'] : []);
        if (node.type === 'heading' && attrs.level !== undefined && ![1, 2, 3].includes(attrs.level))
            throw new TypeError('Supported heading levels: 1, 2, 3');
        if (node.type === 'ordered_list' && attrs.order !== undefined && (!Number.isSafeInteger(attrs.order) || attrs.order < 1))
            throw new TypeError('Invalid list start');
        if (node.type === 'token') {
            const run = record(attrs.run);
            keys(run, ['kind', 'id', 'type', 'text', 'label', 'data']);
            if (run.kind !== 'token' || ['id', 'type', 'text', 'label'].some(key => typeof run[key] !== 'string' || !run[key]) || !Object.hasOwn(run, 'data') || ids.has(run.id))
                throw new TypeError('Tokens require unique occurrence IDs, type, fallback, label and data');
            ids.add(run.id);
        }
        if (node.marks !== undefined) {
            if (!Array.isArray(node.marks))
                throw new TypeError('Invalid marks');
            const seen = new Set();
            for (const rawMark of node.marks) {
                const mark = record(rawMark);
                keys(mark, ['type', 'attrs']);
                if (!['strong', 'em', 'link'].includes(mark.type) || seen.has(mark.type))
                    throw new TypeError('Unsupported or repeated mark');
                seen.add(mark.type);
                const attrs = mark.attrs === undefined ? {} : record(mark.attrs);
                keys(attrs, mark.type === 'link' ? ['href'] : []);
                if (mark.type === 'link' && (typeof attrs.href !== 'string' || !safeEditorLink(attrs.href)))
                    throw new TypeError('Unsafe link');
            }
        }
        if (node.content !== undefined) {
            if (!Array.isArray(node.content))
                throw new TypeError('Invalid rich content');
            for (const child of node.content)
                pending.push({ node: child, depth: depth + 1 });
        }
    }
    const block = new Set(['paragraph', 'heading', 'bullet_list', 'ordered_list']), inline = new Set(['text', 'hard_break', 'token']);
    const check = (node) => {
        const children = node.content ?? [];
        if (['text', 'hard_break', 'token'].includes(node.type) && children.length)
            throw new TypeError('Leaf node cannot have content');
        if (node.type === 'doc' && (!children.length || children.some(child => !block.has(child.type))))
            throw new TypeError('Document requires blocks');
        if (['paragraph', 'heading'].includes(node.type) && children.some(child => !inline.has(child.type)))
            throw new TypeError('Text block requires inline content');
        if (['bullet_list', 'ordered_list'].includes(node.type) && (!children.length || children.some(child => child.type !== 'list_item')))
            throw new TypeError('List requires list items');
        if (node.type === 'list_item' && (!children.length || children[0].type !== 'paragraph' || children.some(child => !block.has(child.type))))
            throw new TypeError('List item requires a paragraph and blocks');
        if (!inline.has(node.type) && node.marks?.length)
            throw new TypeError('Block marks are unsupported');
        children.forEach(check);
    };
    if (envelope.doc.type !== 'doc')
        throw new TypeError('Expected a block document');
    check(envelope.doc);
    return deepFreeze(JSON.parse(JSON.stringify(input)));
}
function deepFreeze(value) { if (value && typeof value === 'object') {
    for (const child of Object.values(value))
        deepFreeze(child);
    Object.freeze(value);
} return value; }
/** Same readable projection as the editor: block boundaries and hard breaks are newlines. */
export function richDocumentText(value, limits = {}) {
    const document = decodeRichDocument(value, limits);
    let text = '', first = true;
    const visit = (node) => { if (['paragraph', 'heading'].includes(node.type)) {
        if (!first)
            text += '\n';
        first = false;
    } if (node.type === 'text')
        text += node.text;
    else if (node.type === 'token')
        text += node.attrs.run.text;
    else if (node.type === 'hard_break')
        text += '\n';
    else
        node.content?.forEach(visit); };
    visit(document.doc);
    return text;
}
/** Explicit conversion; never interprets plain @ text as identity. */
export function richDocumentFromRuns(runs, limits = {}) {
    const blocks = [];
    let inline = [];
    for (const run of runs) {
        if (run.kind === 'token')
            inline.push({ type: 'token', attrs: { run: run } });
        else if (run.kind === 'text' && typeof run.text === 'string')
            run.text.split('\n').forEach((text, index) => { if (index) {
                blocks.push({ type: 'paragraph', content: inline });
                inline = [];
            } if (text) {
                const previous = inline.at(-1);
                if (previous?.type === 'text')
                    inline[inline.length - 1] = { type: 'text', text: previous.text + text };
                else
                    inline.push({ type: 'text', text });
            } });
        else
            throw new TypeError('Unsupported run');
    }
    blocks.push({ type: 'paragraph', content: inline });
    return decodeRichDocument({ type: 'en-rich-text', version: 1, doc: { type: 'doc', content: blocks } }, limits);
}
