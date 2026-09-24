import { isHTMLButton } from '../internal/dom-kind.js';
import { ScopedContext } from '../internal/context-consumer.js';
import { editorMessagesContext, mergeMessageOverrides } from '../messages-context.js';
import { ContextProvider } from '../internal/context-provider.js';
import { editorExtensionContext, richEditorCommandContext } from '../editor/context.js';
import { editorMessages } from '../editor/messages.js';
import { readEditorClipboard, importClipboardRuns, writeEditorClipboard } from '../../primitives/interactions/editor-clipboard.js';
import { clipboardRuns, clipboardHTML, runsSlice, importRichClipboard, externalRichClipboard } from './clipboard.js';
import { positionEditorPopup, observeEditorPopup, editorTriggerAnchor } from '../internal/editor-popup.js';
import { html, nothing } from 'lit';
import { html as staticHtml, unsafeStatic } from 'lit/static-html.js';
import { descriptionTemplate } from '../../primitives/templates/description.js';
import { EnElement } from '../internal/en-element.js';
import { EditorState, TextSelection, NodeSelection } from 'prosemirror-state';
import { resolveRichRange } from './ranges.js';
import { Fragment } from 'prosemirror-model';
import { history, undo, redo, undoDepth, redoDepth, closeHistory } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark, setBlockType, chainCommands, exitCode, selectAll } from 'prosemirror-commands';
import { wrapInList, liftListItem, splitListItem, sinkListItem } from 'prosemirror-schema-list';
import { EditorExtensionRegistry, EditorQueryTask, EditorBookmarks } from '../../primitives/interactions/editor-extensions.js';
import { registerChatEditor, snapshotEditorData } from '../../primitives/interactions/chat-editor.js';
import { dispatchAction, dispatchChange, dispatchDraftInput } from '../../primitives/interactions/events.js';
import { EditorDocument } from '../../primitives/state/token-document.js';
import { sizeStyles } from '../../styles/foundations.js';
import { tokenEditorStyles } from '../../styles/token-editor.js';
import { richTextEditorStyles } from '../../styles/rich-text-editor.js';
import { richSchema, validateRichDocument, richSnapshot, richText, richHTML, richDocumentFromRuns, safeEditorLink } from './document.js';
export { richDocumentFromRuns };
/**
 * Optional block editor with application-owned reference/tool/picker extensions.
 * @cssprop --en-editor-token-pressed-scale - editor-token held-state refinement; geometry is bounded and reduced motion wins.
 * @cssprop --en-editor-token-pressed-offset - editor-token held-state refinement; geometry is bounded and reduced motion wins.
 * @cssprop --en-editor-token-press-duration - editor-token held-state refinement; geometry is bounded and reduced motion wins.
 * @cssprop --en-editor-token-release-duration - editor-token held-state refinement; geometry is bounded and reduced motion wins.
 * @cssprop --en-editor-token-pressed-shadow - editor-token held-state refinement; geometry is bounded and reduced motion wins.
 * @cssprop --en-editor-token-pressed-color - editor-token held-state refinement; geometry is bounded and reduced motion wins.
 * @cssprop --en-editor-token-pressed-border-color - editor-token held-state refinement; geometry is bounded and reduced motion wins.
 * @tagname en-rich-text-editor
 * @slot description - Supporting content; replaces the description attribute/property fallback.
 * @csspart description - Supporting content below the editing surface.
 * @slot label - Visible label; label supplies the accessible textbox name.
 * @csspart label - Visible editor label.
 * @csspart control - Semantic multiline editing surface.
 * @csspart range-decoration - Revision-bound passage highlight.
 * @csspart token - Atomic inline token wrapper, sharing token-editor theme hooks.
 * @csspart token-interactive - Token wrappers configured with an edit extension; disabled while unavailable.
 * @csspart token-content - Noninteractive token contents, including custom renderer output.
 * @csspart popup - Extension list/picker surface.
 * @csspart option - Extension suggestion.
 * @cssprop --en-input-background - Editing surface paint; refines shared control background.
 * @cssprop --en-input-color - Editing foreground; refines shared control color.
 * @cssprop --en-input-inline-padding - Editing inset; refines shared control inline padding.
 * @cssprop --en-field-gap - Space between label and editor.
 * @cssprop --en-option-list-max-block-size - Suggestion list ceiling, further constrained by available viewport space.
 * @cssprop --en-option-list-gap - Space between standard suggestion rows.
 * @cssprop --en-option-list-padding - Suggestion inset, with focus clearance.
 * @cssprop --en-option-list-radius - Suggestion surface radius.
 * @cssprop --en-option-list-color - Suggestion foreground, falling back through overlay color.
 * @cssprop --en-option-block-padding - Standard suggestion row block padding.
 * @cssprop --en-option-inline-padding - Standard suggestion row inline padding.
 * @cssprop --en-option-radius - Standard suggestion row radius, otherwise concentric with its list.
 * @cssprop --en-editor-max-size - Maximum editor block size before scrolling.
 * @cssprop --en-editor-token-radius - Inline token contour.
 * @cssprop --en-editor-token-background - Inline token background.
 * @cssprop --en-editor-token-color - Inline token foreground.
 * @cssprop --en-editor-token-border-color - Token boundary color.
 * @cssprop --en-editor-token-hover-background - Hover-capable token action background.
 * @cssprop --en-editor-token-pressed-background - Pressed token action background.
 * @cssprop --en-editor-token-inline-padding - Inline token padding.
 * @cssprop --en-editor-token-block-padding - Block token padding.
 * @cssprop --en-editor-token-gap - Space between adjacent tokens.
 * @cssprop --en-editor-token-min-size - Minimum token size; interactive target floors still apply.
 * @fires {RichTextEditorChangeEvent} en-change - Cancelable rich document transaction with previous/proposed and reason.
 * @fires {EditorInputEvent} en-input - Native draft input, including composition state.
 * @fires {EditorActionEvent} en-action - Cancelable application extension action.
 * @fires {CustomEvent<null>} en-toolbar-request - Cancelable direct-host toolbar association protocol; does not bubble or cross roots.
 * @fires {CustomEvent<null>} en-editor-state - Document/selection/availability changed; toolbar consumers reread state.
 */
