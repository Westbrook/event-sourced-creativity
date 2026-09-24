import { EnToast } from '../toast.js';
import { buttonDefinition } from './button.js';
import { iconDefinition } from './icon.js';
/** Registration metadata only; importing this module does not define elements. */
export const toastDefinition = {
    tagName: 'en-toast',
    elementClass: EnToast,
    dependencies: [buttonDefinition, iconDefinition],
};
