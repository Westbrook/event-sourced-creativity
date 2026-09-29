/** Selected Thread motion, adopted from the isolated Still study. Visual layers
 * contain inert snapshots only; the coordinator retains real Lit/En controls. */
import {THREAD_TIMING} from './timing.js';
const active = new WeakMap();
const EASE = 'cubic-bezier(.22,.74,.2,1)';
const SOFT = 'cubic-bezier(.35,0,.3,1)';
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));
const row = node => node.querySelector('.toolbar-row') || node;
const actions = node => [...row(node).querySelectorAll(':scope > [data-action]')];
const control = entry => entry.shadowRoot?.querySelector('[part~="control"]') || entry;
const labels = entry => [...(entry.shadowRoot?.querySelectorAll('[part~="label"], .en-button__suffix, .en-button__prefix') || [])]
  .flatMap(node => node.localName === 'slot' ? node.assignedElements({ flatten: true }) : [node]);
const isPrimary = entry => entry?.getAttribute('variant') === 'primary';
const mix = (token, amount) => `color-mix(in srgb, var(${token}) ${amount}%, transparent)`;

// Give longer travel a little more time. Use the wider rendered endpoint so
// opening/closing and More/Back have the same pace, including after overflow.
export function threadWidthScale(fromWidth, toWidth) {
  const progress = clamp((Math.max(fromWidth, toWidth) - 640) / 320, 0, 1);
  return 1 + .2 * progress * progress * (3 - 2 * progress);
}

// Give the wash its own window. Hold departures only when a longer sweep needs
// it; construction keeps its pace, and arriving surfaces let the wash finish.
export function threadTimeline(base, { arrival = 1, departure = 0, opening = false, returnToLoading = false } = {}) {
  if (returnToLoading) {
    // Match the accepted loading loop’s right/left sweep ratio, independent of
    // its edge hold and rest. Preserve construction pace and scale with playback.
    const open = threadTimeline(base, { arrival: .69, opening: true });
    const returnSweep = (open.duration - .69 * base) * THREAD_TIMING.closingSweepRatio;
    const delay = Math.max(0, returnSweep - .56 * base);
    return { base, delay, openingExtra: 0, sweepScale: 1, returnSweep, duration: base + delay };
  }
  const sweepScale = opening ? 1.5 : 2;
  const openingExtra = opening ? THREAD_TIMING.openingSweepExtension * base / THREAD_TIMING.duration : 0;
  const delay = departure * base * (sweepScale - 1);
  const arrivalSpan = (1 - arrival) * base + openingExtra;
  return { base, delay, openingExtra, sweepScale, duration: delay + base + openingExtra + arrivalSpan * (sweepScale - 1) };
}

function constructionFrames(keyframes, timing) {
  if (timing.duration === timing.base && !timing.delay) return keyframes;
  return framesBetween(timing.delay / timing.duration, (timing.delay + timing.base) / timing.duration,
    keyframes.map((frame, index) => ({ ...frame, offset: frame.offset ?? index / (keyframes.length - 1) })));
}

function preserve(node, names = ['style']) {
  const values = names.map(name => [name, node.getAttribute(name)]);
  return () => values.forEach(([name, value]) => value === null ? node.removeAttribute(name) : node.setAttribute(name, value));
}

