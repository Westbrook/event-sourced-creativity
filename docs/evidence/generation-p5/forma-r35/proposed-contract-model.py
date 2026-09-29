"""Executable acceptance sketch ONLY. Not imported by Forma; not an authority issuer,
provider driver, migration, or proposed production implementation. Fictional values.
SQL below models an atomic one-owner transfer claim, not final production DDL.
"""
import copy,json,sqlite3,unittest
NOW='2026-09-29T12:00:00Z'; EXPIRY='2026-10-01T00:00:00Z'
def example():
 return dict(mode='pending-exact-pair-v1',pair='OFFLINE-pair',owner='OFFLINE-owner',plan='OFFLINE-plan',baseline='OFFLINE-base',treatment='OFFLINE-treatment',candidate='OFFLINE-candidate',policy='OFFLINE-policy',scopeMatches=True,authority=True,residualAcceptance=True,reviewCurrent=True,humanResume=True,safety='clear',fidelity='expected-failure',prespecifiedFinding=True,originalResult=True,privateSlots=9,evidenceHashesValid=True,completeUsage=True,providerSubmission='original-received',duplicateSubmission=False,hardStop=False,expired=False,now=NOW,expiry=EXPIRY,lifecycleThrough=EXPIRY,lifecycleFunded=True,lifecycleBinding=True,knownOverrun=False,unrelated=[],unknown=[],otherExecution=False,baselineStatus='hold',providerSettled=False,remainingUncertainty=None,baseCost=100,baseLife=10,baseTokens=20,treatmentCost=100,treatmentLife=10,treatmentTokens=20,costLimit=220,costUsed=0,otherCostReserved=0,tokenLimit=40,tokenUsed=0,otherTokensReserved=0)
def eligibility(x):
 if x['mode']!='pending-exact-pair-v1':return 'legacy-settlement-required'
 for k in ['scopeMatches','authority','residualAcceptance','reviewCurrent','humanResume','originalResult','evidenceHashesValid','completeUsage','lifecycleFunded','lifecycleBinding']:
  if not x[k]:return k
 if x['baselineStatus']!='hold' or x['providerSettled'] or x['remainingUncertainty'] is not None:return 'wrong-pending-state'
 if x['safety']!='clear' or x['fidelity'] not in ['pass','expected-failure'] or x['fidelity']=='expected-failure' and not x['prespecifiedFinding']:return 'human-findings'
 if x['privateSlots']!=9 or x['providerSubmission']!='original-received' or x['duplicateSubmission']:return 'original-submission'
 if x['hardStop'] or x['knownOverrun'] or x['otherExecution']:return 'stopped-or-concurrent'
 if x['unrelated'] or x['unknown']:return 'unrelated-or-unknown-holds'
 if x['expired'] or x['now']>=x['expiry'] or x['now']>=x['lifecycleThrough']:return 'expiry'
 amounts=['baseCost','baseLife','baseTokens','treatmentCost','treatmentLife','treatmentTokens','costLimit','costUsed','otherCostReserved','tokenLimit','tokenUsed','otherTokensReserved']
 if any(type(x[k]) is not int or x[k]<0 for k in amounts):return 'amount'
 if x['costUsed']+x['otherCostReserved']+x['baseCost']+x['baseLife']+x['treatmentCost']+x['treatmentLife']>x['costLimit']:return 'cost-headroom'
 if x['tokenUsed']+x['otherTokensReserved']+x['baseTokens']+x['treatmentTokens']>x['tokenLimit']:return 'token-headroom'
 return 'eligible-for-one-transfer-not-settled'
def transfer(db,x,fail_after_claim=False):
 # Atomicity specification: caller cannot split claim, lane transfer and reservation.
 if eligibility(x)!='eligible-for-one-transfer-not-settled':raise ValueError(eligibility(x))
 with db:
  db.execute('INSERT INTO spec_claim VALUES(?,?,?,?)',(x['owner'],x['pair'],x['baseline'],x['treatment']))
  if fail_after_claim:raise ValueError('simulated-rollback')
 return copy.deepcopy(x),{'operation':x['treatment'],'status':'reserved','newProviderCalls':0}
