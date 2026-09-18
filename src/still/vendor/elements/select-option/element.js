import { nothing } from 'lit';
import { SelectionItemElement } from '../internal/selection-item.js';
/**
 * Declarative metadata for one en-select option. The parent renders the native option.
 * This descriptor is not an interactive option and owns no selection or form entry.
 * @tagname en-select-option
 * @slot - Plain option label text; normalized nonempty text replaces the label fallback.
 */
export class EnSelectOption extends SelectionItemElement {
    render() { return nothing; }
}
