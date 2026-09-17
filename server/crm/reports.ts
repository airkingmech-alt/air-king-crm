import type { Express } from "express";
import { caller,db,result } from "./core";
import { receiptsThisMonth } from "../../shared/dashboard";
export function registerReports(app:Express){
  app.get('/api/crm/reports/receipts',async(req,res)=>{
    res.set('Cache-Control','no-store');
    try{
      const user=await caller(req);const payments:any[]=[];
      for(let start=0;;start+=500){const page=await result(db().from('payments').select('amount_cents,paid_at,method').eq('company_id',user.company).order('id').range(start,start+499));payments.push(...page);if(page.length<500)break;}
      res.json({monthToDateCents:receiptsThisMonth(payments),timezone:'America/Chicago',historicalExcluded:true});
    }catch(e:any){res.status(e.status || 400).json({error:e.message});}
  });
}
