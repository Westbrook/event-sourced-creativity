import { EnDrawer } from '../drawer.js';
/** Registration metadata only; importing this module does not define elements. */
export declare const drawerDefinition: {
    readonly tagName: 'en-drawer';
    readonly elementClass: typeof EnDrawer;
    readonly dependencies: readonly [{
        readonly tagName: 'en-button';
        readonly elementClass: typeof import("../button.js").EnButton;
    }, {
        readonly tagName: 'en-icon';
        readonly elementClass: typeof import("../icon.js").EnIcon;
    }];
};
