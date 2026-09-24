import type { ComponentSize } from './types.js';
/** Absolute visual size choices. Density and target-size floors are independent. */
export declare const componentSizes: readonly ["small", "medium", "large"];
export declare const sizeScales: Readonly<Record<ComponentSize, number>>;
export declare const typeScales: Readonly<Record<ComponentSize, number>>;
/** Finite semantic mapping shared by token generation and stylesheet size selection.
 * Output IDs append -small/-medium/-large. A size selects these absolute outputs;
 * nested hosts must not multiply an already selected parent value again.
 */
export declare const sizingRoles: Readonly<{
    'size.control': "size.control-min";
    'size.icon': "size.icon";
    'size.avatar': "size.avatar";
    'size.swatch': "size.swatch";
    'size.spinner': "size.spinner";
    'size.progress': "size.progress";
    'size.skeleton-line': "size.skeleton-line";
    'size.splitter': "size.splitter";
    'size.switch-inline': "size.switch-inline";
    'size.switch-block': "size.switch-block";
    'size.switch-thumb': "size.switch-thumb";
    'size.choice-mark-inline': "size.choice-mark-inline";
    'size.choice-mark-block': "size.choice-mark-block";
    'size.choice-dot': "size.choice-dot";
    'size.range-track': "size.range-track";
    'space.switch-inset': "space.switch-inset";
    'space.control-inline': "space.control-inline";
    'space.control-block': "space.control-block";
    'space.panel': "space.panel";
    'space.rows': "space.rows";
    'space.actions': "space.actions";
    'space.fields': "space.fields";
    'space.sections': "space.sections";
    'space.icon-label': "space.icon-label";
    'space.label-control': "space.label-control";
    'space.control-description': "space.control-description";
    'space.badge-inline': "space.badge-inline";
    'space.badge-block': "space.badge-block";
    'radius.control': "radius.control";
    'radius.container': "radius.container";
    'radius.dialog': "radius.dialog";
    'radius.choice': "radius.choice";
    'layout.form-max': "layout.form-max";
    'layout.panel-preferred': "layout.panel-preferred";
    'font.ui.size': "font.ui.size";
    'font.input.size': "font.input.size";
    'font.data.size': "font.data.size";
    'font.metadata.size': "font.metadata.size";
    'font.body.size': "font.body.size";
    'font.heading-small.size': "font.heading-small.size";
    'font.heading-medium.size': "font.heading-medium.size";
    'font.heading-large.size': "font.heading-large.size";
}>;
/** Ready-to-use CSS names; safe to import without token resolution or color math. */
export declare const sizingRoleCSS: readonly Readonly<{
    role: `--en-${string}`;
    base: `--en-${string}`;
    variants: Readonly<Readonly<Record<ComponentSize, string>>>;
}>[];
export declare function sizeScaleToken(role: string, size: ComponentSize): string;
