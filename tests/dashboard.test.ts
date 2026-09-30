import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isUnpaidInvoice,businessDay,membershipSummary,receiptsThisMonth} from '../shared/dashboard';

test('Crown Care counts each unscheduled seasonal visit, including legacy labels',()=>{
 const metrics=membershipSummary([
  {status:'Active',billingFrequency:'Annual',springVisit:{status:'Unscheduled'},fallVisit:{status:'Unscheduled'}},
  {status:'Active',billingFrequency:'Annual',springVisit:{status:'Not Scheduled'},fallVisit:{status:'Scheduled'}},
  {status:'Active',billingFrequency:'Annual',springVisit:{status:'Completed'}},
  {status:'Cancelled',springVisit:{status:'Unscheduled'},fallVisit:{status:'Unscheduled'}},
 ]);
 assert.equal(metrics.unbooked,4);
});

test('monthly collections include partial receipts by payment date, not invoice paid status',()=>{
 const payments=[
  {amount_cents:200000,paid_at:'2026-09-10T12:00:00Z',method:'Check',invoice_status:'Partial'},
  {amount_cents:500000,paid_at:'2026-08-15T12:00:00Z',method:'Check',invoice_status:'Paid'},
  {amount_cents:700000,paid_at:'2026-09-01T12:00:00Z',method:'Historical',invoice_status:'Paid'},
 ];
 assert.equal(receiptsThisMonth(payments,new Date('2026-09-29T12:00:00Z')),200000);
});
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
