import { ContextProvider as LitContextProvider } from '@lit/context';
/** Lit 1.1.x uses stopPropagation; the current protocol requires immediate stop. */
export class ContextProvider extends LitContextProvider {
    installed = false;
    constructor(host, options) {
        super(host, options);
        const provide = this.onContextRequest;
        host.removeEventListener('context-request', provide);
        this.onContextRequest = event => {
            const requester = event.contextTarget ?? event.composedPath()[0];
            if (event.context === options.context && requester !== host)
                event.stopImmediatePropagation();
            provide(event);
        };
        host.addEventListener('context-request', this.onContextRequest);
        this.installed = true;
        if (host.isConnected)
            super.hostConnected();
    }
    /** A connected host may invoke this during super(); announce only after wrapping. */
    hostConnected() { if (this.installed)
        super.hostConnected(); }
}
