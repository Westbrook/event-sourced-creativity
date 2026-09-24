import type { ResolvedTheme, ResolvedToken, TokenType } from './types.js';
import { customizationFamilies, hookDeclarations, type HookDeclaration } from './customization-data.js';
export type CustomizationKind = 'semantic' | 'override' | 'configuration' | 'mechanical';
export type CustomizationReset = 'semantic' | 'theme' | 'preserve';
export type CustomizationSizeBehavior = HookDeclaration['size'] | 'selected-output' | 'size-input';
/** Stylesheet inputs, not a complete CSS dependency graph: recipes can reorder
 * inputs or derive geometry in a local context. */
export interface CustomizationFallback {
    readonly tokenIds: readonly string[];
    readonly cssNames: readonly string[];
    readonly description: string;
}
export interface CustomizationRegistration {
    /** Compatibility default is inherited/untyped and invalid when unset.
     * Optional hooks deliberately have no initial-value. */
    readonly syntax: '*';
    readonly inherits: true;
    readonly initialValue?: string;
    readonly typed: {
        readonly eligible: boolean;
        readonly syntax?: string;
        readonly reason: string;
    };
}
export interface CustomizationContract {
    readonly cssName: string;
    readonly tokenId?: string;
    readonly tokenType?: TokenType;
    readonly kind: CustomizationKind;
    readonly family: string;
    readonly concepts: readonly string[];
    /** Consumer grammar; not every CSS property grammar is legal in @property. */
    readonly syntax: string;
    readonly inherits: true;
    readonly fallback: CustomizationFallback;
    readonly reset: CustomizationReset;
    readonly states: readonly string[];
    readonly size: {
        readonly behavior: CustomizationSizeBehavior;
        readonly description: string;
    };
    readonly managed: {
        readonly supported: boolean;
        readonly tokenId?: string;
        readonly reason: string;
    };
    readonly registration: CustomizationRegistration;
    readonly consumers: readonly string[];
    readonly consumerStatus: 'connected' | 'unwired' | 'source-token';
    /** Resolved authoring default is distinct from the stylesheet fallback. */
    readonly tokenDefault?: {
        readonly cssValue: string;
        readonly cssExpression: string;
        readonly tokenIds: readonly string[];
        readonly provenance: ResolvedToken['provenance'];
        readonly fullThemeValue: 'initial' | 'expression';
    };
}
/** Static public hook classification, useful without resolving a theme. */
export declare const styleCustomizationContracts: readonly CustomizationContract[];
/** Compatibility lists derive from the same declarations. Configuration and
 * mechanical inputs never enter full-theme reset. */
export type StyleOverrideName = Extract<typeof hookDeclarations[number], {
    readonly kind: 'override';
}>['cssName'];
export declare const styleOverrideNames: readonly StyleOverrideName[];
export declare const styleStateProperties: readonly string[];
export declare const styleConfigurationProperties: readonly string[];
export declare const styleFamilies: readonly typeof customizationFamilies[number][0][];
/** A theme source or reset extension must not claim application layout or
 * controller/data properties. Assign those through their CSS/component API. */
export declare function assertThemeCustomizationProperty(cssName: string, tokenId?: string): void;
/** Combine the declared CSS surface with the actual resolved graph. Matching
 * cssName supports compatible source overlays. CSS-only hooks do not become
 * manageable because of their spelling. This is not exhaustive rendered impact. */
export declare function customizationContracts(theme: ResolvedTheme): readonly CustomizationContract[];
export declare function getCustomizationContract(theme: ResolvedTheme, cssName: string): CustomizationContract | undefined;
