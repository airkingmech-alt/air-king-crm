import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isUnpaidInvoice,businessDay} from '../shared/dashboard';
test('collections includes partial balances but excludes draft, void and settled invoices',()=>{
 for(const status of ['Sent','Partial','Overdue']) {
  assert.equal(isUnpaidInvoice({status,amount:5000,paidAmount:2000}),true);
  assert.equal(isUnpaidInvoice({status,amount:5000,paidAmount:5000}),false);
  assert.equal(isUnpaidInvoice({status,amount:5000,paidAmount:6000}),false);
 }
 for(const status of ['Draft','Void','Paid']) assert.equal(isUnpaidInvoice({status,amount:5000,paidAmount:0}),false);
 assert.equal(isUnpaidInvoice({status:'Partial',amount:0.1+0.2,paidAmount:0.3}),false);
});
test('today uses Missouri business date on both sides of daylight saving',()=>{
 assert.equal(businessDay(new Date('2026-09-21T03:00:00Z')),'2026-09-20');
 assert.equal(businessDay(new Date('2026-12-21T05:00:00Z')),'2026-12-20');
});
