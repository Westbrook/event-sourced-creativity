/** Reviewed public CSS contracts. Sources are consumers, not a promise that every
 * selector in a family consumes every hook. Exact source coverage is checked by
 * tooling/customization; runtime consumers never read the filesystem. */
export interface HookDeclaration {
    readonly cssName: string;
    readonly family: string;
    readonly syntax: string;
    readonly fallbackTokens: readonly string[];
    readonly fallbackCSS: readonly string[];
    readonly description: string;
    readonly consumers: readonly string[];
    readonly kind: 'override' | 'configuration' | 'mechanical';
    readonly states: readonly string[];
    readonly concepts: readonly string[];
    readonly size: 'none' | 'fixed' | 'minimum' | 'maximum' | 'preferred' | 'relative' | 'configuration' | 'mechanical';
    readonly consumerStatus: 'connected' | 'unwired';
}
/** These are recipe families, including recipes that consume only semantic
 * tokens. Keep family membership alongside the source contract declarations. */
export declare const customizationFamilies: readonly [readonly ['carousel', readonly [string]], readonly ['collaboration', readonly [string]], readonly ['color-slider', readonly [string]], readonly ['color-picker', readonly [string]], readonly ['color-plane', readonly [string]], readonly ['color-wheel', readonly [string]], readonly ['toast', readonly [string]], readonly ['foundations', readonly [string]], readonly ['controls', readonly [string, string, string]], readonly ['buttons', readonly [string, string]], readonly ['links', readonly [string, string]], readonly ['radio', readonly [string, string]], readonly ['combobox', readonly [string]], readonly ['selection', readonly [string, string]], readonly ['surfaces', readonly [string]], readonly ['overlays', readonly [string]], readonly ['feedback', readonly [string, string]], readonly ['recipes', readonly [string]], readonly ['navigation', readonly [string]], readonly ['commands', readonly [string]], readonly ['content', readonly [string]], readonly ['table', readonly [string, string]], readonly ['pagination', readonly [string]], readonly ['tree', readonly [string]], readonly ['file-upload', readonly [string]], readonly ['calendar', readonly [string]], readonly ['chat', readonly [string]], readonly ['token-editor', readonly [string]], readonly ['rich-text-editor', readonly [string, string]], readonly ['editor-toolbar', readonly [string]], readonly ['form-navigation', readonly [string]], readonly ['typography', readonly [string]]];
/** Optional overrides retain the guaranteed-invalid/unset fallback. Existing
 * resettable names keep that policy, including older layout hooks. New authored
 * viewport/configuration inputs deliberately preserve inheritance. */
