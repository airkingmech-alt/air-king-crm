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

test("published enrollment requires complete selection and trusted explicitly-versioned catalog",async()=>{
 const {defaultCrownCatalog,crownEnrollmentSelection,crownEnrollmentSnapshot,currentCrownInquiryMetadata,publicCrownCatalog}=await import("../shared/crown-tiers");
 const selection={tier:"gold" as const,catalogVersion:defaultCrownCatalog.version,systemCount:2};
 const plan=crownEnrollmentSnapshot(selection,defaultCrownCatalog);
 assert.equal(plan.status,"published");assert.equal(plan.enrollmentAvailable,true);assert.equal(plan.annualTotalCents,69800);
 assert.equal(plan.repairDiscountPercent,15);assert.equal(plan.diagnosticWaiverAmountCents,9900);
 assert.equal(crownEnrollmentSelection.safeParse({...selection,systemCount:undefined}).success,false);
 assert.equal(crownEnrollmentSelection.safeParse({...selection,annualTotalCents:1}).success,false);
 assert.throws(()=>crownEnrollmentSnapshot({...selection,catalogVersion:crownCatalogVersion},defaultCrownCatalog),(e:any)=>e.status===409&&e.code==="CROWN_CATALOG_STALE");
 const edited=structuredClone(defaultCrownCatalog);edited.version="next-version";edited.tiers.gold.annualPerSystemCents=39900;
 assert.equal(crownEnrollmentSnapshot({...selection,catalogVersion:edited.version},edited).annualTotalCents,79800);
 assert.equal(plan.annualTotalCents,69800);assert.equal(defaultCrownCatalog.tiers.gold.annualPerSystemCents,34900);
 const inquiry=currentCrownInquiryMetadata({campaign:"keep",crownCare:{tier:"bronze",catalogVersion:edited.version}},edited)!;
 assert.equal(inquiry.campaign,"keep");assert.equal(inquiry.crownCare.intent,"inquiry");assert.equal(inquiry.crownCare.annualTotalCents,null);assert.equal(inquiry.crownCare.enrollmentAvailable,false);
 const publicCatalog=publicCrownCatalog(edited);assert.equal(publicCatalog.catalogVersion,edited.version);
 assert.equal(publicCatalog.plans[0].diagnosticWaiver,"");assert.equal(publicCatalog.plans[2].annualPrice,399);
 assert.equal(publicCatalog.plans[2].diagnosticWaiver,"One $99 business-hours diagnostic fee waived per year");
});
