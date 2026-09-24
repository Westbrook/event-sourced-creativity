import { isHTMLElement } from './internal/dom-kind.js';
import { connectionDocument } from './internal/element-registry.js';
import { ChildUpgrades } from './internal/child-upgrades.js';
import { isCollectionKey } from '../primitives/state/collection.js';
import { html, nothing } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { EnElement } from './internal/en-element.js';
import { CarouselContextProvider } from './internal/carousel-context.js';
import { foundationStyles, blockHostStyles } from '../styles/foundations.js';
import { buttonStyles } from '../styles/buttons.js';
import { carouselStyles } from '../styles/carousel.js';
import { dispatchChange } from '../primitives/interactions/events.js';
/**
 * Finite, slot-first horizontal carousel. No media fetching or slide cloning.
 * @tagname en-carousel
 * @slot - Direct en-carousel-slide children in reading order.
 * @slot previous - Noninteractive previous-control icon/content.
 * @slot next - Noninteractive next-control icon/content.
 * @csspart base - Named carousel group.
 * @csspart viewport - Focusable native scrolling surface.
 * @csspart controls - Navigation and position layout.
 * @csspart previous - Previous en-button host.
 * @csspart next - Next en-button host.
 * @csspart rotation - Start/stop en-button host.
 * @csspart position - Visible position.
 * @csspart picker - Scrollable slide-position navigation group.
 * @csspart picker-button - Native position/thumbnail button.
 * @csspart picker-current - Current leading-window button.
 * @csspart thumbnail - Decorative thumbnail image.
 * @csspart picker-number - Visible thumbnail position.
 * @csspart first - Optional first-window shortcut in controls.
 * @csspart last - Optional last-window shortcut in controls.
 * @csspart picker-range - Visible contiguous picker range.
 * @csspart picker-tooltip-surface - Thumbnail hover/focus tooltip surface.
 * @csspart track - Native horizontal extent for a keyed collection.
 * @csspart slide - Mounted keyed slide host.
 * @csspart reading-list - Paginated list alternative.
 * @csspart reading-item - List entry.
 * @csspart announcement - Polite manual-navigation status.
 * @cssprop --en-carousel-viewport-size - Stable keyed collection frame height; defaults to 22rem.
 * @cssprop --en-carousel-gap - Slide/control spacing.
 * @cssprop --en-carousel-slides-per-view - Positive integer visible-slide count; overrides slides-per-view.
 * @cssprop --en-carousel-radius - Viewport and slide corners.
 * @cssprop --en-carousel-background - Slide surface.
 * @cssprop --en-carousel-border-color - Slide boundary.
 * @fires {import('./events.js').CarouselChangeEvent} en-change - Cancelable zero-based leading-index change with previous, proposed and reason.
 */
