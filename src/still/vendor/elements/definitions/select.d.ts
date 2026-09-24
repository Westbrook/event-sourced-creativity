import { EnSelect } from '../select.js';
/** Registration metadata only; importing this module does not define elements. */
export declare const selectDefinition: {
    readonly tagName: 'en-select';
    readonly elementClass: typeof EnSelect;
    readonly dependencies: readonly [{
        readonly tagName: 'en-select-option';
        readonly elementClass: typeof import("../select-option.js").EnSelectOption;
    }];
};
