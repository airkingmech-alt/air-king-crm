import { useState } from "react";
import { Link } from "wouter";
import { Search, Plus, Building2, Home, Phone, Mail, MapPin } from "lucide-react";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useData } from "@/context/data-context";

const leadStatusColors: Record<string, string> = {
  New: "bg-sky-100 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400",
  Contacted: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-400",
  Appointment: "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400",
  "Quote Sent": "bg-purple-100 text-purple-700 dark:bg-purple-950/30 dark:text-purple-400",
  Won: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400",
  Lost: "bg-rose-100 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400",
};

export default function Customers() {
  const { toast } = useToast();
  const { customers, addCustomer } = useData();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"All" | "Residential" | "Commercial">("All");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [form, setForm] = useState({
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

  const filtered = customers.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.contacts.some((cnt) => cnt.phone.includes(search) || cnt.email.toLowerCase().includes(search.toLowerCase())) ||
      c.properties.some((p) => p.address.toLowerCase().includes(search.toLowerCase()) || p.city.toLowerCase().includes(search.toLowerCase()));
    const matchesFilter = filter === "All" || c.type === filter;
    return matchesSearch && matchesFilter;
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast({ title: "Missing name", description: "Please enter a customer name.", variant: "destructive" });
      return;
    }
    addCustomer(form);
    toast({
      title: "Customer added",
      description: `${form.name} has been added as a ${form.type.toLowerCase()} customer.`,
    });
    setShowAddDialog(false);
    setForm({ name: "", type: "Residential", phone: "", email: "", address: "", city: "Kansas City", state: "MO", zip: "", leadSource: "Google Ads" });
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Customers</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{customers.length} total · {customers.filter(c => c.type === "Residential").length} residential · {customers.filter(c => c.type === "Commercial").length} commercial</p>
        </div>
        <Button size="sm" className="bg-primary text-primary-foreground" onClick={() => setShowAddDialog(true)} data-testid="button-add-customer">
          <Plus size={16} className="mr-1.5" />
          Add Customer
        </Button>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name, phone, email, or address..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1.5">
          {(["All", "Residential", "Commercial"] as const).map((f) => (
            <Button
              key={f}
              variant={filter === f ? "default" : "outline"}
              size="sm"
              onClick={() => setFilter(f)}
            >
              {f}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((customer) => (
          <Link key={customer.id} href={`/customers/${customer.id}`}>
            <Card className="hover:shadow-md transition-shadow cursor-pointer border-border h-full">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className={`flex h-11 w-11 items-center justify-center rounded-full text-sm font-bold shrink-0 ${
                    customer.type === "Commercial"
                      ? "bg-purple-100 text-purple-700 dark:bg-purple-950/30 dark:text-purple-400"
                      : "bg-sky-100 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400"
                  }`}>
                    {customer.type === "Commercial" ? <Building2 size={18} /> : <Home size={18} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">{customer.name}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {customer.properties[0]?.address}, {customer.properties[0]?.city}, {customer.properties[0]?.state}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${leadStatusColors[customer.leadStatus]}`}>
                        {customer.leadStatus}
                      </span>
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground">
                        {customer.type}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-3 pt-3 border-t border-border">
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Phone size={12} />
                    {customer.contacts[0]?.phone}
                  </div>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground truncate">
                    <MapPin size={12} />
                    {customer.properties[0]?.city}
                  </div>
                </div>
                {customer.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {customer.tags.map((tag) => (
                      <Badge key={tag} variant="outline" className="text-[10px] py-0">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12">
          <p className="text-sm text-muted-foreground">No customers found matching your search.</p>
        </div>
      )}

      {/* Add Customer Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Add New Customer</DialogTitle>
            <DialogDescription>Create a new customer record. Fields marked with * are required.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="cust-name">Customer Name *</Label>
              <Input
                id="cust-name"
                placeholder="e.g. John & Mary Smith"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                data-testid="input-customer-name"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Customer Type</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as "Residential" | "Commercial" })}>
                  <SelectTrigger data-testid="select-customer-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Residential">Residential</SelectItem>
                    <SelectItem value="Commercial">Commercial</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Lead Source</Label>
                <Select value={form.leadSource} onValueChange={(v) => setForm({ ...form, leadSource: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Google Ads">Google Ads</SelectItem>
                    <SelectItem value="Referral">Referral</SelectItem>
                    <SelectItem value="Walk-in">Walk-in</SelectItem>
                    <SelectItem value="Angi">Angi</SelectItem>
                    <SelectItem value="Repeat Customer">Repeat Customer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="cust-phone">Phone</Label>
                <Input
                  id="cust-phone"
                  placeholder="(816) 555-0000"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cust-email">Email</Label>
                <Input
                  id="cust-email"
                  type="email"
                  placeholder="name@email.com"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="cust-address">Service Address</Label>
              <Input
                id="cust-address"
                placeholder="123 Main St"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label htmlFor="cust-city">City</Label>
                <Input
                  id="cust-city"
                  value={form.city}
                  onChange={(e) => setForm({ ...form, city: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>State</Label>
                <Select value={form.state} onValueChange={(v) => setForm({ ...form, state: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MO">MO</SelectItem>
                    <SelectItem value="KS">KS</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cust-zip">Zip</Label>
                <Input
                  id="cust-zip"
                  placeholder="64118"
                  value={form.zip}
                  onChange={(e) => setForm({ ...form, zip: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setShowAddDialog(false)}>Cancel</Button>
              <Button type="submit" data-testid="button-submit-customer">Add Customer</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
