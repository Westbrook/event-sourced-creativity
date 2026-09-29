# Disposable synthetic metadata only; no application/private body or real reservation.
import sqlite3,pathlib,unittest
ROOT=pathlib.Path(__file__).resolve().parent
class QueryTest(unittest.TestCase):
 def setUp(self):
  self.db=sqlite3.connect(':memory:');self.db.row_factory=sqlite3.Row;self.addCleanup(self.db.close)
  self.db.executescript('''CREATE TABLE budget_reservations(reservation_id TEXT,owner_id TEXT,stream_id TEXT,correlation_id TEXT,operation TEXT,status TEXT,created_at TEXT);
  CREATE TABLE cost_budget_reservations(reservation_id TEXT,owner_id TEXT,stream_id TEXT,correlation_id TEXT,operation TEXT,status TEXT,created_at TEXT);
  CREATE TABLE document_jobs(owner_id TEXT,stream_id TEXT,correlation_id TEXT,job_id TEXT,result_json TEXT);
  CREATE TABLE output_operation_slots(scope_key TEXT,grant_id TEXT,token_reservation_id TEXT,cost_reservation_id TEXT);
  CREATE TABLE output_execution_grants(scope_key TEXT,grant_id TEXT,payer_user_id TEXT);
  CREATE TABLE consequential_execution_steps(execution_id TEXT,token_reservation_id TEXT,cost_reservation_id TEXT);
  CREATE TABLE consequential_executions(execution_id TEXT,actor_user_id TEXT);''')
 def read(self,k):return [dict(r) for r in self.db.execute((ROOT/f'hold-{k}-read.sql').read_text(),{'owner_id':'fictional-owner','observed_at':'2026-09-29T12:00:00Z'})]
 def seed(self,table,owner='fictional-owner',rid='secret-fictional-id'):
  self.db.execute(f'INSERT INTO {table} VALUES(?,?,?,?,?,?,?)',(rid,owner,'private-stream','private-correlation','unknown-private-operation','active','2026-09-20T00:00:00Z'))
 def test_unmatched_is_not_cleared_and_ids_not_returned(self):
  for k,table in [('token','budget_reservations'),('cost','cost_budget_reservations')]:
   self.seed(table);v=self.read(k)[0];self.assertEqual(v['document_matches_capped2'],0);self.assertEqual(v['operation_class'],'other-or-unknown');self.assertEqual(v['age_bucket'],'7-days-or-more');self.assertNotIn('private',str(v));self.assertNotIn('secret',str(v))
 def test_scope_excludes_other_owner(self):self.seed('budget_reservations','different-owner');self.assertEqual(self.read('token'),[])
 def test_two_matches_are_ambiguous_not_unique_operation(self):
  self.seed('budget_reservations');self.db.executemany('INSERT INTO document_jobs VALUES(?,?,?,?,?)',[('fictional-owner','private-stream','private-correlation',str(i),'{}') for i in range(3)]);self.assertEqual(self.read('token')[0]['document_matches_capped2'],2)
 def test_overflow_sentinel_not_unbounded_output(self):
  for i in range(102):self.seed('cost_budget_reservations',rid=str(i))
  self.assertEqual(len(self.read('cost')),101)
 def test_exact_output_reference_still_only_candidate(self):
  self.seed('budget_reservations');self.db.execute("INSERT INTO output_operation_slots VALUES('s','g','secret-fictional-id','x')");self.db.execute("INSERT INTO output_execution_grants VALUES('s','g','fictional-owner')");self.assertEqual(self.read('token')[0]['output_binding_candidate'],1)
if __name__=='__main__':unittest.main(verbosity=2)
