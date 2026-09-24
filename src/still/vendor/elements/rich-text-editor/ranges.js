/** Pure resolution: never move selection or snap a stale, token-cutting or grapheme-cutting passage. */
export function resolveRichRange(doc, revision, range) {
    if (!range || range.revision !== revision || !Number.isSafeInteger(range.from) ||
        !Number.isSafeInteger(range.to) || range.from < 0 || range.to < range.from ||
        typeof range.expectedText !== 'string')
        return;
    let text = '', first = true, lastEnd = 0;
    const positions = new Map();
    doc.descendants((node, pos) => {
        if (node.isTextblock) {
            if (!first) {
                positions.set(text.length, lastEnd);
                text += '\n';
            }
            first = false;
            positions.set(text.length, pos + 1);
            lastEnd = pos + node.nodeSize - 1;
        }
        if (node.isText) {
            for (let i = 0; i <= node.text.length; i++)
                positions.set(text.length + i, pos + i);
            text += node.text;
        }
        else if (node.isLeaf) {
            // Atoms expose endpoints only, even when their fallback spans many UTF-16 units.
            positions.set(text.length, pos);
            text += node.type.name === 'token' ? node.attrs.run.text : '\n';
            positions.set(text.length, pos + node.nodeSize);
        }
    });
    let start, end;
    let from, to;
    if (range.coordinate === 'text') {
        start = range.from;
        end = range.to;
        from = positions.get(start);
        to = positions.get(end);
    }
    else if (range.coordinate === 'structured') {
        from = range.from;
        to = range.to;
        for (const [offset, position] of positions) {
            if (position === from)
                start = offset;
            if (position === to)
                end = offset;
        }
        // AllSelection uses root endpoints rather than textblock interiors.
        if (from === 0)
            start = 0;
        if (to === 0)
            end = 0;
        if (from === doc.content.size)
            start = text.length;
        if (to === doc.content.size)
            end = text.length;
    }
    else
        return;
    if (start === undefined || end === undefined || from === undefined || to === undefined ||
        end < start || text.slice(start, end) !== range.expectedText)
        return;
    const boundaries = new Set([0, text.length]);
    for (const part of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text))
        boundaries.add(part.index);
    if (!boundaries.has(start) || !boundaries.has(end))
        return;
    return { from, to };
}
