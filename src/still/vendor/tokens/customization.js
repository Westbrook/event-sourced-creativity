import { deepFreeze, TokenError } from './value.js';
import { componentSizes, sizingRoles } from './sizing.js';
import { customizationFamilies, directHookConsumers, hookDeclarations } from './customization-data.js';
function compatibilityRegistration(reason) {
    return { syntax: '*', inherits: true, typed: { eligible: false, reason } };
}
const sizeDescriptions = {
    none: 'No geometry contract.',
    fixed: 'An explicit hook value bypasses contextual selected-size fallbacks; it does not scale automatically.',
    minimum: 'A minimum input; content, target floors or available layout may constrain the rendered size.',
    maximum: 'A ceiling input; available viewport or layout can impose a smaller limit.',
    preferred: 'A preferred dimension; available space or separate minimums can constrain it.',
    relative: 'An input to a local geometry calculation; it is not necessarily the final rendered dimension.',
    configuration: 'Application layout configuration remains inherited across full theme boundaries.',
    mechanical: 'Data/controller geometry remains inherited across full theme boundaries.',
    'selected-output': 'An absolute small/medium/large output selected by the stylesheet; nested sizes do not multiply it.',
    'size-input': 'A semantic size or scale input; resolve a full theme to recompute graph dependants.',
};
function hookContract(declaration) {
    const preserved = declaration.kind !== 'override';
    return {
        cssName: declaration.cssName, kind: declaration.kind, family: declaration.family,
        concepts: declaration.concepts, syntax: declaration.syntax, inherits: true,
        fallback: { tokenIds: declaration.fallbackTokens, cssNames: declaration.fallbackCSS, description: declaration.description },
        reset: preserved ? 'preserve' : 'theme', states: declaration.states,
        size: { behavior: declaration.size, description: sizeDescriptions[declaration.size] },
        managed: { supported: false, reason: declaration.kind === 'mechanical'
                ? 'Controller/data input, outside managed theme authoring.'
                : declaration.kind === 'configuration'
                    ? 'Application layout configuration, outside managed theme authoring; source tokens and theme resets cannot claim this property.'
                    : 'CSS-only unless this resolved theme contains a corresponding typed source token.' },
        registration: compatibilityRegistration(preserved
            ? 'Preserve authored/controller inheritance and unset fallbacks; a typed initial value would change this contract.'
            : 'Optional hook: typed registration requires an initial value that would suppress contextual var() fallbacks and selected-size behavior.'),
        consumers: directHookConsumers[declaration.cssName] ?? declaration.consumers, consumerStatus: declaration.consumerStatus,
    };
}
/** Static public hook classification, useful without resolving a theme. */
export const styleCustomizationContracts = deepFreeze(hookDeclarations.map(hookContract));
export const styleOverrideNames = deepFreeze(styleCustomizationContracts.filter(record => record.reset === 'theme').map(record => record.cssName));
export const styleStateProperties = deepFreeze(styleCustomizationContracts.filter(record => record.kind === 'mechanical').map(record => record.cssName));
export const styleConfigurationProperties = deepFreeze(styleCustomizationContracts.filter(record => record.kind === 'configuration').map(record => record.cssName));
export const styleFamilies = deepFreeze(customizationFamilies.map(([name]) => name));
const preservedNames = new Set([...styleConfigurationProperties, ...styleStateProperties]);
/** A theme source or reset extension must not claim application layout or
 * controller/data properties. Assign those through their CSS/component API. */
