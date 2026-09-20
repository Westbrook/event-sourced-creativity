import { html, nothing } from 'lit';
/**
 * One stable, same-shadow description target per field. Native slot assignment
 * takes precedence over the attribute fallback, including an empty assigned
 * element. Shared form styles collapse the controlled empty fallback span;
 * the target and slot stay in the initial SSR DOM without presence observers.
 */
export function descriptionTemplate(fallback, part = 'description') {
    // Hydrate an absent value as an empty part, not an empty text node: HTML
    // parsing drops empty text nodes before a later fallback update can reuse one.
    return html `<div id="description" part=${part} class="en-description"><slot name="description"><span class="en-description-fallback">${fallback || nothing}</span></slot></div>`;
}
