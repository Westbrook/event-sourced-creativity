/** Shared public event contracts. These are types, never a global DOM event map. */
import type { ActionDetail, ChangeEvent, DraftInputDetail } from '../primitives/interactions/events.js';
import type { DateRange } from './internal/date-range.js';
import type { CarouselChangeReason } from './carousel.js';
import type { PaginationReason } from './pagination/template.js';
import type { SplitCollapsed } from './split-view/split-view.js';
export type DraftInputEvent = CustomEvent<DraftInputDetail>;
/** Native field values remain strings, including numeric/date/time inputs. */
export type FieldChangeEvent = ChangeEvent<string>;
export type CommandActionEvent = CustomEvent<ActionDetail<string>>;
export type MenuItemChangeEvent = ChangeEvent<boolean, 'checked'>;
export type CalendarChangeEvent = ChangeEvent<string, 'date'> | ChangeEvent<DateRange, 'range'>;
export type CalendarActionEvent = CustomEvent<ActionDetail<'confirm', string> | ActionDetail<'range-draft', DateRange>>;
export type DatePickerChangeEvent = FieldChangeEvent | ChangeEvent<DateRange, 'range' | 'clear'>;
export type CarouselChangeEvent = ChangeEvent<number, CarouselChangeReason>;
export type PaginationChangeEvent = ChangeEvent<number, PaginationReason>;
export type PresenceGroupChangeEvent = ChangeEvent<boolean, 'disclosure'>;
export type SplitCollapseEvent = ChangeEvent<SplitCollapsed, 'keyboard' | 'button' | 'programmatic'>;
