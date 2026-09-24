/** A Gregorian date without a time zone or time of day. Months are one-based. */
export interface CalendarDate {
    readonly year: number;
    readonly month: number;
    readonly day: number;
}
export interface CalendarDay {
    /** Undefined only where the six-week grid crosses the supported year limits. */
    readonly date: CalendarDate | undefined;
    readonly value: string;
    readonly inMonth: boolean;
    readonly disabled: boolean;
}
export interface CalendarGridOptions {
    /** Zero is Sunday; six is Saturday. Defaults to Sunday. */
    readonly firstDayOfWeek?: number;
    /** Inclusive ISO date bounds. Empty or malformed bounds are ignored. */
    readonly min?: string;
    readonly max?: string;
}
export declare function daysInMonth(year: number, month: number): number;
/** Parse a complete, valid YYYY-MM-DD value; never normalize an invalid day. */
export declare function parseDate(value: string): CalendarDate | undefined;
export declare function formatDate(date: CalendarDate): string;
/** Date arithmetic uses UTC days and saturates at the supported year limits. */
export declare function addDays(date: CalendarDate, delta: number): CalendarDate;
/** Preserve the day where possible, clamping it for shorter destination months. */
export declare function addMonths(date: CalendarDate, delta: number): CalendarDate;
export declare function compareDates(left: CalendarDate, right: CalendarDate): number;
/**
 * Match a date's distance from the native date-input step base in whole days.
 * Invalid steps use the native default of one day; invalid bases use the epoch.
 * A fractional step may still describe whole dates (for example 0.3 allows
 * every third day). Quotient tolerance avoids rejecting those exact multiples
 * because of floating-point representation.
 */
export declare function dateOnStep(date: CalendarDate, step: number, base?: string): boolean;
export declare function dateInRange(date: CalendarDate, min?: string, max?: string): boolean;
/** A reversed valid range is empty, so no month can be navigated into. */
export declare function monthInRange(date: CalendarDate, min?: string, max?: string): boolean;
/** Return undefined for a reversed range, which cannot contain a selected date. */
export declare function clampDate(date: CalendarDate, min?: string, max?: string): CalendarDate | undefined;
/** A stable six-week grid, including neighboring months and disabled bound days. */
export declare function monthGrid(month: CalendarDate, options?: CalendarGridOptions): readonly CalendarDay[];
/** Locale controls presentation; Gregorian/UTC retain the date-only API meaning. */
export declare function localizedDate(date: CalendarDate, locale?: string, options?: Intl.DateTimeFormatOptions): string;
export declare function weekdayLabels(locale?: string, firstDayOfWeek?: number): readonly {
    short: string;
    long: string;
}[];
