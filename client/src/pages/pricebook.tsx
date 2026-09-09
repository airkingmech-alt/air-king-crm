import { useState } from "react";
import { Search, Filter, DollarSign } from "lucide-react";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { pricebook, type EquipmentCategory, type Brand } from "@/data/pricebook";
import { fmtCurrency } from "@/data/mock-data";

const categories: ("All" | EquipmentCategory)[] = [
  "All", "Heat Pump", "Condenser", "Air Handler", "Evaporator Coil", "Furnace", "Heat Strip", "Accessory",
];

const brands: ("All" | Brand)[] = ["All", "Champion", "Guardian"];

export default function Pricebook() {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"All" | EquipmentCategory>("All");
  const [brandFilter, setBrandFilter] = useState<"All" | Brand>("All");

  const filtered = pricebook.filter((item) => {
    const matchesSearch =
      item.model.toLowerCase().includes(search.toLowerCase()) ||
      item.description.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = categoryFilter === "All" || item.category === categoryFilter;
    const matchesBrand = brandFilter === "All" || item.brand === brandFilter;
    return matchesSearch && matchesCategory && matchesBrand;
  });

  const brandColors: Record<Brand, string> = {
    Champion: "bg-orange-100 text-orange-700 dark:bg-orange-950/30 dark:text-orange-400",
    Guardian: "bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400",
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Pricebook</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {pricebook.length} items · Champion & Guardian equipment from Kearney Winsupply
        </p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search model number or description..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {brands.map((b) => (
            <Button
              key={b}
              variant={brandFilter === b ? "default" : "outline"}
              size="sm"
              onClick={() => setBrandFilter(b)}
            >
              {b}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {categories.map((cat) => (
          <Button
            key={cat}
            variant={categoryFilter === cat ? "default" : "outline"}
            size="sm"
            onClick={() => setCategoryFilter(cat)}
            className="text-xs"
          >
            {cat}
          </Button>
        ))}
      </div>

      {/* Items */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map((item) => (
          <Card key={item.id} className="hover:shadow-md transition-shadow border-border">
            <CardContent className="p-4">
              <div className="flex items-start justify-between gap-2 mb-2">
                <Badge variant="outline" className={`text-[10px] ${brandColors[item.brand]}`}>
                  {item.brand}
                </Badge>
                {item.tier && (
                  <Badge variant="outline" className="text-[10px]">{item.tier}</Badge>
                )}
              </div>
              <p className="text-sm font-semibold font-mono tracking-tight">{item.model}</p>
              <p className="text-xs text-muted-foreground mt-1">{item.description}</p>
              <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
                <div className="flex items-center gap-1.5">
                  {item.tonnage && (
                    <span className="text-xs text-muted-foreground">{item.tonnage} ton</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <DollarSign size={14} className="text-muted-foreground" />
                  <span className="text-sm font-semibold">{fmtCurrency(item.cost)}</span>
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground/60 mt-1">Internal cost · not customer-facing</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12">
          <Filter size={32} className="mx-auto text-muted-foreground/40 mb-2" />
          <p className="text-sm text-muted-foreground">No equipment found matching your filters.</p>
        </div>
      )}
    </div>
  );
}
