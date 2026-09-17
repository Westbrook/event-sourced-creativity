import { EnSelect } from '../select.js';
import { EnSelectOption } from '../select-option.js';
import { registerDefinition } from '../../primitives/interactions/registration.js';
registerDefinition(customElements, { tagName: 'en-select', elementClass: EnSelect, dependencies: [{ tagName: 'en-select-option', elementClass: EnSelectOption }] });
