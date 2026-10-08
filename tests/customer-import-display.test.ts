import {test} from 'node:test';import assert from 'node:assert/strict';
import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {CustomerImportSummary,CustomerBillingAddress,CustomerContactChannels} from '../client/src/components/customer-import-details';
test('imported fields render separately, safely, and without inventing empty addresses',()=>{
 const customer={companyName:'Example <script>Company</script>',billingAddress:{street:'Billing Street',unit:'Unit A',city:'Example',state:'MO',postalCode:'00123'},sourceReferences:{markate:{customerId:'101',batchId:'test',exportSha256:'test',exportedAt:'test',sourceAddedOn:'test',sourceRow:2,status:'Pending' as const}}};
 const html=renderToStaticMarkup(React.createElement('div',null,React.createElement(CustomerImportSummary,{customer}),React.createElement(CustomerBillingAddress,{customer}),React.createElement(CustomerContactChannels,{contact:{name:'Example',email:'hello@example.test',phone:'2025550101',phoneNumbers:[{label:'Mobile',value:'2025550101'},{label:'Phone',value:'2025550102'}]}})));
 assert.match(html,/Billing address/);assert.match(html,/Unit A/);assert.match(html,/00123/);assert.match(html,/Customer 101/);assert.match(html,/Mobile: 2025550101/);assert.match(html,/Phone: 2025550102/);assert.ok(!html.includes('<script>'));
 assert.equal(renderToStaticMarkup(React.createElement(CustomerBillingAddress,{customer:{}})),'');
});

test('saved billing addresses retain visible provider attribution after manual correction',()=>{
 const customer={billingAddress:{street:'Corrected Billing Street',unit:'Unit B',city:'Example',state:'MO',postalCode:'00123'},billingAddressProvenance:{provider:'geoapify' as const,selectedAt:'2026-10-08T00:00:00Z',source:{attribution:'Example map attribution',url:'javascript:alert(1)'}}};
 const html=renderToStaticMarkup(React.createElement(CustomerBillingAddress,{customer}));
 assert.match(html,/Corrected Billing Street/);assert.match(html,/Powered by Geoapify/);assert.match(html,/OpenStreetMap contributors/);assert.match(html,/Example map attribution/);assert.doesNotMatch(html,/javascript:/);
});
