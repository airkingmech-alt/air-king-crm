import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

test("quote presentation renders logo, contacts, scope, saved add-ons and no-payment acceptance", async () => {
  // Render real components against synthetic cached documents. No production requests.
  const temp = await mkdtemp(path.join(process.cwd(), ".quote-render-test-"));
  try {
    await build({ stdin: { contents: `
      import React from 'react';
      import { renderToStaticMarkup } from 'react-dom/server';
      import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
      import { Router, Route } from 'wouter';
      import CustomerDocument from './client/src/pages/customer-document';
      import { addOnServices } from './client/src/data/pricebook';
      import { buildQuoteDraft } from './client/src/lib/quote-pricing';
      import { publicFields } from './server/crm/core';
      export function renderInvoice(fees=false) {
        const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
        client.setQueryData(['public-document','test-invoice'],{kind:'invoice',payments_enabled:true,fee_enabled:fees,payments:fees?[{amount_cents:100000,fee_cents:3000,method:'Visa',paid_at:'2026-09-22'}]:[],document:{
          number:'INV-TEST',customerName:'Test Builder',status:'Partial',amount:5000,paidAmount:1250,dueDate:'2026-10-01',
          projectName:'Lot 12',constructionStage:'Rough-in',items:[{description:'Ductwork and piping rough-in',amount:5000}]
        }});
        const html=renderToStaticMarkup(<QueryClientProvider client={client}><Router ssrPath='/customer/test-invoice'><Route path='/customer/:token'><CustomerDocument /></Route></Router></QueryClientProvider>);
        client.clear();return html;
      }
      export function renderTiered(tier) {
        const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
        const q=buildQuoteDraft({customerId:'synthetic',customerName:'Test Customer',jobType:'Changeout',title:'Synthetic model-based quote',equipmentCost:4974,laborCost:1000,materialsCost:300,equipmentItems:['chp-z9e080c20','chp-ec42','chp-xc342']},'Q-TEST','2026-09-30');
        client.setQueryData(['public-document','test-quote'],{kind:'quote',document:publicFields('quote',{...q,status:'Won',selectedOption:tier})});
        const html=renderToStaticMarkup(<QueryClientProvider client={client}><Router ssrPath='/customer/test-quote'><Route path='/customer/:token'><CustomerDocument /></Route></Router></QueryClientProvider>);
        client.clear();return html;
      }
      export function render(status) {
        const client = new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
        const addon = addOnServices[0];
        client.setQueryData(['public-document','test-quote'], {kind:'quote', document:{
          number:'Q-TEST',title:'Champion Comfort System',customerName:'Test Customer',
          createdAt:'2026-09-16',scope:'Remove old equipment and install the selected system.',status,
          selectedOption: status==='Won'?'Better':null,selectedAddOns:status==='Won'?[addon.id]:[],
          options:[{tier:'Better',label:'Enhanced',customerPrice:5000,equipment:'Champion',features:['Included installation']}]
        }});
        const html=renderToStaticMarkup(<QueryClientProvider client={client}><Router ssrPath='/customer/test-quote'><Route path='/customer/:token'><CustomerDocument /></Route></Router></QueryClientProvider>);
        client.clear(); return {html,addon};
      }`, resolveDir: process.cwd(), loader: "tsx" },
      outfile: path.join(temp, "render.mjs"), bundle: true, platform: "node", format: "esm",
      packages: "external", jsx: "automatic", loader: { ".jpg": "dataurl", ".css": "empty" },
      plugins: [{ name: "no-network-crm", setup(b) { b.onResolve({ filter: /^@\/lib\/crm-api$/ }, () => ({ path: "crm", namespace: "test" }));
        b.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: "export async function crm(){throw new Error('Network forbidden in presentation test')}" })); } }],
    });
    const { render, renderInvoice, renderTiered } = await import(pathToFileURL(path.join(temp, "render.mjs")).href);
    const invoiceHtml=renderInvoice();
    assert.match(invoiceHtml,/PAY \$3,750.00 IN FULL/);
    assert.match(invoiceHtml,/Rough-in/);assert.match(invoiceHtml,/Lot 12/);
    assert.doesNotMatch(invoiceHtml,/pay-amount|partial payment|<input/);
    const feeHtml=renderInvoice(true);
    assert.match(feeHtml,/up to 3%/);assert.match(feeHtml,/Cash, check, debit and prepaid have no added fee/);
    assert.match(feeHtml,/CONTINUE TO SECURE CHECKOUT/);assert.match(feeHtml,/Credit-card fee: \$30.00/);assert.match(feeHtml,/\$1,030.00/);
    const pending = render("Quote Sent").html;
    assert.match(pending, /alt="Air King logo"/);
    assert.match(pending, /Mechanical Services LLC/);
    assert.match(pending, /Turney, MO 64493/);
    assert.match(pending, /airkingmech@gmail.com/);
    assert.match(pending, /Remove old equipment/);
    assert.match(pending, /Approve your proposal/);
    assert.match(pending, /No payment is required to accept/);
    assert.match(pending, /Print \/ Save PDF/);
    assert.doesNotMatch(pending, /HVAC-2019-0442/);
    const { html: accepted, addon } = render("Won");
    const expectedTotal = new Intl.NumberFormat('en-US', {style:'currency',currency:'USD'}).format(5000 + addon.price);
    assert.ok(accepted.includes(expectedTotal), "Accepted total includes persisted add-ons");
    assert.match(accepted, /Accepted/);
    assert.doesNotMatch(accepted, /Approve your proposal/);
    const best=renderTiered('Best');
    assert.match(best,/CTM48C5CFS1/);assert.doesNotMatch(best,/CTM42C5CES1/);
    assert.match(best,/4 Ton Champion AC/);assert.match(best,/15.75 SEER2/);
    assert.match(best,/\$9,974.09/);assert.doesNotMatch(best,/16 SEER/);
    assert.doesNotMatch(best,/Purchase tax|Internal cost|576.27|6,103.00/);
    const good=renderTiered('Good');
    assert.match(good,/CTM42C5CES1/);assert.match(good,/\$8,435.83/);
    assert.match(good,/13.4 SEER2/);assert.doesNotMatch(good,/13 SEER/);
    const staff = await readFile("client/src/pages/proposal.tsx", "utf8");
    assert.match(staff, /<QuoteHeader/);
    assert.match(staff, /<QuoteFooter/);
    assert.doesNotMatch(staff, /HVAC-2019-0442/);
  } finally { await rm(temp, { recursive: true, force: true }); }
});
