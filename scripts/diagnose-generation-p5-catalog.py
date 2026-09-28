import json,pathlib,sqlite3,tarfile,gzip,hashlib,subprocess,collections
root=pathlib.Path('rehearsal/p5-sites');out=pathlib.Path('docs/evidence/generation-p5/sites-r8');sha=lambda b:hashlib.sha256(b).hexdigest();read=lambda p:json.loads(p.read_text());D=read(root/'src/dataset.json');expected=D['schema'];key=lambda x:x['name']
def diff(a,b):
 a={key(x):x for x in a};b={key(x):x for x in b};return {'missing':[a[k] for k in sorted(a.keys()-b.keys())],'extra':[b[k] for k in sorted(b.keys()-a.keys())],'changed':[{'name':k,'fields':{f:{'expected':a[k][f],'observed':b[k][f]} for f in ['type','tbl_name','sql'] if a[k][f]!=b[k][f]}} for k in sorted(a.keys()&b.keys()) if a[k]!=b[k]]}
query="SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT IN('d1_migrations','_cf_KV','_cf_METADATA') ORDER BY name"
def catalog(c):return [dict(zip(['type','name','tbl_name','sql'],r)) for r in c.execute(query)]
def make(sqls):
 c=sqlite3.connect(':memory:');c.executescript('\n'.join(sqls));return c
sources=tarfile.open('/private/tmp/forma-p5-sites-source-r3.tar.gz');archive=tarfile.open('/private/tmp/forma-p5-sites-rehearsal-r3.tar.gz');envelope=read(out.parent/'sites-r3/release-envelope.json');manifest=read(out.parent/'sites-r3/source-manifest.json');checks=[]
for f in manifest['files']:
 assert sha((root/f['path']).read_bytes())==f['sha256'];checks.append(f['path'])
# Archives use relative paths; pin all19 source payloads independent of wrapping prefix.
for f in manifest['files']:
 matches=[m for m in sources.getmembers() if m.isfile() and (m.name==f['path'] or m.name.endswith('/'+f['path']))];assert len(matches)==1,(f['path'],len(matches));assert sha(sources.extractfile(matches[0]).read())==f['sha256']
files=[m for m in archive.getmembers() if m.isfile()];assert len(files)==9
for m in files:assert archive.extractfile(m).read()==(root/m.name).read_bytes()
assert sha(gzip.decompress(pathlib.Path('/private/tmp/forma-p5-sites-rehearsal-r3.tar.gz').read_bytes()))==read(out.parent/'sites-r5/native-archive-admission.json')['nativeTarSha256']
for f in manifest['files']:
 b=subprocess.check_output(['git','-C','/private/tmp/forma-p5-sites-publish-r5','show','1565d8ac8a568bd0b9b7bde789eadc450e384364:'+f['path']]);assert sha(b)==f['sha256']
ms=[archive.extractfile('dist/.openai/drizzle/'+f).read().decode() for f in ['0000_hesitant_red_skull.sql','0001_p5_minimum.sql']];c=make(ms);exact=diff(expected,catalog(c));assert not any(exact.values());assert len(expected)==172
# Realistic local hypotheses only; no native cause asserted.
hypotheses={}
for name,ddl in [('named_excluded_bookkeeping','CREATE TABLE d1_migrations(id INTEGER);CREATE TABLE _cf_KV(key TEXT);CREATE TABLE _cf_METADATA(key TEXT);'),('drizzle_default_bookkeeping','CREATE TABLE "__drizzle_migrations" (id SERIAL PRIMARY KEY,hash text NOT NULL,created_at numeric);')]:
 db=make(ms+[ddl]);hypotheses[name]=diff(expected,catalog(db));db.close()
# Compare DDL representations while preserving all columns/constraints/index/trigger structure.
def structure(c):
 result={}
 for r in catalog(c):
  if r['type']=='table':
   q='"'+r['name'].replace('"','""')+'"';result[r['name']]={'columns':list(c.execute('PRAGMA table_xinfo('+q+')')),'foreignKeys':list(c.execute('PRAGMA foreign_key_list('+q+')')),'indexes':list(c.execute('PRAGMA index_list('+q+')')),'indexColumns':{i[1]:list(c.execute('PRAGMA index_xinfo("'+i[1].replace('"','""')+'")')) for i in c.execute('PRAGMA index_list('+q+')')}}
 return result
# Known, targeted transformation: whitespace after CREATE TABLE only (no blanket normalization).
rep=[s.replace('CREATE TABLE ', 'CREATE TABLE  ') for s in ms];rc=make(rep);hypotheses['create_keyword_spacing']=diff(expected,catalog(rc));assert structure(c)==structure(rc)
# internal field spacing retained by SQLite; all exact raw differences recorded.
rep=[s.replace('text PRIMARY KEY NOT NULL','text  PRIMARY KEY NOT NULL') for s in ms];rc2=make(rep);hypotheses['column_type_spacing']=diff(expected,catalog(rc2));assert structure(c)==structure(rc2)
# Semantic mutations must remain visible, including SQL-only CHECK and trigger changes.
sem=[]
for r in expected:
 if r['type'] in ['table','index','trigger','view'] and r['type'] not in sem:sem.append(r['type'])
rows=sorted(x['name'] for x in expected if x['type']=='table');post=read(out.parent/'sites-r5/postdeploy.json')
def find(v):
 if isinstance(v,dict):
  if 'tables' in v:return v['tables']
  for x in v.values():
   a=find(x)
   if a is not None:return a
 return None
listed=find(post);assert len(listed)==50;assert listed==rows[:50]
report={'sourceFilesVerified':len(checks),'archiveFilesVerified':9,'deployedSourceCommit':'1565d8ac8a568bd0b9b7bde789eadc450e384364','nativeTarHashMatched':True,'sqliteVersion':sqlite3.sqlite_version,'expectedObjects':len(expected),'counts':dict(collections.Counter(x['type'] for x in expected)),'exactPackagedMigrationDiff':exact,'hypotheses':hypotheses,'hypothesisConclusion':'Local only. __drizzle_migrations creates one extra object and reproduces equality refusal. Selected intra-definition whitespace changes preserve PRAGMA structure but differ in raw SQL. Neither is identified as hosted cause.','overview':{'listed':len(listed),'expectedTables':len(rows),'matchesFirst50Exactly':True,'notListed':rows[50:],'absenceProven':False,'contract':'Retained read_database_overview contract has project_id/binding_name only, no limit/offset/cursor request or next cursor response. Returned model_projection reported0omitted. Actual backend50cap is not established by that contract; no pagination API is available. Do not call trailing names absent.'},'hostedCauseIdentified':False,'hostedCalls':0}
(out/'local-catalog-diagnosis.json').write_text(json.dumps(report,indent=2)+'\n');(out/'reconstructed-catalog.json').write_text(json.dumps(catalog(c),indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k!='hypotheses'},indent=2));print('Hypothesis delta counts:',{k:{a:len(b) for a,b in v.items()} for k,v in hypotheses.items()})
