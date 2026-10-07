import { test } from "node:test";
import assert from "node:assert/strict";
import { crownCatalogVersion, crownTierIds, crownTierSnapshot, crownInquiryMetadata } from "../shared/crown-tiers";
import { configurationFor, crownConfiguration, membershipPriceCents } from "../shared/crown-care";

test("draft catalog has approved benefit quantities and exact draft prices",()=>{
 const plans=crownTierIds.map(tier=>crownTierSnapshot({tier,catalogVersion:crownCatalogVersion,systemCount:2}));
 assert.deepEqual(plans.map(p=>p.annualPerSystemCents),[19900,27900,34900]);
 assert.deepEqual(plans.map(p=>p.repairDiscountPercent),[5,10,15]);
 assert.deepEqual(plans.map(p=>p.annualTotalCents),[39800,55800,69800]);
 for(const p of plans){assert.equal(p.status,"draft");assert.equal(p.enrollmentAvailable,false);assert.equal(p.visitsPerYear,2);assert.match(p.excludedFilterSupply,/Four-inch and five-inch/);}
 assert.equal(plans[0].suppliedOneInchFiltersPerVisitPerSystem,0);
 for(const p of plans.slice(1)){assert.equal(p.suppliedOneInchFiltersPerVisitPerSystem,1);assert.equal(p.diagnosticWaiversPerYear,1);assert.equal(p.diagnosticWaiverAmountCents,9900);assert.match(p.diagnosticWaiverScope,/Business hours/);}
});
test("intake snapshots valid inquiry selections and rejects tampering",()=>{
 const original={other:"preserved",crownCare:{tier:"silver",catalogVersion:crownCatalogVersion,systemCount:2}};
 const result=crownInquiryMetadata(original)!;
 assert.equal(result.other,"preserved");assert.equal(result.crownCare.intent,"inquiry");assert.equal(result.crownCare.annualTotalCents,55800);
 assert.equal((original.crownCare as any).intent,undefined);
 for(const patch of [{tier:"platinum"},{catalogVersion:"old"},{systemCount:0},{systemCount:1.5},{systemCount:101},{annualTotalCents:0},{status:"active"}])assert.throws(()=>crownInquiryMetadata({crownCare:{...original.crownCare,...patch}}));
 assert.equal(crownInquiryMetadata(undefined),undefined);const generic={campaign:"a"};assert.equal(crownInquiryMetadata(generic),generic);
});
test("draft tier round trips separately without repricing legacy agreement",()=>{
 const draftTier=crownTierSnapshot({tier:"gold",catalogVersion:crownCatalogVersion,systemCount:3});
 const member={draftTier,pricing:{baseAmountCents:23500,totalAmountCents:23500},systemDescription:"Legacy coverage"};
 const config=configurationFor(member);assert.equal(crownConfiguration.safeParse(config).success,true);
 assert.deepEqual(config.draftTier,{tier:"gold",catalogVersion:crownCatalogVersion,systemCount:3});
 assert.equal(membershipPriceCents(member),23500);assert.equal(configurationFor({}).draftTier,undefined);
});
