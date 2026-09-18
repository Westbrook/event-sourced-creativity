import { EnElement } from '../internal/en-element.js';
import { foundationStyles, blockHostStyles } from '../../styles/foundations.js';
import { feedbackStyles } from '../../styles/feedback.js';
import { skeletonTemplate } from './template.js';
/**
 * A decorative loading placeholder. The surrounding region owns loading status.
 * @tagname en-skeleton
 * @cssprop --en-skeleton-color - Placeholder color.
 * @cssprop --en-skeleton-size - Placeholder block size.
 * @csspart base - The placeholder surface.
 */
export class EnSkeleton extends EnElement {
    static properties = { shape: { reflect: true } };
    static styles = [foundationStyles, blockHostStyles, feedbackStyles];
    constructor() {
        super();
        this.shape = 'text';
    }
    render() {
        return skeletonTemplate(this.shape);
    }
}
