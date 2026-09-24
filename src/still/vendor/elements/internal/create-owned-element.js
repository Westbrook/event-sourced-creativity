import { registryCreationScope } from '../element-scope.js';
import { elementRegistry } from './element-registry.js';
/** Synchronous factory for a required, already registered dependency in the owner's scope. */
export function createOwnedElement(owner, tag) {
    const document = owner.ownerDocument;
    const registry = elementRegistry(owner);
    if (!registry?.get(tag))
        throw new Error(`The owning registry must define ${tag} before synchronous creation.`);
    const view = document.defaultView;
    if (view && !view.HTMLElement.prototype.isPrototypeOf(owner)) {
        // Import's construction context handles classes from an adopted source realm;
        // direct createElement can reject their source-document constructor in WebKit.
        const template = document.createElement('template');
        template.innerHTML = `<${tag}></${tag}>`;
        return registryCreationScope(document, registry).importNode(template.content, true).firstElementChild;
    }
    return registry === document.defaultView?.customElements
        ? document.createElement(tag)
        : document.createElement(tag, { customElementRegistry: registry });
}
