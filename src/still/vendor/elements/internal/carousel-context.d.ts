import type { ReactiveControllerHost } from 'lit';
export type CarouselSlideContext = Readonly<{
    position: string;
    description: string;
    visible: boolean;
}> | null;
/** Presentation is per member; requesting the service does not admit a slide. */
export interface CarouselPresentationService {
    subscribe(slide: HTMLElement, receive: (context: CarouselSlideContext) => void): () => void;
}
export declare const carouselContext: {
    __context__: CarouselPresentationService;
};
export declare class CarouselContextProvider {
    private values;
    private receivers;
    private service;
    constructor(host: HTMLElement & ReactiveControllerHost);
    /** Only the owning carousel's existing slot/collection reconciliation calls this. */
    set(slide: HTMLElement, value: CarouselSlideContext): void;
}
