export type TokenType = 'color' | 'dimension' | 'number' | 'fontFamily' | 'fontWeight' | 'fontStyle' | 'duration' | 'cubicBezier' | 'shadow';
export interface ColorValue {
    colorSpace: 'srgb';
    components: readonly [number, number, number];
    alpha?: number;
}
export interface DimensionValue {
    value: number;
    unit: 'px' | 'rem';
}
export interface DurationValue {
    value: number;
    unit: 'ms' | 's';
}
export interface ShadowValue {
    color: ColorValue;
    offsetX: DimensionValue;
    offsetY: DimensionValue;
    blur: DimensionValue;
    spread: DimensionValue;
    inset?: boolean;
}
/** A nested DTCG document. See README for the deliberately supported subset. */
export type TokenDocument = Record<string, unknown>;
export interface TokenDefinition {
    $value: unknown;
    $type?: TokenType;
    $description?: string;
    $extensions?: Record<string, unknown>;
    $deprecated?: boolean | string;
}
export interface FlatToken extends TokenDefinition {
    id: string;
}
export interface Recipe {
    version: string;
    dependencies: readonly string[];
    evaluate: (get: (id: string) => unknown) => unknown;
    /** Optional equivalent CSS expression; otherwise the evaluated value is emitted. */
    css?: (reference: (id: string) => string) => string;
}
export interface ResolvedToken {
    readonly id: string;
    readonly type: TokenType;
    readonly value: unknown;
    readonly description: string;
    readonly cssName: string;
    readonly cssValue: string;
    readonly cssExpression: string;
    readonly dependencies: readonly string[];
    readonly potentialDependencies: readonly string[];
    readonly provenance: 'literal' | 'alias' | 'recipe' | 'pin';
    readonly recipeVersion?: string;
    readonly deprecated?: boolean | string;
}
export interface ResolvedGraph {
    readonly tokens: Readonly<Record<string, ResolvedToken>>;
    readonly dependencies: Readonly<Record<string, readonly string[]>>;
    readonly potentialDependencies: Readonly<Record<string, readonly string[]>>;
}
export type ThemeMode = 'light' | 'dark';
export type ThemeDensity = 'comfortable' | 'compact' | 'spacious';
export type ComponentSize = 'small' | 'medium' | 'large';
export interface ThemeOptions {
    name?: string;
    mode?: ThemeMode;
    density?: ThemeDensity;
    /** Additional typed source or overrides. Values at recipe outputs become pins. */
    source?: TokenDocument;
    /** Opt-in diagnostics for component outputs without registered library consumers. */
    warnUnknownComponentHooks?: boolean;
    pins?: Readonly<Record<string, unknown>>;
}
export interface ThemeDiagnostic {
    code: string;
    tokens: readonly string[];
    message: string;
    measured?: number;
}
export interface ResolvedTheme extends ResolvedGraph {
    readonly name: string;
    readonly mode: ThemeMode;
    readonly density: ThemeDensity;
    readonly source: TokenDocument;
    readonly sourceOverrides: TokenDocument;
    readonly pins: Readonly<Record<string, unknown>>;
    readonly sourceHash: string;
    readonly compilerVersion: string;
    readonly diagnostics: readonly ThemeDiagnostic[];
}
export interface EditorDescriptor {
    readonly tokenId: string;
    /** Public CSS contract name, also present in the customization registry. */
    readonly cssName: string;
    readonly kind: 'color' | 'dimension' | 'number' | 'font-family' | 'font-weight' | 'font-style' | 'duration' | 'bezier' | 'shadow';
    readonly choices?: readonly unknown[];
    readonly min?: number;
    readonly max?: number;
    readonly step?: number;
    readonly units?: readonly string[];
    readonly alpha?: boolean;
    readonly aliasTargets: readonly string[];
    readonly supportsPin: true;
}
export interface ThemeCSSOptions {
    scope?: 'root' | 'theme';
    /** Explicit stylesheet target. Shadow-host output must be installed inside that shadow root. */
    target?: 'root' | 'element' | 'shadow-host';
    /** Complete paired-appearance selectors for custom selector grammars. */
    appearanceSelectors?: {
        auto: string;
        light: string;
        dark: string;
    };
    /** Partial-only: release registered optional hooks to their point-of-use fallback. */
    clearOverrides?: readonly string[];
    /** Code-authored selector, not an admin free-form field. */
    selector?: string;
    kind?: 'full' | 'partial';
    /** For a single full theme, opt into its fixed native color scheme. Pair output always owns its scheme. */
    colorScheme?: boolean;
    tokenIds?: readonly string[];
    /** Public component variables supplied by a consuming component manifest. */
    componentOverrides?: readonly string[];
}
