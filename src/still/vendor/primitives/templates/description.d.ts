import type { TemplateResult } from 'lit';
/**
 * One stable, same-shadow description target per field. Native slot assignment
 * takes precedence over the attribute fallback, including an empty assigned
 * element. Shared form styles collapse the controlled empty fallback span;
 * the target and slot stay in the initial SSR DOM without presence observers.
 */
export declare function descriptionTemplate(fallback: string, part?: string): TemplateResult;
