import { type CSSResult } from 'lit';
import type { StyleOverrideName } from '../metadata.js';
/** Static, trusted token data only. Never pass user-authored strings to unsafeCSS. */
export declare function rawToken(name: string): CSSResult;
/** Select a finite role, never multiply an inherited font or dimension recursively. */
export declare function token(name: string): CSSResult;
/** Leave optional properties unset so inherited consumer overrides remain effective. */
export declare function override(name: StyleOverrideName, fallback: CSSResult): CSSResult;
