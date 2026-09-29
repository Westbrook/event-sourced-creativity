import json,pathlib,hashlib,os,datetime,math
root=pathlib.Path('/private/tmp/forma-p5-live-comparison/docs/evidence/generation-p5'); prior=root/'forma-r21/request-ledger.json'; dest=root/'forma-r23'; dest.mkdir(exist_ok=True)
out=dest/'request-ledger.json'; assert not out.exists(),'Do not reserve or dispatch twice'
ledger=json.loads(prior.read_text()); assert (ledger['normal'],ledger['recovery'],ledger['issued'])==(18,6,24);assert ledger['limits']=={'normal':22,'recovery':6}
assert len(ledger['entries'])==24 and not any(e['state']=='reserved' or e['group']=='logs' for e in ledger['entries'])
project=json.loads((root/'forma-r21/23-site-final.json').read_text())['data']['id']; assert project==ledger['target']
now=datetime.datetime.now(datetime.timezone.utc); start=datetime.datetime.fromisoformat('2026-09-28T23:57:45.950721+00:00'); assert now<datetime.datetime.fromisoformat('2026-09-30T22:00:00+00:00')
minutes=math.ceil((now-start).total_seconds()/60)+1;assert 1<=minutes<=2880
args={'project_id':project,'since_minutes':minutes,'limit':100,'errors_only':False}
ledger.update(stage='R23 user-approved single R22 native log read; stopped except this exact one operation',normal=19,issued=25)
ledger['priorLedger']={'path':'../forma-r21/request-ledger.json','sha256':hashlib.sha256(prior.read_bytes()).hexdigest(),'entries':24,'receiptBase':'../forma-r21/'}
ledger['acceptedLogOnlyException']={'userMessage':'Approve.','respondingTo':'Approve that single log read?','decision':'../forma-r22/decision.md','decisionSha256':hashlib.sha256((root/'forma-r22/decision.md').read_bytes()).hexdigest(),'normalReservations':1,'recoveryReservations':0,'allowedGroup':'logs','groupCap':1,'allOtherActionsRemainStopped':True}
ledger['entries'].append({'sequence':25,'reservedAt':now.isoformat(),'state':'reserved','group':'logs','action':'sites_get_site_worker_logs','args':args})
data=(json.dumps(ledger,indent=2)+'\n').encode();temp=out.with_suffix('.tmp')
with open(temp,'xb')as f:f.write(data);f.flush();os.fsync(f.fileno())
os.replace(temp,out);fd=os.open(dest,os.O_RDONLY);os.fsync(fd);os.close(fd);assert out.read_bytes()==data
assert json.loads(out.read_text())['entries'][:24]==json.loads(prior.read_text())['entries']
print(json.dumps({'sequence':25,'savedAndReadBack':True,'ledgerSha256':hashlib.sha256(data).hexdigest(),'reservedAt':now.isoformat(),'args':args}))
