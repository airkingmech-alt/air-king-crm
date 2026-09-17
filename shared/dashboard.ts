import { membershipPriceCents } from "./crown-care";
export const businessDay=(date:Date)=>new Intl.DateTimeFormat("en-CA",{timeZone:"America/Chicago",year:"numeric",month:"2-digit",day:"2-digit"}).format(date);
export function receiptsThisMonth(payments:any[],now=new Date()){
  const month=businessDay(now).slice(0,7);
  return payments.reduce((total,p)=>{
    const date=new Date(p.paid_at);
    return p.method!=="Historical" && Number.isFinite(+date) && date<=now && businessDay(date).startsWith(month)
      ? total+Number(p.amount_cents || 0) : total;
  },0);
}
export function membershipSummary(memberships:any[]){
  const active=memberships.filter(m=>m.status==="Active");
  return {annualCents:active.reduce((n,m)=>n+membershipPriceCents(m)*(m.billingFrequency==="Monthly"?12:1),0),unbooked:active.reduce((n,m)=>n+[m.springVisit,m.fallVisit].filter(v=>v?.status==="Unscheduled").length,0)};
}