function dimensions(node) {
  const rect = node.getBoundingClientRect();
  return { width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
}

function layer(node, size, bottom) {
  Object.assign(node.style, {
    position: 'absolute', left: '50%', bottom: `${-bottom}px`, margin: '0',
    width: `${size.width}px`, minWidth: `${size.width}px`, maxWidth: 'none',
    height: `${size.height}px`, boxSizing: 'border-box', transform: 'translateX(-50%)',
    visibility: 'visible', background: 'transparent', borderColor: 'transparent',
    boxShadow: 'none', pointerEvents: 'none', overflow: 'visible', zIndex: '2',
  });
  node.setAttribute('inert', '');
  node.dataset.running = 'false';
}

function selected(entries, trigger) {
  return entries.find(entry => entry.dataset.action === trigger)
    || (['action', 'primary', 'next-best'].includes(trigger) && entries.find(isPrimary))
    || (trigger === 'action' && entries.find(entry => !['more', 'back', 'find'].includes(entry.dataset.action)))
    || entries.find(entry => entry.hasAttribute('data-overflow-trigger'));
}

function decorate(parent, styles, debris, kind = 'material') {
  const node = document.createElement('span');
  node.className = `construction-${kind}`;
  node.setAttribute('aria-hidden', 'true');
  Object.assign(node.style, { position: 'absolute', pointerEvents: 'none', boxSizing: 'border-box', ...styles });
  parent.append(node);
  debris.push(node);
  return node;
}

function capsuleGeometry(entry, save) {
  const c = control(entry);
  save(entry); save(c);
  // Direct toolbar clicks can still be releasing the component's native press
  // scale/translate. Measure its unpressed box, then own these longhands until
  // the actual component styles are restored at cleanup.
  Object.assign(c.style, { transition: 'none', scale: 'none', translate: 'none' });
  const host = entry.getBoundingClientRect(), inner = c.getBoundingClientRect();
  const width = inner.width, height = inner.height;
  entry.style.setProperty('--still-motion-capsule-radius', `${height / 2}px`);
  Object.assign(entry.style, {
    position: 'relative', width: `${host.width}px`, minWidth: `${host.width}px`,
    maxWidth: `${host.width}px`, height: `${host.height}px`, flex: `0 0 ${host.width}px`,
  });
  const shift = width / 2;
  Object.assign(c.style, {
    position: 'absolute', left: `${inner.left - host.left + shift}px`, top: `${inner.top - host.top}px`,
    width: `${width}px`, height: `${height}px`, minWidth: '0', minHeight: '0',
    minInlineSize: '0', minBlockSize: '0', maxWidth: 'none', boxSizing: 'border-box',
    padding: '0', margin: '0', overflow: 'hidden', whiteSpace: 'nowrap',
    borderRadius: `${height / 2}px`, transform: 'translateX(-50%)',
    willChange: 'width, opacity',
  });
  labels(entry).forEach(label => {
    save(label);
    Object.assign(label.style, { flex: '0 0 auto', minWidth: 'max-content', whiteSpace: 'nowrap' });
  });
  // Never make a tall narrow capsule. The smallest visible shape is a circle.
  return { width, height, minimum: Math.min(width, height) };
}

function texture(style) {
  return Object.fromEntries(['backgroundImage', 'backgroundSize', 'backgroundPosition', 'backgroundRepeat', 'backgroundOrigin', 'backgroundClip'].map(name => [name, style[name]]));
}

function shellTexture(shell, source, destination, play, debris) {
  if (JSON.stringify(source) === JSON.stringify(destination)) {
    Object.assign(shell.style, source);
    return;
  }
  shell.style.backgroundImage = 'none';
  [source, destination].forEach((paint, index) => {
    if (paint.backgroundImage === 'none') return;
    const material = decorate(shell, { inset: '0', borderRadius: 'inherit', zIndex: '0', ...paint }, debris, 'shell-texture');
    play(material, [{ opacity: index ? 0 : 1, offset: 0, easing: SOFT }, { opacity: index ? 1 : 0, offset: 1 }]);
  });
}

// Every animation uses a shared duration and explicit stops, so pause/step/scrub
// can set the same currentTime on every returned WAAPI handle without bookkeeping.
function framesBetween(start, finish, frames) {
  const mapped = frames.map(frame => ({ ...frame, offset: start + frame.offset * (finish - start) }));
  // WAAPI inserts an underlying-value keyframe when 0 or 1 is omitted. Hold the
  // actual first/last material state instead, so a staggered destination never
  // flashes at full opacity before its construction window begins.
  return [
    ...(start > 0 ? [{ ...mapped[0], offset: 0 }] : []),
    ...mapped,
    ...(finish < 1 ? [{ ...mapped.at(-1), offset: 1 }] : []),
  ];
}

function animateLabels(entry, play, start, finish, incoming, direction = 1) {
  labels(entry).forEach(label => play(label, framesBetween(start, finish, incoming ? [
    { opacity: 0, transform: `translateY(${direction * 2}px)`, offset: 0, easing: EASE },
    { opacity: 1, transform: 'translateY(0)', offset: 1 },
  ] : [
    { opacity: 1, transform: 'translateY(0)', offset: 0, easing: SOFT },
    { opacity: 0, transform: `translateY(${-direction * 2}px)`, offset: 1 },
  ])));
}

function centerOffset(entry, toolbar) {
  const a = control(entry).getBoundingClientRect(), b = toolbar.getBoundingClientRect();
  return b.left + b.width / 2 - (a.left + a.width / 2);
}

function buttonInfusion(entry, ctx, start, finish, departing = false) {
  const { play, save, debris } = ctx;
  const sweepPlay = ctx.playFull || play;
  const timing = ctx.timing;
  const swipeLeft = departing;
  const sweepStartMs = (departing ? 0 : timing.delay) + start * timing.base;
  const sweepSpan = departing && timing.returnSweep !== undefined ? timing.returnSweep : ((finish - start) * timing.base + (departing ? 0 : timing.openingExtra)) * timing.sweepScale;
  const sweepStart = sweepStartMs / timing.duration;
  const sweepFinish = Math.min(1, (sweepStartMs + sweepSpan) / timing.duration);
  const c = control(entry), primary = isPrimary(entry);
  save(c);
  c.style.isolation = 'isolate';
  // Label and suffix are actual rendered elements, not display:contents slots.
  labels(entry).forEach(label => {
    save(label);
    Object.assign(label.style, { position: 'relative', zIndex: '1' });
  });
  const tint = primary ? mix('--en-color-on-action', 22) : mix('--en-color-brand', 28);
  const wash = decorate(c, {
    inset: '-1px', borderRadius: 'inherit', zIndex: '0', filter: 'blur(1.5px)',
    backgroundImage: `linear-gradient(105deg, transparent 22%, ${tint} 44%, ${tint} 56%, transparent 78%)`,
    backgroundSize: '220% 100%', backgroundPosition: swipeLeft ? '0% 50%' : '100% 50%', backgroundRepeat: 'no-repeat',
  }, debris, 'button-infusion');
  wash.dataset.action = entry.dataset.action;
  // Every departure mirrors the travel and tint midpoint of Infusion. Paging
  // keeps its existing sweep window while sharing the Loading return direction.
  sweepPlay(wash, framesBetween(sweepStart, sweepFinish, [
    { backgroundPosition: swipeLeft ? '0% 50%' : '100% 50%', offset: 0, easing: swipeLeft ? 'ease-in' : 'ease-out' },
    { backgroundPosition: swipeLeft ? '100% 50%' : '0% 50%', offset: 1 },
  ]));
  sweepPlay(wash, framesBetween(sweepStart, sweepFinish, [
    { opacity: 0, offset: 0, easing: SOFT },
    { opacity: primary ? .92 : .78, offset: swipeLeft ? .6575 : .3425, easing: SOFT },
    { opacity: 0, offset: 1 },
  ]));
}

function centerIncoming(entry, ctx) {
  const { play, opening, save, to } = ctx;
  const primary = isPrimary(entry), c = control(entry);
  const { width, minimum } = capsuleGeometry(entry, save);
  const origin = centerOffset(entry, to);
  const radius = Math.abs(origin) / Math.max(1, to.getBoundingClientRect().width / 2);
  const launch = (opening ? .3 : .48) + radius * .015;
  const landed = opening ? .79 : .85;
  const begin = opening ? .18 : .41;
  entry.style.zIndex = primary ? '3' : '2';
  const overshoot = -Math.sign(origin) * (primary ? 1.5 : .6);
  // All initial control centers coincide, independent of uneven button widths.
  // The surfaces separate before the labels start to appear.
  play(entry, [
    { transform: `translateX(${origin}px)`, offset: 0 },
    { transform: `translateX(${origin}px)`, offset: launch, easing: EASE },
    { transform: `translateX(${overshoot}px)`, offset: landed - .05, easing: SOFT },
    { transform: 'translateX(0)', offset: landed + .02 },
    { transform: 'translateX(0)', offset: 1 },
  ]);
  play(c, [
    { opacity: 0, width: `${minimum}px`, offset: 0 },
    { opacity: 0, width: `${minimum}px`, offset: begin, easing: SOFT },
    { opacity: 1, width: `${minimum}px`, offset: begin + .065 },
    { opacity: 1, width: `${minimum}px`, offset: launch, easing: EASE },
    { opacity: 1, width: `${width * (primary ? 1.035 : 1.012)}px`, offset: landed - .025, easing: SOFT },
    { opacity: 1, width: `${width}px`, offset: landed + .075 },
    { opacity: 1, width: `${width}px`, offset: 1 },
  ]);
  animateLabels(entry, play, landed - .025, Math.min(1, landed + .18), true);
  // Preserve the start near full expansion; loading arrivals give the shine
  // its additional time after the original construction has settled.
  buttonInfusion(entry, ctx, landed - .10, 1);
}

function centerOutgoing(entry, ctx) {
  const { play, closing, chosen, save, from } = ctx;
  const primary = isPrimary(entry) && chosen === entry, c = control(entry);
  const { width, minimum } = capsuleGeometry(entry, save);
  const origin = centerOffset(entry, from);
  const gather = closing ? .48 : .41;
  const disappear = closing ? (primary ? .61 : .56) : .435;
  const leave = closing ? .17 : .14;
  const labelEnd = closing ? (primary ? .165 : .145) : .125;
  entry.style.zIndex = primary ? '3' : '2';
  animateLabels(entry, play, .015, labelEnd, false);
  play(entry, [
    { transform: 'translateX(0)', offset: 0 },
    { transform: 'translateX(0)', offset: leave, easing: SOFT },
    { transform: `translateX(${origin}px)`, offset: gather, easing: SOFT },
    { transform: `translateX(${origin}px)`, offset: 1 },
  ]);
  play(c, [
    { opacity: 1, width: `${width}px`, offset: 0, easing: SOFT },
    { opacity: 1, width: `${width * (primary ? 1.035 : 1)}px`, offset: .07, easing: SOFT },
    { opacity: 1, width: `${minimum}px`, offset: gather - .055 },
    { opacity: 1, width: `${minimum}px`, offset: gather },
    { opacity: 0, width: `${minimum}px`, offset: disappear },
    { opacity: 0, width: `${minimum}px`, offset: 1 },
  ]);
  buttonInfusion(entry, ctx, 0, disappear, true);
}

function compact(node, play, incomingMark, direction) {
  const mark = node.querySelector('.mark');
  if (!mark) return;
  const dot = mark.querySelector('.dot'), letter = mark.querySelector('.letter');
  if (incomingMark) {
    play(letter || mark, [
      { opacity: 0, offset: 0 }, { opacity: 0, offset: .57, easing: EASE },
      { opacity: 1, offset: .9 }, { opacity: 1, offset: 1 },
    ]);
    if (dot) play(dot, [
      { opacity: 0, transform: `translateX(${-direction * 6}px) scale(.35)`, offset: 0 },
      { opacity: 0, transform: `translateX(${-direction * 6}px) scale(.35)`, offset: .55, easing: EASE },
      { opacity: 1, transform: 'translateX(0) scale(1.2)', offset: .83, easing: SOFT },
      { opacity: 1, transform: 'translateX(0) scale(1)', offset: 1 },
    ]);
  } else {
    play(letter || mark, [{ opacity: 1, offset: 0, easing: SOFT }, { opacity: 0, offset: .26 }, { opacity: 0, offset: 1 }]);
    if (dot) play(dot, [
      { opacity: 1, transform: 'translateX(0) scale(1)', offset: 0, easing: SOFT },
      { opacity: 1, transform: `translateX(${direction * 2}px) scale(1.25)`, offset: .13 },
      { opacity: 0, transform: `translateX(${direction * 5}px) scale(.35)`, offset: .32 },
      { opacity: 0, offset: 1 },
    ]);
  }

}

export async function constructionTransition({ host, from, to, duration, reduced = false, trigger = 'action', signal, onTimeline, onInteractive } = {}) {
  if (!host || !to) throw new TypeError('A transition needs a host and destination toolbar.');
  const prior = active.get(host);
  if (prior) {
    prior.cancel(); await prior.done;
    if (!from?.isConnected) from = [...host.querySelectorAll('.spec-toolbar')].find(node => node !== to);
  }
  if (!from || from === to) {
    if (to.parentNode !== host) host.append(to);
    return { cancelled: Boolean(signal?.aborted) };
  }
  const fromState = from.dataset.state, toState = to.dataset.state;
  const baseMilliseconds = reduced ? Math.min(120, Number(duration) || 120) : clamp(Number(duration) || THREAD_TIMING.duration, 100, 8000);
  let timing = { base: baseMilliseconds, delay: 0, openingExtra: 0, sweepScale: 1, duration: baseMilliseconds };
  let milliseconds = baseMilliseconds;
  const animations = [], restorers = [], debris = [], saved = new WeakSet();
  let cancelled = Boolean(signal?.aborted), stage, resolveDone, phaseFrame, interactive = false;
  let interactiveAt = milliseconds;
  const done = new Promise(resolve => { resolveDone = resolve; });
  const operation = { done, cancel() { cancelled = true; setInteractive(false); animations.forEach(animation => animation.cancel()); } };
  active.set(host, operation);
  const abort = () => operation.cancel();
  signal?.addEventListener('abort', abort, { once: true });
  const restoreFrom = preserve(from, ['style', 'inert', 'data-running']);
  const restoreTo = preserve(to, ['style', 'inert', 'data-running']);
  const restoreHost = preserve(host, ['aria-busy']);
  const setInteractive = enabled => {
    if (enabled === interactive || enabled && cancelled) return;
    interactive = enabled;
    to.setAttribute('inert', '');
    to.style.pointerEvents = 'none';
    host.setAttribute('aria-busy', enabled ? 'false' : 'true');
    onInteractive?.({ from, to, interactive: enabled, at: interactiveAt, duration: milliseconds });
  };
  const visibility = () => animations.forEach(animation => {
    if (document.hidden && animation.playState === 'running') animation.pause();
    else if (!document.hidden && animation.playState === 'paused' && !cancelled) animation.play();
  });
  document.addEventListener('visibilitychange', visibility);
  const save = node => { if (!saved.has(node)) { saved.add(node); restorers.push(preserve(node)); } };
  const playFull = (node, keyframes) => {
    if (!node || cancelled || typeof node.animate !== 'function') return;
    const animation = node.animate(keyframes, { duration: milliseconds, easing: 'linear', fill: 'both' });
    animations.push(animation);
    if(document.hidden)animation.pause();
    return animation;
  };
  // Keep construction landmarks at their original milliseconds while giving
  // every handle one shared timeline for inspection, seeking and cancellation.
  const play = (node, keyframes) => playFull(node, constructionFrames(keyframes, timing));
  to.style.visibility = 'hidden';
  from.setAttribute('inert', '');
  to.setAttribute('inert', '');
  host.setAttribute('aria-busy', 'true');
  host.dataset.motionPhase = 'reserve';
  host.dataset.motionFamily = 'thread';
  try {
    await Promise.all([from.ready, to.ready].filter(Boolean));
    if (cancelled) return { cancelled: true, from: fromState, to: toState };
    const fromSize = dimensions(from), toSize = dimensions(to);
    const oldStyle = getComputedStyle(from), newStyle = getComputedStyle(to);
    const surface = { backgroundColor: newStyle.backgroundColor, borderColor: newStyle.borderColor, boxShadow: newStyle.boxShadow };
    const sourceSurface = { backgroundColor: oldStyle.backgroundColor, borderColor: oldStyle.borderColor, boxShadow: oldStyle.boxShadow };
    // Computed styles are live. Snapshot the Cushion paint before layer()
    // clears each real toolbar's background in favor of the single owning shell.
    const sourceTexture = texture(oldStyle), destinationTexture = texture(newStyle);
    const fromActions = actions(from), toActions = actions(to);
    const opening = !fromActions.length && toActions.length > 0, closing = fromActions.length > 0 && !toActions.length;
    const direction = trigger === 'back' || fromState === 'page2' && toState !== 'page2' ? -1 : 1;
    const chosen = selected(fromActions, trigger);
    const paging = fromActions.length > 0 && toActions.length > 0;

    if (!reduced) {
      const widthScale = threadWidthScale(fromSize.width, toSize.width);
      timing = threadTimeline(baseMilliseconds * widthScale, {
        arrival: toActions.length ? (opening ? .69 : .75) : 1,
        departure: !fromActions.length ? 0 : closing ? (isPrimary(chosen) ? .61 : .56) : .435,
        opening: opening && ['loading', 'waiting'].includes(fromState),
        returnToLoading: closing && toState === 'loading',
      });
      milliseconds = timing.duration;
    }
    interactiveAt = !reduced && toActions.length
      ? timing.delay + timing.base * (opening ? .97 : 1)
      : milliseconds;

    stage = document.createElement('div');
    stage.className = 'toolbar-motion-stage family-thread construction-stage';
    stage.dataset.threadMode = 'center';
    Object.assign(stage.style, { position: 'relative', width: `${Math.max(fromSize.width, toSize.width)}px`, height: `${Math.max(fromSize.height, toSize.height)}px`, flex: '0 0 auto', maxWidth: '100%', marginInline: 'auto', isolation: 'isolate', pointerEvents: 'none' });
    const shell = document.createElement('div');
    shell.className = 'toolbar-motion-shell';
    Object.assign(shell.style, { position: 'absolute', left: '50%', bottom: '0', transform: 'translateX(-50%)', width: `${fromSize.width}px`, height: `${fromSize.height}px`, boxSizing: 'border-box', borderStyle: oldStyle.borderStyle, borderWidth: oldStyle.borderWidth, borderRadius: oldStyle.borderRadius, ...sourceSurface, ...sourceTexture, overflow: 'hidden', isolation: 'isolate' });
    stage.append(shell); host.append(stage);
    const borderBottom = parseFloat(oldStyle.borderBottomWidth) || 0;
    layer(from, fromSize, borderBottom); layer(to, toSize, borderBottom);
    shell.append(from, to);
    save(row(from)); save(row(to));
    Object.assign(row(from).style, { position: 'relative', zIndex: '1' });
    Object.assign(row(to).style, { position: 'relative', zIndex: '1', opacity: '0' });
    await nextFrame();
    if (cancelled) return { cancelled: true, from: fromState, to: toState };
    row(to).style.opacity = '1';
    if (reduced) {
      Object.assign(shell.style, { width: `${toSize.width}px`, height: `${toSize.height}px`, ...surface, ...destinationTexture });
      play(row(from), [{ opacity: 1 }, { opacity: 0 }]);
      play(row(to), [{ opacity: 0 }, { opacity: 1 }]);
    } else {
      shellTexture(shell, sourceTexture, destinationTexture, play, debris);
      // Paging shares the buttons' gathered center. The shell reaches its
      // compact circle as the left sweep ends, then opens with the new row.
      const compactSize = Math.max(fromSize.height, toSize.height);
      play(shell, paging ? [
        { width: `${fromSize.width}px`, height: `${fromSize.height}px`, ...sourceSurface, offset: 0 },
        { width: `${fromSize.width}px`, height: `${fromSize.height}px`, ...sourceSurface, offset: .14, easing: SOFT },
        { width: `${compactSize}px`, height: `${compactSize}px`, ...sourceSurface, offset: .435 },
        { width: `${compactSize}px`, height: `${compactSize}px`, ...surface, offset: .48, easing: EASE },
        { width: `${toSize.width}px`, height: `${toSize.height}px`, ...surface, offset: .80 },
        { width: `${toSize.width}px`, height: `${toSize.height}px`, ...surface, offset: 1 },
      ] : [
        { width: `${fromSize.width}px`, height: `${fromSize.height}px`, ...sourceSurface, offset: 0, easing: opening ? EASE : SOFT },
        ...(closing ? [{ width: `${fromSize.width}px`, height: `${fromSize.height}px`, ...sourceSurface, offset: .5, easing: EASE }] : []),
        { width: `${toSize.width}px`, height: `${toSize.height}px`, ...surface, offset: closing ? 1 : opening ? .42 : .55 },
        ...(!closing ? [{ width: `${toSize.width}px`, height: `${toSize.height}px`, ...surface, offset: 1 }] : []),
      ]);
      const ctx = { play, playFull, timing, opening, closing, chosen, debris, from, to, save };
        fromActions.forEach(entry => centerOutgoing(entry, ctx));
        toActions.forEach(entry => centerIncoming(entry, ctx));
        compact(from, play, false, direction); compact(to, play, true, direction);
        // Retire status copy and the inserted wordmark letters before
        // constructing actions. Loading also contains the hidden waiting copy;
        // preserve its actual opacity so it cannot flash during an opening.
        from.querySelectorAll('.toolbar-status-copy, .toolbar-waiting-content, .toolbar-wordmark-middle').forEach(node => play(node, [{ opacity: getComputedStyle(node).opacity, offset: 0 }, { opacity: 0, offset: .3 }, { opacity: 0, offset: 1 }]));
        to.querySelectorAll('.toolbar-status-copy').forEach(node => play(node, [{ opacity: 0, offset: 0 }, { opacity: 0, offset: .6 }, { opacity: 1, offset: 1 }]));

    }
    const phases = () => {
      const currentTime = Number(animations[0]?.currentTime || 0);
      const progress = currentTime / milliseconds;
      host.dataset.motionPhase = progress < .2 ? 'release' : progress < .5 ? 'construct' : progress < .84 ? 'resolve' : 'settle';
      setInteractive(!cancelled && animations.length > 0
        && animations.every(animation => ['running', 'finished'].includes(animation.playState))
        && currentTime >= interactiveAt);
      phaseFrame = requestAnimationFrame(phases);
    };
    onTimeline?.(animations, milliseconds);
    phases();
    await Promise.all(animations.map(animation => animation.finished.catch(() => undefined)));
    if (!cancelled && !animations.some(animation => animation.playState === 'paused')) setInteractive(true);
    return { cancelled, from: fromState, to: toState, duration: milliseconds };
  } finally {
    cancelAnimationFrame(phaseFrame);
    animations.forEach(animation => animation.cancel());
    debris.forEach(node => node.remove());
    restorers.reverse().forEach(restore => restore());
    restoreFrom(); restoreTo(); restoreHost();
    if (stage?.parentNode === host) stage.replaceWith(to);
    else if (to.parentNode !== host) host.append(to);
    from.remove(); stage?.remove();
    host.dataset.motionPhase = 'settled';
    signal?.removeEventListener('abort', abort);
    document.removeEventListener('visibilitychange', visibility);
    if (active.get(host) === operation) active.delete(host);
    resolveDone();
  }
}

