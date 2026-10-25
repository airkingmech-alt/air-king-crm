export async function recordNewCustomerConsent(
  customerId:string, confirmed:boolean|undefined,
  request:(path:string,method:string,body:unknown)=>Promise<unknown>,
):Promise<string|undefined> {
  if(!confirmed)return;
  try {
    await request(`crm/customers/${customerId}/service-text-consent`,'POST',{confirmed:true});
  } catch {
    return 'Customer saved, but service-text permission could not be confirmed. Open the customer’s communication preferences to review it before texting.';
  }
}
