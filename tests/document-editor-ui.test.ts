import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

test("real editor controls distinguish ordinary documents, accepted quotes and recorded payments", async () => {
  const temp = await mkdtemp(path.join(process.cwd(), ".document-editor-render-"));
  try {
    await build({ stdin: { contents: `
      import React from "react";import {renderToStaticMarkup} from "react-dom/server";
      import {QuoteEditor,InvoiceEditor} from "./client/src/components/document-editors";
      export function render(kind,status,paidAmount=0) {
        const quote={id:"Q-QA",status,customerId:"qa",customerName:"Synthetic",title:"Synthetic quote",jobType:"Changeout",laborCost:0,materialsCost:0,selectedAddOns:[],options:[{tier:"Good",label:"Test",customerPrice:100,equipment:"",efficiency:"",features:[],totalCost:80}]};
        const invoice={id:"INV-QA",status,paidAmount,customerId:"qa",customerName:"Synthetic",amount:100,dueDate:"2026-11-08",items:[{description:"Test",amount:100}]};
        return renderToStaticMarkup(kind==='quote'?<QuoteEditor quote={quote}/>:<InvoiceEditor invoice={invoice}/>);
      }`, resolveDir: process.cwd(), loader: "tsx" }, outfile: path.join(temp, "render.mjs"),
      bundle: true, platform: "node", format: "esm", packages: "external", jsx: "automatic",
      plugins: [{ name: "synthetic-editor-dependencies", setup(b) {
        b.onResolve({ filter: /^@\/context\/data-context$/ }, () => ({ path: "data", namespace: "qa" }));
        b.onResolve({ filter: /^@\/lib\/supabase$/ }, () => ({ path: "supabase", namespace: "qa" }));
        b.onLoad({ filter: /.*/, namespace: "qa" }, args => ({ contents: args.path === "data" ? 'export function useData(){return {workOrders:[],acceptSavedRecord(){throw Error("No writes in render test")}}}' : 'export const supabase={rpc(){throw Error("Network forbidden in render test")}}' }));
      } }],
    });
    const { render } = await import(pathToFileURL(path.join(temp, "render.mjs")).href);
    for (const status of ["Draft", "Quote Sent", "Lost"]) assert.match(render("quote", status), /Edit Quote/);
    assert.doesNotMatch(render("quote", "Won"), /Edit Quote/);
    for (const status of ["Draft", "Sent", "Overdue"]) assert.match(render("invoice", status), /Edit Invoice/);
    for (const status of ["Paid", "Partial", "Void"]) {
      assert.doesNotMatch(render("invoice", status), /Edit Invoice/);
      assert.match(render("invoice", status), /billing history is retained/);
    }
    assert.doesNotMatch(render("invoice", "Draft", 1), /Edit Invoice/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test("editing entry points are on real detail routes and dialogs preserve failures and submit guards", async () => {
  const proposal = await readFile("client/src/pages/proposal.tsx", "utf8"), invoice = await readFile("client/src/pages/invoice-view.tsx", "utf8"), customer = await readFile("client/src/pages/customer-detail.tsx", "utf8"), app = await readFile("client/src/App.tsx", "utf8");
  assert.match(proposal, /<QuoteEditor key=\{quote.id\} quote=\{quote\}/);
  assert.match(invoice, /<InvoiceEditor key=\{invoice.id\} invoice=\{invoice\}/);
  assert.match(customer, /<CustomerEditor key=\{customer.id\} customer=\{customer\}/);
  assert.match(app, /canAccess\(profile,"quotes"\) \? <Proposal/);
  assert.match(app, /canAccess\(profile,"invoices"\) \? <InvoiceView/);
  const editor = await readFile("client/src/components/document-editors.tsx", "utf8");
  assert.match(editor, /if \(!original \|\| pending.current\) return/);
  assert.match(editor, /setOriginal\(structuredClone\(quote\)\)/);
  assert.match(editor, /setOriginal\(structuredClone\(invoice\)\)/);
  assert.match(await readFile("client/src/lib/document-editing.ts", "utf8"), /p_previous: original/);
  assert.match(editor, /max-h-\[90dvh\] overflow-y-auto/);
  assert.match(editor, /catch \(error\) \{ setError\(errorMessage\(error\)\); \}/);
  assert.doesNotMatch(editor, /crm\([^\n]*(send|payment|convert)/);
});
