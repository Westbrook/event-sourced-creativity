import { EnToastRegion } from '../toast-region.js';
/** Registration metadata only; importing this module does not define elements. */
export declare const toastRegionDefinition: {
    readonly tagName: 'en-toast-region';
    readonly elementClass: typeof EnToastRegion;
    readonly dependencies: readonly [{
        readonly tagName: 'en-toast';
        readonly elementClass: typeof import("../toast.js").EnToast;
        readonly dependencies: readonly [{
            readonly tagName: 'en-button';
            readonly elementClass: typeof import("../button.js").EnButton;
        }, {
            readonly tagName: 'en-icon';
            readonly elementClass: typeof import("../icon.js").EnIcon;
        }];
    }];
};
