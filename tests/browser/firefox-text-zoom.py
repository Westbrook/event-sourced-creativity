"""Native Firefox text-only zoom for finite local regressions. No import-time browser."""
import base64
import hashlib
import json
import os
import shutil
import signal
import socket
import struct
import subprocess
import threading
import time
import traceback
from pathlib import Path

KEYS = {'TAB': '\ue004', 'ENTER': '\ue006'}

NATIVE = '''const b=window.gBrowser.selectedBrowser; return {
textZoom:b.textZoom,fullZoom:b.fullZoom,zoomManagerValue:window.ZoomManager.getZoomForBrowser(b),
useFullZoom:window.ZoomManager.useFullZoom,browserZoomFull:Services.prefs.getBoolPref("browser.zoom.full"),
siteSpecific:Services.prefs.getBoolPref("browser.zoom.siteSpecific"),uri:b.currentURI.spec,
browsingContextId:b.browsingContext.id};'''
ACTIVE = '''let e=document.activeElement; while(e?.shadowRoot?.activeElement)e=e.shadowRoot.activeElement;
const r=e?.getBoundingClientRect(); const style=e?getComputedStyle(e):null;
const x=r?(r.left+r.right)/2:0,y=r?(r.top+r.bottom)/2:0;
let hit=document.elementFromPoint(x,y);while(hit?.shadowRoot){const n=hit.shadowRoot.elementFromPoint(x,y);if(!n||n===hit)break;hit=n;}
const d=e?.closest('dialog');const dr=d?.getBoundingClientRect();
return {tag:e?.tagName,id:e?.id,name:e?.getAttribute('name'),type:e?.type,
text:(e?.getAttribute('aria-label')||e?.innerText||e?.textContent||'').trim().replace(/\\s+/g,' ').slice(0,240),
value:typeof e?.value==='string'?e.value:null,ariaInvalid:e?.getAttribute('aria-invalid'),
describedBy:e?.getAttribute('aria-describedby'),product:!!e?.closest('#experience-root,forma-selected-output-share-review,forma-native-retained-model3d'),
rect:r?{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}:null,
viewport:{width:innerWidth,height:innerHeight},scroll:{x:scrollX,y:scrollY},
withinOneCssPixel:r? r.left>=-1&&r.top>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1:false,
centerOwned:!!e&&!!hit&&(hit===e||e.contains(hit)||hit.contains(e)),
outline:style?{style:style.outlineStyle,width:style.outlineWidth,offset:style.outlineOffset}:null,
dialog:dr?{x:dr.x,y:dr.y,width:dr.width,height:dr.height,right:dr.right,bottom:dr.bottom,scrollTop:d.scrollTop,scrollHeight:d.scrollHeight,clientHeight:d.clientHeight}:null};'''
METRICS = '''return {innerWidth,innerHeight,outerWidth,outerHeight,devicePixelRatio,
visualViewportScale:visualViewport.scale,scrollX,scrollY,
document:{clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth},
textSample:[...document.querySelectorAll('h1,textarea,button')].slice(0,8).map(e=>({tag:e.tagName,id:e.id,fontSize:getComputedStyle(e).fontSize}))};'''


class Marionette:
    def __init__(self, sock, receipt):
        self.sock, self.receipt, self.ident = sock, receipt, 0

    def receive(self):
        header = b''
        while not header.endswith(b':'):
            chunk = self.sock.recv(1)
            if not chunk:
                raise RuntimeError('Marionette closed during header')
            header += chunk
        size, payload = int(header[:-1]), b''
        while len(payload) < size:
            chunk = self.sock.recv(size - len(payload))
            if not chunk:
                raise RuntimeError('Marionette closed during payload')
            payload += chunk
        return json.loads(payload)

    def command(self, name, params=None):
        self.ident += 1
        body = json.dumps([0, self.ident, name, params or {}]).encode()
        self.sock.sendall(str(len(body)).encode() + b':' + body)
        reply = self.receive()
        if not isinstance(reply, list) or len(reply) != 4 or reply[:2] != [1, self.ident]:
            raise RuntimeError('Unexpected Marionette frame: ' + repr(reply))
        self.receipt['commands'].append({'id': self.ident, 'name': name, 'error': reply[2]})
        if reply[2]:
            raise RuntimeError(name + ': ' + json.dumps(reply[2]))
        return reply[3]

    def value(self, name, params=None):
        result = self.command(name, params)
        return result.get('value') if isinstance(result, dict) and set(result) == {'value'} else result


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


