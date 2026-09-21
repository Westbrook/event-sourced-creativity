import {LitElement, html, nothing, type PropertyValues} from 'lit';
import {keyed} from 'lit/directives/keyed.js';
import {decodedAudioPeaks, waveformPath, readWaveformBytes, MAX_WAVEFORM_SECONDS} from './audio-waveform.ts';

/** Playback stays native; the noninteractive waveform is derived locally from the same file. */
export class StillAudioPlayer extends LitElement {
  static properties = {src: {type: String}, label: {type: String}, scope: {type: String}, status: {state: true}, path: {state: true}};
  src = ''; label = 'Audio'; scope = '';
  private status: 'loading' | 'ready' | 'unavailable' = 'loading';
  private path = '';
  private work?: AbortController;
  private started = false;
  private revision = 0;
  createRenderRoot() { return this; }
  private retire() {
    this.revision++; this.work?.abort(); this.work = undefined; this.started = false; this.path = ''; this.status = 'loading';
    const audio = this.querySelector('audio');
    if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
  }
  protected willUpdate(changes: PropertyValues) {
    if (changes.has('src') || changes.has('scope')) this.retire();
  }
  disconnectedCallback() { this.retire(); super.disconnectedCallback(); }
  connectedCallback() { super.connectedCallback(); this.requestUpdate('scope'); }
  private loadWaveform = async (event: Event) => {
    const audio = event.currentTarget as HTMLAudioElement;
    if (this.started || !this.isConnected || !this.src.startsWith('/api/media/')) return;
    this.started = true;
    if (!Number.isFinite(audio.duration) || audio.duration <= 0 || audio.duration > MAX_WAVEFORM_SECONDS) { this.status = 'unavailable'; return; }
    const source = this.src, scope = this.scope, controller = new AbortController(); this.work = controller;
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
      this.path = waveformPath(peaks); this.status = 'ready';
    } catch { if (this.work === controller && this.src === source && this.scope === scope && this.isConnected) this.status = 'unavailable'; }
    finally { clearTimeout(timeout); }
  };
  render() {
    const source = this.src.startsWith('/api/media/') ? this.src : '';
    return html`<div class="audio-waveform" aria-busy=${Boolean(source) && this.status === 'loading'}>
      ${this.status === 'ready' ? html`<svg viewBox="0 0 600 180" preserveAspectRatio="none" role="img" aria-label=${`Waveform of ${this.label}`}><line x1="0" x2="600" y1="90" y2="90"></line><path d=${this.path}></path></svg>` : html`<span role="status">${this.status === 'unavailable' || !source ? 'Waveform unavailable.' : 'Loading waveform…'}</span>`}
    </div>${keyed(`${this.revision}:${this.scope}:${source}`, html`<audio controls preload="metadata" aria-label=${this.label} src=${source || nothing} @loadedmetadata=${this.loadWaveform} @error=${() => {this.status = 'unavailable';}}></audio>`)}`;
  }
}
customElements.define('still-audio-player', StillAudioPlayer);
