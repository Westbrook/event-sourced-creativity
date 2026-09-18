import { EnDrawer } from '../drawer.js';
import { EnButton } from '../button.js';
import { EnIcon } from '../icon.js';
import { registerDefinition } from '../../primitives/interactions/registration.js';
registerDefinition(customElements, {
    tagName: 'en-drawer', elementClass: EnDrawer,
    dependencies: [{ tagName: 'en-button', elementClass: EnButton }, { tagName: 'en-icon', elementClass: EnIcon }],
});
