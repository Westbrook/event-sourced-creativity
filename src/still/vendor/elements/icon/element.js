import { EnElement } from '../internal/en-element.js';
import { foundationStyles, iconHostStyles } from '../../styles/foundations.js';
import { mediaStyles } from '../../styles/feedback.js';
import { iconTemplate } from './template.js';
/**
 * A small built-in icon set. Decorative by default; provide label for meaningful images.
 * @tagname en-icon
 * @cssprop --en-icon-size - Icon dimensions.
 * @cssprop --en-size-icon-stroke - Icon stroke weight in SVG user units.
 * @csspart base - The SVG icon.
 */
export class EnIcon extends EnElement {
    static properties = {
        name: { type: String },
        label: { type: String },
    };
    static styles = [foundationStyles, iconHostStyles, mediaStyles];
    constructor() {
        super();
        this.name = 'info';
        this.label = '';
    }
    render() {
        return iconTemplate(this.name, this.label);
    }
}
