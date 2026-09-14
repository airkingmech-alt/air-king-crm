import { test } from "node:test";
import assert from "node:assert/strict";
import {
  quantityUnits, availableUnits, restockSuggestion,
  assertTransferTransition, receiptResult, assertCountCanPost,
} from "../server/crm/inventory-rules";

test("inventory quantities preserve fractional materials without floating point drift", () => {
  assert.equal(quantityUnits("1.125"), 1125);
  assert.equal(quantityUnits("0.009"), 9);
  assert.equal(quantityUnits("2", true), 2000);
  for (const value of ["-1", "1.0001", "1e3", "NaN", "Infinity", "", "9007199254740992"])
    assert.throws(() => quantityUnits(value));
  assert.throws(() => quantityUnits("1.5", true));
});

test("available inventory excludes reservations and transfer commitments", () => {
  assert.equal(availableUnits(3000, 1000, 1000), 1000);
  assert.throws(() => availableUnits(1000, 1000, 1));
  assert.throws(() => availableUnits(-1, 0, 0));
});

test("restock accounts for already incoming stock and shop shortages", () => {
  assert.deepEqual(restockSuggestion({available:1000, inbound:1000, minimum:2000, target:5000, sourceAvailable:2000}),
    {belowMinimum:true, needed:3000, transferable:2000, purchaseShortage:1000});
  assert.equal(restockSuggestion({available:2000, inbound:0, minimum:2000, target:5000, sourceAvailable:9000}).needed, 0);
  assert.equal(restockSuggestion({available:0, inbound:5000, minimum:2000, target:5000, sourceAvailable:9000}).needed, 0);
  assert.throws(() => restockSuggestion({available:0, inbound:0, minimum:3000, target:2000, sourceAvailable:9000}));
});

test("transfers cannot credit a truck from draft or cancel dispatched stock", () => {
  assertTransferTransition("Draft", "Ready");
  assertTransferTransition("Picked", "In Transit");
  assertTransferTransition("In Transit", "Received");
  assert.throws(() => assertTransferTransition("Draft", "Received"));
  assert.throws(() => assertTransferTransition("In Transit", "Cancelled"));
  assert.throws(() => assertTransferTransition("Received", "Received"));
});

test("partial receiving reconciles remaining quantities and blocks overreceipt", () => {
  assert.deepEqual(receiptResult(20000,0,12000),{received:12000,remaining:8000,status:"Partially Received"});
  assert.deepEqual(receiptResult(20000,12000,8000),{received:20000,remaining:0,status:"Received"});
  assert.throws(() => receiptResult(20000,12000,9000));
  assert.throws(() => receiptResult(20000,12000,0));
});

test("counts require administrator approval and unchanged stock version", () => {
  assertCountCanPost("admin",3,3);
  assertCountCanPost("owner",3,3);
  assert.throws(() => assertCountCanPost("technician",3,3));
  assert.throws(() => assertCountCanPost("dispatcher",3,3));
  assert.throws(() => assertCountCanPost("owner",3,4));
});
