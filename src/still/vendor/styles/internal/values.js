import { css, unsafeCSS } from 'lit';
import { rawTokenCSS, tokenCSS } from './token-values.js';
/** Static, trusted token data only. Never pass user-authored strings to unsafeCSS. */
export function rawToken(name) {
    return unsafeCSS(rawTokenCSS(name));
}
/** Select a finite role, never multiply an inherited font or dimension recursively. */
export function token(name) {
    return unsafeCSS(tokenCSS(name));
}
/** Leave optional properties unset so inherited consumer overrides remain effective. */
export function override(name, fallback) {
    return css `var(${unsafeCSS(name)}, ${fallback})`;
}
