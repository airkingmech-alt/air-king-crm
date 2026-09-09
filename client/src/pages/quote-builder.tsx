import { useState } from "react";
import { Link } from "wouter";
import {
  FileText,
  Plus,
  ArrowLeft,
  Search,
  Check,
  Crown,
  Sparkles,
  TrendingUp,
  X,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { fmtCurrency } from "@/data/mock-data";
import { CustomerCombobox } from "@/components/customer-combobox";
import { useData } from "@/context/data-context";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { pricebook, addOnServices } from "@/data/pricebook";

export default function Quotes() {
  const { quotes, createQuote, customers } = useData();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [showBuilder, setShowBuilder] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [selectedEquipment, setSelectedEquipment] = useState<string[]>([]);
  const [selectedAddOns, setSelectedAddOns] = useState<string[]>([]);
  const [laborCost, setLaborCost] = useState("1200");
  const [laborDesc, setLaborDesc] = useState("Remove old equipment, install new system, reconnect electrical and refrigerant lines");
  const [materialsCost, setMaterialsCost] = useState("450");
  const [eqDropdown, setEqDropdown] = useState("");
  const [eqSearch, setEqSearch] = useState("");
  const [eqFilter, setEqFilter] = useState("All");

  const toggleEquipment = (id: string) => {
    setSelectedEquipment((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleAddOn = (id: string) => {
    setSelectedAddOns((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const selectedItems = pricebook.filter((p) => selectedEquipment.includes(p.id));
  const equipmentCost = selectedItems.reduce((sum, item) => sum + item.cost, 0);
  const labor = parseFloat(laborCost) || 0;
  const materials = parseFloat(materialsCost) || 0;
  const totalCost = equipmentCost + labor + materials;
  // Air King pricing formula: total cost ÷ 0.75
  const customerPrice = Math.round(totalCost / 0.75);
  const grossProfit = customerPrice - totalCost;
  const margin = ((grossProfit / customerPrice) * 100).toFixed(1);

  const categories = ["All", "Heat Pump", "Condenser", "Air Handler", "Evaporator Coil", "Furnace", "Heat Strip", "Accessory"];
  const filteredEquipment = pricebook.filter((p) => {
    const matchesSearch = !eqSearch || p.model.toLowerCase().includes(eqSearch.toLowerCase()) || p.description.toLowerCase().includes(eqSearch.toLowerCase());
    const matchesFilter = eqFilter === "All" || p.category === eqFilter;
    return matchesSearch && matchesFilter;
  });

  if (showBuilder) {
    return (
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
        <Button variant="ghost" size="sm" onClick={() => setShowBuilder(false)}>
          <ArrowLeft size={16} className="mr-1.5" /> Back to Quotes
        </Button>

        <div>
          <h1 className="text-xl font-bold tracking-tight">New Quote</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Build a Good/Better/Best proposal</p>
        </div>

        {/* Customer Selection */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">1. Select Customer</CardTitle>
          </CardHeader>
          <CardContent>
            <CustomerCombobox
              value={selectedCustomer}
              onChange={setSelectedCustomer}
              testId="select-quote-customer"
            />
          </CardContent>
        </Card>

        {/* Equipment Selection */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">2. Select Equipment</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Equipment Dropdown */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold">Select Equipment</Label>
              <Select
                value={eqDropdown}
                onValueChange={(val) => {
                  if (!selectedEquipment.includes(val)) {
                    setSelectedEquipment((prev) => [...prev, val]);
                  }
                  setEqDropdown("");
                }}
              >
                <SelectTrigger className="h-9 text-sm" data-testid="select-equipment-dropdown">
                  <SelectValue placeholder="Browse and select equipment..." />
                </SelectTrigger>
                <SelectContent className="max-h-[300px]">
                  {categories.filter(c => c !== "All").map((cat) => (
                    <div key={cat}>
                      <p className="text-[10px] font-bold text-muted-foreground px-2 py-1 uppercase tracking-wide">{cat}</p>
                      {pricebook.filter(p => p.category === cat).map((item) => (
                        <SelectItem key={item.id} value={item.id} className="text-xs">
                          {item.model} — {fmtCurrency(item.cost)}
                        </SelectItem>
                      ))}
                    </div>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Selected items */}
            {selectedItems.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selectedItems.map((item) => (
                  <Badge key={item.id} variant="secondary" className="text-[10px] gap-1 pr-1">
                    {item.model}
                    <button onClick={() => toggleEquipment(item.id)} className="hover:text-destructive">
                      <X size={10} />
                    </button>
                  </Badge>
                ))}
              </div>
            )}

            {/* Search + filter */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative flex-1 min-w-[180px]">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search model or description..."
                  value={eqSearch}
                  onChange={(e) => setEqSearch(e.target.value)}
                  className="pl-9 h-9 text-sm"
                />
              </div>
              <Select value={eqFilter} onValueChange={setEqFilter}>
                <SelectTrigger className="w-[140px] h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Equipment list */}
            <div className="max-h-[300px] overflow-y-auto space-y-1 rounded-lg border border-border p-1">
              {filteredEquipment.slice(0, 50).map((item) => {
                const selected = selectedEquipment.includes(item.id);
                return (
                  <button
                    key={item.id}
                    onClick={() => toggleEquipment(item.id)}
                    className={`w-full text-left p-2 rounded-md transition-colors flex items-center gap-2 ${
                      selected ? "bg-primary/10 border border-primary/30" : "hover:bg-muted/50 border border-transparent"
                    }`}
                  >
                    <div className={`flex h-4 w-4 items-center justify-center rounded shrink-0 ${
                      selected ? "bg-primary text-primary-foreground" : "border border-border"
                    }`}>
                      {selected && <Check size={12} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold truncate">{item.model}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{item.description}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-medium">{fmtCurrency(item.cost)}</p>
                      <p className="text-[9px] text-muted-foreground">{item.brand}</p>
                    </div>
                  </button>
                );
              })}
              {filteredEquipment.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">No equipment found.</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Labor & Materials */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">3. Labor & Materials</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="labor" className="text-xs">Labor Cost</Label>
                <Input
                  id="labor"
                  type="number"
                  value={laborCost}
                  onChange={(e) => setLaborCost(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="materials" className="text-xs">Materials Cost</Label>
                <Input
                  id="materials"
                  type="number"
                  value={materialsCost}
                  onChange={(e) => setMaterialsCost(e.target.value)}
                  className="mt-1"
                />
              </div>
            </div>
            <div className="mt-3">
              <Label htmlFor="labor-desc" className="text-xs">Labor Description</Label>
              <Textarea
                id="labor-desc"
                value={laborDesc}
                onChange={(e) => setLaborDesc(e.target.value)}
                rows={2}
                className="mt-1 text-sm"
                placeholder="Describe the labor being performed..."
              />
            </div>
          </CardContent>
        </Card>

        {/* Add-ons */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">4. Customer Add-On Options</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {addOnServices.map((addon) => {
                const selected = selectedAddOns.includes(addon.id);
                return (
                  <button
                    key={addon.id}
                    onClick={() => toggleAddOn(addon.id)}
                    className={`flex items-start gap-2 p-3 rounded-lg border text-left transition-colors ${
                      selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <div className={`flex h-5 w-5 items-center justify-center rounded border shrink-0 mt-0.5 ${
                      selected ? "bg-primary border-primary text-primary-foreground" : "border-border"
                    }`}>
                      {selected && <Check size={12} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium">{addon.name}</p>
                      <p className="text-[10px] text-muted-foreground">{addon.description}</p>
                      <p className="text-xs font-semibold mt-0.5">{fmtCurrency(addon.price)}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Pricing Summary */}
        <Card className="bg-primary/5 border-primary/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Sparkles size={16} className="text-primary" />
              Pricing Summary
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Equipment Cost</span>
              <span className="font-medium">{fmtCurrency(equipmentCost)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Labor</span>
              <span className="font-medium">{fmtCurrency(labor)}</span>
            </div>
            {laborDesc && (
              <p className="text-[10px] text-muted-foreground/70 pl-2">{laborDesc}</p>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Materials</span>
              <span className="font-medium">{fmtCurrency(materials)}</span>
            </div>
            <Separator className="my-2" />
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Total Internal Cost</span>
              <span className="font-medium">{fmtCurrency(totalCost)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Customer Price (÷ 0.75)</span>
              <span className="font-medium text-primary">{fmtCurrency(customerPrice)}</span>
            </div>
            <Separator className="my-2" />
            <div className="flex justify-between">
              <span className="text-sm font-semibold">Gross Profit</span>
              <span className="font-bold text-emerald-600">{fmtCurrency(grossProfit)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-sm font-semibold">Margin</span>
              <span className="font-bold">{margin}%</span>
            </div>
            <div className="mt-3 p-3 rounded-lg bg-yellow-50 dark:bg-yellow-950/20 text-xs text-yellow-700 dark:text-yellow-500 flex items-center gap-2">
              <Crown size={14} />
              Customer sees bundled price only. Costs and margins are internal.
            </div>
          </CardContent>
        </Card>

        <div className="flex gap-2 justify-end">
          <Button variant="outline" onClick={() => setShowBuilder(false)}>Cancel</Button>
          <Button
            className="bg-primary text-primary-foreground"
            disabled={!selectedCustomer || selectedEquipment.length === 0}
            onClick={() => {
              const customer = customers.find((c) => c.id === selectedCustomer);
              if (!customer) return;
              const truncatedDesc = laborDesc.length > 60
                ? laborDesc.substring(0, 60).replace(/\s+\S*$/, "") + "…"
                : laborDesc;
              const newQuote = createQuote({
                customerId: customer.id,
                customerName: customer.name,
                jobType: "Changeout",
                title: `${selectedItems.length} item(s) — ${truncatedDesc}`,
                totalCost,
                customerPrice,
                equipmentItems: selectedEquipment,
                laborDescription: laborDesc,
              });
              toast({ title: "Quote created", description: `${newQuote.id} generated for ${customer.name}.` });
              setShowBuilder(false);
              setLocation(`/proposals/${newQuote.id}`);
            }}
            data-testid="button-generate-quote"
          >
            <FileText size={16} className="mr-1.5" />
            Generate Good/Better/Best Proposal
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Quotes</h1>
          <p className="text-sm text-muted-foreground mt-0.5">{quotes.length} quotes · {quotes.filter(q => q.status === "Quote Sent").length} pending</p>
        </div>
        <Button size="sm" className="bg-primary text-primary-foreground" onClick={() => setShowBuilder(true)}>
          <Plus size={16} className="mr-1.5" />
          New Quote
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {quotes.map((quote) => (
          <Card key={quote.id} className="hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <p className="text-sm font-semibold">{quote.id}</p>
                    <Badge variant={quote.status === "Won" ? "default" : "secondary"} className="text-[10px]">
                      {quote.status}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">{quote.jobType}</Badge>
                  </div>
                  <p className="text-sm font-medium">{quote.customerName}</p>
                  <p className="text-xs text-muted-foreground">{quote.title}</p>
                  <p className="text-xs text-muted-foreground mt-1">Created {quote.createdAt}</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <div className="flex gap-1.5">
                    {quote.options.map((opt) => (
                      <div key={opt.tier} className="text-center">
                        <Badge
                          variant={opt.isPopular ? "default" : "outline"}
                          className="text-[10px] mb-1"
                        >
                          {opt.tier}
                          {opt.isPopular && " ★"}
                        </Badge>
                        <p className="text-xs font-semibold">{fmtCurrency(opt.customerPrice)}</p>
                      </div>
                    ))}
                  </div>
                  <Link href={`/proposals/${quote.id}`}>
                    <Button size="sm" variant="outline" className="text-xs">
                      View Proposal
                    </Button>
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
