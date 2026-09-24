import { nothing } from 'lit';
/** Decorative only: excluded from pointer hit testing and accessible descriptions. */
export declare function overlayArrowTemplate(arrow: boolean, path?: string): typeof nothing | import("lit-html").TemplateResult<1>;
export declare function arrowExtent(surface: HTMLElement): number;
/** Aim at the trigger after flip/shift, keeping the base clear of rounded corners.
 * Hide when no edge can point at the trigger without falsely indicating a target. */
export declare function positionOverlayArrow(surface: HTMLElement, trigger: HTMLElement): void;