class ContractTests(unittest.TestCase):
 def setUp(self):
  self.x=example();self.db=sqlite3.connect(':memory:');self.db.execute('CREATE TABLE spec_claim(owner TEXT PRIMARY KEY,pair TEXT UNIQUE,baseline TEXT UNIQUE,treatment TEXT UNIQUE)');self.addCleanup(self.db.close)
 def deny(self,**patch):
  x={**self.x,**patch};self.assertNotEqual(eligibility(x),'eligible-for-one-transfer-not-settled');self.assertRaises(ValueError,transfer,self.db,x)
 def test_legacy_default(self):self.deny(mode='after-settlement-and-funded-lifecycle')
 def test_exact_pair_advances_without_falsifying_baseline(self):
  before=copy.deepcopy(self.x);after,result=transfer(self.db,self.x);self.assertEqual(after,before);self.assertEqual(after['baselineStatus'],'hold');self.assertFalse(after['providerSettled']);self.assertIsNone(after['remainingUncertainty']);self.assertEqual(result['newProviderCalls'],0)
 def test_scope_wrong_pair_or_owner(self):self.deny(scopeMatches=False)
 def test_no_independent_acceptance(self):self.deny(residualAcceptance=False)
 def test_no_authentic_authority(self):self.deny(authority=False)
 def test_no_human_resume(self):self.deny(humanResume=False)
 def test_unsafe_or_unknown_fidelity(self):
  self.deny(safety='unknown');self.deny(safety='unsafe');self.deny(fidelity='unknown');self.deny(prespecifiedFinding=False)
 def test_existing_unclassified_counts_still_block(self):self.deny(unknown=['OFFLINE-token']*17+['OFFLINE-cost']*46)
 def test_unrelated_hold_still_blocks(self):self.deny(unrelated=['OFFLINE-another-purchase'])
 def test_original_result_missing(self):self.deny(originalResult=False)
 def test_private_evidence_missing_or_changed(self):self.deny(privateSlots=8);self.deny(evidenceHashesValid=False)
 def test_incomplete_usage(self):self.deny(completeUsage=False)
 def test_uncertain_submission(self):self.deny(providerSubmission='intent-unknown')
 def test_duplicate_submission(self):self.deny(duplicateSubmission=True)
 def test_no_baseline_reserve_reuse(self):self.deny(costLimit=219);self.deny(tokenLimit=39)
 def test_cross_period_liability_still_consumes_headroom(self):self.deny(otherCostReserved=1);self.deny(otherTokensReserved=1)
 def test_expiry_and_lifecycle(self):self.deny(now=EXPIRY);self.deny(lifecycleFunded=False);self.deny(lifecycleBinding=False);self.deny(lifecycleThrough=NOW)
 def test_overrun_or_hard_stop_not_cleared(self):self.deny(knownOverrun=True);self.deny(hardStop=True)
 def test_concurrent_execution_denied(self):self.deny(otherExecution=True)
 def test_competing_transfer_and_restart_cannot_claim_again(self):
  transfer(self.db,self.x);self.assertRaises(sqlite3.IntegrityError,transfer,self.db,self.x)
  other={**self.x,'pair':'OFFLINE-another-pair','treatment':'OFFLINE-another-treatment'};self.assertRaises(sqlite3.IntegrityError,transfer,self.db,other)
 def test_atomic_fault_cannot_leave_half_transfer(self):
  self.assertRaises(ValueError,transfer,self.db,self.x,True);self.assertEqual(self.db.execute('SELECT count(*) FROM spec_claim').fetchone()[0],0);transfer(self.db,self.x)
if __name__=='__main__':unittest.main(verbosity=2)
