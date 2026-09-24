import { EnDialog } from '../dialog.js';
/** Registration metadata only; importing this module does not define elements. */
export declare const dialogDefinition: {
    readonly tagName: 'en-dialog';
    readonly elementClass: typeof EnDialog;
    readonly dependencies: readonly [{
        readonly tagName: 'en-button';
        readonly elementClass: typeof import("../button.js").EnButton;
    }, {
        readonly tagName: 'en-icon';
        readonly elementClass: typeof import("../icon.js").EnIcon;
    }];
};
