import { parseDate, formatDate, dateInRange, dateOnStep } from '../../primitives/interactions/calendar.js';
import { calendarConfiguration } from './calendar-adapter.js';
export function dateRange(value) {
    if (!value || typeof value.start !== 'string' || typeof value.end !== 'string')
        return;
    if ((value.start && !parseDate(value.start)) || (value.end && !parseDate(value.end)))
        return;
    return Object.freeze(value.start && value.end && value.end < value.start ? { start: value.end, end: value.start } : { start: value.start, end: value.end });
}
export const emptyRange = () => Object.freeze({ start: '', end: '' });
export function validateRange(value, options) {
    if (!value.start || !value.end)
        return 'Choose both a start date and an end date.';
    const start = parseDate(value.start), end = parseDate(value.end);
    const config = calendarConfiguration(options.calendar, options.locale, value.start);
    if (!start || !end || !config.adapter || !config.adapter.supported(end))
        return config.error || 'The range is outside the supported calendar.';
    if (!dateInRange(start, options.min, options.max) || !dateInRange(end, options.min, options.max))
        return 'The range must stay within the available dates.';
    if (!dateOnStep(start, options.step, options.min || options.stepBase) || !dateOnStep(end, options.step, options.min || options.stepBase) || (value.start !== value.end && options.step > 1))
        return 'Every date in the range must match the allowed date step.';
    if (options.unavailableDate) {
        if (config.adapter.dayIdentity(end) - config.adapter.dayIdentity(start) >= 36600)
            return 'Availability checks support ranges of at most 36,600 days. Choose a shorter range.';
        // At most 36,600 inclusive dates; callers cache each proposal result.
        for (let day = start;; day = config.adapter.addDays(day, 1)) {
            const iso = formatDate(day);
            if (options.unavailableDate(iso))
                return `The range includes an unavailable date: ${iso}.`;
            if (iso === value.end)
                break;
        }
    }
    return '';
}
