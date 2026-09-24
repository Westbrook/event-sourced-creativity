import { type PropertyValues } from 'lit';
import { EnElement } from './internal/en-element.js';
import { type ChangeOutcome } from '../primitives/interactions/events.js';
export interface CarouselItem {
    /** Stable, unique identity, independent of position. */ key: string;
    label: string;
    thumbnail?: string;
    [field: string]: unknown;
}
export type CarouselChangeReason = 'previous' | 'next' | 'keyboard' | 'scroll' | 'api' | 'autoplay' | 'picker';
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
export declare class EnCarousel extends EnElement {
    private readonly slideContexts;
    static properties: {
        items: {
            attribute: boolean;
            noAccessor: boolean;
        };
        renderItem: {
            attribute: boolean;
        };
        readingMode: {
            attribute: string;
            reflect: boolean;
        };
        pageSize: {
            type: NumberConstructor;
            attribute: string;
        };
        previousPageLabel: {
            attribute: string;
        };
        nextPageLabel: {
            attribute: string;
        };
        listLabel: {
            attribute: string;
        };
        overscan: {
            type: NumberConstructor;
        };
        collectionOffset: {
            state: boolean;
        };
        collectionWidth: {
            state: boolean;
        };
        collectionGap: {
            state: boolean;
        };
        label: {};
        controls: {};
        boundaryControls: {
            type: BooleanConstructor;
            attribute: string;
        };
        navigation: {};
        pickerLabel: {
            attribute: string;
        };
        pickLabel: {
            attribute: string;
        };
        pickerFocus: {
            state: boolean;
        };
        pickerCapacity: {
            state: boolean;
        };
        firstLabel: {
            attribute: string;
        };
        lastLabel: {
            attribute: string;
        };
        pickerRangeLabel: {
            attribute: string;
        };
        index: {
            type: NumberConstructor;
            noAccessor: boolean;
            reflect: boolean;
        };
        slidesPerView: {
            type: NumberConstructor;
            attribute: string;
        };
        loop: {
            type: BooleanConstructor;
        };
        autoplay: {
            type: BooleanConstructor;
        };
        interval: {
            type: NumberConstructor;
        };
        previousLabel: {
            attribute: string;
        };
        nextLabel: {
            attribute: string;
        };
        startLabel: {
            attribute: string;
        };
        stopLabel: {
            attribute: string;
        };
        positionLabel: {
            attribute: string;
        };
        rangeLabel: {
            attribute: string;
        };
        emptyLabel: {
            attribute: string;
        };
        carouselLabel: {
            attribute: string;
        };
        slideLabel: {
            attribute: string;
        };
        viewportLabel: {
            attribute: string;
        };
        ready: {
            state: boolean;
        };
        count: {
            state: boolean;
        };
        end: {
            state: boolean;
        };
        visibleCount: {
            state: boolean;
        };
        stopped: {
            state: boolean;
        };
        reduced: {
            state: boolean;
        };
        announcement: {
            state: boolean;
        };
    };
    static styles: import("lit").CSSResult[];
    /** Accessible group name. */ label: string;
    /** Number of equal-width slides shown; CSS may override this responsively. */ slidesPerView: number;
    /** Wrap button/API navigation at boundaries; native scrolling remains finite. */ loop: boolean;
    /** Opt-in rotation, always controllable with the first button. */ autoplay: boolean;
    /** Rotation delay in milliseconds; minimum 5000, default 7000. */ interval: number;
    /** Localized navigation/control labels. */ previousLabel: string;
    nextLabel: string;
    startLabel: string;
    stopLabel: string;
    /** Localized visible position; {current}, {end}, {total} placeholders. */ positionLabel: string;
    /** Localized multiple-visible-slide range, with {current}, {end}, {total}. */ rangeLabel: string;
    /** Localized empty text. */ emptyLabel: string;
    /** Localized role descriptions and scrolling-surface name. */ carouselLabel: string;
    slideLabel: string;
    viewportLabel: string;
    /** Optional main navigation row. none (default) omits it; auto requires multiple windows; always preserves disabled controls. */
    controls: 'none' | 'auto' | 'always';
    /** Include First/Last in an enabled controls row; never enables the row itself. */ boundaryControls: boolean;
    /** Optional leading-window picker. Missing thumbnails fall back to position numbers. */ navigation: 'none' | 'positions' | 'thumbnails';
    /** Localized picker group name. */ pickerLabel: string;
    /** Localized button name; {position} contains the visible range and {label} the leading slide label. */ pickLabel: string;
    /** Localized visible collection boundary shortcuts. */ firstLabel: string;
    lastLabel: string;
    /** Localized visible picker range; {start}, {end}, {total} are leading-window positions. */ pickerRangeLabel: string;
    private pickerCapacity;
    private pickerFocus;
    private pickerWindowFocus;
    private ready;
    private count;
    private end;
    private visibleCount;
    private stopped;
    private reduced;
    private announcement;
    /** Optional keyed collection. undefined uses authored slides; null is a legacy input alias; an empty array is an empty collection. Assign a new array after changes. */
    get items(): readonly CarouselItem[] | undefined;
    set items(value: readonly CarouselItem[] | null | undefined);
    /** Application-owned content inside the managed en-carousel-slide (or li in list reading mode). Invoked only for mounted items; never return the slide/list-item wrapper. */
    renderItem: ((item: CarouselItem, index: number) => unknown) | undefined;
    /** Paginated, ordinary list reading alternative for data collections. */
    readingMode: 'carousel' | 'list';
    previousPageLabel: string;
    nextPageLabel: string;
    listLabel: string;
    /** Maximum entries per page in list mode. */ pageSize: number;
    /** Additional slides mounted on each side of the visible window. */ overscan: number;
    /** Stable key of the leading item. undefined in authored mode or an empty collection. */
    get currentKey(): string | undefined;
    private collection;
    private pendingPickerFocus?;
    private pendingSlideFocus?;
    private collectionOffset;
    private collectionWidth;
    private collectionGap;
    private current;
    private revision;
    private connectionGeneration;
    private slides;
    private readonly upgrades;
    private observer?;
    private resize?;
    private motion?;
    private timer?;
    private settleTimer?;
    private frame;
    private hovering;
    private focusedSlide?;
    private focusedPickerSlide?;
    private rotationIntent?;
    private aligning;
    /** Zero-based leading slide; writes are silent and clamped to the last full window. */
    get index(): number;
    set index(value: number);
    private setIndex;
    constructor();
    private get viewport();
    private get rotating();
    connectedCallback(): void;
    disconnectedCallback(): void;
    private get showControls();
    private get showPicker();
    protected willUpdate(changes: PropertyValues): void;
    protected updated(changes: PropertyValues): void;
    private onMotion;
    private sync;
    private layout;
    private offset;
    private align;
    private updateSlides;
    private scrolled;
    private finishScroll;
    private change;
    /** Navigate to a leading slide and emit a cancellable change. */ goTo(index: number): void;
    /** Legacy key-found result: true even if navigation is canceled. Use requestGoToKey for the semantic outcome. */
    goToKey(key: string): boolean;
    /** Request semantic navigation by collection key. A commit does not imply scroll/animation completion. */
    requestGoToKey(key: string): ChangeOutcome | 'not-found';
    /** Advance one slide, keeping focus on the activating control. */ next(): void;
    /** Move back one slide. */ previous(): void;
    /** Explicitly restart optional rotation; reduced motion still prevents rotation. */ play(): void;
    /** Stop rotation until an explicit play request. */ pause(): void;
    private scheduleRotation;
    private focused;
    private blurred;
    private keydown;
    private pickerButtons;
    private revealPicker;
    private pickerKeydown;
    private get listMode();
    private get listPageSize();
    private refreshCollectionSlides;
    private collectionEntries;
    private pickerEntries;
    private renderCollection;
    private position;
    protected render(): import("lit-html").TemplateResult<1>;
}
declare global {
    interface HTMLElementTagNameMap {
        'en-carousel': EnCarousel;
    }
}
