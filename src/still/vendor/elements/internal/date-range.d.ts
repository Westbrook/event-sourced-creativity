export interface DateRange {
    readonly start: string;
    readonly end: string;
}
export type UnavailableDate = (date: string) => boolean;
export declare function dateRange(value: DateRange): DateRange | undefined;
export declare const emptyRange: () => DateRange;
export declare function validateRange(value: DateRange, options: {
    calendar: string;
    locale: string;
    min: string;
    max: string;
    step: number;
    stepBase: string;
    unavailableDate?: UnavailableDate;
}): string;
