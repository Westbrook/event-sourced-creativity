import { EnToastRegion } from '../toast-region.js';
import { toastDefinition } from './toast.js';
/** Registration metadata only; importing this module does not define elements. */
export const toastRegionDefinition = {
    tagName: 'en-toast-region',
    elementClass: EnToastRegion,
    dependencies: [toastDefinition],
};
