"""Single native-key Image text200 regression, launched by the adjacent Node runner."""
import importlib.util
import json
import os
import sys
import time
from pathlib import Path

sys.dont_write_bytecode = True

spec = importlib.util.spec_from_file_location('firefox_text_zoom', Path(__file__).with_name('firefox-text-zoom.py'))
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)

FRAME = r'''
const done=arguments[arguments.length-1],limit=arguments[0];
let finished=false,frameId,timer;
function snapshot(reason){
  if(finished)return;finished=true;cancelAnimationFrame(frameId);clearTimeout(timer);
  const e=document.activeElement,r=e.getBoundingClientRect();
  const hit=document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2);
  const lines=[],walk=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);
  let text;while(text=walk.nextNode()){
    if(!text.textContent.trim())continue;
    const range=document.createRange();range.selectNodeContents(text);
    for(const box of range.getClientRects())lines.push({text:text.textContent,
      rect:{x:box.x,y:box.y,width:box.width,height:box.height,right:box.right,bottom:box.bottom},
      fullyInViewport:box.left>=0&&box.top>=0&&box.right<=innerWidth&&box.bottom<=innerHeight});
  }
  done({reason,performanceMs:performance.now(),wallMs:Date.now(),
    active:{tag:e.tagName,id:e.id,text:(e.getAttribute('aria-label')||e.textContent||'').trim()},
    rect:{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom},
    scroll:{x:scrollX,y:scrollY},viewport:{width:innerWidth,height:innerHeight},
    centerOwned:!!hit&&(hit===e||e.contains(hit)||hit.contains(e)),
    controlInsideViewport:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,
    textLineBoxes:lines});
}
frameId=requestAnimationFrame(()=>snapshot('requestAnimationFrame'));
timer=setTimeout(()=>snapshot('completion-fallback'),limit);
'''


def append(path, value):
    with path.open('a') as stream:
        stream.write(json.dumps(value)+'\n')
        stream.flush()
        os.fsync(stream.fileno())


def counts(p):
    value = p.observe('return {mode:document.querySelector("#fixture-mode-reads")?.textContent,catalog:document.querySelector("#fixture-reads")?.textContent,forbidden:document.querySelector("#fixture-blocked")?.textContent};')
    p.receipt.setdefault('fixtureCounters', []).append(value)
    expected = {'mode':'1 ordinary entry-mode reads','catalog':'1 catalog reads','forbidden':'0 forbidden requests'}
    if value != expected:
        raise AssertionError('Unexpected fixture counters: '+json.dumps(value))
    return value


def to_button(p, label, stage=None):
    return p.tab_until(lambda a:a['product'] and a['tag']=='BUTTON' and a['text']==label,
                       stage or 'native-tab-'+label, max_steps=40)


def hold_focus(p, label):
    immediate, native = p.active(), p.native()
    if immediate['tag'] != 'BUTTON' or immediate['text'] != label:
        raise AssertionError('Wrong focused control at hold start')
    target = {'label':label,'immediate':immediate,'nativeBefore':native,'frames':[],
              'sampling':'After native Tab and unchanged bounded layout settle; protocol/fsync round trips may skip display frames. No product actions occur during the two-second hold.'}
    p.receipt.setdefault('focusHolds', []).append(target)
    path = p.out/(label.replace(':', '-')+'-frames.jsonl')
    append(path, {'kind':'immediate','value':immediate,'native':native})
    started = time.monotonic()
    while time.monotonic()-started < 2:
        remaining = 2.8-(time.monotonic()-started)
        if remaining <= 0:
            raise TimeoutError('Animation-frame observation exceeded 2.8 seconds')
        frame = p.marionette.value('WebDriver:ExecuteAsyncScript', {'script':FRAME,
            'args':[max(1, int(remaining*1000))], 'newSandbox':True, 'sandbox':'system',
            'filename':'native-text200-image-focus', 'line':1})
        frame['elapsedSeconds'] = time.monotonic()-started
        target['frames'].append(frame)
        append(path, {'kind':'frame','value':frame})
        if frame['active']['tag'] != 'BUTTON' or frame['active']['text'] != label:
            raise AssertionError('Focus changed during untouched observation')
        if frame['reason'] != 'requestAnimationFrame' or frame['elapsedSeconds'] > 2.8:
            raise TimeoutError('Animation-frame fallback fired')
    target['heldSeconds'], target['nativeAfter'], target['final'] = time.monotonic()-started, p.native(), p.active()
    target['fixtureCounters'] = counts(p)
    # Keep the red or green full viewport before making the visibility assertion.
    target['capture'] = p.capture('after-two-seconds-'+label.replace(':', '-'))
    append(path, {'kind':'final','heldSeconds':target['heldSeconds'],'value':target['final'],
                  'native':target['nativeAfter'],'capture':target['capture']['path']})
    p._pin(path)
    # Native focus scrolling may converge after the ordinary driver settle. Keep
    # every frame, but require an unchanged final >=250 ms window plus capture.
    end = target['frames'][-1]['elapsedSeconds']
    candidates = [index for index, frame in enumerate(target['frames']) if frame['elapsedSeconds'] <= end-0.25]
    if not candidates:
        raise AssertionError(label+': no final 250 ms observation window')
    final_frames = target['frames'][candidates[-1]:]
    geometry = lambda frame: {key:frame[key] for key in ['active','rect','scroll','textLineBoxes','centerOwned','controlInsideViewport']}
    stable = len(final_frames)>=2 and all(geometry(frame)==geometry(final_frames[-1]) for frame in final_frames)
    visible = all(frame['controlInsideViewport'] and frame['centerOwned'] and frame['textLineBoxes']
                  and all(line['fullyInViewport'] for line in frame['textLineBoxes']) for frame in final_frames)
    captured = target['capture']['before']['active']
    capture_matches = (captured['rect']==final_frames[-1]['rect'] and captured['scroll']==final_frames[-1]['scroll']
                       and all(captured[key]==final_frames[-1]['active'][key] for key in ['tag','id','text'])
                       and captured['centerOwned']==final_frames[-1]['centerOwned'])
    target['acceptance'] = {'predicate':'Final >=250 ms of the two-second native focus hold is stable, with at least two returned rAF observations, strict full control/text-line visibility, center ownership, and unchanged full-viewport capture. Earlier convergence is retained but not accepted as instant reveal.',
                            'terminalWindowSeconds':end-final_frames[0]['elapsedSeconds'],
                            'terminalFrameCount':len(final_frames),'stable':stable,'visible':visible,'captureMatches':capture_matches}
    append(path, {'kind':'acceptance','value':target['acceptance']})
    p._pin(path)
    if not stable or not visible or not capture_matches:
        raise AssertionError(label+': final native focus did not converge to stable full control/text-line visibility')


