"""One blank native Review: Model3D invalid-field group at Firefox text2/full1."""
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

# Read-only geometry and DOM text-line observations. The blank textarea has no
# authored text; associated label text lines, full control and Required are tested.
# Label outer blocks remain raw evidence, separate from visible label text lines.
SNAPSHOT = r'''
function snapshot(){
  const subject=document.querySelector('#experience-subject');
  const error=document.querySelector('#experience-subject-error');
  const group=subject?.parentElement;
  const rect=r=>({x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom});
  const visible=r=>r.width>0&&r.height>0&&r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;
  function element(e){
    if(!e)return null;
    const r=e.getBoundingClientRect(),lines=[],walk=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);
    let text;while(text=walk.nextNode()){
      if(!text.textContent.trim())continue;
      const range=document.createRange();range.selectNodeContents(text);
      for(const box of range.getClientRects()){
        const hit=document.elementFromPoint((box.left+box.right)/2,(box.top+box.bottom)/2);
        lines.push({text:text.textContent,rect:rect(box),fullyVisible:visible(box),centerOwned:!!hit&&(hit===e||e.contains(hit))});
      }
    }
    return {tag:e.tagName,id:e.id,text:e.textContent.trim(),rect:rect(r),fullyVisible:visible(r),textLineBoxes:lines};
  }
  const control=element(subject),labels=[...(subject?.labels||[])].map(label=>({...element(label),associated:label.control===subject,connected:label.isConnected}));
  if(control){
    const r=subject.getBoundingClientRect(),hit=document.elementFromPoint((r.left+r.right)/2,(r.top+r.bottom)/2);
    Object.assign(control,{value:subject.value,ariaInvalid:subject.getAttribute('aria-invalid'),
      describedBy:subject.getAttribute('aria-describedby'),centerOwned:!!hit&&(hit===subject||subject.contains(hit))});
  }
  const active=document.activeElement;
  return {active:{tag:active?.tagName,id:active?.id},control,labels,error:element(error),
    group:group?{className:group.className,rect:rect(group.getBoundingClientRect()),
      containsLabelControlError:group.classList.contains('experience-field')&&group.contains(subject)&&group.contains(error)&&labels.length>0&&[...subject.labels].every(label=>group.contains(label))}:null,
    viewport:{width:innerWidth,height:innerHeight},scroll:{x:scrollX,y:scrollY},
    document:{clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth}};
}
'''
FRAME = SNAPSHOT + r'''
const done=arguments[arguments.length-1],limit=arguments[0];
let finished=false,frameId,timer;
function complete(reason){
  if(finished)return;finished=true;cancelAnimationFrame(frameId);clearTimeout(timer);
  done({reason,performanceMs:performance.now(),wallMs:Date.now(),state:snapshot()});
}
frameId=requestAnimationFrame(()=>complete('requestAnimationFrame'));
timer=setTimeout(()=>complete('completion-fallback'),limit);
'''


def append(path, value):
    with path.open('a') as stream:
        stream.write(json.dumps(value)+'\n')
        stream.flush()
        os.fsync(stream.fileno())


def state(p):
    return p.observe(SNAPSHOT+'return snapshot();')


def counts(p):
    value = p.observe('return {mode:document.querySelector("#fixture-mode-reads")?.textContent,catalog:document.querySelector("#fixture-reads")?.textContent,forbidden:document.querySelector("#fixture-blocked")?.textContent};')
    p.receipt.setdefault('fixtureCounters', []).append(value)
    expected = {'mode':'0 ordinary entry-mode reads','catalog':'1 catalog reads','forbidden':'0 forbidden requests'}
    if value != expected:
        raise AssertionError('Unexpected Model3D fixture counters: '+json.dumps(value))
    return value


def valid_error_focus(value):
    control, error = value['control'], value['error']
    return (value['active']=={'tag':'TEXTAREA','id':'experience-subject'} and control is not None
            and control['value']=='' and control['ariaInvalid']=='true'
            and 'experience-subject-error' in (control['describedBy'] or '').split()
            and error is not None and error['text']=='Required'
            and value['group'] is not None and value['group']['containsLabelControlError'])


