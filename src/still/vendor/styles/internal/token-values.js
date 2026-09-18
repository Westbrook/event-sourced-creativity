import { defaultCSSValue } from '../../tokens/defaults.js';
import { sizingRoleCSS } from '../../tokens/sizing.js';
/** Shared build/runtime serialization of trusted token references. */
export function rawTokenCSS(name) {
    const value = defaultCSSValue(name);
    if (!value)
        throw new Error(`Missing stylesheet token default: ${name}`);
    return `var(${name}, ${value})`;
}
const sizedRoles = new Map(sizingRoleCSS.map(({ base, role }) => [base, `--_en-sized-${role.slice(5)}`]));
export function tokenCSS(name) {
    const fallback = rawTokenCSS(name);
    const sized = sizedRoles.get(name);
    return sized ? `var(${sized}, ${fallback})` : fallback;
}
