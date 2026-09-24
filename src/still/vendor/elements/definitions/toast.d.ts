import { EnToast } from '../toast.js';
/** Registration metadata only; importing this module does not define elements. */
export declare const toastDefinition: {
    readonly tagName: 'en-toast';
    readonly elementClass: typeof EnToast;
    readonly dependencies: readonly [{
        readonly tagName: 'en-button';
        readonly elementClass: typeof import("../button.js").EnButton;
    }, {
        readonly tagName: 'en-icon';
        readonly elementClass: typeof import("../icon.js").EnIcon;
    }];
};