export function assertThemeCustomizationProperty(cssName, tokenId) {
    if (preservedNames.has(cssName))
        throw new TokenError('reserved-customization-property', `${cssName} is an inheritance-preserving configuration or mechanical input, not a theme token/reset property.`, tokenId);
}
const semanticSyntax = {
    color: '<color>', dimension: '<length>', number: '<number>', fontFamily: '<font-family>',
    fontStyle: '<font-style>', fontWeight: '<number>', duration: '<time>', cubicBezier: '<easing-function>', shadow: '<shadow>',
};
function syntaxForToken(token) {
    // Number tokens may carry an emitted cssUnit extension (layout.prose-max).
    return token.type === 'number' && /^-?[\d.]+(?:ch|em|rem|px|vw|vh)$/.test(token.cssValue) ? '<length>' : semanticSyntax[token.type];
}
function semanticRegistration(token) {
    const syntax = syntaxForToken(token);
    const supported = ['<color>', '<length>', '<number>', '<time>'].includes(syntax);
    const relative = syntax === '<length>' && !/^-?(?:\d+\.?\d*|\.\d+)px$/.test(token.cssValue);
    return {
        syntax: '*', inherits: true,
        typed: { eligible: supported && !relative, ...(supported ? { syntax } : {}),
            reason: !supported
                ? 'This compound CSS grammar has no equivalent supported typed @property syntax; keep the compatibility registration.'
                : relative
                    ? 'The resolved length uses relative units. A typed registration needs a separate computationally independent initial value and an explicit author decision.'
                    : 'A typed registration is possible only as explicit document-wide opt-in with a stable initial value; it changes invalid-value and inheritance semantics.' },
    };
}
const sizedOutputs = new Set(Object.keys(sizingRoles).flatMap(role => componentSizes.map(size => `${role}-${size}`)));
function semanticConcepts(token) {
    const id = token.id;
    if (id.startsWith('radius.'))
        return ['radius', 'geometry'];
    if (id.startsWith('font.'))
        return ['typography'];
    if (id.startsWith('focus.') || id === 'color.focus' || id === 'color.focus-halo')
        return ['focus', token.type === 'color' ? 'paint' : 'geometry'];
    if (id.startsWith('space.') || id.startsWith('rhythm.'))
        return ['spacing', 'geometry'];
    if (id.startsWith('size.'))
        return ['size', 'geometry'];
    if (id.startsWith('border.'))
        return ['border', 'geometry'];
    if (id.startsWith('shadow.'))
        return ['elevation'];
    if (id.startsWith('duration.') || id.startsWith('ease.') || id.startsWith('motion.'))
        return ['motion'];
    if (id.startsWith('layout.'))
        return ['layout'];
    if (id.startsWith('calendar.'))
        return ['selection', 'paint'];
    if (token.type === 'color')
        return ['paint'];
    return ['custom'];
}
function semanticContract(token) {
    const optional = token.id.startsWith('component.');
    const size = sizedOutputs.has(token.id) ? 'selected-output' : token.type === 'dimension' || token.id.startsWith('size.') ? 'size-input' : 'none';
    return {
        cssName: token.cssName, tokenId: token.id, tokenType: token.type,
        kind: optional ? 'override' : 'semantic',
        family: optional ? token.id.split('.')[1] : token.id.startsWith('font.') ? 'typography' : token.id.startsWith('calendar.') ? 'calendar' : 'foundations',
        concepts: semanticConcepts(token), syntax: syntaxForToken(token), inherits: true,
        fallback: { tokenIds: [...token.dependencies], cssNames: [], description: token.description },
        reset: optional ? 'theme' : 'semantic',
        states: token.id.includes('action-hover') || token.id.includes('hover-opacity') ? ['hover'] : token.id.includes('action-pressed') || token.id.includes('pressed-opacity') ? ['pressed'] : [],
        size: { behavior: size, description: sizeDescriptions[size] },
        managed: { supported: true, tokenId: token.id, reason: 'Present in this resolved theme; typed editor/pin authoring follows the source token.' },
        registration: optional
            ? compatibilityRegistration('Optional component token: typed initial values would suppress contextual stylesheet fallbacks.')
            : semanticRegistration(token),
        consumers: ['packages/tokens/src/source.ts'], consumerStatus: 'source-token',
    };
}
/** Combine the declared CSS surface with the actual resolved graph. Matching
 * cssName supports compatible source overlays. CSS-only hooks do not become
 * manageable because of their spelling. This is not exhaustive rendered impact. */
export function customizationContracts(theme) {
    const records = new Map(styleCustomizationContracts.map(record => [record.cssName, record]));
    for (const token of Object.values(theme.tokens)) {
        assertThemeCustomizationProperty(token.cssName, token.id);
        const declared = records.get(token.cssName);
        const base = declared ?? semanticContract(token);
        records.set(token.cssName, {
            ...base, tokenId: token.id, tokenType: token.type,
            managed: { supported: true, tokenId: token.id, reason: 'Present in this resolved theme; typed editor/pin authoring follows the source token.' },
            tokenDefault: { cssValue: token.cssValue, cssExpression: token.cssExpression, tokenIds: [...token.dependencies],
                provenance: token.provenance,
                fullThemeValue: token.id.startsWith('component.') && token.provenance !== 'pin' && token.provenance !== 'literal' ? 'initial' : 'expression' },
        });
    }
    return deepFreeze([...records.values()].sort((a, b) => a.cssName.localeCompare(b.cssName, 'en')));
}
export function getCustomizationContract(theme, cssName) {
    return customizationContracts(theme).find(record => record.cssName === cssName);
}
