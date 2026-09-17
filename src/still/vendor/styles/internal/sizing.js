import { css, unsafeCSS } from 'lit';
import { sizingRoleCSS } from '../../tokens/sizing.js';
import { rawToken } from './values.js';
/** Static family compilation: declare only private roles consumed by this fragment.
 * A universal role block repeated in every declarative shadow root is needlessly
 * expensive. Selection flags inherit only when requested; role values always
 * recompute at the local theme boundary. No application content is inspected.
 */
export function sizedStyles(styles) {
    const declarations = sizingRoleCSS.filter(({ role }) => styles.cssText.includes(`var(--_en-sized-${role.slice(5)},`))
        .map(({ role, variants }) => `--_en-sized-${role.slice(5)}: calc(${rawToken(variants.small).cssText} * var(--_en-size-small, 0) + ${rawToken(variants.medium).cssText} * var(--_en-size-medium, 1) + ${rawToken(variants.large).cssText} * var(--_en-size-large, 0));`)
        .join('\n');
    return declarations ? css `:host, .en-foundation { ${unsafeCSS(declarations)} } ${styles}` : styles;
}