export class EnCarousel extends EnElement {
    slideContexts = new CarouselContextProvider(this);
    static properties = { items: { attribute: false, noAccessor: true }, renderItem: { attribute: false }, readingMode: { attribute: 'reading-mode', reflect: true }, pageSize: { type: Number, attribute: 'page-size' }, previousPageLabel: { attribute: 'previous-page-label' }, nextPageLabel: { attribute: 'next-page-label' }, listLabel: { attribute: 'list-label' }, overscan: { type: Number }, collectionOffset: { state: true }, collectionWidth: { state: true }, collectionGap: { state: true }, label: {}, controls: {}, boundaryControls: { type: Boolean, attribute: 'boundary-controls' }, navigation: {}, pickerLabel: { attribute: 'picker-label' }, pickLabel: { attribute: 'pick-label' }, pickerFocus: { state: true }, pickerCapacity: { state: true }, firstLabel: { attribute: 'first-label' }, lastLabel: { attribute: 'last-label' }, pickerRangeLabel: { attribute: 'picker-range-label' }, index: { type: Number, noAccessor: true, reflect: true }, slidesPerView: { type: Number, attribute: 'slides-per-view' }, loop: { type: Boolean }, autoplay: { type: Boolean }, interval: { type: Number }, previousLabel: { attribute: 'previous-label' }, nextLabel: { attribute: 'next-label' }, startLabel: { attribute: 'start-label' }, stopLabel: { attribute: 'stop-label' }, positionLabel: { attribute: 'position-label' }, rangeLabel: { attribute: 'range-label' }, emptyLabel: { attribute: 'empty-label' }, carouselLabel: { attribute: 'carousel-label' }, slideLabel: { attribute: 'slide-label' }, viewportLabel: { attribute: 'viewport-label' }, ready: { state: true }, count: { state: true }, end: { state: true }, visibleCount: { state: true }, stopped: { state: true }, reduced: { state: true }, announcement: { state: true } };
    static styles = [foundationStyles, blockHostStyles, buttonStyles, carouselStyles];
    // Pointer focus precedes click. Expanding its neighbors at that point moves
    // the pressed button before release, so only navigation advances this window.
    pickerWindowFocus = 0;
    /** Optional keyed collection. undefined uses authored slides; null is a legacy input alias; an empty array is an empty collection. Assign a new array after changes. */
    get items() { return this.collection ?? undefined; }
    set items(value) {
        if (value != null && !Array.isArray(value))
            throw new TypeError('Carousel items must be an array or undefined (legacy: null).');
        value ??= null;
        const keys = new Set();
        for (const item of value ?? []) {
            if (!item || !isCollectionKey(item.key) || keys.has(item.key))
                throw new TypeError('Carousel items require unique, nonblank string keys.');
            keys.add(item.key);
        }
        const previous = this.collection;
        if ((previous === null) !== (value === null)) {
            for (const slide of this.slides) {
                this.slideContexts.set(slide, null);
                this.resize?.unobserve(slide);
            }
        }
        const anchor = previous?.[this.index]?.key;
        const focusedElement = this.renderRoot?.querySelector('[data-key]:focus-within');
        const focused = focusedElement?.dataset.key ?? this.focusedSlide?.dataset.key;
        if (focused && keys.has(focused)) {
            let active = this.ownerDocument.activeElement;
            while (active?.shadowRoot?.activeElement)
                active = active.shadowRoot.activeElement;
            this.pendingSlideFocus = isHTMLElement(active) ? active : undefined;
        }
        const focusedPicker = previous?.[this.pickerFocus]?.key;
        this.pendingPickerFocus = this.renderRoot?.querySelector('.picker-button:focus') ? focusedPicker : undefined;
        this.collection = value ? [...value] : null;
        if (value)
            this.count = value.length;
        ++this.revision;
        if (anchor && value) {
            const next = value.findIndex(item => item.key === anchor);
            if (next >= 0)
                this.setIndex(next);
        }
        if (focused && !keys.has(focused)) {
            this.viewport?.focus({ preventScroll: true });
            this.focusedSlide = undefined;
        }
        if (focusedPicker && value) {
            const next = value.findIndex(item => item.key === focusedPicker);
            this.pickerFocus = next < 0 ? this.index : next;
        }
        this.requestUpdate('items', previous);
    }
    /** Stable key of the leading item. undefined in authored mode or an empty collection. */
    get currentKey() { return this.collection?.[this.index]?.key; }
    collection = null;
    pendingPickerFocus;
    pendingSlideFocus;
    current = 0;
    revision = 0;
    connectionGeneration = 0;
    slides = [];
    upgrades = new ChildUpgrades(this, () => this.sync());
    observer;
    resize;
    motion;
    timer;
    settleTimer;
    frame = 0;
    hovering = false;
    focusedSlide;
    focusedPickerSlide;
    rotationIntent;
    aligning = false;
    /** Zero-based leading slide; writes are silent and clamped to the last full window. */
    get index() {
        if (!this.collection)
            return this.current;
        const visible = this.listMode ? this.listPageSize : Math.max(1, this.ready ? this.visibleCount : Math.floor(this.slidesPerView || 1));
        const last = this.listMode ? Math.max(0, Math.floor((this.collection.length - 1) / visible) * visible) : Math.max(0, this.collection.length - visible);
        const index = Math.min(this.current, last);
        return this.listMode ? Math.floor(index / visible) * visible : index;
    }
    set index(value) {
        ++this.revision;
        this.aligning = false;
        this.setIndex(Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0);
    }
    setIndex(value) {
        const old = this.current;
        this.current = value;
        this.requestUpdate('index', old);
    }
    constructor() {
        super();
        this.label = 'Slides';
        this.readingMode = 'carousel';
        this.pageSize = 10;
        this.previousPageLabel = 'Previous page';
        this.nextPageLabel = 'Next page';
        this.listLabel = 'Slides as a paginated list';
        this.overscan = 2;
        this.collectionOffset = 0;
        this.collectionWidth = 1;
        this.collectionGap = 0;
        this.controls = 'none';
        this.boundaryControls = false;
        this.navigation = 'none';
        this.pickerLabel = 'Choose slides';
        this.pickLabel = 'Show {position}: {label}';
        this.pickerFocus = 0;
        this.pickerCapacity = 7;
        this.firstLabel = 'First';
        this.lastLabel = 'Last';
        this.pickerRangeLabel = 'Showing choices {start}–{end} of {total}';
        this.slidesPerView = 1;
        this.loop = false;
        this.autoplay = false;
        this.interval = 7000;
        this.previousLabel = 'Previous slide';
        this.nextLabel = 'Next slide';
        this.startLabel = 'Start slide rotation';
        this.stopLabel = 'Stop slide rotation';
        this.positionLabel = '{current} of {total}';
        this.rangeLabel = '{current}–{end} of {total}';
        this.emptyLabel = 'No slides';
        this.carouselLabel = 'carousel';
        this.slideLabel = 'slide';
        this.viewportLabel = 'Slides. Use Left and Right arrows to browse.';
        this.ready = false;
        this.count = 0;
        this.end = 0;
        this.visibleCount = 1;
        this.stopped = false;
        this.reduced = false;
        this.announcement = '';
    }
    get viewport() {
        return this.renderRoot?.querySelector('.viewport');
    }
    get rotating() {
        return !this.listMode && this.autoplay && !this.stopped && !this.reduced && this.count > this.visibleCount;
    }
    connectedCallback() {
        const generation = ++this.connectionGeneration;
        super.connectedCallback();
        void this.updateComplete.then(() => {
            if (!this.isConnected || generation !== this.connectionGeneration)
                return;
            this.motion = this.ownerDocument.defaultView.matchMedia('(prefers-reduced-motion: reduce)');
            this.reduced = this.motion.matches;
            if (this.reduced)
                this.stopped = true;
            this.motion.addEventListener('change', this.onMotion);
            this.ownerDocument.addEventListener('visibilitychange', this.scheduleRotation);
            this.observer = new MutationObserver(() => this.sync());
            this.observer.observe(this, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'dir', 'slot', 'label', 'thumbnail', 'style', 'class'] });
            this.resize = new ResizeObserver(() => this.layout());
            if (this.viewport)
                this.resize.observe(this.viewport);
            this.ready = true;
            this.sync();
        });
    }
    disconnectedCallback() {
        ++this.connectionGeneration;
        connectionDocument(this).removeEventListener('visibilitychange', this.scheduleRotation);
        super.disconnectedCallback();
        this.observer?.disconnect();
        this.resize?.disconnect();
        this.motion?.removeEventListener('change', this.onMotion);
        clearTimeout(this.timer);
        clearTimeout(this.settleTimer);
        cancelAnimationFrame(this.frame);
        for (const slide of this.slides)
            this.slideContexts.set(slide, null);
        this.ready = false;
        this.slides = [];
    }
    get showControls() { return this.ready && (this.controls === 'always' || this.controls === 'auto' && this.end > 0); }
    get showPicker() { return this.ready && !this.listMode && this.count > 0 && (this.navigation === 'positions' || this.navigation === 'thumbnails'); }
    willUpdate(changes) {
        const removedControl = !this.showControls && this.renderRoot?.querySelector('.controls:focus-within')
            || !this.showPicker && this.renderRoot?.querySelector('.picker:focus-within')
            || !this.boundaryControls && this.renderRoot?.querySelector('[part="first"]:focus-within, [part="last"]:focus-within');
        if (removedControl)
            this.viewport?.focus({ preventScroll: true });
        if (changes.has('index') || changes.has('items')) {
            const focused = this.renderRoot?.querySelector('.picker-button:focus');
            this.pickerWindowFocus = focused || this.pendingPickerFocus ? this.pickerFocus : this.index;
            if (!focused && !this.pendingPickerFocus)
                this.pickerFocus = this.index;
        }
        // Keyed repeat may move a pinned node while replacing its surrounding window.
        // Preserve actual DOM focus, as browsers can blur even a retained node during a move.
        if (this.collection && !this.listMode && !changes.has('readingMode')) {
            const slide = this.renderRoot?.querySelector('.collection-slide:focus-within');
            if (slide) {
                this.focusedSlide = slide;
                let active = this.ownerDocument.activeElement;
                while (active?.shadowRoot?.activeElement)
                    active = active.shadowRoot.activeElement;
                if (isHTMLElement(active))
                    this.pendingSlideFocus = active;
            }
        }
        if (changes.has('readingMode') && this.viewport?.matches(':focus-within'))
            this.viewport.focus({ preventScroll: true });
        if (this.listMode && changes.has('index')) {
            const focused = this.renderRoot?.querySelector('.reading-list [data-key]:focus-within');
            const index = focused ? this.collection?.findIndex(item => item.key === focused.dataset.key) : undefined;
            if (index !== undefined && (index < this.index || index >= this.index + this.listPageSize))
                this.viewport?.focus({ preventScroll: true });
        }
    }
    updated(changes) {
        if (!this.ready)
            return;
        if (changes.has('items'))
            this.sync();
        if (changes.has('readingMode')) {
            this.pause();
            this.focusedSlide = undefined;
            this.sync();
        }
        if (changes.has('pageSize') || changes.has('readingMode'))
            this.layout();
        if (changes.has('collectionWidth') || changes.has('collectionGap'))
            this.align();
        if ((changes.has('index') && !this.aligning) || changes.has('slidesPerView'))
            this.layout();
        if (changes.has('autoplay'))
            this.stopped = this.reduced;
        if (changes.has('index') && !this.renderRoot.querySelector('.picker-button:focus'))
            this.pickerFocus = this.index;
        if (changes.has('index') || changes.has('navigation'))
            this.revealPicker(this.index);
        this.refreshCollectionSlides();
        if (this.pendingSlideFocus) {
            const target = this.pendingSlideFocus;
            this.pendingSlideFocus = undefined;
            let active = this.ownerDocument.activeElement;
            while (active?.shadowRoot?.activeElement)
                active = active.shadowRoot.activeElement;
            // A consumer's synchronous focus choice wins over our recovery after DOM moves.
            if (target.isConnected && (!active || active === target || active === this.ownerDocument.body || active === this.ownerDocument.documentElement))
                target.focus({ preventScroll: true });
        }
        if (this.pendingPickerFocus) {
            const key = this.pendingPickerFocus;
            this.pendingPickerFocus = undefined;
            const index = this.collection?.findIndex(item => item.key === key) ?? -1;
            const button = this.pickerButtons().find(button => Number(button.dataset.index) === (index < 0 ? this.pickerFocus : index));
            const target = button ?? this.viewport;
            let active = this.ownerDocument.activeElement;
            while (active?.shadowRoot?.activeElement)
                active = active.shadowRoot.activeElement;
            if (!active || active === target || active === this.ownerDocument.body || active === this.ownerDocument.documentElement)
                target?.focus({ preventScroll: true });
        }
        this.updateSlides();
        this.scheduleRotation();
    }
    onMotion = () => {
        this.reduced = Boolean(this.motion?.matches);
        if (this.reduced)
            this.pause();
        this.align();
    };
    sync() {
        if (!this.ready)
            return;
        if (this.collection) {
            this.count = this.collection.length;
            this.refreshCollectionSlides();
            this.layout();
            return;
        }
        const previous = this.slides, anchor = previous[this.index];
        const focused = this.renderRoot.querySelector('.picker-button:focus');
        const focusedSlide = focused ? this.focusedPickerSlide : undefined;
        this.upgrades.watch(this.children);
        const items = Array.from(this.children).filter((el) => el.localName === 'en-carousel-slide' && !el.hasAttribute('slot') && !el.hasAttribute('hidden'));
        for (const slide of previous)
            if (!items.includes(slide)) {
                this.slideContexts.set(slide, null);
                this.resize?.unobserve(slide);
            }
        this.slides = items;
        this.count = items.length;
        for (const slide of items)
            this.resize?.observe(slide);
        if (anchor && items.includes(anchor))
            this.setIndex(items.indexOf(anchor));
        if (this.focusedSlide && !items.includes(this.focusedSlide)) {
            this.viewport?.focus({ preventScroll: true });
            this.focusedSlide = undefined;
        }
        this.layout();
        this.requestUpdate(); // Labels and thumbnail metadata can change without changing count.
        if (focusedSlide) {
            this.pickerFocus = Math.max(0, Math.min(items.indexOf(focusedSlide), this.end));
            void this.updateComplete.then(() => {
                const button = this.pickerButtons()[this.pickerFocus];
                if (button)
                    button.focus({ preventScroll: true });
                else
                    this.viewport?.focus({ preventScroll: true });
            });
        }
    }
    layout() {
        const port = this.viewport;
        if (!port || !this.ready)
            return;
        const style = getComputedStyle(port);
        const width = port.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        const gap = parseFloat(style.columnGap) || 0;
        const rem = parseFloat(getComputedStyle(this.ownerDocument.documentElement).fontSize) || 16;
        this.pickerCapacity = width >= 44 * rem ? 7 : width >= 32 * rem ? 5 : 3;
        if (this.collection) {
            const perView = Math.max(1, Math.floor(parseFloat(style.getPropertyValue('--en-carousel-slides-per-view')) || this.slidesPerView || 1));
            this.collectionWidth = Math.max(1, (width - (perView - 1) * gap) / perView);
            this.collectionGap = gap;
            this.visibleCount = this.listMode ? this.listPageSize : perView;
        }
        else {
            const slideWidth = this.slides[0]?.getBoundingClientRect().width ?? width;
            this.visibleCount = Math.max(1, Math.floor((width + gap) / (slideWidth + gap) + .02));
        }
        this.end = this.listMode ? Math.max(0, Math.floor((this.count - 1) / this.listPageSize) * this.listPageSize) : Math.max(0, this.count - this.visibleCount);
        const focusedPicker = this.renderRoot.querySelector('.picker-button:focus');
        this.pickerFocus = Math.min(this.pickerFocus, this.end);
        if (focusedPicker && Number(focusedPicker.dataset.index) > this.end)
            void this.updateComplete.then(() => this.pickerButtons().find(button => Number(button.dataset.index) === this.pickerFocus)?.focus({ preventScroll: true }));
        this.setIndex(this.listMode ? Math.floor(Math.min(this.index, this.end) / this.listPageSize) * this.listPageSize : Math.min(this.index, this.end));
        this.align();
        this.updateSlides();
        this.scheduleRotation();
    }
    offset(slide) {
        const port = this.viewport;
        const p = port.getBoundingClientRect(), s = slide.getBoundingClientRect(), style = getComputedStyle(port);
        return style.direction === 'rtl' ? s.right - (p.right - parseFloat(style.paddingRight)) : s.left - (p.left + parseFloat(style.paddingLeft));
    }
    align(behavior = 'instant') {
        const port = this.viewport, slide = this.slides[this.index];
        if (port && this.collection) {
            if (this.listMode)
                return;
            this.aligning = true;
            const offset = this.index * (this.collectionWidth + this.collectionGap);
            // Direct jumps mount the destination immediately; native scroll frames mount the intervening windows.
            this.collectionOffset = offset;
            port.scrollTo({ left: getComputedStyle(port).direction === 'rtl' ? -offset : offset, behavior: 'instant' });
            clearTimeout(this.settleTimer);
            this.settleTimer = setTimeout(() => this.finishScroll(), 140);
            return;
        }
        if (!port || !slide)
            return;
        this.aligning = true;
        port.scrollTo({ left: port.scrollLeft + this.offset(slide), behavior: this.reduced ? 'instant' : behavior });
        clearTimeout(this.settleTimer);
        this.settleTimer = setTimeout(() => this.finishScroll(), 140);
    }
    updateSlides() {
        const port = this.viewport;
        if (!port)
            return;
        const p = port.getBoundingClientRect();
        this.slides.forEach((slide, localIndex) => {
            const i = this.collection ? Number(slide.dataset.index) : localIndex;
            const r = slide.getBoundingClientRect();
            const visible = this.listMode || Math.min(r.right, p.right) - Math.max(r.left, p.left) > 1 || slide.matches(':focus-within') || slide === this.focusedSlide && Boolean(this.pendingSlideFocus?.isConnected);
            this.slideContexts.set(slide, { position: this.positionLabel.replaceAll('{current}', String(i + 1)).replaceAll('{end}', String(i + 1)).replaceAll('{total}', String(this.count)), description: this.slideLabel, visible });
        });
    }
    scrolled = () => {
        cancelAnimationFrame(this.frame);
        this.frame = requestAnimationFrame(() => {
            if (this.collection && !this.listMode)
                this.collectionOffset = Math.abs(this.viewport?.scrollLeft ?? 0);
            this.updateSlides();
        });
        clearTimeout(this.settleTimer);
        this.settleTimer = setTimeout(() => this.finishScroll(), 140);
    };
    finishScroll() {
        if (!this.isConnected)
            return;
        if (this.collection) {
            if (this.listMode)
                return;
            const nearest = Math.max(0, Math.min(this.end, Math.round(Math.abs(this.viewport?.scrollLeft ?? 0) / (this.collectionWidth + this.collectionGap))));
            const aligned = this.aligning;
            this.aligning = false;
            if (nearest !== this.index) {
                if (!aligned)
                    this.pause();
                this.change(nearest, 'scroll');
            }
            else if (!aligned)
                this.align();
            this.updateSlides();
            return;
        }
        let nearest = this.index, distance = Infinity;
        this.slides.slice(0, this.end + 1).forEach((slide, i) => {
            const d = Math.abs(this.offset(slide));
            if (d < distance) {
                distance = d;
                nearest = i;
            }
        });
        const aligned = this.aligning;
        this.aligning = false;
        if (nearest !== this.index) {
            if (!aligned)
                this.pause();
            this.change(nearest, 'scroll');
        }
        this.updateSlides();
    }
    change(proposed, reason) {
        if (!this.count)
            return 'unchanged';
        const previous = this.index;
        if (this.listMode)
            proposed = Math.floor(proposed / this.listPageSize) * this.listPageSize;
        const normalized = this.loop ? (proposed < 0 ? this.end : proposed > this.end ? 0 : proposed) : Math.max(0, Math.min(proposed, this.end));
        if (reason !== 'autoplay' && reason !== 'scroll')
            this.pause();
        const outcome = dispatchChange(this, { previous, proposed: normalized, reason, getRevision: () => this.revision, stage: value => this.setIndex(value), rollback: value => this.setIndex(value), canCommit: () => normalized <= this.end, commit: () => {
                if (reason !== 'autoplay')
                    this.announcement = this.position();
                this.align(reason === 'scroll' ? 'instant' : 'smooth');
            } });
        if (outcome === 'canceled' || outcome === 'superseded') {
            this.align();
            if (reason === 'autoplay')
                this.pause();
        }
        return outcome;
    }
    /** Navigate to a leading slide and emit a cancellable change. */ goTo(index) {
        this.change(Number.isFinite(index) ? Math.floor(index) : 0, 'api');
    }
    /** Legacy key-found result: true even if navigation is canceled. Use requestGoToKey for the semantic outcome. */
    goToKey(key) {
        const index = this.collection?.findIndex(item => item.key === key) ?? -1;
        if (index < 0)
            return false;
        this.goTo(index);
        return true;
    }
    /** Request semantic navigation by collection key. A commit does not imply scroll/animation completion. */
    requestGoToKey(key) {
        const index = this.collection?.findIndex(item => item.key === key) ?? -1;
        return index < 0 ? 'not-found' : this.change(index, 'api');
    }
    /** Advance one slide, keeping focus on the activating control. */ next() {
        this.change(this.index + (this.listMode ? this.listPageSize : 1), 'next');
    }
    /** Move back one slide. */ previous() {
        this.change(this.index - (this.listMode ? this.listPageSize : 1), 'previous');
    }
    /** Explicitly restart optional rotation; reduced motion still prevents rotation. */ play() {
        if (this.reduced)
            return;
        this.autoplay = true;
        this.stopped = false;
        this.scheduleRotation();
    }
    /** Stop rotation until an explicit play request. */ pause() {
        this.stopped = true;
        clearTimeout(this.timer);
    }
    scheduleRotation = () => {
        clearTimeout(this.timer);
        if (!this.isConnected || !this.rotating || this.hovering || this.ownerDocument.hidden)
            return;
        this.timer = setTimeout(() => {
            if (!this.loop && this.index >= this.end) {
                this.pause();
                return;
            }
            this.change(this.index + 1, 'autoplay');
            this.scheduleRotation();
        }, Number.isFinite(this.interval) ? Math.max(5000, this.interval) : 7000);
    };
    focused = (event) => {
        this.pause();
        this.focusedSlide = event.composedPath().find(el => this.slides.includes(el));
    };
    blurred = () => {
        queueMicrotask(() => {
            if (!this.isConnected)
                return;
            if (this.focusedSlide && !this.focusedSlide.isConnected) {
                this.sync();
                return;
            }
            this.focusedSlide = this.slides.find(slide => slide.matches(':focus-within'));
            this.updateSlides();
            if (this.collection)
                this.requestUpdate();
        });
    };
    keydown = (event) => {
        if (event.composedPath()[0] !== this.viewport || event.altKey || event.ctrlKey || event.metaKey)
            return;
        const rtl = getComputedStyle(this.viewport).direction === 'rtl';
        let next = this.index;
        if (event.key === 'Home')
            next = 0;
        else if (event.key === 'End')
            next = this.end;
        else if (event.key === 'ArrowRight')
            next += (rtl ? -1 : 1) * (this.listMode ? this.listPageSize : 1);
        else if (event.key === 'ArrowLeft')
            next += (rtl ? 1 : -1) * (this.listMode ? this.listPageSize : 1);
        else
            return;
        event.preventDefault();
        this.change(next, 'keyboard');
    };
    pickerButtons() {
        return Array.from(this.renderRoot.querySelectorAll('.picker-button'));
    }
    revealPicker(index) {
        const button = this.pickerButtons().find(button => Number(button.dataset.index) === index), picker = button?.parentElement;
        if (!button || !picker)
            return;
        const b = button.getBoundingClientRect(), p = picker.getBoundingClientRect();
        const clearance = parseFloat(getComputedStyle(picker).paddingInlineStart) || 0;
        const delta = b.left < p.left + clearance ? b.left - p.left - clearance : b.right > p.right - clearance ? b.right - p.right + clearance : 0;
        if (delta)
            picker.scrollBy({ left: delta, behavior: 'instant' });
    }
    pickerKeydown = (event) => {
        if (event.altKey || event.ctrlKey || event.metaKey)
            return;
        const button = event.target.closest('.picker-button');
        if (!button)
            return;
        const rtl = getComputedStyle(button).direction === 'rtl';
        let next = Number(button.dataset.index);
        if (event.key === 'Home')
            next = 0;
        else if (event.key === 'End')
            next = this.end;
        else if (event.key === 'ArrowRight')
            next += rtl ? -1 : 1;
        else if (event.key === 'ArrowLeft')
            next += rtl ? 1 : -1;
        else
            return;
        event.preventDefault();
        this.pickerWindowFocus = this.pickerFocus = Math.max(0, Math.min(next, this.end));
        void this.updateComplete.then(() => {
            this.pickerButtons().find(button => Number(button.dataset.index) === this.pickerFocus)?.focus({ preventScroll: true });
            this.revealPicker(this.pickerFocus);
        });
    };
    get listMode() { return this.collection !== null && this.readingMode === 'list'; }
    get listPageSize() { return Math.max(1, Math.floor(Number.isFinite(this.pageSize) ? this.pageSize : 10)); }
    refreshCollectionSlides() {
        if (this.collection)
            this.slides = Array.from(this.renderRoot.querySelectorAll('.collection-slide'));
    }
    collectionEntries() {
        if (!this.collection)
            return [];
        if (this.listMode || !this.ready)
            return this.collection.slice(this.index, this.index + this.listPageSize).map((item, offset) => ({ item, index: this.index + offset }));
        const overscan = Math.max(0, Math.min(20, Math.floor(Number.isFinite(this.overscan) ? this.overscan : 2)));
        const first = Math.max(0, Math.floor(this.collectionOffset / (this.collectionWidth + this.collectionGap)) - overscan);
        const last = Math.min(this.count, first + this.visibleCount + overscan * 2 + 1);
        const indexes = new Set(Array.from({ length: Math.max(0, last - first) }, (_, offset) => first + offset));
        const focusedKey = this.focusedSlide?.dataset.key;
        const focused = focusedKey ? this.collection.findIndex(item => item.key === focusedKey) : -1;
        if (focused >= 0)
            indexes.add(focused);
        return [...indexes].sort((a, b) => a - b).map(index => ({ item: this.collection[index], index }));
    }
    pickerEntries() {
        if (!this.collection)
            return this.slides.slice(0, this.end + 1).map((slide, index) => ({ key: slide, label: slide.label, thumbnail: slide.thumbnail, slide, index }));
        const count = Math.min(this.pickerCapacity, this.end + 1);
        const start = Math.max(0, Math.min(this.end + 1 - count, this.pickerWindowFocus - Math.floor(count / 2)));
        return Array.from({ length: count }, (_, offset) => {
            const index = start + offset;
            return { ...this.collection[index], index, slide: undefined };
        });
    }
    renderCollection() {
        const entries = this.collectionEntries();
        if (this.listMode || !this.ready)
            return html `<ol class="reading-list" part="reading-list" start=${this.index + 1}>
            ${repeat(entries, entry => entry.item.key, ({ item, index }) => html `<li part="reading-item" data-key=${item.key} aria-posinset=${index + 1} aria-setsize=${this.count}>${this.renderItem?.(item, index) ?? item.label}</li>`)}
        </ol>`;
        return html `<div class="collection-track" part="track" style=${`inline-size:${Math.max(0, this.count * (this.collectionWidth + this.collectionGap) - this.collectionGap)}px`}>
            ${repeat(entries, entry => entry.item.key, ({ item, index }) => html `<en-carousel-slide class="collection-slide" part="slide" data-key=${item.key} data-index=${index} label=${item.label} style=${`inset-inline-start:${index * (this.collectionWidth + this.collectionGap)}px;inline-size:${this.collectionWidth}px`}>${this.renderItem?.(item, index) ?? item.label}</en-carousel-slide>`)}
        </div>`;
    }
    position(index = this.index) {
        if (!this.count)
            return this.emptyLabel;
        const end = Math.min(this.count, index + this.visibleCount);
        return (this.visibleCount > 1 ? this.rangeLabel : this.positionLabel).replaceAll('{current}', String(index + 1)).replaceAll('{end}', String(end)).replaceAll('{total}', String(this.count));
    }
    render() {
        const entries = this.pickerEntries();
        const pickerRange = this.pickerRangeLabel.replaceAll('{start}', String((entries[0]?.index ?? 0) + 1))
            .replaceAll('{end}', String((entries.at(-1)?.index ?? 0) + 1)).replaceAll('{total}', String(this.end + 1));
        return html `<section class="base" part="base" role="group" aria-roledescription=${this.listMode ? nothing : this.carouselLabel} aria-label=${this.label} @focusin=${this.focused} @focusout=${this.blurred} @pointerenter=${() => {
            this.hovering = true;
            this.scheduleRotation();
        }} @pointerleave=${() => {
            this.hovering = false;
            this.scheduleRotation();
        }}>
  <en-button class="rotation" part="rotation" variant="secondary" ?hidden=${this.listMode || !this.autoplay || !this.ready} aria-disabled=${String(this.reduced || this.count <= this.visibleCount)} @pointerdown=${() => {
            this.rotationIntent = this.rotating;
        }} @click=${() => {
            if (this.reduced || this.count <= this.visibleCount)
                return;
            const stop = this.rotationIntent ?? this.rotating;
            this.rotationIntent = undefined;
            if (stop)
                this.pause();
            else
                this.play();
        }}>${this.rotating ? this.stopLabel : this.startLabel}</en-button>
  <div class="viewport" part="viewport" ?data-collection=${this.collection !== null} ?data-list=${this.listMode || this.collection !== null && !this.ready} ?data-controls-ready=${!this.listMode && (this.showControls || this.showPicker)} tabindex="0" role="group" aria-label=${this.listMode ? this.listLabel : this.viewportLabel} style=${`--_en-carousel-per-view:${Number.isFinite(this.slidesPerView) ? Math.max(1, Math.floor(this.slidesPerView)) : 1}`} @scroll=${this.scrolled} @keydown=${this.keydown} @pointerdown=${() => this.pause()} @wheel=${() => this.pause()}>${this.collection ? this.renderCollection() : html `<slot @slotchange=${() => this.sync()}></slot>`}</div>
  ${this.showControls ? html `<div class="controls" part="controls" ?data-boundaries=${this.boundaryControls}>
   ${this.boundaryControls ? html `<en-button part="first" variant="secondary" aria-disabled=${String(!this.count || this.index === 0)} @click=${() => this.change(0, 'picker')}>${this.firstLabel}</en-button>` : nothing}
   <en-button part="previous" variant="secondary" icon-only aria-disabled=${String(!this.count || this.end === 0 || (!this.loop && this.index === 0))} @click=${() => this.previous()}><span slot="prefix" class="arrow"><slot name="previous"><en-icon name="chevron-left"></en-icon></slot></span><span slot="label">${this.listMode ? this.previousPageLabel : this.previousLabel}</span></en-button>
   <span class="position" part="position">${this.position()}</span>
   <en-button part="next" variant="secondary" icon-only aria-disabled=${String(!this.count || this.end === 0 || (!this.loop && this.index >= this.end))} @click=${() => this.next()}><span slot="prefix" class="arrow"><slot name="next"><en-icon name="chevron-right"></en-icon></slot></span><span slot="label">${this.listMode ? this.nextPageLabel : this.nextLabel}</span></en-button>
   ${this.boundaryControls ? html `<en-button part="last" variant="secondary" aria-disabled=${String(!this.count || this.index >= this.end)} @click=${() => this.change(this.end, 'picker')}>${this.lastLabel}</en-button>` : nothing}
  </div>` : nothing}
  ${this.showPicker ? html `
  ${this.collection ? html `<span class="picker-range" part="picker-range">${pickerRange}</span>` : nothing}
  <div id="picker" class="picker" part="picker" ?data-bounded=${this.collection !== null} style=${this.collection ? `--_en-picker-count:${entries.length}` : nothing} role="group" aria-label=${this.pickerLabel} @keydown=${this.pickerKeydown}>
   ${repeat(entries, entry => entry.key, ({ label, thumbnail, slide, index }) => html `<button type="button" class="en-button picker-button" id=${`picker-${index}`} data-variant="secondary" data-index=${index} part=${index === this.index ? 'picker-button picker-current' : 'picker-button'} aria-current=${index === this.index ? 'true' : nothing} aria-label=${this.pickLabel.replaceAll('{position}', this.position(index)).replaceAll('{label}', label || this.slideLabel)} tabindex=${index === this.pickerFocus ? 0 : -1} @focus=${() => { this.focusedPickerSlide = slide; this.pickerFocus = index; }} @click=${() => this.change(index, 'picker')}>
    ${this.navigation === 'thumbnails' && thumbnail ? html `<img class="thumbnail" part="thumbnail" src=${thumbnail} alt="" draggable="false">${this.collection ? html `<span class="picker-number" part="picker-number" aria-hidden="true">${index + 1}</span>` : nothing}` : html `<span aria-hidden="true">${this.visibleCount > 1 ? `${index + 1}–${Math.min(this.count, index + this.visibleCount)}` : index + 1}</span>`}
   </button>`)}
  </div>
  ${this.collection ? repeat(entries, entry => entry.key, ({ index, label }) => html `<en-tooltip for=${`picker-${index}`} warmup-group="picker" exportparts="surface:picker-tooltip-surface" @en-change=${(event) => event.stopPropagation()}><span slot="content">${this.position(index)}: ${label || this.slideLabel}</span></en-tooltip>`) : nothing}` : nothing}
  <span class="en-sr-only" part="announcement" role="status" aria-live=${this.rotating ? 'off' : 'polite'} aria-atomic="true">${this.announcement}</span>
 </section>`;
    }
}