def fully_visible(value):
    labels, error, control = value['labels'], value['error'], value['control']
    text_visible = lambda item: item['fullyVisible'] and bool(item['textLineBoxes']) and all(line['fullyVisible'] for line in item['textLineBoxes'])
    return (valid_error_focus(value) and value['viewport']=={'width':1000,'height':715}
            and value['document']['clientWidth']==value['document']['scrollWidth']
            and control['fullyVisible'] and control['centerOwned']
            and bool(labels) and all(label['associated'] and label['connected'] and bool(label['textLineBoxes'])
                and all(line['fullyVisible'] and line['centerOwned'] for line in label['textLineBoxes']) for label in labels)
            and text_visible(error))


def capture_matches(capture, value):
    # The common capture checks physical PNG dimensions, native zoom, metrics and
    # active-state invariance. Also bind that capture to this exact field group.
    active = capture['before']['active']
    control = value['control']
    return (capture.get('diagnosticOnly') is not True
            and capture['capturePreservedState'] is True and capture['before']==capture['after']
            and control is not None and active['rect']==control['rect'] and active['scroll']==value['scroll']
            and all(active[key]==control[key] for key in ['tag','id','value','ariaInvalid','describedBy','centerOwned']))


def invalid_review(p):
    path = p.out/'invalid-focus-frames.jsonl'
    hold = {'frames':[],
            'sampling':'Immediate means after one native Enter command and protocol readbacks, without the ordinary settle delay; not zero latency. Then two seconds of returned rAF observations. Protocol/fsync round trips may skip display frames. No product actions occur during this hold.'}
    p.receipt['invalidFocusHold'] = hold
    # One native activation only. The common action API also releases all keys.
    key = driver.KEYS['ENTER']
    p._actions([{'type':'keyDown','value':key},{'type':'keyUp','value':key}])
    hold['immediate'] = state(p)
    hold['nativeBefore'] = p.native()
    append(path, {'kind':'immediate','state':hold['immediate'],'native':hold['nativeBefore']})
    p._pin(path)
    hold['immediateCapture'] = p.capture('invalid-focus-immediate', settle=False, diagnostic='model3d-invalid-immediate')
    hold['afterImmediateCapture'] = state(p)
    append(path, {'kind':'immediate-capture','path':hold['immediateCapture']['path'],'state':hold['afterImmediateCapture']})
    p._pin(path)
    started = time.monotonic()
    while time.monotonic()-started < 2:
        remaining = 2.8-(time.monotonic()-started)
        if remaining <= 0:
            raise TimeoutError('Invalid-focus rAF observation exceeded 2.8 seconds')
        frame = p.marionette.value('WebDriver:ExecuteAsyncScript', {'script':FRAME,
            'args':[max(1, int(remaining*1000))], 'newSandbox':True, 'sandbox':'system',
            'filename':'native-text200-model3d-invalid-focus', 'line':1})
        frame['elapsedSeconds'] = time.monotonic()-started
        hold['frames'].append(frame)
        append(path, {'kind':'frame','value':frame})
        p._pin(path)
        if frame['reason'] != 'requestAnimationFrame' or frame['elapsedSeconds'] > 2.8:
            raise TimeoutError('Invalid-focus animation-frame fallback fired')
    hold['heldSeconds'] = time.monotonic()-started
    hold['nativeAfter'] = p.native()
    hold['beforeFinalCapture'] = state(p)
    # Retain red and green full viewports before the visibility predicate.
    hold['finalCapture'] = p.capture('invalid-focus-after-two-seconds')
    hold['afterFinalCapture'] = state(p)
    hold['fixtureCounters'] = counts(p)
    append(path, {'kind':'final','heldSeconds':hold['heldSeconds'],'native':hold['nativeAfter'],
                  'before':hold['beforeFinalCapture'],'after':hold['afterFinalCapture'],
                  'path':hold['finalCapture']['path']})
    p._pin(path)
    end = hold['frames'][-1]['elapsedSeconds']
    candidates = [index for index, frame in enumerate(hold['frames']) if frame['elapsedSeconds'] <= end-0.25]
    if not candidates:
        raise AssertionError('Invalid-focus hold lacks a final 250 ms observation window')
    # Include the last sample AT OR BEFORE the cutoff so span is at least 250 ms.
    terminal = hold['frames'][candidates[-1]:]
    final = terminal[-1]['state']
    stable = len(terminal)>=2 and all(frame['state']==final for frame in terminal)
    visible = all(fully_visible(frame['state']) for frame in terminal)
    capture_stable = (hold['beforeFinalCapture']==final==hold['afterFinalCapture']
                      and capture_matches(hold['finalCapture'], final))
    focused = all(valid_error_focus(frame['state']) for frame in hold['frames'])
    # Immediate geometry may still converge during its raw diagnostic capture.
    # It is preserved separately and never contributes to stable acceptance.
    hold['immediateDiagnostic'] = {
        'diagnosticOnly':hold['immediateCapture']['diagnosticOnly'],
        'capturePreservedState':hold['immediateCapture']['capturePreservedState'],
        'scope':'Raw immediate before/PNG/after plus postcapture snapshot. Native state, viewport/document and nongeometry focus identity remain strict; geometry/scroll differences are diagnostic only.'}
    hold['earlierObservationToImmediateCapture'] = {
        'earlierScroll':hold['immediate']['scroll'],
        'captureScroll':hold['immediateCapture']['before']['active']['scroll'],
        'earlierGroupMatchesPostcapture':hold['immediate']==hold['afterImmediateCapture'],
        'scope':'Earlier external observation retained separately; equality with the later capture is not required.'}
    hold['acceptance'] = {
        'predicate':'Final >=250 ms of the two-second observation has at least two returned rAF samples with identical field-group geometry and focused blank invalid subject. Every associated connected label has nonempty DOM text-line boxes strictly inside the viewport with owned centers; label outer-block bounds are retained without a full-block claim. Control and Required bounds and Required text-line bounds remain strictly full. The final full viewport capture preserves its complete before/after state and matches the converged group. The immediate PNG and earlier geometry are raw diagnostics only, without a stable-capture, instant-reveal or numerical-tolerance claim.',
        'terminalWindowSeconds':end-terminal[0]['elapsedSeconds'],'terminalFrameCount':len(terminal),
        'stable':stable,'visible':visible,'errorFocusMaintained':focused,
        'finalCapturePreservedState':hold['finalCapture']['capturePreservedState'],
        'finalCaptureMatches':capture_stable}
    append(path, {'kind':'acceptance','value':hold['acceptance']})
    p._pin(path)
    if not all([stable, visible, focused, capture_stable]):
        raise AssertionError('Blank Review failed stable label-text and full invalid-control/Required visibility')


