import { type CalendarDate, type CalendarGridOptions } from '../../primitives/interactions/calendar.js';
/** Private calendar boundary. Public values remain ISO dates, never display fields. */
export interface CalendarFields {
    readonly calendar: 'gregory' | 'buddhist';
    readonly era: 'ce' | 'be';
    readonly year: number;
    readonly monthCode: string;
    readonly day: number;
}
export declare function calendarAdapter(id: string, locale?: string): {
    id: string;
    minimum: string;
    maximum: string;
    supported: (date: CalendarDate) => boolean;
    toFields: (date: CalendarDate) => CalendarFields;
    fromFields: (fields: CalendarFields) => CalendarDate;
    dayIdentity: (date: CalendarDate) => number;
    daysInMonth: (fields: CalendarFields) => number;
    addDays: (date: CalendarDate, delta: number) => CalendarDate;
    addMonths: (date: CalendarDate, delta: number) => CalendarDate;
    grid: (date: CalendarDate, options: CalendarGridOptions) => import("../../primitives/interactions/calendar.js").CalendarDay[];
    format: (date: CalendarDate, options: Intl.DateTimeFormatOptions) => string;
};
/** User-visible fallback, without silently substituting another calendar. */
export declare function calendarConfiguration(calendar: string, locale: string, value?: string): {
    error: string;
    adapter?: undefined;
} | {
    error?: undefined;
    adapter: {
        id: string;
        minimum: string;
        maximum: string;
        supported: (date: CalendarDate) => boolean;
        toFields: (date: CalendarDate) => CalendarFields;
        fromFields: (fields: CalendarFields) => CalendarDate;
        dayIdentity: (date: CalendarDate) => number;
        daysInMonth: (fields: CalendarFields) => number;
        addDays: (date: CalendarDate, delta: number) => CalendarDate;
        addMonths: (date: CalendarDate, delta: number) => CalendarDate;
        grid: (date: CalendarDate, options: CalendarGridOptions) => import("../../primitives/interactions/calendar.js").CalendarDay[];
        format: (date: CalendarDate, options: Intl.DateTimeFormatOptions) => string;
    };
};
