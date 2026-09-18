import { EnSkeleton } from '../skeleton.js';
import { registerDefinition } from '../../primitives/interactions/registration.js';
registerDefinition(customElements, { tagName: 'en-skeleton', elementClass: EnSkeleton });
