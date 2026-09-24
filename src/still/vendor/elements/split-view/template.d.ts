import type { SplitPane, SplitCollapsed } from './split-view.js';
export interface SplitViewSnapshot {
    readonly value: number;
    readonly min: number;
    readonly max: number;
    readonly step: number;
    readonly label: string;
    readonly disabled: boolean;
    readonly orientation: 'horizontal' | 'vertical';
    readonly collapsed: SplitCollapsed;
    readonly primaryAction: boolean;
    readonly secondaryAction: boolean;
    readonly primaryLabel: string;
    readonly secondaryLabel: string;
    readonly collapseLabel: string;
    readonly restoreLabel: string;
    readonly controlsLabel: string;
}
export declare function splitViewTemplate(view: SplitViewSnapshot, setHandle: (element?: Element) => void, action: (pane: SplitPane) => void, handleKey: (event: KeyboardEvent) => void): import("lit-html").TemplateResult<1>;
