const dayMilliseconds = 86_400_000;
export function daysInMonth(year, month) {
    if (!Number.isInteger(year) || year < 1 || year > 9999 || !Number.isInteger(month) || month < 1 || month > 12) {
        throw new RangeError('Calendar dates require a year from 1 to 9999 and a month from 1 to 12.');
    }
    return month === 2 ? (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28) :
        ([4, 6, 9, 11].includes(month) ? 30 : 31);
}
/** Parse a complete, valid YYYY-MM-DD value; never normalize an invalid day. */
export function parseDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
        return undefined;
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    const day = Number(value.slice(8, 10));
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month))
        return undefined;
    return { year, month, day };
}
export function formatDate(date) {
    if (!Number.isInteger(date.day) || date.day < 1 || date.day > daysInMonth(date.year, date.month)) {
        throw new RangeError('Calendar dates require a valid day in the selected month.');
    }
    return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}
/** setUTCFullYear avoids Date.UTC's special treatment of years 0 through 99. */
function utcDate(date) {
    formatDate(date);
    const result = new Date(0);
    result.setUTCFullYear(date.year, date.month - 1, date.day);
    return result;
}
function fromTimestamp(timestamp) {
    const date = new Date(timestamp);
    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}
const firstDate = { year: 1, month: 1, day: 1 };
const lastDate = { year: 9999, month: 12, day: 31 };
const firstTimestamp = utcDate(firstDate).getTime();
const lastTimestamp = utcDate(lastDate).getTime();
function integerDelta(delta) {
    if (!Number.isSafeInteger(delta))
        throw new RangeError('Calendar increments must be safe integers.');
}
/** Date arithmetic uses UTC days and saturates at the supported year limits. */
export function addDays(date, delta) {
    integerDelta(delta);
    const timestamp = utcDate(date).getTime() + delta * dayMilliseconds;
    return fromTimestamp(Math.max(firstTimestamp, Math.min(lastTimestamp, timestamp)));
}
/** Preserve the day where possible, clamping it for shorter destination months. */
export function addMonths(date, delta) {
    formatDate(date);
    integerDelta(delta);
    const index = Math.max(0, Math.min(9999 * 12 - 1, (date.year - 1) * 12 + date.month - 1 + delta));
    const year = Math.floor(index / 12) + 1;
    const month = index % 12 + 1;
    return { year, month, day: Math.min(date.day, daysInMonth(year, month)) };
}
export function compareDates(left, right) {
    return Math.sign(utcDate(left).getTime() - utcDate(right).getTime());
}
/**
 * Match a date's distance from the native date-input step base in whole days.
 * Invalid steps use the native default of one day; invalid bases use the epoch.
 * A fractional step may still describe whole dates (for example 0.3 allows
 * every third day). Quotient tolerance avoids rejecting those exact multiples
 * because of floating-point representation.
 */
export function dateOnStep(date, step, base = '1970-01-01') {
    const interval = Number.isFinite(step) && step > 0 ? step : 1;
    const origin = parseDate(base) ?? { year: 1970, month: 1, day: 1 };
    const distance = (utcDate(date).getTime() - utcDate(origin).getTime()) / dayMilliseconds;
    const quotient = distance / interval;
    // At this granularity the interval is smaller than numeric precision for
    // the distance; no distinct mismatch can be represented.
    if (!Number.isFinite(quotient))
        return true;
    return Math.abs(quotient - Math.round(quotient)) <= Number.EPSILON * Math.max(1, Math.abs(quotient)) * 8;
}
export function dateInRange(date, min, max) {
    const lower = min ? parseDate(min) : undefined;
    const upper = max ? parseDate(max) : undefined;
    return (!lower || compareDates(date, lower) >= 0) && (!upper || compareDates(date, upper) <= 0);
}
/** A reversed valid range is empty, so no month can be navigated into. */
export function monthInRange(date, min, max) {
    const lower = min ? parseDate(min) : undefined;
    const upper = max ? parseDate(max) : undefined;
    if (lower && upper && compareDates(lower, upper) > 0)
        return false;
    const first = { ...date, day: 1 };
    const last = { ...date, day: daysInMonth(date.year, date.month) };
    return (!lower || compareDates(last, lower) >= 0) && (!upper || compareDates(first, upper) <= 0);
}
/** Return undefined for a reversed range, which cannot contain a selected date. */
export function clampDate(date, min, max) {
    const lower = min ? parseDate(min) : undefined;
    const upper = max ? parseDate(max) : undefined;
    if (lower && upper && compareDates(lower, upper) > 0)
        return undefined;
    if (lower && compareDates(date, lower) < 0)
        return lower;
    if (upper && compareDates(date, upper) > 0)
        return upper;
    return { ...date };
}
function checkedFirstDay(firstDayOfWeek) {
    if (!Number.isInteger(firstDayOfWeek) || firstDayOfWeek < 0 || firstDayOfWeek > 6) {
        throw new RangeError('The first weekday must be an integer from 0 (Sunday) to 6 (Saturday).');
    }
    return firstDayOfWeek;
}
/** A stable six-week grid, including neighboring months and disabled bound days. */
export function monthGrid(month, options = {}) {
    const firstDay = checkedFirstDay(options.firstDayOfWeek ?? 0);
    const first = utcDate({ ...month, day: 1 });
    const offset = (first.getUTCDay() - firstDay + 7) % 7;
    return Array.from({ length: 42 }, (_, index) => {
        const timestamp = first.getTime() + (index - offset) * dayMilliseconds;
        if (timestamp < firstTimestamp || timestamp > lastTimestamp) {
            return { date: undefined, value: '', inMonth: false, disabled: true };
        }
        const date = fromTimestamp(timestamp);
        return { date, value: formatDate(date), inMonth: date.month === month.month && date.year === month.year,
            disabled: !dateInRange(date, options.min, options.max) };
    });
}
/** Locale controls presentation; Gregorian/UTC retain the date-only API meaning. */
export function localizedDate(date, locale, options = { dateStyle: 'full' }) {
    return new Intl.DateTimeFormat(locale, { ...options, calendar: 'gregory', timeZone: 'UTC' }).format(utcDate(date));
}
export function weekdayLabels(locale, firstDayOfWeek = 0) {
    const firstDay = checkedFirstDay(firstDayOfWeek);
    // 2024-01-07 is a Sunday. Use separate formatters so visible abbreviations can
    // be paired with unambiguous full names in accessible column headings.
    const short = new Intl.DateTimeFormat(locale, { weekday: 'short', calendar: 'gregory', timeZone: 'UTC' });
    const long = new Intl.DateTimeFormat(locale, { weekday: 'long', calendar: 'gregory', timeZone: 'UTC' });
    return Array.from({ length: 7 }, (_, index) => {
        const date = utcDate({ year: 2024, month: 1, day: 7 + (firstDay + index) % 7 });
        return { short: short.format(date), long: long.format(date) };
    });
}
