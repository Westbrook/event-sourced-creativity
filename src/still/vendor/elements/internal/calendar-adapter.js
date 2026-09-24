import { addDays, addMonths, daysInMonth, formatDate, monthGrid, parseDate } from '../../primitives/interactions/calendar.js';
export function calendarAdapter(id, locale = 'en') {
    if (id !== 'gregory' && id !== 'buddhist')
        throw new RangeError(`Unsupported calendar: ${id}.`);
    const formatters = new Map();
    const formatter = (options) => {
        const key = JSON.stringify(options), existing = formatters.get(key);
        if (existing)
            return existing;
        const result = new Intl.DateTimeFormat(locale, { ...options, calendar: id, timeZone: 'UTC' });
        if (result.resolvedOptions().calendar !== id)
            throw new RangeError(`Calendar data unavailable: ${id}.`);
        formatters.set(key, result);
        return result;
    };
    formatter({ year: 'numeric' });
    const minimum = id === 'buddhist' ? '1941-01-01' : '0001-01-01';
    const maximum = '9999-12-31';
    const offset = id === 'buddhist' ? 543 : 0;
    const era = id === 'buddhist' ? 'be' : 'ce';
    function dayIdentity(date) {
        checked(date);
        const instant = new Date(0);
        instant.setUTCFullYear(date.year, date.month - 1, date.day);
        return instant.getTime() / 86_400_000;
    }
    function moveDays(date, delta) {
        const result = checked(addDays(checked(date), delta));
        if (dayIdentity(result) - dayIdentity(date) !== delta)
            throw new RangeError('Day navigation exceeds the supported calendar interval.');
        return result;
    }
    function moveMonths(date, delta) {
        const result = checked(addMonths(checked(date), delta));
        if ((result.year - date.year) * 12 + result.month - date.month !== delta)
            throw new RangeError('Month navigation exceeds the supported calendar interval.');
        return result;
    }
    function supported(date) {
        const value = formatDate(date);
        return value >= minimum && value <= maximum;
    }
    function checked(date) {
        if (!supported(date))
            throw new RangeError(`${id} supports ISO ${minimum} through ${maximum}.`);
        return date;
    }
    function toFields(date) {
        checked(date);
        return { calendar: id, era, year: date.year + offset, monthCode: `M${String(date.month).padStart(2, '0')}`, day: date.day };
    }
    function fromFields(fields) {
        if (fields.calendar !== id || fields.era !== era || !/^M(0[1-9]|1[0-2])$/.test(fields.monthCode))
            throw new RangeError('Invalid calendar fields.');
        return checked({ year: fields.year - offset, month: Number(fields.monthCode.slice(1)), day: fields.day });
    }
    return {
        id, minimum, maximum, supported, toFields, fromFields, dayIdentity,
        daysInMonth: (fields) => { const date = fromFields({ ...fields, day: 1 }); return daysInMonth(date.year, date.month); },
        addDays: moveDays,
        addMonths: moveMonths,
        grid: (date, options) => monthGrid(checked(date), options).map(day => day.date && !supported(day.date) ? { date: undefined, value: '', inMonth: false, disabled: true } : day),
        format: (date, options) => {
            checked(date);
            const instant = new Date(0);
            instant.setUTCFullYear(date.year, date.month - 1, date.day);
            return formatter(options).format(instant);
        },
    };
}
/** User-visible fallback, without silently substituting another calendar. */
export function calendarConfiguration(calendar, locale, value) {
    try {
        const adapter = calendarAdapter(calendar, locale);
        const date = value ? parseDate(value) : undefined;
        if (date && !adapter.supported(date))
            return { error: `${calendar} supports ISO ${adapter.minimum} through ${adapter.maximum}.` };
        return { adapter };
    }
    catch {
        return { error: `Calendar “${calendar}” is unsupported or its locale data is unavailable.` };
    }
}
