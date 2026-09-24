import { EnDialog } from '../dialog.js';
import { buttonDefinition } from './button.js';
import { iconDefinition } from './icon.js';
/** Registration metadata only; importing this module does not define elements. */
export const dialogDefinition = {
    tagName: 'en-dialog',
    elementClass: EnDialog,
    dependencies: [buttonDefinition, iconDefinition],
};