export class EnRichTextEditor extends EnElement {
    editorExtensionContextProvider = new ContextProvider(this, { context: editorExtensionContext, initialValue: this });
    richEditorCommandContextProvider = new ContextProvider(this, { context: richEditorCommandContext, initialValue: this });
    messageContext = new ScopedContext(this, editorMessagesContext);
    get effectiveMessages() { return mergeMessageOverrides(this.messageContext.value, this.messages); }
    static properties = { label: { useDefault: true }, description: {}, messages: { attribute: false }, disabled: { type: Boolean, reflect: true }, readOnly: { type: Boolean, attribute: 'readonly', reflect: true }, value: { noAccessor: true }, document: { attribute: false, noAccessor: true }, sessionVersion: { state: true } };
    static styles = [sizeStyles, tokenEditorStyles, richTextEditorStyles];
    state = this.createState(validateRichDocument(richDocumentFromRuns([])));
    view;
    viewModule;
    mountGeneration = 0;
    version = 0;
    rangeDecorations = [];
    authorVersion = 0;
    initialMarkup;
    deferred;
    unregister;
    bookmarks = new EditorBookmarks();
    registry = new EditorExtensionRegistry(previous => { if (previous && this.session?.extension === previous)
        this.close(); });
    queryTask = new EditorQueryTask();
    renderers = new Map();
    session;
    dismissed = '';
    committing = false;
    frame = 0;
    get popup() { return this.renderRoot.querySelector('.popup'); }
    constructor() { super(); this.label = 'Document'; this.description = ''; this.disabled = false; this.readOnly = false; this.sessionVersion = 0; }
    createState(doc) {
        return EditorState.create({ doc, plugins: [history({ depth: 100 }), keymap({
                    'Mod-z': undo, 'Shift-Mod-z': redo, 'Mod-y': redo,
                    'Mod-b': toggleMark(richSchema.marks.strong), 'Mod-i': toggleMark(richSchema.marks.em),
                    Enter: splitListItem(richSchema.nodes.list_item), 'Mod-[': liftListItem(richSchema.nodes.list_item), 'Mod-]': sinkListItem(richSchema.nodes.list_item),
                    'Shift-Enter': chainCommands(exitCode, (state, dispatch) => { dispatch?.(state.tr.replaceSelectionWith(richSchema.nodes.hard_break.create()).scrollIntoView()); return true; }),
                }), keymap(baseKeymap)] });
    }
    /** Detached, immutable, independently versioned block document. Author writes reset history. */
    get document() { return richSnapshot(this.state.doc); }
    set document(value) {
        const doc = validateRichDocument(value);
        this.authorVersion++;
        this.close();
        if (this.composing) {
            this.deferred = richSnapshot(doc);
            return;
        }
        this.state = this.createState(doc);
        this.version++;
        this.view?.updateState(this.state);
        this.requestUpdate();
        this.notify();
    }
    /** Plain-text projection. Setting explicitly replaces all formatting/tokens and history. */
    get value() { return richText(this.state.doc); }
    set value(value) { this.document = richDocumentFromRuns([{ kind: 'text', text: String(value) }]); }
    get revision() { return this.version; }
    /** Live native text, including an unfinished composition; falls back to value before mounting. */
    get draftValue() { return this.draftText(); }
    /** Whether a native IME composition is active. */
    get composing() { return this.view?.composing ?? false; }
    get hasSelection() { return !this.state.selection.empty; }
    get selectionKey() { return this.signature(); }
    get extensionOpen() { return !!this.session; }
    captureBookmark() { return this.bookmarks.capture(this.revision, this.state.selection.getBookmark()); }
    restoreBookmark(bookmark) {
        const selection = this.bookmarks.resolve(bookmark, this.revision);
        if (!selection || this.disabled || this.composing || !this.view)
            return false;
        this.view.dispatch(this.state.tr.setSelection(selection.resolve(this.state.doc)));
        this.focus();
        return true;
    }
    /** Capture the user's current passage or caret as an explicit validated public range. */
    captureRange() {
        if (this.composing)
            return;
        const { from, to } = this.state.selection;
        const expectedText = this.state.doc.textBetween(from, to, '\n', node => node.type.name === 'token' ? node.attrs.run.text : '\n');
        const range = Object.freeze({ coordinate: 'structured', from, to, expectedText, revision: this.revision });
        return this.validateRange(range) ? range : undefined;
    }
    /** Validate arbitrary text/structured offsets against this exact document revision. */
    validateRange(range) { return !!resolveRichRange(this.state.doc, this.revision, range); }
    /** Decorations do not focus the editor, change selection, or enter undo history. */
    decorateRanges(decorations) {
        const ids = new Set();
        for (const item of decorations) {
            if (!item.id || ids.has(item.id) || !this.validateRange(item.range))
                return false;
            ids.add(item.id);
        }
        this.rangeDecorations = decorations.map(item => Object.freeze({ id: item.id, range: Object.freeze({ ...item.range }) }));
        this.view?.setProps({ decorations: () => this.decorations() });
        return true;
    }
    clearRangeDecorations() { this.rangeDecorations = []; this.view?.setProps({ decorations: () => this.decorations() }); }
    decorations() {
        const { Decoration, DecorationSet } = this.viewModule;
        return DecorationSet.create(this.state.doc, this.rangeDecorations.flatMap(item => { const range = resolveRichRange(this.state.doc, this.revision, item.range); return range && range.from < range.to ? [Decoration.inline(range.from, range.to, { part: 'range-decoration', 'data-range-id': item.id, class: 'range-decoration' })] : []; }));
    }
    /** Apply accepted nonoverlapping passages in one undoable transaction; selection maps normally. */
    replaceRanges(replacements) {
        if (!this.editable || !replacements.length)
            return false;
        const resolved = replacements.map(item => ({ item, range: resolveRichRange(this.state.doc, this.revision, item.range) }));
        if (resolved.some(item => !item.range))
            return false;
        resolved.sort((a, b) => a.range.from - b.range.from);
        if (resolved.some((item, index) => index > 0 && (item.range.from < resolved[index - 1].range.to || item.range.from === resolved[index - 1].range.from)))
            return false;
        try {
            const tr = closeHistory(this.state.tr);
            for (const { item, range } of resolved.reverse()) {
                const normalized = new EditorDocument(item.runs).document.runs;
                let marks = this.state.doc.resolve(range.from).marks();
                // Nonempty passages inherit the first selected inline node, not its left neighbor.
                if (range.from < range.to) {
                    let found = false;
                    this.state.doc.nodesBetween(range.from, range.to, node => { if (!found && node.isInline) {
                        marks = node.marks;
                        found = true;
                    } return !found; });
                }
                const nodes = normalized.flatMap(run => run.kind === 'token' ? [richSchema.nodes.token.create({ run }, null, marks)] : run.text.split('\n').flatMap((text, index) => [...(index ? [richSchema.nodes.hard_break.create()] : []), ...(text ? [richSchema.text(text, marks)] : [])]));
                tr.replaceWith(range.from, range.to, Fragment.fromArray(nodes));
            }
            validateRichDocument(richSnapshot(tr.doc));
            const accepted = this.commit(tr.setMeta('reason', 'extension'));
            if (accepted)
                this.commit(closeHistory(this.state.tr).setMeta('addToHistory', false));
            return accepted;
        }
        catch {
            return false;
        }
    }
    /** Viewport selection bounds, or undefined before hydration. No live DOM Range is exposed. */
    getSelectionRect() {
        if (!this.view)
            return;
        const { from, to } = this.state.selection, a = this.view.coordsAtPos(from), b = this.view.coordsAtPos(to);
        return new DOMRect(Math.min(a.left, b.left), a.top, Math.max(1, Math.max(a.right, b.right) - Math.min(a.left, b.left)), Math.max(a.bottom, b.bottom) - a.top);
    }
    replaceBookmark(bookmark, runs) {
        const selection = this.bookmarks.resolve(bookmark, this.revision);
        if (!selection || !this.editable)
            return false;
        return this.replace(runs, selection.resolve(this.state.doc));
    }
    get editable() { return !!this.view && !this.disabled && !this.readOnly && !this.composing; }
    replace(runs, selection = this.state.selection) {
        if (!this.editable)
            return false;
        const normalized = new EditorDocument(runs).document.runs;
        const marks = this.state.storedMarks ?? selection.$from.marks();
        const nodes = normalized.flatMap(run => run.kind === 'token' ? [richSchema.nodes.token.create({ run }, null, marks)] : run.text.split('\n').flatMap((text, i) => [...(i ? [richSchema.nodes.hard_break.create()] : []), ...(text ? [richSchema.text(text, marks)] : [])]));
        const tr = closeHistory(this.state.tr).setSelection(selection).replaceWith(selection.from, selection.to, Fragment.fromArray(nodes));
        tr.setSelection(TextSelection.near(tr.doc.resolve(tr.mapping.map(selection.to))));
        return this.commit(tr.setMeta('reason', 'extension').scrollIntoView());
    }
    command(name, value) {
        switch (name) {
            case 'bold': return toggleMark(richSchema.marks.strong);
            case 'italic': return toggleMark(richSchema.marks.em);
            case 'paragraph': return setBlockType(richSchema.nodes.paragraph);
            case 'heading': return setBlockType(richSchema.nodes.heading, { level: 2 });
            case 'bullet-list':
            case 'ordered-list': {
                const list = richSchema.nodes[name === 'bullet-list' ? 'bullet_list' : 'ordered_list'];
                for (let i = this.state.selection.$from.depth; i > 0; i--)
                    if (this.state.selection.$from.node(i).type === list)
                        return liftListItem(richSchema.nodes.list_item);
                return wrapInList(list);
            }
            case 'undo': return undo;
            case 'redo': return redo;
            case 'link': return (state, dispatch) => { if (state.selection.empty || value !== undefined && !safeEditorLink(value))
                return false; dispatch?.(closeHistory(state.tr).addMark(state.selection.from, state.selection.to, richSchema.marks.link.create({ href: value?.trim() }))); return true; };
            case 'unlink': return (state, dispatch) => { if (state.selection.empty || !state.doc.rangeHasMark(state.selection.from, state.selection.to, richSchema.marks.link))
                return false; dispatch?.(closeHistory(state.tr).removeMark(state.selection.from, state.selection.to, richSchema.marks.link)); return true; };
        }
    }
    getCommandState(name) {
        let yes = 0, no = 0;
        const mark = richSchema.marks[name === 'bold' ? 'strong' : name === 'italic' ? 'em' : name === 'link' ? 'link' : ''];
        const type = richSchema.nodes[{ paragraph: 'paragraph', heading: 'heading', 'bullet-list': 'bullet_list', 'ordered-list': 'ordered_list' }[name]];
        const { from, to, empty, $from } = this.state.selection;
        if (mark) {
            if (empty) {
                yes = mark.isInSet(this.state.storedMarks ?? $from.marks()) ? 1 : 0;
                no = 1 - yes;
            }
            else
                this.state.doc.nodesBetween(from, to, node => { if (node.isInline) {
                    if (mark.isInSet(node.marks))
                        yes++;
                    else
                        no++;
                } });
        }
        else if (type) {
            this.state.doc.nodesBetween(from, to, (node, pos) => {
                if (node.isTextblock) {
                    let matches = node.type === type;
                    if (name.endsWith('list')) {
                        const point = this.state.doc.resolve(Math.min(pos + 1, this.state.doc.content.size));
                        for (let depth = point.depth; depth > 0; depth--)
                            if (point.node(depth).type === type)
                                matches = true;
                    }
                    if (matches)
                        yes++;
                    else
                        no++;
                }
            });
        }
        const enabled = this.editable && (name === 'undo' ? undoDepth(this.state) > 0 : name === 'redo' ? redoDepth(this.state) > 0 : !!this.command(name)?.(this.state));
        return Object.freeze({ enabled, active: yes > 0 && no === 0, mixed: yes > 0 && no > 0 });
    }
    /** Execute against the current selection or an explicit opaque bookmark. */
    execute(name, value, bookmark) {
        if (!this.editable || bookmark && !this.restoreBookmark(bookmark) || name === 'link' && (!value || !safeEditorLink(value)))
            return false;
        const command = this.command(name, value);
        if (!command)
            return false;
        let accepted = false;
        command(this.state, tr => { accepted = this.commit(closeHistory(tr).setMeta('reason', name).scrollIntoView()); }, this.view);
        if (accepted)
            this.focus();
        return accepted;
    }
    undo() { return this.execute('undo'); }
    redo() { return this.execute('redo'); }
    registerExtension(extension) {
        if (!extension.provide && !extension.render && !extension.open)
            throw new TypeError('Extension requires provider or picker');
        const dispose = this.registry.register(extension);
        this.refreshNodeViews();
        return () => { dispose(); this.refreshNodeViews(); };
    }
    registerToken(type, render, options = {}) {
        if (options.part && !/^[a-z][a-z0-9-]*$/.test(options.part))
            throw new TypeError('Invalid token part');
        const registration = { render, options: { ...options } };
        this.renderers.set(type, registration);
        this.refreshNodeViews();
        return () => { if (this.renderers.get(type) === registration) {
            this.renderers.delete(type);
            this.refreshNodeViews();
        } };
    }
    refreshNodeViews() { this.view?.setProps({ nodeViews: this.nodeViews() }); }
    openExtension(id, options = {}) {
        const extension = this.registry.get(id);
        if (!extension || !this.editable)
            return false;
        let token;
        let from = this.state.selection.from, to = this.state.selection.to;
        if (options.tokenId !== undefined) {
            this.state.doc.descendants((node, pos) => { if (node.type.name === 'token' && node.attrs.run.id === options.tokenId) {
                token = node.attrs.run;
                from = pos;
                to = pos + node.nodeSize;
            } });
            if (!token)
                return false;
        }
        this.focus();
        this.start(extension, '', from, to, true, token);
        return true;
    }
    /** Convert a token to editable trigger/query text and open its picker as one undoable edit. */
    editToken(tokenId, options = {}) {
        if (!this.editable)
            return false;
        let run, from = 0;
        this.state.doc.descendants((node, pos) => { if (node.type.name === 'token' && node.attrs.run.id === tokenId) {
            run = node.attrs.run;
            from = pos;
        } });
        if (!run)
            return false;
        const id = this.renderers.get(run.type)?.options.extension, extension = id ? this.registry.get(id) : undefined;
        if (!extension)
            return false;
        const query = options.query ?? '';
        if (typeof query !== 'string')
            throw new TypeError('Expected a query string');
        this.close();
        this.committing = true;
        try {
            const text = extension.trigger + query;
            if (!this.replace([{ kind: 'text', text }], TextSelection.create(this.state.doc, from, from + 1)))
                return false;
            this.focus();
            this.start(extension, query, from, from + text.length);
            return true;
        }
        finally {
            this.committing = false;
        }
    }
    deleteToken(run, from) {
        const options = this.renderers.get(run.type)?.options;
        if (options?.deleteBehavior === 'edit' && options.extension && this.registry.has(options.extension))
            this.editToken(run.id);
        else if (this.replace([], TextSelection.create(this.state.doc, from, from + 1)))
            this.focus();
    }
    deleteAdjacentToken(direction) {
        if (!this.editable || !this.state.selection.empty)
            return false;
        const { $from } = this.state.selection, node = direction === 'backward' ? $from.nodeBefore : $from.nodeAfter;
        if (node?.type.name !== 'token')
            return false;
        // Consume the deletion even when a cancelable change is vetoed; native deletion
        // must not bypass the application's decision or merely select the atomic node.
        this.deleteToken(node.attrs.run, direction === 'backward' ? $from.pos - node.nodeSize : $from.pos);
        return true;
    }
    nodeViews() {
        return { token: (node, _view, getPos) => {
                const run = node.attrs.run, registration = this.renderers.get(run.type);
                const interactive = !!registration?.options.extension;
                const dom = this.ownerDocument.createElement(interactive ? 'button' : 'span');
                if (isHTMLButton(dom)) {
                    dom.type = 'button';
                    dom.disabled = this.disabled || this.readOnly || !this.registry.has(registration.options.extension);
                    dom.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ')
                        event.stopPropagation(); if ((event.key === 'Backspace' || event.key === 'Delete') && !event.isComposing && this.editable) {
                        const pos = getPos();
                        if (pos !== undefined) {
                            event.preventDefault();
                            event.stopPropagation();
                            this.deleteToken(run, pos);
                        }
                    } });
                }
                dom.contentEditable = 'false';
                dom.dataset.token = run.id;
                dom.setAttribute('part', ['token', interactive ? 'token-interactive' : '', registration?.options.part ?? ''].filter(Boolean).join(' '));
                dom.setAttribute('aria-label', run.label);
                const content = this.ownerDocument.createElement('span');
                content.setAttribute('part', 'token-content');
                content.setAttribute('aria-hidden', 'true');
                try {
                    content.append(registration ? registration.render(run) : this.ownerDocument.createTextNode(run.text));
                }
                catch {
                    content.textContent = run.text;
                }
                dom.append(content);
                dom.addEventListener('click', () => { const extension = registration?.options.extension; if (extension)
                    this.openExtension(extension, { tokenId: run.id });
                else {
                    const pos = getPos();
                    if (pos !== undefined)
                        this.view?.dispatch(this.state.tr.setSelection(NodeSelection.create(this.state.doc, pos)));
                } });
                return { dom, ignoreMutation: () => true, stopEvent: (event) => interactive && (event.type === 'mousedown' || event.type === 'keydown' || event.type === 'click') };
            } };
    }
    /** Focus the native textbox and restore editor selection; no-op before the asynchronous view mounts. */
    focus(options) {
        if (!this.view)
            return;
        if (options)
            this.view.dom.focus(options);
        this.view.focus();
    }
    connectedCallback() {
        super.connectedCallback();
        const owner = this;
        this.unregister = registerChatEditor(this, { get value() { return owner.value; }, get disabled() { return owner.disabled; }, get readOnly() { return owner.readOnly; }, get composing() { return owner.composing; }, focus: options => owner.focus(options), reportValidity: () => !owner.session, getSnapshot: () => ({ value: owner.value, content: owner.document }) });
        if (this.hasUpdated)
            void this.updateComplete.then(() => this.mount());
    }
    disconnectedCallback() { this.mountGeneration++; this.unregister?.(); this.close(); this.view?.destroy(); this.view = undefined; super.disconnectedCallback(); }
    firstUpdated() { this.mount(); }
    async mount() {
        if (this.view || !this.isConnected)
            return;
        const generation = ++this.mountGeneration;
        const viewModule = await import('prosemirror-view');
        if (generation !== this.mountGeneration || !this.isConnected || this.view)
            return;
        this.viewModule = viewModule;
        const { EditorView } = viewModule;
        const mount = this.renderRoot.querySelector('.mount');
        mount.replaceChildren();
        this.view = new EditorView(mount, { state: this.state, dispatchTransaction: tr => { this.commit(tr); }, editable: () => !this.disabled && !this.readOnly,
            attributes: this.attributesForEditor(), nodeViews: this.nodeViews(), decorations: () => this.decorations(),
            handleKeyDown: (_view, event) => this.keydown(event),
            handleTripleClick: (view, _pos, event) => {
                if (this.disabled || this.composing || event.button !== 0)
                    return false;
                this.close();
                view.dom.focus({ preventScroll: true });
                const selected = selectAll(view.state, tr => view.dispatch(tr.setMeta('pointer', true)), view);
                // ProseMirror's readonly DOM-selection ownership check does not cross shadow roots.
                if (selected && this.readOnly) {
                    this.ownerDocument.getSelection()?.setBaseAndExtent(view.dom, 0, view.dom, view.dom.childNodes.length);
                }
                return selected;
            },
            handleDrop: () => true,
            handleDOMEvents: { copy: (_view, event) => this.copy(event), cut: (_view, event) => this.copy(event), paste: (_view, event) => this.paste(event), beforeinput: (_view, event) => { const input = event; if (input.cancelable && !input.isComposing && (input.inputType === 'deleteContentBackward' || input.inputType === 'deleteContentForward') && this.deleteAdjacentToken(input.inputType === 'deleteContentBackward' ? 'backward' : 'forward')) {
                    input.preventDefault();
                    return true;
                } return false; }, input: (_view, event) => { dispatchDraftInput(this, { value: this.draftValue, isComposing: this.composing, inputType: event.inputType ?? '' }); return false; },
                compositionstart: () => { this.close(); this.notify(); return false; }, compositionend: () => { setTimeout(() => { if (this.deferred) {
                    const doc = this.deferred;
                    this.deferred = undefined;
                    this.document = doc;
                } this.notify(); }, 0); return false; },
                keydown: (_view, event) => { if (event.key === 'Enter' && !event.ctrlKey && !event.metaKey)
                    event.stopPropagation(); return false; } }
        });
        this.notify();
    }
    copy(event) {
        if (this.state.selection.empty || !event.clipboardData)
            return false;
        const slice = this.state.selection.content();
        if (!writeEditorClipboard(event.clipboardData, clipboardRuns(slice), slice.toJSON(), clipboardHTML(slice)))
            return false;
        event.preventDefault();
        if (event.type === 'cut' && this.editable) {
            this.close();
            this.commit(closeHistory(this.state.tr).deleteSelection().setMeta('reason', 'cut').scrollIntoView());
        }
        return true;
    }
    paste(event) {
        event.preventDefault();
        if (!this.editable || !event.clipboardData)
            return true;
        const data = event.clipboardData, structured = readEditorClipboard(data), used = new Set();
        this.state.doc.descendants(node => { if (node.type.name === 'token')
            used.add(node.attrs.run.id); });
        const importToken = (token, context) => { const handler = this.renderers.get(token.type)?.options.importToken; return handler ? handler(token, context) : token; };
        let slice;
        for (const run of structured?.runs ?? [])
            if (run.kind === 'token')
                used.add(run.id);
        if (structured)
            try {
                slice = structured.rich === undefined ? runsSlice(importClipboardRuns(structured.runs, type => this.renderers.has(type), used, importToken)) : importRichClipboard(structured.rich, type => this.renderers.has(type), used, importToken);
            }
            catch { /* Invalid private data falls back to readable text. */ }
        else
            slice = externalRichClipboard(data.getData('text/html'), this.ownerDocument);
        try {
            slice ??= runsSlice([{ kind: 'text', text: data.getData('text/plain') }], this.state.storedMarks ?? this.state.selection.$from.marks());
            this.close();
            this.commit(closeHistory(this.state.tr).replaceSelection(slice).setMeta('reason', 'paste').scrollIntoView());
        }
        catch { /* A fallback or final document exceeding schema limits leaves history/content unchanged. */ }
        return true;
    }
    draftText() {
        if (!this.view)
            return this.value;
        const tokens = new Map();
        this.state.doc.descendants(node => { if (node.type.name === 'token')
            tokens.set(node.attrs.run.id, node.attrs.run.text); });
        const read = (node) => {
            if (node.nodeType === 3)
                return node.textContent ?? '';
            const element = node;
            if (element.dataset?.token)
                return tokens.get(element.dataset.token) ?? element.textContent ?? '';
            if (node.nodeName === 'BR')
                return element.classList.contains('ProseMirror-trailingBreak') ? '' : '\n';
            return [...node.childNodes].map((child, index) => (index && /^(P|DIV|H[1-3]|LI|UL|OL)$/.test(child.nodeName) ? '\n' : '') + read(child)).join('');
        };
        return read(this.view.dom);
    }
    attributesForEditor() { return { class: 'editor', part: 'control', role: 'textbox', 'aria-label': this.label, 'aria-multiline': 'true', 'aria-readonly': String(this.readOnly), 'aria-disabled': String(this.disabled), tabindex: this.disabled ? '-1' : '0', 'aria-describedby': 'description rich-hint' }; }
    updated(changed) { if (changed.has('disabled') || changed.has('readOnly') || changed.has('label')) {
        if (this.disabled || this.readOnly)
            this.close();
        this.view?.setProps({ attributes: this.attributesForEditor(), editable: () => !this.disabled && !this.readOnly, nodeViews: this.nodeViews() });
        this.notify();
    } }
    commit(tr) {
        const previous = this.state;
        if (tr.docChanged && (this.disabled || this.readOnly))
            return false;
        const next = previous.apply(tr);
        if (tr.docChanged) {
            const proposed = richSnapshot(next.doc);
            validateRichDocument(proposed);
            const outcome = dispatchChange(this, {
                previous: richSnapshot(previous.doc), proposed, reason: tr.getMeta('reason') ?? 'input',
                getRevision: () => this.authorVersion,
                stage: () => { this.state = next; },
                rollback: () => { this.state = previous; this.view?.updateState(previous); this.notify(); },
                canCommit: () => this.isConnected && !this.disabled && !this.readOnly,
                commit: () => { this.version++; this.view?.updateState(this.state); if (!this.committing)
                    this.detect(); this.notify(); },
            });
            return outcome === 'committed';
        }
        this.state = next;
        this.view?.updateState(next);
        if (!this.committing)
            this.detect();
        this.notify();
        return true;
    }
    notify() { this.dispatchEvent(new CustomEvent('en-editor-state', { bubbles: true, composed: true })); }
    signature() { return `${this.revision}:${this.state.selection.from}:${this.state.selection.to}`; }
    detect() {
        if (!this.editable || !this.view?.hasFocus() || this.committing)
            return;
        const { from, to, $from, empty } = this.state.selection;
        if (this.session?.manual && this.session.revision === this.revision)
            return;
        if (!empty) {
            this.close();
            return;
        }
        if (this.dismissed === this.signature())
            return;
        // Stop at the last atom within the current textblock; never match across a block.
        let start = $from.start(), before = '';
        $from.parent.forEach((node, offset) => { const pos = $from.start() + offset; if (pos >= from)
            return; if (node.isText)
            before += (node.text ?? '').slice(0, from - pos);
        else {
            before = '';
            start = pos + node.nodeSize;
        } });
        const match = this.registry.match(before);
        if (!match) {
            this.close();
            return;
        }
        if (this.session?.extension === match.extension && this.session.query === match.query && this.session.revision === this.revision && this.session.to === to)
            return;
        this.start(match.extension, match.query, start + match.from, to);
    }
    start(extension, query, from, to, manual = false, token) {
        this.close();
        const session = { extension, query, from, to, manual, token, revision: this.revision, controller: new AbortController(), choices: [], active: 0, loading: !!extension.provide, error: false, external: !!extension.open };
        this.session = session;
        this.refresh();
        this.track(true);
        this.notify();
        if (extension.open) {
            try {
                extension.open(this.pickerSession(session));
            }
            catch (error) {
                if (this.session === session)
                    this.close();
                else
                    session.controller.abort();
                throw error;
            }
            return;
        }
        if (extension.provide)
            this.queryTask.start(query, extension.provide, choices => { if (this.session === session && !session.external) {
                session.choices = choices;
                session.loading = false;
                this.refresh();
            } }, () => { if (this.session === session) {
                session.loading = false;
                session.error = true;
                this.refresh();
            } }, session.controller);
    }
    valid(session) { return this.session === session && session.revision === this.revision && !session.controller.signal.aborted && this.isConnected && this.editable; }
    pickerSession(session) { return { query: session.query, token: session.token, signal: session.controller.signal, getAnchorRect: () => this.pickerRect(session), openPicker: open => { if (!this.valid(session))
            return false; session.external = true; this.popup?.hidePopover(); this.refresh(); try {
            open(this.pickerSession(session));
        }
        catch (error) {
            if (this.session === session)
                this.close();
            else
                session.controller.abort();
            throw error;
        } return true; }, commit: choice => this.complete(session, choice), cancel: () => { if (this.session !== session)
            return; this.close(); this.restoreSessionFocus(session); this.dismissed = this.signature(); } }; }
    restoreSessionFocus(session) {
        const button = session.token ? [...this.view?.dom.querySelectorAll('button[data-token]') ?? []].find(node => node.dataset.token === session.token.id) : undefined;
        if (button && !this.disabled && !this.readOnly)
            button.focus();
        else
            this.focus();
    }
    pickerRect(session) {
        if (!this.valid(session) || !this.view)
            return this.getBoundingClientRect();
        const token = session.token && [...this.view.dom.querySelectorAll('[data-token]')].find(node => node.dataset.token === session.token.id);
        if (token)
            return token.getBoundingClientRect();
        const caret = this.caretRect(session.to);
        if (session.manual)
            return caret;
        const point = this.view.domAtPos(session.from, 1);
        let trigger = this.caretRect(session.from);
        if (point.node.nodeType === 3) {
            const text = point.node.textContent ?? '', range = this.ownerDocument.createRange();
            range.setStart(point.node, point.offset);
            range.setEnd(point.node, Math.min(text.length, point.offset + (text.codePointAt(point.offset) > 0xffff ? 2 : 1)));
            const rect = range.getClientRects()[0];
            if (rect?.height)
                trigger = rect;
        }
        return editorTriggerAnchor(this.view.dom, trigger, caret);
    }
    caretRect(position) {
        const rect = this.view.coordsAtPos(position);
        return new DOMRect(rect.left, rect.top, Math.max(1, rect.right - rect.left), rect.bottom - rect.top);
    }
    complete(session, choice) {
        if (!this.valid(session))
            return false;
        this.committing = true;
        try {
            if (choice.action && !dispatchAction(this, { action: choice.action, data: choice.data === undefined ? undefined : snapshotEditorData(choice.data) }, { cancelable: true }))
                return false;
            if (!this.valid(session))
                return false;
            const selection = TextSelection.create(this.state.doc, session.from, session.to);
            const result = this.replace(choice.insert ?? [], selection);
            if (result) {
                this.close();
                this.focus();
            }
            return result;
        }
        finally {
            this.committing = false;
        }
    }
    choose(session, choice) { if (!this.valid(session))
        return; if (session.extension.select) {
        try {
            session.extension.select(choice, this.pickerSession(session));
        }
        catch (error) {
            if (this.session === session)
                this.close();
            else
                session.controller.abort();
            throw error;
        }
    }
    else
        this.complete(session, choice); }
    keydown(event) {
        if (event.isComposing || this.composing)
            return false;
        if (event.altKey && event.key === 'F10') {
            event.preventDefault();
            event.stopPropagation();
            this.dispatchEvent(new CustomEvent('en-toolbar-request', { cancelable: true }));
            return true;
        }
        const s = this.session;
        if (s) {
            if (event.key === 'Escape') {
                event.stopPropagation();
                this.pickerSession(s).cancel();
                return true;
            }
            if (event.key === 'Tab') {
                if (!s.extension.render)
                    this.close();
                return false;
            }
            if (s.extension.render && (event.key === 'Enter' || event.key === 'ArrowDown') && this.view?.hasFocus()) {
                event.stopPropagation();
                (this.popup?.querySelector('[data-picker-focus],input,button,[tabindex="0"]'))?.focus();
                return true;
            }
            if (s.extension.render)
                return false;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                const length = s.choices.length;
                if (length)
                    s.active = (s.active + (event.key === 'ArrowDown' ? 1 : -1) + length) % length;
                this.refresh();
                return true;
            }
            if (event.key === 'Enter') {
                event.stopPropagation();
                const choice = s.choices[s.active];
                if (choice)
                    this.choose(s, choice);
                return true;
            }
        }
        if ((event.key === 'Enter' || event.key === ' ') && this.state.selection instanceof NodeSelection && this.state.selection.node.type.name === 'token') {
            const run = this.state.selection.node.attrs.run, extension = this.renderers.get(run.type)?.options.extension;
            if (extension) {
                event.stopPropagation();
                return this.openExtension(extension, { tokenId: run.id });
            }
        }
        if ((event.key === 'Backspace' || event.key === 'Delete') && !event.altKey && !event.ctrlKey && !event.metaKey && this.deleteAdjacentToken(event.key === 'Backspace' ? 'backward' : 'forward'))
            return true;
        return false;
    }
    close() { this.queryTask.cancel(); if (!this.session)
        return; this.session.controller.abort(); this.session = undefined; this.track(false); if (this.popup?.matches(':popover-open'))
        this.popup.hidePopover(); this.refresh(); this.notify(); }
    refresh() { this.sessionVersion++; void this.updateComplete.then(() => { const s = this.session, popup = this.popup; if (s && !s.external && this.isConnected && popup) {
        if (!popup.matches(':popover-open'))
            popup.showPopover();
        this.position();
    } if (this.view) {
        const s = this.session;
        this.view.dom.setAttribute('aria-expanded', String(!!s && !s.external));
        if (s && !s.extension.render && s.choices.length)
            this.view.dom.setAttribute('aria-activedescendant', `rich-choice-${s.active}`);
        else
            this.view.dom.removeAttribute('aria-activedescendant');
        if (s) {
            this.view.dom.setAttribute('aria-controls', 'rich-popup');
            this.view.dom.setAttribute('aria-haspopup', s.extension.render ? 'dialog' : 'listbox');
        }
        else {
            this.view.dom.removeAttribute('aria-controls');
            this.view.dom.removeAttribute('aria-haspopup');
        }
    } }); }
    outside = (event) => { if (!this.session?.external && !event.composedPath().includes(this))
        this.close(); };
    popupResize;
    track(on) { const view = this.ownerDocument.defaultView; if (!view)
        return; const method = on ? 'addEventListener' : 'removeEventListener'; this.ownerDocument[method]('pointerdown', this.outside, true); this.ownerDocument[method]('focusin', this.outside, true); view[method]('scroll', this.position, true); view[method]('resize', this.position); view.visualViewport?.[method]('resize', this.position); view.visualViewport?.[method]('scroll', this.position); this.popupResize?.disconnect(); this.popupResize = on ? observeEditorPopup(this.view?.dom, this.popup, this.position) : undefined; if (!on)
        cancelAnimationFrame(this.frame); }
    position = () => { cancelAnimationFrame(this.frame); this.frame = requestAnimationFrame(() => { const popup = this.popup, editor = this.view?.dom, s = this.session; if (popup && editor && s && !s.external)
        positionEditorPopup(popup, editor, this.pickerRect(s), !!s.extension.render, s.token ? undefined : this.caretRect(s.to)); }); };
    render() {
        this.initialMarkup ??= richHTML(this.state.doc);
        const s = this.session;
        const messages = editorMessages(this.effectiveMessages);
        return staticHtml `<span class="label" part="label"><slot name="label">${this.label}</slot></span><div class="mount"><div class="editor" part="control" role="textbox" aria-label=${this.label} aria-multiline="true" aria-readonly="true" aria-describedby="description rich-hint">${unsafeStatic(this.initialMarkup)}</div></div>${descriptionTemplate(this.description)}<span id="rich-hint" class="hint">${messages.instructions.richText} ${s && !s.external ? (s.extension.render ? messages.instructions.picker : messages.suggestions.keyboardHint) : ''}</span><div class="popup" part="popup" id="rich-popup" popover="manual" role=${s?.extension.render ? 'dialog' : 'listbox'} aria-label=${s?.extension.label ?? messages.suggestions.label} @keydown=${(event) => { if (this.keydown(event))
            event.preventDefault(); }}>${s ? s.extension.render ? s.extension.render(this.pickerSession(s)) : html `${s.loading ? html `<span role="status">${messages.suggestions.loading}</span>` : s.error ? html `<span role="status">${messages.suggestions.unavailable}</span>` : !s.choices.length ? html `<span role="status">${messages.suggestions.empty}</span>` : s.choices.map((choice, i) => html `<div class="option" part="option" id=${`rich-choice-${i}`} role="option" aria-selected=${String(i === s.active)} aria-label=${choice.label} aria-describedby=${choice.description ? `rich-choice-description-${i}` : nothing} @pointerdown=${(event) => event.preventDefault()} @click=${() => this.choose(s, choice)}>${s.extension.renderOption ? s.extension.renderOption(choice) : choice.label}${choice.description ? html `<span class="description" id=${`rich-choice-description-${i}`}>${choice.description}</span>` : nothing}</div>`)}` : nothing}</div>`;
    }
}
