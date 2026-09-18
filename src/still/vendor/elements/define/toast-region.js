import { EnButton } from '../button.js';
import { EnIcon } from '../icon.js';
import { EnToast } from '../toast.js';
import { EnToastRegion } from '../toast-region.js';
import { registerDefinition } from '../../primitives/interactions/registration.js';
registerDefinition(customElements, { tagName: 'en-toast-region', elementClass: EnToastRegion, dependencies: [{ tagName: 'en-toast', elementClass: EnToast, dependencies: [{ tagName: 'en-button', elementClass: EnButton }, { tagName: 'en-icon', elementClass: EnIcon }] }] });
