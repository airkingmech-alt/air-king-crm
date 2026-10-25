type SearchableCustomer = {
  id:string; name?:string; companyName?:string;
  contacts?:Array<{name?:string;phone?:string;email?:string;phoneNumbers?:Array<{value:string}>}>;
  properties?:Array<{address?:string;street?:string;city?:string;state?:string;zip?:string}>;
};
export function matchesCustomerSearch(customer:SearchableCustomer, search:string) {
  const query=search.trim().toLowerCase();
  if(!query)return true;
  const contacts=customer.contacts || [], properties=customer.properties || [];
  const text=[customer.id,customer.name,customer.companyName,
    ...contacts.flatMap(c=>[c.name,c.email,c.phone,...(c.phoneNumbers || []).map(p=>p.value)]),
    ...properties.flatMap(p=>[p.address,p.street,p.city,p.state,p.zip])].filter(Boolean).join(' ').toLowerCase();
  if(query.split(/\s+/).every(term=>text.includes(term)))return true;
  const digits=query.replace(/\D/g,'');
  return /^[+\d\s().-]+$/.test(query) && digits.length>=3 && contacts.some(c=>
    [c.phone,...(c.phoneNumbers || []).map(p=>p.value)].some(p=>(p || '').replace(/\D/g,'').includes(digits)));
}