def run(output_dir, config):
    if config.get('case') != 'model3d-invalid-native-text200' or not config.get('viewSha256'):
        raise ValueError('This finite case requires the declared Model3D invalid-focus view successor')
    with driver.FirefoxProfile(output_dir, config) as p:
        p._pin(Path(__file__))
        p.open('/experiences/model3d')
        p.wait_for(lambda:p.observe('return !!document.querySelector("#experience-subject");'), 'Model3D setup did not mount')
        initial = state(p)
        p.receipt['initialSetup'] = {'state':initial,'fixtureCounters':counts(p),
            'scope':'Read-only initial state and native Tab transit only; no initial textarea visibility or authoring claim.'}
        if initial['control']['value'] != '' or initial['control']['ariaInvalid'] != 'false' or initial['error']['text']:
            raise AssertionError('The Model3D invalid-focus regression requires a fresh blank setup')
        p.receipt['reviewFocus'] = p.tab_until(
            lambda active:active['product'] and active['tag']=='BUTTON' and active['text']=='Review',
            'native-tab-to-blank-review', max_steps=40)
        if state(p)['control']['value'] != '':
            raise AssertionError('Native Tab changed the blank subject')
        invalid_review(p)
        p.finish({'fixtureCounters':counts(p),'productActivations':1,'authoredInput':False,'browseActivations':0,
                  'scope':'One blank Model3D Review: associated label text-line bounds and owned centers, full invalid-subject control and Required bounds at native text200 only. Label outer blocks are retained without a full-block claim. DOM bounds and returned rAF samples; no glyph-ink, whole focus-outline, initial partial-textarea, authoring, physical-device or AT claim.'})


if __name__ == '__main__':
    if len(sys.argv) != 3:
        raise SystemExit('Usage: python3 forma-model3d-invalid-text-200.py <new output directory> <run-config.json>')
    run(sys.argv[1], json.loads(Path(sys.argv[2]).read_text()))