class FirefoxProfile:
    """Exactly one bounded fresh profile; product changes use native key actions only."""
    def __init__(self, output_dir, config):
        self.case_id = config.get('case', 'image-native-text200')
        if self.case_id not in {'image-native-text200', 'model3d-invalid-native-text200'}:
            raise ValueError('Only the declared finite native text200 cases are admitted')
        self.config = config
        self.firefox = Path(config['firefox']).resolve()
        self.out = Path(output_dir).resolve()
        self.base_url = config['baseURL']
        from urllib.parse import urlsplit
        origin = urlsplit(self.base_url)
        if origin.scheme != 'http' or origin.hostname != '127.0.0.1' or not origin.port or origin.path:
            raise ValueError('Only the parent-owned dedicated loopback origin is admitted')
        self.proc = self.sock = self.timer = self.log = self.marionette = None
        self.started = None
        self.done = False
        self.owns_output = False
        self.context = 'content'
        self.receipt = {'case': self.case_id, 'status': 'not-started', 'commands': [], 'stages': [],
                        'captures': [], 'errors': [], 'sourcePins': {}, 'wallCapSeconds': 60,
                        'watchdogSeconds': 55, 'alarmSeconds': 58,
                        'scope': 'Authorized finite native Firefox text200 software fixture; no physical-device or AT claim'}

    def __enter__(self):
        try:
            self._start()
            return self
        except BaseException as error:
            self._error(error)
            self._cleanup()
            raise

    def __exit__(self, kind, error, tb):
        if error is not None:
            self._error(error)
        elif not self.done:
            self._error(RuntimeError('Profile exited without explicit finish'))
        self._cleanup()
        return False

    def _error(self, error):
        self.receipt['status'] = 'failed'
        self.receipt['errors'].append({'type': type(error).__name__, 'message': str(error),
                                       'traceback': traceback.format_exc()})
        # Preserve the first failed state without actions, retries or altered acceptance checks.
        if (self.marionette and self.proc and self.proc.poll() is None and self.started is not None
                and time.monotonic()-self.started < 51 and 'failureObservation' not in self.receipt):
            observation = {}
            try:
                self.sock.settimeout(1)
                observation['native'] = self.native()
                observation['metrics'] = self.observe(METRICS)
                observation['active'] = self.active()
                observation['guard'] = self.guard()
                observation['fixtureState'] = self.observe('return {display:[...document.querySelectorAll("#fixture-mode-reads,#fixture-reads,#fixture-blocked,#reads,#forbidden,#fixture-receipt,[role=alert]")].map(e=>({id:e.id,text:e.textContent})),uri:location.href};')
                encoded = self.marionette.value('WebDriver:TakeScreenshot',{'full':False,'scroll':False})
                path = self.out/'first-failure.png'
                path.write_bytes(base64.b64decode(encoded))
                observation['screenshot']=str(path)
                self._pin(path)
            except BaseException as capture_error:
                observation['captureError']=str(capture_error)
            finally:
                self.receipt['failureObservation']=observation
                if self.sock:
                    self.sock.settimeout(10)

    def _pin(self, path):
        path = Path(path)
        self.receipt['sourcePins'][str(path)] = hashlib.sha256(path.read_bytes()).hexdigest()

    def _registry(self, state):
        path = self.out/'browser-process.json'
        temporary = path.with_suffix('.tmp')
        temporary.write_text(json.dumps({'runToken':self.config['runToken'],
            'ownerPythonPid':os.getpid(), 'pid':self.proc.pid, 'processGroup':self.proc.pid,
            'executable':str(self.firefox), 'profile':str(self.profile), 'state':state})+'\n')
        os.replace(temporary, path)

    def _start(self):
        self.out.mkdir(parents=True, exist_ok=False)
        self.owns_output = True
        self.profile = self.out / 'disposable-profile'
        self.profile.mkdir()
        extension = self.out / 'extension'
        extension.mkdir()
        port, proxy = free_port(), free_port()
        prefs = {'marionette.port': port, 'marionette.log.level': 'Trace',
                 'browser.startup.page': 0, 'browser.startup.homepage': 'about:blank',
                 'browser.newtabpage.enabled': False, 'browser.startup.homepage_override.mstone': 'ignore',
                 'browser.shell.checkDefaultBrowser': False, 'browser.tabs.warnOnClose': False,
                 'browser.tabs.warnOnQuit': False, 'browser.sessionstore.resume_from_crash': False,
                 'app.update.auto': False, 'app.update.enabled': False, 'app.normandy.enabled': False,
                 'app.shield.optoutstudies.enabled': False, 'datareporting.healthreport.uploadEnabled': False,
                 'datareporting.policy.dataSubmissionEnabled': False, 'toolkit.telemetry.enabled': False,
                 'toolkit.telemetry.unified': False, 'toolkit.telemetry.server': '',
                 'network.captive-portal-service.enabled': False, 'network.connectivity-service.enabled': False,
                 'network.prefetch-next': False, 'network.dns.disablePrefetch': True,
                 'network.predictor.enabled': False, 'network.trr.mode': 5,
                 'browser.safebrowsing.downloads.enabled': False, 'browser.safebrowsing.malware.enabled': False,
                 'browser.safebrowsing.phishing.enabled': False, 'extensions.update.enabled': False,
                 'extensions.systemAddon.update.enabled': False, 'extensions.getAddons.cache.enabled': False,
                 'network.proxy.type': 1, 'network.proxy.http': '127.0.0.1', 'network.proxy.http_port': proxy,
                 'network.proxy.ssl': '127.0.0.1', 'network.proxy.ssl_port': proxy,
                 'network.proxy.ftp': '127.0.0.1', 'network.proxy.ftp_port': proxy,
                 'network.proxy.socks': '127.0.0.1', 'network.proxy.socks_port': proxy,
                 'network.proxy.socks_remote_dns': True, 'network.proxy.no_proxies_on': '127.0.0.1',
                 'network.proxy.failover_direct': False, 'dom.serviceWorkers.enabled': False,
                 'browser.zoom.full': True, 'browser.zoom.siteSpecific': False,
                 'media.autoplay.default': 5}
        user_js = ''.join('user_pref(' + json.dumps(k) + ', ' + json.dumps(v) + ');\n' for k, v in prefs.items())
        (self.profile / 'user.js').write_text(user_js)
        (self.out / 'profile-user.js').write_text(user_js)
        manifest = {'manifest_version': 2, 'name': 'Finite native text200 fixture guard', 'version': '1.0',
                    'browser_specific_settings': {'gecko': {'id': 'forma-text200-guard@localhost'}},
                    'permissions': ['browserSettings', 'tabs', 'webRequest', 'webRequestBlocking', '<all_urls>'],
                    'background': {'scripts': ['background.js']},
                    'content_scripts': [{'matches': ['http://127.0.0.1/*'], 'run_at': 'document_start',
                                         'js': ['observation.js']} ]}
        (extension / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        (extension / 'background.js').write_text('const origin = ' + json.dumps(self.base_url) + ';\n' + '''
const state = { ready:false, guardRegistered:false, allowed:[], forbidden:[], zoom:[], errors:[] };
function blockRequest(request) {
  const url = new URL(request.url);
  const ok = url.origin === origin && ["GET", "HEAD"].includes(request.method)
    && !url.pathname.startsWith("/api/") && request.type !== "websocket";
  const item = {url:request.url,method:request.method,type:request.type};
  (ok ? state.allowed : state.forbidden).push(item);
  return {cancel:!ok};
}
browser.webRequest.onBeforeRequest.addListener(blockRequest, {urls:["<all_urls>"]}, ["blocking"]);
state.guardRegistered=browser.webRequest.onBeforeRequest.hasListener(blockRequest);
if(!state.guardRegistered)throw Error("Blocking listener registration failed");
async function zoom(tabId) {
  await browser.browserSettings.zoomFullPage.set({value:false});
  await browser.browserSettings.zoomSiteSpecific.set({value:false});
  await browser.tabs.setZoom(tabId,2);
  state.zoom.push({tabId,factor:await browser.tabs.getZoom(tabId),fullPage:await browser.browserSettings.zoomFullPage.get({})});
}
browser.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status === "complete" && tab.url?.startsWith(origin + "/"))
    zoom(tabId).catch(error => state.errors.push(String(error)));
});
browser.runtime.onMessage.addListener((message,sender) => {
  if (message?.kind !== "observe-native-text200" || !sender.url?.startsWith(origin + "/")) return undefined;
  return Promise.resolve({...state,tabId:sender.tab.id,documentUrl:sender.url,
    documentToken:message.documentToken,observedAt:Date.now()});
});
// The driver observes true→false only after the blocking listener is registered.
browser.browserSettings.zoomFullPage.set({value:false}).then(()=>{state.ready=true;})
  .catch(error=>state.errors.push(String(error)));
''')
        (extension / 'observation.js').write_text('const origin = ' + json.dumps(self.base_url) + ';\n' + '''// Test-only observation channel. No product state, focus, scroll or styles are changed.
if (location.origin === origin) {
  const documentToken=crypto.randomUUID();
  const diagnostics={pageErrors:[],unhandledRejections:[],cspViolations:[],resourceErrors:[]};
  window.addEventListener("error",event=>{
    if(event.message)diagnostics.pageErrors.push({message:event.message,file:event.filename,line:event.lineno});
    else diagnostics.resourceErrors.push({tag:event.target?.tagName,url:event.target?.src||event.target?.href||""});
  },true);
  window.addEventListener("unhandledrejection",event=>diagnostics.unhandledRejections.push(String(event.reason)));
  document.addEventListener("securitypolicyviolation",event=>diagnostics.cspViolations.push({
    blockedURI:event.blockedURI,effectiveDirective:event.effectiveDirective,violatedDirective:event.violatedDirective,disposition:event.disposition}));
  const read = async () => {
    try { const value=await browser.runtime.sendMessage({kind:"observe-native-text200",documentToken});
      if(document.documentElement)document.documentElement.dataset.nativeText200Observation=JSON.stringify({...value,diagnostics});
    } catch(error) { if(document.documentElement)document.documentElement.dataset.nativeText200Observation=JSON.stringify({errors:[String(error)]}); }
  };
  read(); setInterval(read,100);
}
''')
        # Pin the executable and available native runtime inputs without assuming an OS layout.
        runtime = self.firefox.parent
        resources = runtime.parent / 'Resources' if runtime.name == 'MacOS' else runtime
        native_inputs = [self.firefox, runtime/'XUL', runtime/'libmozglue.dylib',
                         runtime/'libxul.so', runtime/'mozglue.dll', runtime/'xul.dll',
                         resources/'application.ini', resources/'platform.ini',
                         resources/'omni.ja', resources/'browser/omni.ja']
        for path in [Path(__file__), self.out/'profile-user.js', *extension.iterdir(),
                     *(path for path in native_inputs if path.is_file())]:
            self._pin(path)
        if (resources/'application.ini').is_file():
            self.receipt['applicationIni'] = (resources/'application.ini').read_text()
        argv = [str(self.firefox), '--headless', '--no-remote', '--profile', str(self.profile),
                '--marionette', 'about:blank']
        self.receipt['argv'] = argv
        self.receipt['childEnvironmentOverrides'] = {'MOZ_HEADLESS': '1', 'MOZ_CRASHREPORTER_DISABLE': '1',
                                                    'MOZ_NO_REMOTE': '1', 'MOZ_REMOTE_ALLOW_SYSTEM_ACCESS': '1'}
        self.receipt['networkContainment'] = {'guard': str(extension/'background.js'), 'staticOrigin': self.base_url,
                                               'startupDeadProxy': f'127.0.0.1:{proxy}', 'packetCapture': False}
        self.log = open(self.out/'firefox.log', 'wb')
        self.started = time.monotonic()
        self.proc = subprocess.Popen(argv, stdout=self.log, stderr=subprocess.STDOUT,
                                     env={**os.environ, **self.receipt['childEnvironmentOverrides']}, start_new_session=True)
        self.receipt['pid'] = self.proc.pid
        # Parent supervisor can terminate this exact owned group if Python is interrupted.
        self._registry('active')
        self.receipt['status'] = 'running'
        self.old_alarm_handler = signal.signal(signal.SIGALRM, self._alarm)
        signal.alarm(58)
        self.timer = threading.Timer(55, self._watchdog)
        self.timer.daemon = True
        self.timer.start()
        while time.monotonic() - self.started < 15:
            if self.proc.poll() is not None:
                raise RuntimeError('Firefox exited before Marionette: ' + str(self.proc.returncode))
            try:
                self.sock = socket.create_connection(('127.0.0.1', port), timeout=0.3)
                break
            except (ConnectionRefusedError, TimeoutError):
                time.sleep(0.05)
        if self.sock is None:
            raise TimeoutError('Marionette startup exceeded 15 seconds')
        self.sock.settimeout(10)
        self.marionette = Marionette(self.sock, self.receipt)
        self.receipt['hello'] = self.marionette.receive()
        # Raw Marionette consumes direct capability fields, unlike geckodriver's HTTP envelope.
        self.receipt['session'] = self.marionette.command('WebDriver:NewSession',
            {'acceptInsecureCerts': False, 'pageLoadStrategy': 'normal',
             'timeouts': {'script': 5000, 'pageLoad': 10000, 'implicit': 0}})
        self.marionette.command('WebDriver:SetTimeouts', {'script': 5000, 'pageLoad': 10000, 'implicit': 0})
        self.receipt['timeouts'] = self.marionette.value('WebDriver:GetTimeouts')
        if self.receipt['timeouts'] != {'script': 5000, 'pageLoad': 10000, 'implicit': 0}:
            raise AssertionError('Effective Marionette timeouts differ from declared limits')
        self.marionette.command('WebDriver:SetWindowRect', {'width': 1000, 'height': 800})
        self.receipt['windowRect'] = self.marionette.value('WebDriver:GetWindowRect')
        if any(self.receipt['windowRect'][key] != expected for key, expected in [('width',1000),('height',800)]):
            raise AssertionError('Native window dimensions differ from declared profile')
        self.receipt['initialNative'] = self.native()
        if self.receipt['initialNative']['textZoom'] != 1 or self.receipt['initialNative']['fullZoom'] != 1 or self.receipt['initialNative']['browserZoomFull'] is not True:
            raise AssertionError('Fresh profile did not start at native text1/full1')
        self.receipt['extensionId'] = self.marionette.value('Addon:Install', {'path':str(extension),'temporary':True})
        self.receipt['guardInstallationProof'] = self.wait_for(
            lambda: (value if (value:=self.native())['browserZoomFull'] is False else None),
            'Guard did not signal registered blocking listener before navigation',timeout=3)
        self.receipt['parentBlockingListenerProof']=self.wait_for(self._parent_guard,
            'Firefox parent did not register the live blocking request listener',timeout=3)

    def _parent_guard(self):
        self._context('chrome')
        try:
            return self._execute('''const {ExtensionParent}=ChromeUtils.importESModule('resource://gre/modules/ExtensionParent.sys.mjs');
const e=ExtensionParent.GlobalManager.getExtension('forma-text200-guard@localhost');
if(!e||e.hasShutdown||!e.policy?.active||e.backgroundState!=='running')return false;
const modules=e.persistentListeners;if(!modules?.has('webRequest'))return false;
const events=modules.get('webRequest');if(!events.has('onBeforeRequest'))return false;
const ready=[...events.get('onBeforeRequest').values()].some(({params,listeners})=>
params[0]?.urls?.length===1&&params[0].urls[0]==='<all_urls>'&&params[1]?.includes('blocking')&&listeners.some(l=>l.added===true&&!l.primed));
return ready?{extensionId:e.id,backgroundState:e.backgroundState,policyActive:e.policy.active,
blockingAllUrlsListenerAdded:true}:false;''')
        finally:
            self._context('content')

    def _context(self, value):
        if self.context != value:
            self.marionette.command('Marionette:SetContext', {'value':value})
            self.context = value

    def _execute(self, body):
        return self.marionette.value('WebDriver:ExecuteScript', {'script':body,'args':[],
            'newSandbox':True,'sandbox':'system','filename':'native-text200-observation','line':1})

    def observe(self, body):
        """Read-only content script body with an explicit return statement."""
        self._context('content')
        return self._execute(body)

    def native(self):
        self._context('chrome')
        value = self._execute(NATIVE)
        self._context('content')
        return value

    def wait_for(self, predicate, label, timeout=3):
        deadline = time.monotonic() + timeout
        while True:
            value = predicate()
            if value:
                return value
            if time.monotonic() >= deadline:
                raise TimeoutError(label)
            time.sleep(0.05)

    def open(self, path):
        if not path.startswith('/') or path.startswith('//') or '?' in path or '#' in path:
            raise ValueError('Only exact fresh local paths without query/hash are admitted')
        self._context('content')
        self.marionette.command('WebDriver:Navigate', {'url':self.base_url+path})
        def zoom_ready():
            value = self.native()
            return value if value['textZoom']==2 and value['fullZoom']==1 and value['useFullZoom'] is False else None
        self.receipt['openedNative'] = self.wait_for(zoom_ready, 'Native text2/full1 was not applied', timeout=5)
        self.receipt['openedMetrics'] = self.observe(METRICS)
        self._check_metrics(self.receipt['openedMetrics'])
        self.current_url = self.base_url+path
        initial_guard=self.wait_for(lambda: (value if (value:=self.guard()).get('ready') and value.get('documentUrl')==self.current_url else None), 'Extension network observer was not ready')
        self.document_token=initial_guard['documentToken']
        self.check_graph()

    def _check_metrics(self, metrics):
        expected={'innerWidth':1000,'innerHeight':715,'outerWidth':1000,'outerHeight':800,'devicePixelRatio':1,'visualViewportScale':1}
        if metrics['document']['clientWidth'] != metrics['document']['scrollWidth']:
            raise AssertionError('Native text200 document has horizontal overflow: '+json.dumps(metrics))
        if any(metrics[key]!=value for key,value in expected.items()):
            raise AssertionError('Native text200 profile dimensions/DPR differ: '+json.dumps(metrics))

    def check_graph(self):
        path = Path(self.config['graph'])
        graph = json.loads(path.read_text())
        if graph.get('errors'):
            raise AssertionError('Static source graph guard reported: '+json.dumps(graph['errors']))
        if (graph.get('baseline') != self.config['baseline'] or graph.get('styleSha256') != self.config['styleSha256']
                or graph.get('viewSha256') != self.config.get('viewSha256') or graph.get('case') != self.case_id):
            raise AssertionError('Static source graph identity changed')
        self.receipt.setdefault('sourceGraphChecks', []).append({
            'path':str(path),'baseline':graph['baseline'],'styleSha256':graph['styleSha256'],
            'viewSha256':graph.get('viewSha256'),'case':graph['case'],
            'errors':graph['errors'],'files':len(graph.get('files',[]))})

    def guard(self):
        return self.observe('return JSON.parse(document.documentElement.dataset.nativeText200Observation||"{}");')

    def active(self):
        return self.observe(ACTIVE)

    def _actions(self, actions):
        self._context('content')
        self.marionette.command('WebDriver:PerformActions', {'actions':[{'type':'key','id':'native-text200-keyboard','actions':actions}]})
        self.marionette.command('WebDriver:ReleaseActions')

    def key(self, name, shift=False):
        value = KEYS[name]
        actions = ([{'type':'keyDown','value':'\ue008'}] if shift else [])
        actions += [{'type':'keyDown','value':value},{'type':'keyUp','value':value}]
        if shift:
            actions.append({'type':'keyUp','value':'\ue008'})
        self._actions(actions)
        self.settle()

    def settle(self):
        """Observe bounded natural layout/scroll settlement; never manipulate focus or scroll."""
        previous = None
        deadline = time.monotonic()+0.8
        while True:
            current = self.active()
            if previous == current:
                return current
            previous = current
            if time.monotonic() >= deadline:
                return current
            time.sleep(0.05)

    def tab_until(self, predicate, label, max_steps=40):
        stage = {'label':label,'steps':[]}
        self.receipt['stages'].append(stage)
        for _ in range(max_steps):
            self.key('TAB')
            focused = self.active()
            stage['steps'].append(focused)
            if focused['tag'] == 'BODY':
                raise AssertionError('Native Tab entered browser chrome before '+label)
            if predicate(focused):
                return focused
        raise AssertionError('Native Tab did not reach '+label)

    def capture(self, label, *, settle=True, diagnostic=None):
        if diagnostic is not None and (diagnostic != 'model3d-invalid-immediate'
                or self.case_id != 'model3d-invalid-native-text200' or label != 'invalid-focus-immediate'
                or settle is not False or any(item['label']==label for item in self.receipt['captures'])):
            raise ValueError('Diagnostic capture is only the single unsettled Model3D invalid-focus observation')
        if settle:
            self.settle()
        before = {'native':self.native(),'metrics':self.observe(METRICS),'active':self.active()}
        self._check_metrics(before['metrics'])
        if before['native']['textZoom']!=2 or before['native']['fullZoom']!=1 or before['native']['browserZoomFull'] is not False:
            raise AssertionError('Capture lacks native text2/full1')
        encoded = self.marionette.value('WebDriver:TakeScreenshot', {'full':False,'scroll':False})
        path = self.out/(label+'.png')
        png=base64.b64decode(encoded)
        path.write_bytes(png)
        if png[:8]!=b'\x89PNG\r\n\x1a\n' or png[12:16]!=b'IHDR':
            raise AssertionError('Native screenshot is not a PNG with IHDR dimensions')
        width,height=struct.unpack('>II',png[16:24])
        after = {'native':self.native(),'metrics':self.observe(METRICS),'active':self.active()}
        capture = {'label':label,'path':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
                   'pixelWidth':width,'pixelHeight':height,'before':before,'after':after,'capturePreservedState':before==after}
        if diagnostic is not None:
            capture['diagnosticOnly'] = True
            capture['diagnostic'] = diagnostic
            capture['scope'] = 'Immediate raw geometry/scroll observation only; this PNG is never evidence of stable geometry or an invariant capture interval.'
        self.receipt['captures'].append(capture)
        self._pin(path)
        if width!=before['metrics']['innerWidth']*before['metrics']['devicePixelRatio'] or height!=before['metrics']['innerHeight']*before['metrics']['devicePixelRatio']:
            raise AssertionError('Screenshot physical pixels do not match the full native viewport')
        if diagnostic is not None:
            self._check_metrics(after['metrics'])
            identity = {'tag':'TEXTAREA','id':'experience-subject','name':'subject','type':'textarea',
                        'value':'','ariaInvalid':'true','describedBy':'experience-subject-error',
                        'product':True,'centerOwned':True}
            if any(sample['active'].get(key)!=value for sample in [before,after] for key,value in identity.items()):
                raise AssertionError('Diagnostic capture lost the owned blank invalid subject focus')
            # Only geometry and page scroll may vary in this diagnostic interval.
            # Compare all other returned fields, including native zoom/context,
            # document dimensions, text metrics, focus identity and ownership.
            without = lambda value, keys: {key:item for key,item in value.items() if key not in keys}
            if (before['native']!=after['native']
                    or without(before['metrics'], {'scrollX','scrollY'})!=without(after['metrics'], {'scrollX','scrollY'})
                    or without(before['active'], {'rect','scroll'})!=without(after['active'], {'rect','scroll'})):
                raise AssertionError('Diagnostic capture changed native state, dimensions or nongeometry focus identity')
        elif before != after:
            raise AssertionError('Full viewport capture changed native zoom, viewport, focus or scroll')
        return capture

    def finish(self, extra=None):
        self.check_graph()
        # A timestamp/document-token barrier proves the final observation is fresh for this document.
        barrier = time.time()*1000
        guard = self.wait_for(lambda: (value if (value:=self.guard()).get('observedAt',0)>=barrier
            and value.get('documentUrl')==self.current_url and value.get('documentToken')==self.document_token else None),
            'No fresh terminal extension observation',timeout=2)
        self.receipt['networkGuard'] = guard
        if not guard.get('ready') or not guard.get('guardRegistered') or guard.get('errors') or guard.get('forbidden'):
            raise AssertionError('Extension guard missing, failed or observed forbidden requests: '+json.dumps(guard))
        diagnostics=guard.get('diagnostics')
        if not isinstance(diagnostics,dict):
            raise AssertionError('Document diagnostics channel is missing')
        if diagnostics.get('pageErrors') or diagnostics.get('unhandledRejections'):
            raise AssertionError('Document reported page errors or unhandled rejections: '+json.dumps(diagnostics))
        self.receipt['diagnosticClassification'] = {
            **diagnostics, 'consoleErrorInterception':False, 'browserDiagnosticsRetained':'firefox.log'}
        if diagnostics.get('cspViolations') or diagnostics.get('resourceErrors'):
            raise AssertionError('Unexpected document CSP/resource diagnostics: '+json.dumps(diagnostics))
        self.receipt['finalNative'] = self.native()
        if self.receipt['finalNative']['textZoom']!=2 or self.receipt['finalNative']['fullZoom']!=1:
            raise AssertionError('Final native text zoom changed')
        self.receipt['checks'] = extra or {}
        self.receipt['status'] = 'passed-pending-cleanup'
        self.done = True

    def _kill(self, sig):
        if self.proc:
            try:
                os.killpg(self.proc.pid,sig)
            except ProcessLookupError:
                pass

    def _watchdog(self):
        self.receipt['watchdogFired'] = True
        self._kill(signal.SIGKILL)

    def _alarm(self, _number, _frame):
        raise TimeoutError('Profile subprocess exceeded the 58-second control deadline')

    def _cleanup(self):
        if self.started is not None:
            signal.alarm(0)
            if hasattr(self,'old_alarm_handler'):
                signal.signal(signal.SIGALRM,self.old_alarm_handler)
        cleanup = {'errors':[]}
        def attempt(name, function):
            try:
                return function()
            except BaseException as error:
                cleanup['errors'].append({'operation':name,'error':str(error)})
                return None
        if self.sock:
            attempt('close-control-socket',self.sock.close)
        if self.proc:
            attempt('terminate-owned-group',lambda:self._kill(signal.SIGTERM))
            attempt('wait-after-term',lambda:self.proc.wait(timeout=0.7))
            attempt('kill-owned-group-remainder',lambda:self._kill(signal.SIGKILL))
            attempt('wait-after-kill',lambda:self.proc.wait(timeout=0.7))
            absent = False
            for _ in range(10):
                try:
                    os.killpg(self.proc.pid,0)
                except ProcessLookupError:
                    absent = True
                    break
                time.sleep(0.03)
            cleanup.update({'browserExitCode':self.proc.returncode,'ownProcessGroup':self.proc.pid,'ownProcessGroupAbsent':absent})
            if absent:
                attempt('retire-owned-browser-registry',lambda:self._registry('cleaned'))
            else:
                self.receipt['status']='failed-cleanup'
        if self.timer:
            self.timer.cancel()
        if self.log:
            attempt('close-browser-log',self.log.close)
        if hasattr(self,'profile') and self.profile.exists():
            attempt('remove-private-profile',lambda:shutil.rmtree(self.profile))
        cleanup['privateProfileDeleted'] = not hasattr(self,'profile') or not self.profile.exists()
        elapsed = time.monotonic()-self.started if self.started is not None else 0
        self.receipt.update({'cleanup':cleanup,'elapsedSeconds':elapsed})
        if cleanup['errors'] or not cleanup['privateProfileDeleted']:
            self.receipt['status']='failed-cleanup'
        if elapsed >= 60:
            self.receipt['status']='failed-runtime-cap'
        if self.receipt['status']=='passed-pending-cleanup':
            self.receipt['status']='pass'
        if self.owns_output:
            (self.out/'receipt.json').write_text(json.dumps(self.receipt,indent=2)+'\n')
