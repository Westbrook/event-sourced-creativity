import { css, unsafeCSS } from 'lit';
import { defaultCSSValue } from '../../tokens/defaults.js';
import { sizingRoleCSS } from '../../tokens/sizing.js';
/** Static, trusted token data only. Never pass user-authored strings to unsafeCSS. */
export function rawToken(name) {
    const value = defaultCSSValue(name);
    if (!value)
        throw new Error(`Missing stylesheet token default: ${name}`);
    return css `var(${unsafeCSS(name)}, ${unsafeCSS(value)})`;
}
const sizedRoles = new Map(sizingRoleCSS.map(({ base, role }) => [base, `--_en-sized-${role.slice(5)}`]));
/** Select a finite role, never multiply an inherited font or dimension recursively. */
export function token(name) {
    const fallback = rawToken(name);
    const sized = sizedRoles.get(name);
    return sized ? css `var(${unsafeCSS(sized)}, ${fallback})` : fallback;
}
/** Leave optional properties unset so inherited consumer overrides remain effective. */
export function override(name, fallback) {
    return css `var(${unsafeCSS(name)}, ${fallback})`;
}
