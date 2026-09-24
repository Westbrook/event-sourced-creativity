import { createContext } from '@lit/context';
import { ContextProvider } from './context-provider.js';
export const carouselContext = createContext('../../carousel-presentation/v1');
export class CarouselContextProvider {
    values = new WeakMap();
    receivers = new Map();
    service = {
        subscribe: (slide, receive) => {
            let callbacks = this.receivers.get(slide);
            if (!callbacks)
                this.receivers.set(slide, callbacks = new Set());
            callbacks.add(receive);
            receive(this.values.get(slide) ?? null);
            return () => {
                callbacks.delete(receive);
                if (!callbacks.size && this.receivers.get(slide) === callbacks)
                    this.receivers.delete(slide);
            };
        },
    };
    constructor(host) {
        new ContextProvider(host, { context: carouselContext, initialValue: this.service });
    }
    /** Only the owning carousel's existing slot/collection reconciliation calls this. */
    set(slide, value) {
        if (value)
            this.values.set(slide, Object.freeze(value));
        else
            this.values.delete(slide);
        for (const receive of [...(this.receivers.get(slide) ?? [])])
            receive(value);
    }
}
