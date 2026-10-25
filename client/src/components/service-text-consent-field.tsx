import {Checkbox} from '@/components/ui/checkbox';
export function ServiceTextConsentField({checked,onChange}:{checked:boolean;onChange:(value:boolean)=>void}) {
  return <label className="flex items-start gap-3 rounded-md border p-3 text-sm">
    <Checkbox className="mt-0.5" checked={checked} onCheckedChange={value=>onChange(value===true)} aria-label="Customer agreed to service texts"/>
    <span><span className="block font-medium">Customer agreed to receive quotes, appointment updates, and invoice texts.</span>
      <span className="block text-muted-foreground mt-1">Check only when the customer has agreed. Marketing texts stay separate.</span></span>
  </label>;
}
