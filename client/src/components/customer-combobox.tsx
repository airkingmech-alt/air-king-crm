import { useState } from "react";
import { ChevronDown, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useData } from "@/context/data-context";
import type { Customer } from "@/data/mock-data";

interface CustomerComboboxProps {
  value: string;
  onChange: (customerId: string) => void;
  placeholder?: string;
  testId?: string;
  allowCreate?: boolean;
}

export function CustomerCombobox({
  value,
  onChange,
  placeholder = "Type to search all customers...",
  testId = "select-customer",
  allowCreate = true,
}: CustomerComboboxProps) {
  const { toast } = useToast();
  const { customers, addCustomer } = useData();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [showNewForm, setShowNewForm] = useState(false);
  const [newCustomer, setNewCustomer] = useState({
    name: "",
    type: "Residential" as "Residential" | "Commercial",
    phone: "",
    email: "",
    address: "",
    city: "Kansas City",
    state: "MO",
    zip: "",
    leadSource: "Google Ads",
  });

  const selected = customers.find((c) => c.id === value);
  const filtered = customers.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.contacts[0]?.phone || "").includes(search) ||
    (c.properties[0]?.address || "").toLowerCase().includes(search.toLowerCase())
  );
  const exactMatch = customers.find((c) => c.name.toLowerCase() === search.trim().toLowerCase());
  const canAddNew = allowCreate && search.trim().length > 0 && !exactMatch;

  const handleSelect = (customerId: string) => {
    const c = customers.find((x) => x.id === customerId);
    onChange(customerId);
    setSearch(c?.name || "");
    setOpen(false);
    setShowNewForm(false);
  };

  const handleAddNew = (e: React.SyntheticEvent) => {
    e.preventDefault();
    const name = newCustomer.name.trim() || search.trim();
    if (!name) {
      toast({ title: "Missing name", description: "Please enter a customer name.", variant: "destructive" });
      return;
    }
    const created = addCustomer({
      name,
      type: newCustomer.type,
      phone: newCustomer.phone,
      email: newCustomer.email,
      address: newCustomer.address,
      city: newCustomer.city,
      state: newCustomer.state,
      zip: newCustomer.zip,
      leadSource: newCustomer.leadSource,
    });
    onChange(created.id);
    setSearch(created.name);
    setShowNewForm(false);
    setNewCustomer({ name: "", type: "Residential", phone: "", email: "", address: "", city: "Kansas City", state: "MO", zip: "", leadSource: "Google Ads" });
    setOpen(false);
    toast({ title: "Customer added", description: `${created.name} has been added and selected.` });
  };

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            data-testid={testId}
            className="w-full justify-between font-normal h-auto py-2"
            onClick={() => setOpen(true)}
          >
            {selected ? (
              <span className="flex flex-col items-start gap-0.5">
                <span className="font-medium">{selected.name}</span>
                <span className="text-xs text-muted-foreground">
                  {selected.properties[0]?.address || ""}{selected.properties[0]?.city ? ", " + selected.properties[0].city : ""}
                </span>
              </span>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
            <ChevronDown size={16} className="opacity-50 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="Search by name, phone, or address..."
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              <CommandEmpty>
                {canAddNew ? "No match — create a new customer below." : "No customers found."}
              </CommandEmpty>
              <CommandGroup heading="Customers">
                {filtered.slice(0, 50).map((c) => (
                  <CommandItem
                    key={c.id}
                    value={c.id}
                    onSelect={() => handleSelect(c.id)}
                    data-testid={`option-customer-${c.id}`}
                  >
                    <div className="flex flex-col">
                      <span>{c.name}</span>
                      <span className="text-xs text-muted-foreground">{c.contacts[0]?.phone || ""} · {c.properties[0]?.address || ""}</span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
              {canAddNew && (
                <CommandGroup heading="New">
                  <CommandItem
                    value={`new-${search}`}
                    onSelect={() => {
                      setNewCustomer({ ...newCustomer, name: search.trim() });
                      setShowNewForm(true);
                      setOpen(false);
                    }}
                    data-testid="option-add-new-customer"
                  >
                    <UserPlus size={14} className="mr-2" />
                    Add new customer: "{search.trim()}"
                  </CommandItem>
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {showNewForm && (
        <div className="rounded-lg border border-primary/30 bg-muted/30 p-3 space-y-3" data-testid="new-customer-form">
          <p className="text-xs font-medium flex items-center gap-1.5">
            <UserPlus size={14} /> New Customer
          </p>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Name *</Label>
                <Input
                  value={newCustomer.name}
                  onChange={(e) => setNewCustomer({ ...newCustomer, name: e.target.value })}
                  placeholder="Full name"
                  data-testid="input-new-customer-name"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Phone</Label>
                <Input
                  value={newCustomer.phone}
                  onChange={(e) => setNewCustomer({ ...newCustomer, phone: e.target.value })}
                  placeholder="(816) 555-0000"
                  data-testid="input-new-customer-phone"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Email</Label>
                <Input
                  type="email"
                  value={newCustomer.email}
                  onChange={(e) => setNewCustomer({ ...newCustomer, email: e.target.value })}
                  placeholder="email@example.com"
                  data-testid="input-new-customer-email"
                />
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Address</Label>
                <Input
                  value={newCustomer.address}
                  onChange={(e) => setNewCustomer({ ...newCustomer, address: e.target.value })}
                  placeholder="Street address"
                  data-testid="input-new-customer-address"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">City</Label>
                <Input
                  value={newCustomer.city}
                  onChange={(e) => setNewCustomer({ ...newCustomer, city: e.target.value })}
                  data-testid="input-new-customer-city"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">ZIP</Label>
                <Input
                  value={newCustomer.zip}
                  onChange={(e) => setNewCustomer({ ...newCustomer, zip: e.target.value })}
                  placeholder="64100"
                  data-testid="input-new-customer-zip"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowNewForm(false)}>
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={handleAddNew} data-testid="button-submit-new-customer">
                Create & Select
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
