/** Persistent shared s/dot anchors and the accepted feathered still. reveal. */
let instance=0;
function mark() {
  const node = document.createElement('span');
  node.className = 'mark';
  node.setAttribute('aria-hidden', 'true');
  // Geometry follows the existing favicon. Separate elements are motion anchors.
  node.innerHTML = `<svg viewBox="0 0 64 64" focusable="false"><circle class="grain grain-a" cx="51" cy="44" r="5"/><circle class="grain grain-b" cx="51" cy="44" r="5"/><text class="letter" x="9" y="48" font-family="Georgia, 'Times New Roman', serif" font-size="64" font-weight="700">s</text><circle class="dot" cx="51" cy="44" r="5"/></svg>`;
  return node;
}

function loadingSurface(shell, row, state, getWidth) {
  const compact = mark();
  compact.classList.add('loading-compact-mark');
  const svg = compact.querySelector('svg');
  const namespace = 'http://www.w3.org/2000/svg';
  const element = (tag, attributes = {}) => {
    const node = document.createElementNS(namespace, tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    return node;
  };
  const boldLetter = compact.querySelector('.letter');
  boldLetter.setAttribute('class', 'toolbar-letter-bold');
  const letter = element('g', {class: 'letter'});
  const regularLetter = element('text', {class: 'toolbar-letter-regular', 'font-weight': 400});
  regularLetter.textContent = 's';
  letter.append(boldLetter, regularLetter);
  const circle = compact.querySelector('.dot');
  circle.setAttribute('class', 'toolbar-dot-circle');
  const wordmark = element('g', {class: 'toolbar-wordmark', 'aria-label': 'still.'});
  const middle = element('text', {class: 'toolbar-wordmark-middle'});
  middle.textContent = 'till';
  const middleGradient = element('linearGradient', {
    id: `${shell.id}-wordmark-reveal-gradient`, class: 'toolbar-wordmark-reveal-gradient',
    gradientUnits: 'userSpaceOnUse', x1: 0, y1: 0, x2: 1, y2: 0,
  });
  for (const [offset, opacity] of [['0%', 1], ['50%', .5], ['100%', 0]]) {
    middleGradient.append(element('stop', {offset, 'stop-color': '#fff', 'stop-opacity': opacity}));
  }
  const middleMask = element('mask', {
    id: `${shell.id}-wordmark-reveal`, class: 'toolbar-wordmark-mask',
    maskUnits: 'userSpaceOnUse', maskContentUnits: 'userSpaceOnUse',
    x: -100, y: -100, width: 300, height: 200, style: 'mask-type: alpha',
  });
  const middleMaskRect = element('rect', {x: -100, y: -100, width: 300, height: 200, fill: `url(#${middleGradient.id})`});
  middleMask.append(middleMaskRect);
  const definitions = element('defs');
  definitions.append(middleGradient, middleMask);
  middle.setAttribute('mask', `url(#${middleMask.id})`);
  middle.style.opacity = '0';
  const dot = element('g', {class: 'dot toolbar-wordmark-dot'});
  const period = element('text', {class: 'toolbar-dot-period'});
  period.textContent = '.';
  dot.append(circle, period);
  wordmark.append(letter, middle, dot);
  svg.append(definitions, wordmark);

  const waiting = document.createElement('span');
  waiting.className = 'toolbar-waiting-content';
  waiting.setAttribute('aria-hidden', 'true');
  // Match Still's actual wordmark, including the separate flex-item period.
  // The invisible text is a geometry probe; the persistent SVG paints the mark.
  waiting.innerHTML = '<span class="toolbar-wordmark-probe"><span class="toolbar-wordmark-probe-text">still<i class="toolbar-wordmark-baseline"></i></span><span class="toolbar-wordmark-probe-dot">.</span></span><span class="toolbar-waiting-copy">waiting…</span>';
  const probe = waiting.querySelector('.toolbar-wordmark-probe');
  const probeText = waiting.querySelector('.toolbar-wordmark-probe-text');
  const accessible = document.createElement('span');
  accessible.className = 'toolbar-sr-only';
  accessible.setAttribute('role', 'status');
  accessible.setAttribute('aria-live', 'polite');
  const field = document.createElement('span');
  field.className = 'toolbar-infusion-field';
  field.setAttribute('aria-hidden', 'true');
  shell.prepend(field);
  row.append(compact, waiting, accessible);
  shell.dataset.loadingSurface = 'true';
  let progress = state === 'waiting' ? 1 : 0;
  let metrics;
  const ratio = 34 / 64;
  const interpolate = (from, to) => from + (to - from) * progress;
  const canvas = document.createElement('canvas').getContext('2d');

  function measure(fontSize) {
    if (!shell.isConnected) return;
    if (metrics?.fontSize === fontSize) return metrics;
    shell.style.setProperty('--waiting-wordmark-size', `${fontSize}px`);
    const content = waiting.getBoundingClientRect();
    const text = probeText.getBoundingClientRect();
    const periodBox = waiting.querySelector('.toolbar-wordmark-probe-dot').getBoundingClientRect();
    const baseline = waiting.querySelector('.toolbar-wordmark-baseline').getBoundingClientRect().top;
    const range = document.createRange();
    range.setStart(probeText.firstChild, 1);
    range.setEnd(probeText.firstChild, 4);
    const middleBox = range.getBoundingClientRect();
    const style = getComputedStyle(probe);
    canvas.font = `${style.fontWeight} ${fontSize}px ${style.fontFamily}`;
    const periodInk = canvas.measureText('.');
    const periodCenterX = (periodInk.actualBoundingBoxRight - periodInk.actualBoundingBoxLeft) / 2;
    const periodCenterY = (periodInk.actualBoundingBoxDescent - periodInk.actualBoundingBoxAscent) / 2;
    canvas.font = `700 64px ${style.fontFamily}`;
    const compactAdvance = canvas.measureText('s').width;
    const originX = content.left + content.width / 2;
    const originY = content.top + content.height / 2;
    metrics = {
      fontSize, contentWidth: content.width,
      letterX: 32 + (text.left - originX) / ratio,
      baseline: 32 + (baseline - originY) / ratio,
      middleX: 32 + (middleBox.left - originX) / ratio,
      middleWidth: middleBox.width / ratio,
      compactMiddleX: 9 + compactAdvance,
      dotX: 32 + (periodBox.left + periodCenterX - originX) / ratio,
      dotY: 32 + (baseline + periodCenterY - originY) / ratio,
      periodCenterX: periodCenterX / ratio,
      periodCenterY: periodCenterY / ratio,
      periodHeight: (periodInk.actualBoundingBoxAscent + periodInk.actualBoundingBoxDescent) / ratio,
    };
    return metrics;
  }

  shell.setWaitingProgress = value => {
    progress = Math.max(0, Math.min(1, Number(value) || 0));
    const side = getWidth() <= 600 ? 54 : 58;
    const fontSize = getWidth() <= 720 ? 30 : 35;
    shell.style.setProperty('--waiting-wordmark-size', `${fontSize}px`);
    const measured = measure(fontSize);
    const expanded = Math.max(side, (measured?.contentWidth || 145) + 32);
    shell.style.width = `${side + (expanded - side) * progress}px`;
    shell.style.height = `${side}px`;
    shell.style.borderRadius = `${side / 2}px`;
    shell.style.setProperty('--waiting-progress', String(progress));
    shell.dataset.waitingProgress = String(progress);
    shell.dataset.wordmarkFontSize = String(fontSize);
    if (measured) {
      const font = interpolate(64, fontSize / ratio);
      const baseline = interpolate(48, measured.baseline);
      const middleX = interpolate(measured.compactMiddleX, measured.middleX);
      for (const face of [boldLetter, regularLetter]) {
        face.setAttribute('x', interpolate(9, measured.letterX));
        face.setAttribute('y', baseline);
        face.setAttribute('font-size', font);
      }
      boldLetter.style.opacity = String(1 - progress);
      // Keep the shared stem opaque while the icon's heavier face thins out.
      regularLetter.style.opacity = String(Math.min(1, progress * 4));
      letter.dataset.x = String(interpolate(9, measured.letterX));
      letter.dataset.y = String(baseline);
      middle.setAttribute('x', middleX);
      middle.setAttribute('y', baseline);
      middle.setAttribute('font-size', font);
      // Keep the moving reveal translucent at its front, with a 10px alpha
      // feather. Its extra travel makes both endpoints clean in either direction.
      const feather = 10 / ratio;
      const revealWidth = measured.middleWidth + 4 / ratio;
      const front = middleX - feather / 2 + (revealWidth + feather) * progress;
      middleGradient.setAttribute('x1', front - feather / 2);
      middleGradient.setAttribute('x2', front + feather / 2);
      for (const target of [middleMask, middleMaskRect]) {
        target.setAttribute('x', middleX - feather);
        target.setAttribute('width', revealWidth + feather * 2);
      }
      middle.style.opacity = progress === 0 ? '0' : '1';
      middle.style.mask = progress === 1 ? 'none' : `url(#${middleMask.id})`;
      const dotX = interpolate(51, measured.dotX);
      const dotY = interpolate(44, measured.dotY);
      const periodScale = interpolate(10 / measured.periodHeight, 1);
      circle.setAttribute('cx', dotX);
      circle.setAttribute('cy', dotY);
      circle.setAttribute('r', interpolate(5, measured.periodHeight / 2));
      circle.style.opacity = String(1 - progress);
      period.setAttribute('x', dotX - measured.periodCenterX * periodScale);
      period.setAttribute('y', dotY - measured.periodCenterY * periodScale);
      period.setAttribute('font-size', fontSize / ratio * periodScale);
      period.style.opacity = String(Math.min(1, progress * 4));
      dot.dataset.centerX = String(dotX);
      dot.dataset.centerY = String(dotY);
    }
    const copy = progress === 1 ? 'Still. Waiting for your next actions' : 'Finding your next actions';
    if (accessible.textContent !== copy) accessible.textContent = copy;
    return shell;
  };

  // Position follows background-position: 100 is the left/start edge, 0 right.
  // The request conductor can move one uninterrupted field through both widths.
  shell.setInfusionPhase = phase => {
    if (phase == null) {
      delete shell.dataset.infusionManaged;
      field.style.removeProperty('background-position');
      field.style.removeProperty('opacity');
      return shell;
    }
    shell.dataset.infusionManaged = 'true';
    const position = Math.max(0, Math.min(100, Number(phase.position) || 0));
    const opacity = Math.max(0, Math.min(1, Number(phase.opacity) || 0));
    field.style.backgroundPosition = `${position}% 50%`;
    field.style.opacity = String(opacity);
    return shell;
  };
  shell.refreshWaitingSurface = () => { metrics = null; return shell.setWaitingProgress(progress); };
  shell.setWaitingProgress(progress);
}


export function createLoadingSurface(getWidth) {
 const shell=document.createElement('div');shell.className='spec-toolbar';shell.id='still-motion-loading-'+(++instance);
 Object.assign(shell.dataset,{state:'loading',empty:'cushion',loading:'current'});
 const row=document.createElement('div');row.className='toolbar-row';shell.append(row);
 loadingSurface(shell,row,'loading',getWidth);return shell;
}
