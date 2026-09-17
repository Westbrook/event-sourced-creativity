import { EnDialog } from './vendor/elements/dialog/dialog.js';
import { EnButton } from './vendor/elements/button.js';
import { EnIcon } from './vendor/elements/icon.js';
import { registerDefinition } from './vendor/primitives/interactions/registration.js';
registerDefinition(customElements, {tagName:'en-dialog',elementClass:EnDialog,dependencies:[{tagName:'en-button',elementClass:EnButton},{tagName:'en-icon',elementClass:EnIcon}]});
