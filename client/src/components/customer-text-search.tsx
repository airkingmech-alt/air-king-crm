import {useState} from 'react';
import {useData} from '@/context/data-context';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {matchesCustomerSearch} from '../../../shared/customer-search';

export function CustomerTextSearch({value,onChange}:{value:string;onChange:(id:string)=>void}) {
  const {customers,loading,loadError}=useData();
  const [search,setSearch]=useState('');
  const matches=customers.filter(c=>matchesCustomerSearch(c,search));
  return <div className="space-y-2">
    <Label htmlFor="text-customer-search">Find a customer</Label>
    <Input id="text-customer-search" data-testid="text-new-customer" type="search" autoFocus value={search}
      placeholder="Search name, phone, email, or address" onChange={e=>{setSearch(e.target.value);onChange('');}}/>
    {loading && <p role="status" className="text-sm">Loading customers…</p>}
    {loadError && <p role="alert" className="text-sm text-red-700">{loadError}</p>}
    {!value && <>
      {!loading&&!matches.length&&<p role="status" className="text-sm">No matching customers. Try another name or phone number.</p>}
      <ul aria-label="Customer search results" className="max-h-64 overflow-y-auto divide-y rounded-md border">
        {matches.slice(0,20).map(customer=>{
          const contact=customer.contacts.find(c=>c.role==='Primary') || customer.contacts[0];
          return <li key={customer.id}><button type="button" data-testid={`option-customer-${customer.id}`}
            className="block w-full p-3 text-left hover:bg-muted focus-visible:outline focus-visible:outline-2"
            onClick={()=>{setSearch(customer.name);onChange(customer.id);}}>
            <span className="block font-medium">{customer.name}</span>
            <span className="block text-sm text-muted-foreground">{contact?.phone || 'No primary phone'} · {customer.properties[0]?.address || customer.id}</span>
          </button></li>;
        })}
      </ul>
      {matches.length>20&&<p className="text-xs text-muted-foreground">Showing 20 of {matches.length} matches. Keep typing to narrow the list.</p>}
    </>}
  </div>;
}
