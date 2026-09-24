/** Exact numeric channel identifiers shared by picker and plane. */
export type ColorChannel = 'red' | 'green' | 'blue' | 'hue' | 'saturation' | 'lightness' | 'brightness' | 'alpha';
/** Property-only messages. Numeric overrides do not set invalidity. */
export interface ColorMessages {
    readonly invalidColor?: string;
    /** Suffix used with each channel label to name its exact-value editor. */
    readonly exactValueLabel?: string;
    /** Per-channel constraint text; falls back to validationText, then built-in numeric messages. */
    readonly channels?: Partial<Record<ColorChannel, string>>;
}
/** Picker guidance in addition to the shared invalid-color and channel messages. */
export interface ColorPickerMessages extends ColorMessages {
    /** Overrides invalidMessage; that existing property remains the HEX fallback. */
    readonly hexGuidance?: string;
    readonly approximationLabel?: string;
    readonly readOnlyApproximation?: string;
    readonly editableApproximation?: string;
    readonly outOfGamut?: string;
    readonly inGamut?: string;
    readonly fallbackPaint?: string;
    readonly supportedPaint?: string;
    readonly convertLabel?: string;
}
