// Direct En Reve controls; behavior and styling stay in the design system.
import { EnIcon } from './vendor/elements/icon.js';
import { registerDefinition } from './vendor/primitives/interactions/registration.js';
registerDefinition(customElements, { tagName: 'en-icon', elementClass: EnIcon });
import './vendor/elements/define/select.js';
import './vendor/elements/define/checkbox.js';
import './vendor/elements/define/search-input.js';
import './vendor/elements/define/number-field.js';
import './vendor/elements/define/text-field.js';
import './vendor/elements/define/textarea.js';

import './vendor/elements/define/menu.js';
import './vendor/elements/define/menu-item.js';

import './vendor/elements/define/toast.js';
import './vendor/elements/define/toast-region.js';

import './vendor/elements/define/skeleton.js';
