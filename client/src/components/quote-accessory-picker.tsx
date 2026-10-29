import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/context/auth-context';
import { fetchCatalogItems } from '@/lib/catalog-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { fmtCurrencyExact } from '@/data/mock-data';
import { matchesCatalogSearch } from '@shared/pricebook-catalog';
import { accessoryAvailable, accessoryCatalog, accessoryGroup, accessoryGroups, snapshotAccessory, type QuoteAccessory } from '@shared/quote-accessories';

export function QuoteAccessoryPicker({ value, onChange, optionNumber }: {
  value: QuoteAccessory[]; onChange: (items: QuoteAccessory[]) => void; optionNumber: number;
}) {
  const { profile } = useAuth();
  const [search, setSearch] = useState('');
  const catalog = useQuery({ queryKey: ['price-book', profile?.company_id], enabled: !!profile?.company_id,
    queryFn: () => fetchCatalogItems(profile!.company_id) });
  const items = accessoryCatalog(catalog.data || []);
  return <fieldset className="space-y-3 rounded-lg border p-3"><legend className="px-1 text-sm font-semibold">Installation accessories — option {optionNumber}</legend>
    <p className="text-xs text-muted-foreground">Select only what this option needs. Part costs receive the normal purchase-tax allowance and margin; installed services use their pricebook selling price. Include additional installation labor in Labor cost.</p>
    <Label className="block">Search accessories<Input className="mt-1" value={search} onChange={e => setSearch(e.target.value)} placeholder="Whip, disconnect, surge protector, thermostat…" /></Label>
    {catalog.isLoading && <p role="status">Loading pricebook accessories…</p>}
    {catalog.isError && <p role="alert">Could not load the pricebook. <Button type="button" variant="outline" size="sm" onClick={() => catalog.refetch()}>Retry</Button></p>}
    {!profile?.company_id && <p role="alert">A company profile is required to load accessory prices.</p>}
    {catalog.isSuccess && accessoryGroups.map(group => {
      const all = items.filter(item => accessoryGroup(item) === group);
      const shown = all.filter(item => matchesCatalogSearch(item, search));
      if (search && !shown.length && !group.pattern.test(search) && !group.name.toLowerCase().includes(search.toLowerCase())) return null;
      return <div key={group.name} className="space-y-1">
        <Label className="block">{group.name}
          <select className="mt-1 w-full min-w-0 rounded-md border bg-background p-2 text-sm" aria-label={`Option ${optionNumber} add ${group.name}`} value="" disabled={!shown.length} onChange={e => {
            const item = items.find(item => item.id === e.target.value);
            if (item) onChange([...value, snapshotAccessory(item)]);
          }}>
            <option value="">{all.length ? 'Choose accessory…' : 'Missing from pricebook — price required'}</option>
            {shown.map(item => <option key={item.id} value={item.id} disabled={!accessoryAvailable(item) || value.some(selected => selected.pricebookId === item.id || (selected.review === group.review && selected.pricing !== (item.item_type === 'service' ? 'installed-service' : 'material')))}>
              {item.name} {item.sku ? ` · ${item.sku}` : ''} — {accessoryAvailable(item) ? `${fmtCurrencyExact((item.item_type === 'service' ? item.price_cents : item.cost_cents) / 100)} / ${item.unit} ${item.item_type === 'service' ? 'installed price' : 'cost'}` : 'Price / unit needs confirmation'}
            </option>)}
          </select>
        </Label>
        <p className="text-xs text-muted-foreground">{group.review}</p>
      </div>;
    })}
    <ul className="space-y-2" aria-label={`Option ${optionNumber} accessories`}>{value.map((item, index) => <li key={item.pricebookId} className="rounded border p-2 space-y-2 text-sm">
      <p className="font-medium">{item.name}{item.sku ? ` · ${item.sku}` : ''}</p>
      <p>{fmtCurrencyExact((item.pricing === 'installed-service' ? item.unitPriceCents : item.unitCostCents) / 100)} / {item.unit} {item.pricing === 'installed-service' ? 'installed price' : 'supplier cost'} — saved quote price</p>
      {item.pricing === 'installed-service' && item.unitCostCents === 0 && <p className="text-amber-700">Internal service cost is missing in the pricebook. Review labor and materials allowances; the displayed internal total is incomplete.</p>}
      <div className="flex items-center gap-2"><Label>Quantity<Input aria-label={`Option ${optionNumber} ${item.name} quantity`} type="number" min="1" max="1000" step="1" className="w-24" value={item.quantity} onChange={e => onChange(value.map((entry, i) => i === index ? {...entry, quantity: Number(e.target.value)} : entry))} /></Label>
        <Button type="button" size="sm" variant="outline" onClick={() => onChange(value.filter((_, i) => i !== index))}>Remove</Button></div>
    </li>)}</ul>
  </fieldset>;
}
