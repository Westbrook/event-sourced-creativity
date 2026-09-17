/** Resolve the dependency closure without registering anything or reading a global registry. */
export function collectDefinitions(definitions) {
    const known = new Map();
    const dependencies = new Map();
    const result = [];
    const visited = new Set();
    const visit = (definition) => {
        const existing = known.get(definition.tagName);
        if (existing && existing.elementClass !== definition.elementClass)
            throw new Error(`Conflicting constructors for ${definition.tagName}.`);
        known.set(definition.tagName, definition);
        if (visited.has(definition))
            return;
        visited.add(definition);
        const children = dependencies.get(definition.tagName) ?? new Set();
        dependencies.set(definition.tagName, children);
        for (const dependency of definition.dependencies ?? []) {
            children.add(dependency.tagName);
            visit(dependency);
        }
    };
    for (const definition of definitions)
        visit(definition);
    const emitted = new Set();
    const visiting = new Set();
    const order = (tagName) => {
        if (emitted.has(tagName) || visiting.has(tagName))
            return;
        visiting.add(tagName);
        for (const dependency of dependencies.get(tagName) ?? [])
            order(dependency);
        visiting.delete(tagName);
        emitted.add(tagName);
        result.push(known.get(tagName));
    };
    for (const tagName of known.keys())
        order(tagName);
    return Object.freeze(result);
}
/** Preflight identity conflicts, then define dependency-first. Browser validation errors are not rolled back. */
export function registerDefinitions(registry, definitions) {
    const all = collectDefinitions(definitions);
    const namesByClass = new Map();
    for (const definition of all) {
        const previousName = namesByClass.get(definition.elementClass);
        if (previousName && previousName !== definition.tagName)
            throw new Error(`One constructor cannot define both ${previousName} and ${definition.tagName}.`);
        namesByClass.set(definition.elementClass, definition.tagName);
        const existing = registry.get(definition.tagName);
        if (existing && existing !== definition.elementClass)
            throw new Error(`A different version of ${definition.tagName} is already registered.`);
    }
    for (const definition of all) {
        if (!registry.get(definition.tagName))
            registry.define(definition.tagName, definition.elementClass);
    }
}
export function registerDefinition(registry, definition) {
    registerDefinitions(registry, [definition]);
}
