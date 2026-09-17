import { reaction } from 'signal-utils/subtle/reaction';
/** Watches a pure snapshot only while its host is connected. Reading a snapshot never requires this controller. */
export class SignalController {
    #host;
    #read;
    #stop;
    #generation = 0;
    #disposed = false;
    constructor(host, readSnapshot) {
        this.#host = host;
        this.#read = readSnapshot;
        host.addController(this);
    }
    get snapshot() { return this.#read(); }
    hostConnected() {
        if (this.#disposed)
            return;
        this.#stop?.();
        const generation = ++this.#generation;
        this.#stop = reaction(this.#read, () => {
            if (!this.#disposed && generation === this.#generation)
                this.#host.requestUpdate();
        });
        this.#host.requestUpdate();
    }
    hostDisconnected() {
        ++this.#generation;
        this.#stop?.();
        this.#stop = undefined;
    }
    /** Permanently detach this controller. Ordinary DOM removal should use hostDisconnected. */
    dispose() {
        this.#disposed = true;
        this.hostDisconnected();
        this.#host.removeController(this);
    }
}
