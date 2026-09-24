import { EnDrawer } from '../drawer.js';
import { buttonDefinition } from './button.js';
import { iconDefinition } from './icon.js';
/** Registration metadata only; importing this module does not define elements. */
export const drawerDefinition = {
    tagName: 'en-drawer',
    elementClass: EnDrawer,
    dependencies: [buttonDefinition, iconDefinition],
};
