import {waveformCache} from './waveform-cache.ts';
import {LitElement, html, svg, nothing, type PropertyValues} from 'lit';
import {keyed} from 'lit/directives/keyed.js';
import {decodedAudioPeaks, waveformPath, readWaveformBytes, MAX_WAVEFORM_SECONDS} from './audio-waveform.ts';

/** Playback stays native; the noninteractive waveform is derived locally from the same file. */
export class StillAudioPlayer extends LitElement {
  static properties = {src: {type: String}, label: {type: String}, scope: {type: String}, cacheScope: {type: String}, progress: {state: true}, status: {state: true}, path: {state: true}};
  src = ''; label = 'Audio'; scope = ''; cacheScope = '';
  private progress = 0;
  private frame = 0;
  private cachedDuration = 0;
  private clipId = `waveform-${crypto.randomUUID()}`;
  private status: 'loading' | 'ready' | 'unavailable' = 'loading';
  private path = '';
  private work?: AbortController;
  private started = false;
  private revision = 0;
  createRenderRoot() { return this; }
  private retire() {
    cancelAnimationFrame(this.frame); this.frame=0; this.progress=0; this.cachedDuration=0;
    this.revision++; this.work?.abort(); this.work = undefined; this.started = false; this.path = ''; this.status = 'loading';
    const audio = this.querySelector('audio');
    if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
  }
  protected willUpdate(changes: PropertyValues) {
    if (changes.has('src') || changes.has('scope') || changes.has('cacheScope')) {
      this.retire();
      const cached=waveformCache.get(this.cacheScope||this.scope,this.src);
      if(cached){this.path=waveformPath(cached.levels);this.cachedDuration=cached.duration;this.status='ready';}
    }
  }
  disconnectedCallback() { this.retire(); super.disconnectedCallback(); }
  connectedCallback() { super.connectedCallback(); this.requestUpdate('scope'); }
  private loadWaveform = async (event: Event) => {
    const audio = event.currentTarget as HTMLAudioElement;
    if (this.started || !this.isConnected || !this.src.startsWith('/api/media/')) return;
    this.started = true;
    if(this.cachedDuration&&Math.abs(audio.duration-this.cachedDuration)<.25)return;
    if (!Number.isFinite(audio.duration) || audio.duration <= 0 || audio.duration > MAX_WAVEFORM_SECONDS) { this.status = 'unavailable'; return; }
    const source = this.src, scope = this.scope, cacheScope=this.cacheScope||scope, controller = new AbortController(); this.work = controller;
    const current = () => this.isConnected && this.work === controller && !controller.signal.aborted && this.src === source && this.scope === scope;
    const timeout = setTimeout(() => { if (current()) this.status = 'unavailable'; controller.abort(); }, 30000);
    try {
      const response = await fetch(source, {credentials: 'same-origin', signal: controller.signal});
      const bytes = await readWaveformBytes(response, controller.signal);
      // Offline decoding never opens a speaker or needs playback permission.
      // 16 kHz keeps the visualization's decoded memory bounded for long audio.
      const context = new OfflineAudioContext(1, 1, 16000);
      const decoded = await context.decodeAudioData(bytes);
      if (!current()) return;
      if (decoded.duration > MAX_WAVEFORM_SECONDS || decoded.numberOfChannels > 8) throw new Error('Waveform too large');
      const channels = Array.from({length: decoded.numberOfChannels}, (_, i) => decoded.getChannelData(i));
      const peaks = await decodedAudioPeaks(channels, controller.signal);
      if (!current()) return;
      if (!peaks.length) throw new Error('Empty audio');
      waveformCache.put(cacheScope,source,decoded.duration,peaks);
      this.path = waveformPath(peaks); this.status = 'ready';
    } catch { if (this.work === controller && this.src === source && this.scope === scope && this.isConnected) this.status = 'unavailable'; }
    finally { clearTimeout(timeout); }
  };
  private updateProgress = () => {
    const audio=this.querySelector('audio');
    const next=audio&&Number.isFinite(audio.duration)&&audio.duration>0?Math.max(0,Math.min(1,audio.currentTime/audio.duration)):0;
    if(Math.abs(next-this.progress)>.001||next===0||next===1)this.progress=next;
  };
  private trackPlayback = () => {
    cancelAnimationFrame(this.frame);this.updateProgress();
    const audio=this.querySelector('audio');
    if(this.isConnected&&audio&&!audio.paused&&!audio.ended)this.frame=requestAnimationFrame(this.trackPlayback);
  };
  private stopTracking = () => {cancelAnimationFrame(this.frame);this.frame=0;this.updateProgress();};
  render() {
    const source = this.src.startsWith('/api/media/') ? this.src : '';
    return html`<div class="audio-waveform" aria-busy=${Boolean(source) && this.status === 'loading'}>
      ${this.status === 'ready' ? html`<svg viewBox="0 0 600 180" preserveAspectRatio="none" role="img" aria-label=${`Waveform of ${this.label}`}><defs><clipPath id=${this.clipId}><rect x="0" y="0" width=${this.progress*600} height="180"></rect></clipPath></defs><line x1="0" x2="600" y1="90" y2="90"></line><path d=${this.path}></path><path class="waveform-played" d=${this.path} clip-path=${`url(#${this.clipId})`}></path>${this.progress>0?svg`<line class="waveform-playhead" x1=${this.progress*600} x2=${this.progress*600} y1="12" y2="168"></line>`:nothing}</svg>` : html`<span role="status">${this.status === 'unavailable' || !source ? 'Waveform unavailable.' : 'Loading waveform…'}</span>`}
    </div>${keyed(`${this.revision}:${this.scope}:${source}`, html`<audio controls preload="metadata" aria-label=${this.label} src=${source || nothing} @loadedmetadata=${this.loadWaveform} @play=${this.trackPlayback} @pause=${this.stopTracking} @ended=${this.stopTracking} @timeupdate=${this.updateProgress} @seeking=${this.updateProgress} @seeked=${this.updateProgress} @durationchange=${this.updateProgress} @error=${() => {this.status = 'unavailable';}}></audio>`)}`;
  }
}
customElements.define('still-audio-player', StillAudioPlayer);
