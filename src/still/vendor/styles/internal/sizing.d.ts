import { type CSSResult } from 'lit';
/** Static family compilation: declare only private roles consumed by this fragment.
 * A universal role block repeated in every declarative shadow root is needlessly
 * expensive. Selection flags inherit only when requested; role values always
 * recompute at the local theme boundary. No application content is inspected.
 */
export declare function sizedStyles(styles: CSSResult): CSSResult;