def required_error(p):
    p.key('ENTER')  # Exactly one invalid Review activation. Subject and ratio remain blank.
    active = p.active()
    error = p.observe('''const e=document.querySelector('#experience-subject-error'),r=e.getBoundingClientRect();
const range=document.createRange();range.selectNodeContents(e);return {text:e.textContent,rect:r.toJSON(),
fullyVisible:r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,
textLines:[...range.getClientRects()].map(b=>({rect:b.toJSON(),fullyVisible:b.left>=0&&b.top>=0&&b.right<=innerWidth&&b.bottom<=innerHeight}))};''')
    p.receipt['requiredError'] = {'active':active,'error':error}
    p.capture('required-error-focus')
    r, v = active['rect'], active['viewport']
    if active['id'] != 'experience-subject' or active['ariaInvalid'] != 'true' or not active['centerOwned']:
        raise AssertionError('Invalid Review did not focus the subject field with an error')
    if not (r['x'] >= 0 and r['y'] >= 0 and r['right'] <= v['width'] and r['bottom'] <= v['height']):
        raise AssertionError('Required subject control is not fully visible')
    if error['text'] != 'Required' or not error['fullyVisible'] or not error['textLines'] or not all(x['fullyVisible'] for x in error['textLines']):
        raise AssertionError('Required error is not fully visible')


def run(output_dir, config):
    with driver.FirefoxProfile(output_dir, config) as p:
        p._pin(Path(__file__))
        p.open('/experiences/image')
        p.wait_for(lambda:p.observe('return !!document.querySelector("#experience-subject");'), 'Image setup did not mount')
        counts(p)
        blank = p.observe('return {subject:document.querySelector("#experience-subject").value,selectedRatios:[...document.querySelectorAll(".experience-ratios [aria-pressed=true]")].length};')
        if blank != {'subject':'','selectedRatios':0}:
            raise AssertionError('Image regression requires blank subject and ratio')
        p.receipt['blankSetup'] = blank
        for label in ['16:9','9:16','Review']:
            to_button(p, label)
            hold_focus(p, label)
        required_error(p)
        counts(p)
        to_button(p, 'Review', 'native-tab-return-to-review')
        # A fourth hold is unnecessary; native focus gets the same full geometry check.
        final = p.active()
        p.receipt['returnedReview'] = final
        p.capture('required-errors-review-focus')
        r, v = final['rect'], final['viewport']
        if not final['centerOwned'] or not (r['x']>=0 and r['y']>=0 and r['right']<=v['width'] and r['bottom']<=v['height']):
            raise AssertionError('Review is not fully visible after required validation')
        layout = p.observe('return {clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth};')
        if layout['clientWidth'] != layout['scrollWidth']:
            raise AssertionError('Image document has horizontal overflow')
        p.finish({'fixtureCounters':counts(p),'productActivations':1,'authoredInput':False,
                  'nativeControlsHeld':['16:9','9:16','Review'],'layout':layout,
                  'scope':'Full focused-control and DOM text-line bounds for these Image states only; no glyph-ink or full focus-outline claim.'})


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('Usage: python3 forma-image-text-200.py <new output directory> <run-config.json>')
    run(sys.argv[1], json.loads(Path(sys.argv[2]).read_text()))