export declare const hookDeclarations: readonly [Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-switch-thumb-pressed-size";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-slider-thumb-pressed-scale";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-slider-thumb-press-duration";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-slider-thumb-release-duration";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-color-plane-thumb-pressed-scale";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-color-plane-thumb-press-duration";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-color-plane-thumb-release-duration";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-segmented-pressed-scale";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-segmented-pressed-offset";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-segmented-press-duration";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-segmented-release-duration";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-segmented-pressed-shadow";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-segmented-pressed-background";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-segmented-pressed-color";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-segmented-pressed-border-color";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-accordion-pressed-scale";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-accordion-pressed-offset";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-accordion-press-duration";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-accordion-release-duration";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-accordion-pressed-shadow";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-accordion-pressed-background";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-accordion-pressed-color";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-tab-pressed-scale";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-tab-pressed-offset";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-tab-press-duration";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-tab-release-duration";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-tab-pressed-shadow";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-tab-pressed-color";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-rating-pressed-scale";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-rating-pressed-offset";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-rating-press-duration";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-rating-release-duration";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-rating-pressed-shadow";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-rating-pressed-background";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-rating-pressed-color";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-combobox-trigger-pressed-scale";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-combobox-trigger-pressed-offset";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-combobox-trigger-press-duration";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-combobox-trigger-release-duration";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-combobox-trigger-pressed-shadow";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-combobox-trigger-pressed-background";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-combobox-trigger-pressed-color";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-navigation-pressed-scale";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-navigation-pressed-offset";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-navigation-press-duration";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-navigation-release-duration";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-navigation-pressed-shadow";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-navigation-pressed-color";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-editor-token-pressed-scale";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-editor-token-pressed-offset";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-editor-token-press-duration";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-editor-token-release-duration";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-editor-token-pressed-shadow";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-editor-token-pressed-background";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-editor-token-pressed-color";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-editor-token-pressed-border-color";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-option-pressed-scale";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-option-pressed-offset";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-option-press-duration";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-option-release-duration";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-option-pressed-shadow";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-calendar-pressed-scale";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-calendar-pressed-offset";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-calendar-press-duration";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-calendar-release-duration";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-calendar-pressed-shadow";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-checkbox-pressed-scale";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-checkbox-pressed-offset";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-checkbox-press-duration";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-checkbox-release-duration";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-checkbox-pressed-shadow";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-checkbox-pressed-border-color";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-radio-pressed-scale";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-radio-pressed-offset";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-radio-press-duration";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-radio-release-duration";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-radio-pressed-shadow";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-radio-pressed-border-color";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-switch-pressed-scale";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-switch-pressed-offset";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-switch-press-duration";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-switch-release-duration";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-switch-pressed-shadow";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-switch-pressed-border-color";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-select-pressed-scale";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-select-pressed-offset";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-select-press-duration";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-select-release-duration";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-select-pressed-shadow";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-select-pressed-background";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-select-pressed-color";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-number-step-pressed-scale";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-number-step-pressed-offset";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-number-step-press-duration";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-number-step-release-duration";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-number-step-pressed-shadow";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-number-step-pressed-background";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-input-radius";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-input-border-width";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-input-invalid-border-width";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-input-border-color";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-input-hover-border-color";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-input-invalid-border-color";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-surface-shadow";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-card-shadow";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-button-shadow";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-button-pressed-shadow";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-button-pressed-scale";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-button-popup-pressed-scale";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-button-popup-pressed-offset";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-button-pressed-offset";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-button-press-duration";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-button-release-duration";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-navigation-hover-background";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-navigation-hover-color";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-navigation-current-background";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-navigation-current-color";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-navigation-pressed-background";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-navigation-current-indicator-color";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-navigation-current-indicator-width";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-tab-hover-background";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-tab-hover-color";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-tab-selected-background";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-tab-selected-color";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-tab-pressed-background";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-tab-indicator-color";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-popup-enter-duration";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-popup-enter-ease";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-popup-exit-duration";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-popup-exit-ease";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-dialog-enter-duration";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-dialog-enter-ease";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-dialog-exit-duration";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-dialog-exit-ease";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-toast-enter-duration";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-toast-enter-ease";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-toast-exit-duration";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-toast-exit-ease";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-choice-size";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-switch-inline-size";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-switch-block-size";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-switch-thumb-size";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-carousel-gap";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-carousel-radius";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-carousel-background";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-carousel-border-color";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-carousel-slides-per-view";
    readonly kind: "override";
}, ...((Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-button-background";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-button-border-color";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-button-color";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-button-hover-background";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-button-hover-color";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-button-inline-padding";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-button-pressed-background";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-button-pressed-color";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-button-radius";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-button-rest-background";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-button-rest-color";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-card-background";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-color-picker-gap";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-color-picker-inline-size";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-color-picker-preview-radius";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-color-picker-preview-size";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-color-slider-checker-dark";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-color-slider-checker-light";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-color-slider-checker-size";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-color-slider-radius";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-color-slider-thumb-size";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-color-slider-track-size";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-control-background";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-control-border-color";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-control-color";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-control-inline-padding";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-control-min-size";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-control-radius";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-editor-token-block-padding";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-editor-token-gap";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-editor-token-inline-padding";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-editor-token-min-size";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-editor-token-radius";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-field-gap";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-input-background";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-input-color";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-input-focus-accent-color";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-input-focus-accent-width";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-input-inline-padding";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-inset-child-radius";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-inset-distance";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-inset-outer-radius";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-option-background";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-option-block-padding";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-option-color";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-option-font-weight";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-option-inline-padding";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-option-list-gap";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-option-list-max-block-size";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-option-list-padding";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-option-list-radius";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-option-list-shadow";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-option-radius";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-option-selected-font-weight";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-presence-busy-color";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-presence-group-gap";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-presence-hover-background";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-presence-hover-border-color";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-presence-online-color";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-radio-selected-color";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-segmented-control-frame-inset";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-select-appearance";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-surface-background";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-surface-border-color";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-surface-color";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-surface-padding";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-surface-radius";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-tab-background";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-tab-color";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-toast-background";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-toast-border-color";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-toast-color";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-toast-icon-color";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-toast-padding";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-toast-radius";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-toast-region-gap";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-toast-region-layer";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-toast-region-max-size";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-toast-region-width";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-toast-shadow";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-toast-stack-offset";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-activity-background" | "--en-presence-background";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-activity-border-color" | "--en-presence-border-color";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-activity-gap" | "--en-presence-gap";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-activity-padding" | "--en-presence-padding";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-activity-radius" | "--en-presence-radius";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-option-list-background" | "--en-option-list-border-color" | "--en-option-list-color";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-editor-token-background" | "--en-editor-token-border-color" | "--en-editor-token-color" | "--en-editor-token-hover-background" | "--en-editor-token-pressed-background";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-table-background" | "--en-table-border-color" | "--en-table-color" | "--en-table-footer-background" | "--en-table-footer-color" | "--en-table-header-background" | "--en-table-header-color" | "--en-table-row-hover-background" | "--en-table-row-selected-background" | "--en-table-row-selected-color" | "--en-table-row-selected-indicator-color";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-option-active-background" | "--en-option-active-color" | "--en-option-disabled-background" | "--en-option-disabled-color" | "--en-option-hover-background" | "--en-option-hover-color" | "--en-option-pressed-background" | "--en-option-pressed-color" | "--en-option-rest-background" | "--en-option-rest-color" | "--en-option-selected-background" | "--en-option-selected-color";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-toast-danger-background" | "--en-toast-danger-border-color" | "--en-toast-danger-color" | "--en-toast-danger-icon-color" | "--en-toast-info-background" | "--en-toast-info-border-color" | "--en-toast-info-color" | "--en-toast-info-icon-color" | "--en-toast-success-background" | "--en-toast-success-border-color" | "--en-toast-success-color" | "--en-toast-success-icon-color" | "--en-toast-warning-background" | "--en-toast-warning-border-color" | "--en-toast-warning-color" | "--en-toast-warning-icon-color";
    readonly kind: "override";
}) | (Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-button-focus-color" | "--en-button-focus-halo-color" | "--en-button-focus-halo-width" | "--en-button-focus-offset" | "--en-button-focus-width" | "--en-input-focus-color" | "--en-input-focus-halo-color" | "--en-input-focus-halo-width" | "--en-input-focus-offset" | "--en-input-focus-width" | "--en-option-focus-color" | "--en-option-focus-halo-color" | "--en-option-focus-halo-width" | "--en-option-focus-offset" | "--en-option-focus-width" | "--en-overlay-focus-color" | "--en-overlay-focus-halo-color" | "--en-overlay-focus-halo-width" | "--en-overlay-focus-offset" | "--en-overlay-focus-width";
    readonly kind: "override";
}))[], Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-data-table-selection-width";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-table-cell-block-padding";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-table-cell-inline-padding";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-table-radius";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-file-list-gap";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-file-list-padding";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-file-list-media-size";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-file-list-metadata-gap";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-stack-gap";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-cluster-gap";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-grid-gap";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-grid-item-min";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-pagination-gap";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-pagination-page-min-inline-size";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-pagination-status-gap";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-overlay-arrow-size";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-overlay-background";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-overlay-color";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-overlay-border-color";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-overlay-radius";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-overlay-padding";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-overlay-max-inline-size";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-overlay-max-block-size";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-alert-background";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-alert-color";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-alert-border-color";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-badge-background";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-badge-color";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-badge-radius";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-progress-color";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-progress-track-color";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-progress-size";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-avatar-size";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-avatar-radius";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-media-radius";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-media-aspect-ratio";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-navigation-background";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-navigation-color";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-navigation-active-background";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-navigation-active-color";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-navigation-indent";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-navigation-border-color";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-navigation-gap";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-navigation-link-radius";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-swatch-size";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-slider-length";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-rating-star-radius";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-skeleton-color";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-skeleton-size";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-divider-color";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-prose-max-inline-size";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-icon-size";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-calendar-inline-size";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-calendar-day-size";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-calendar-gap";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-calendar-day-radius";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-calendar-range-background";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-calendar-range-endpoint-background";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-calendar-range-preview-background";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-chat-background";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-chat-color";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-chat-border-color";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-chat-outgoing-background";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-chat-padding";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-chat-radius";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-color-plane-block-size";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-color-plane-radius";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-color-plane-thumb-size";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-color-wheel-size";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-color-wheel-thumb-size";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-color-wheel-track-size";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-editor-toolbar-background";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-editor-toolbar-gap";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-progress-steps-gap";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-validation-summary-padding";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-validation-summary-radius";
    readonly kind: "override";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-activity-viewport-size";
    readonly kind: "configuration";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-carousel-viewport-size";
    readonly kind: "configuration";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-tree-viewport-size";
    readonly kind: "configuration";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-data-table-viewport-size";
    readonly kind: "configuration";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-data-table-min-inline-size";
    readonly kind: "configuration";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-editor-max-size";
    readonly kind: "configuration";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-pagination-align";
    readonly kind: "configuration";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-progress-value";
    readonly kind: "mechanical";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-split-ratio";
    readonly kind: "mechanical";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-navigation-height";
    readonly kind: "mechanical";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-navigation-offset";
    readonly kind: "mechanical";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-navigation-position";
    readonly kind: "mechanical";
}, Omit<HookDeclaration, "cssName" | "kind"> & {
    readonly cssName: "--en-navigation-z-index";
    readonly kind: "mechanical";
}];
/** Direct lexical/helper consumers from the reviewed source inventory. Recipe
 * family membership above additionally includes composition/import boundaries. */
export declare const directHookConsumers: Readonly<Record<string, readonly string[]>>;
