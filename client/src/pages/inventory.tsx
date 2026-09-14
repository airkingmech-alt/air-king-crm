import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Package,
  Plus,
  Search,
  Truck,
  ArrowRightLeft,
  ClipboardCheck,
  Download,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { crm } from "@/lib/crm-api";
import { useData } from "@/context/data-context";

type Row = Record<string, any>;
const tabs = [
  "Dashboard",
  "Items",
  "Equipment",
  "Locations",
  "Shop",
  "Trucks",
  "Restock",
  "Transfers",
  "Purchase Orders",
  "Vendors",
  "Receiving",
  "Counts",
  "Inventory History",
  "Reports",
  "Settings",
];
const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    n / 100,
  );
const units = (n: any) => Number(n || 0) / 1000;
const scaled = (value: any) => {
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{1,3})?$/.test(text))
    throw new Error(
      "Use a non-negative quantity with up to three decimal places.",
    );
  const [whole, fraction = ""] = text.split(".");
  const valueUnits =
    BigInt(whole) * BigInt(1000) + BigInt(fraction.padEnd(3, "0"));
  if (valueUnits > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Quantity is too large.");
  return Number(valueUnits);
};
const scaledSigned = (value: any) => {
  const text = String(value).trim();
  const negative = text.startsWith("-");
  const valueUnits = scaled(negative ? text.slice(1) : text);
  return negative ? -valueUnits : valueUnits;
};
const inputClass = "h-10 w-full rounded-md border bg-background px-3 text-sm";
const categories = [
  "Capacitors",
  "Contactors",
  "Transformers",
  "Electrical",
  "Thermostats",
  "Controls",
  "Wire",
  "PVC",
  "Drain",
  "Refrigerant",
  "Fittings",
  "Filters",
  "Disconnects",
  "Whips",
  "Surge Protectors",
  "Pads",
  "Sheet Metal",
  "Ductwork",
  "Flex Duct",
  "Registers",
  "Grilles",
  "Installation Materials",
  "Service Parts",
  "Equipment",
  "Miscellaneous",
];
function Select({
  value,
  onChange,
  options,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  options: { id: string; name: string }[];
  label: string;
}) {
  return (
    <label className="grid gap-1 text-sm">
      <span>{label}</span>
      <select
        className={inputClass}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Choose…</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}
export default function Inventory() {
  const { workOrders, customers, invoices } = useData();
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ["inventory"],
    queryFn: () => crm("crm/inventory"),
  });
  const [tab, setTab] = useState("Dashboard"),
    [search, setSearch] = useState(""),
    [location, setLocation] = useState("");
  const [modal, setModal] = useState(""),
    [form, setForm] = useState<Row>({}),
    [lines, setLines] = useState<Row[]>([]),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const pending = useRef<{ fingerprint: string; key: string } | null>(null);
  const [selected, setSelected] = useState<Row | null>(null);
  useEffect(() => {
    const listener = () => refetch();
    window.addEventListener("crm-refresh", listener);
    return () => window.removeEventListener("crm-refresh", listener);
  }, [refetch]);
  if (isLoading) return <p className="p-8">Loading inventory…</p>;
  if (error)
    return (
      <div className="p-8 space-y-3">
        <h1 className="text-xl font-bold">Inventory is unavailable</h1>
        <p>{(error as Error).message}</p>
        <Button onClick={() => refetch()}>Try Again</Button>
      </div>
    );
  const {
    items,
    locations,
    stock,
    vendors,
    documents,
    movements,
    admin,
    staff,
    serials,
  } = data;
  const installCustomer = customers.find(
    (c) => c.id === workOrders.find((j) => j.id === form.job_id)?.customerId,
  );
  const installProperty = installCustomer?.properties.find(
    (p) => p.id === form.property_id,
  );
  const item = (id: string) =>
    items.find((r: Row) => r.id === id) || { name: "Archived item", sku: "" };
  const place = (id: string) =>
    locations.find((r: Row) => r.id === id)?.name || "Other location";
  const docLines = (id: string) =>
    data.lines.filter((r: Row) => r.document_id === id);
  const scoped = stock.filter(
    (s: Row) => !location || s.location_id === location,
  );
  const low = scoped.filter(
    (s: Row) => Number(s.on_hand) - Number(s.reserved) < Number(s.minimum),
  );
  const value = (rows: Row[]) =>
    rows.reduce(
      (sum, s) =>
        sum + units(s.on_hand) * Number(item(s.item_id).cost_cents || 0),
      0,
    );
  const match = (r: Row) =>
    JSON.stringify(r).toLowerCase().includes(search.toLowerCase());
  const field = (key: string, v: any) => setForm((f) => ({ ...f, [key]: v }));
  async function send(path: string, body: Row) {
    const fingerprint = JSON.stringify({ path, body });
    if (pending.current?.fingerprint !== fingerprint)
      pending.current = { fingerprint, key: crypto.randomUUID() };
    const r = await crm(
      "crm/inventory/" + path,
      "POST",
      body,
      pending.current.key,
    );
    pending.current = null;
    await refetch();
    return r;
  }
  async function run(fn: () => Promise<any>) {
    if (busy) return;
    setBusy(true);
    setNotice("");
    try {
      await fn();
      setNotice("Inventory saved.");
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  }
  function open(type: string, initial: Row = {}) {
    setNotice("");
    setForm({
      id: crypto.randomUUID(),
      name: "",
      sku: "",
      category: "Miscellaneous",
      type: "Shop",
      active: true,
      tracked: true,
      serialized: false,
      cost: "0",
      sale: "0",
      details: {},
      location_id:
        location ||
        locations.find((l: Row) => !l.details?.system_transit)?.id ||
        "",
      ...initial,
    });
    setLines([]);
    setModal(type);
  }
  function workflow(kind: string, initial: Row = {}, initialLines: Row[] = []) {
    open("Document", { kind, document_id: crypto.randomUUID(), ...initial });
    setLines(
      initialLines.length
        ? initialLines
        : [{ item_id: "", quantity: "1", cost: "0" }],
    );
  }
  async function save() {
    await run(async () => {
      if (["Item", "Location", "Vendor"].includes(modal)) {
        const common = {
          id: form.id,
          name: form.name,
          active: form.active,
          details: form.details,
        };
        if (modal === "Item")
          await send("items", {
            ...common,
            sku: form.sku,
            category: form.category,
            tracked: form.tracked,
            serialized: form.serialized,
            cost_cents: Math.round(Number(form.cost) * 100),
            sale_cents: Math.round(Number(form.sale) * 100),
          });
        if (modal === "Location")
          await send("locations", {
            ...common,
            type: form.type,
            assigned_to: form.assigned_to || null,
          });
        if (modal === "Vendor") await send("vendors", common);
      } else if (modal === "Policy")
        await send("policy", {
          item_id: form.item_id,
          location_id: form.location_id,
          minimum: scaled(form.minimum),
          target: scaled(form.target),
          bin: form.bin || "",
        });
      else if (modal === "Movement") {
        const quantity = scaledSigned(form.quantity);
        await send("movements", {
          lines: [
            {
              item_id: form.item_id,
              location_id: form.location_id,
              quantity_units:
                form.kind === "Job Usage" ? -Math.abs(quantity) : quantity,
              kind: form.kind,
              notes: form.notes || "",
              job_id: form.job_id || undefined,
              invoice_id: form.invoice_id || undefined,
            },
          ],
        });
      } else if (modal === "Document")
        await send("workflow", {
          action: "create",
          document_id: form.document_id,
          kind: form.kind,
          location_id: form.location_id,
          destination_id: form.destination_id || null,
          vendor_id: form.vendor_id || null,
          job_id: form.job_id || undefined,
          details: form.details,
          lines: lines.map((l) => ({
            item_id: l.item_id,
            quantity: scaled(l.quantity),
            cost_cents: Math.round(Number(l.cost || 0) * 100),
          })),
        });
      else if (modal === "Receive")
        await send("workflow", {
          action: "receive",
          document_id: form.document_id,
          lines: lines
            .filter((l) => Number(l.quantity) > 0)
            .map((l) => ({ line_id: l.id, quantity: scaled(l.quantity) })),
        });
      else if (modal === "Apply Template")
        await send("workflow", {
          action: "apply",
          document_id: form.document_id,
          destination_id: form.destination_id,
        });
      else if (modal === "Receive Equipment")
        await send("serials", {
          id: form.id,
          action: "receive",
          item_id: form.item_id,
          location_id: form.location_id,
          serial: form.serial,
        });
      else if (modal === "Install Equipment") {
        await send("serials", {
          id: form.id,
          action: "install",
          job_id: form.job_id,
          property_id: form.property_id,
          invoice_id: form.invoice_id || undefined,
          existing_system_id: form.existing_system_id || undefined,
          equipment_type: form.equipment_type,
          installed_at: form.installed_at,
          warranty_exp: form.warranty_exp || undefined,
        });
        window.dispatchEvent(new Event("crm-refresh"));
      }
      setModal("");
    });
  }
  const action = (doc: Row, a: string) =>
    run(async () => {
      await send("workflow", { document_id: doc.id, action: a });
      setSelected(null);
    });
  function restock(s: Row) {
    const source = locations.find(
      (l: Row) =>
        ["Shop", "Warehouse"].includes(l.type) && l.id !== s.location_id,
    );
    if (!source) {
      setNotice("Create a shop location before restocking.");
      return;
    }
    const sourceStock = stock.find(
      (r: Row) => r.item_id === s.item_id && r.location_id === source.id,
    );
    const inbound = documents
      .filter(
        (d: Row) =>
          d.kind === "Transfer" &&
          d.destination_id === s.location_id &&
          !["Cancelled", "Received"].includes(d.status),
      )
      .flatMap((d: Row) => docLines(d.id))
      .filter((l: Row) => l.item_id === s.item_id)
      .reduce(
        (n: number, l: Row) => n + Number(l.quantity) - Number(l.processed),
        0,
      );
    const needed = Math.max(
      0,
      Number(s.target) - Number(s.on_hand) + Number(s.reserved) - inbound,
    );
    const available = Math.max(
      0,
      Number(sourceStock?.on_hand || 0) - Number(sourceStock?.reserved || 0),
    );
    if (!needed) {
      setNotice("An existing transfer already covers this stock target.");
      return;
    }
    if (!available) {
      setNotice(
        "Shop inventory is insufficient. Create a purchase order to cover the shortage.",
      );
      return;
    }
    workflow(
      "Transfer",
      {
        location_id: source.id,
        destination_id: s.location_id,
        details: {
          notes:
            needed > available
              ? "Partial replenishment: shop stock is insufficient."
              : "",
        },
      },
      [
        {
          item_id: s.item_id,
          quantity: String(units(Math.min(needed, available))),
          cost: String((item(s.item_id).cost_cents || 0) / 100),
        },
      ],
    );
  }
  const docKind: Record<string, string> = {
    Transfers: "Transfer",
    "Purchase Orders": "Purchase Order",
    Counts: "Count",
    Settings: "Template",
  };
  const visibleDocs = documents.filter(
    (d: Row) =>
      (tab === "Receiving"
        ? ["Purchase Order", "Transfer"].includes(d.kind) &&
          ["Ordered", "In Transit", "Partially Received"].includes(d.status)
        : d.kind === docKind[tab]) && match(d),
  );
  function exportHistory() {
    const header = [
      "Date",
      "Item",
      "Location",
      "Movement",
      "Quantity",
      "Job",
      "Notes",
    ];
    const rows = movements.map((m: Row) => [
      m.created_at,
      item(m.item_id).name,
      place(m.location_id),
      m.kind,
      units(m.quantity_units),
      m.job_id || "",
      m.notes,
    ]);
    const csv = [header, ...rows]
      .map((row) =>
        row
          .map(
            (v: any) =>
              '"' +
              String(v)
                .replace(/^[=+\-@]/, "'$&")
                .replaceAll('"', '""') +
              '"',
          )
          .join(","),
      )
      .join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "inventory-history.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Package /> Inventory
          </h1>
          <p className="text-sm text-muted-foreground">
            Shop, trucks, equipment, and job materials in one place.
          </p>
        </div>
        <div className="flex gap-2">
          {admin && (
            <Button onClick={() => open("Item")}>
              <Plus size={16} className="mr-2" />
              New Item
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() =>
              open("Movement", {
                kind: admin ? "Opening" : "Job Usage",
                quantity: "1",
              })
            }
          >
            Record Stock Movement
          </Button>
        </div>
      </header>
      {notice && (
        <p role="status" className="rounded-lg border bg-muted p-3 text-sm">
          {notice}
        </p>
      )}
      <nav
        className="flex flex-wrap gap-1 border-b pb-3"
        aria-label="Inventory sections"
      >
        {tabs
          .filter(
            (t) =>
              admin ||
              !["Vendors", "Purchase Orders", "Reports", "Settings"].includes(
                t,
              ),
          )
          .map((t) => (
            <Button
              key={t}
              size="sm"
              variant={tab === t ? "default" : "ghost"}
              onClick={() => {
                setTab(t);
                setSearch("");
              }}
            >
              {t}
            </Button>
          ))}
      </nav>
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-52 flex-1">
          <Search
            className="absolute left-3 top-3 text-muted-foreground"
            size={16}
          />
          <Input
            className="pl-9"
            aria-label="Search inventory or barcode"
            placeholder="Search name, SKU, model, or barcode…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          aria-label="Filter inventory location"
          className={inputClass + " max-w-xs"}
          value={location}
          onChange={(e) => setLocation(e.target.value)}
        >
          <option value="">All locations</option>
          {locations.map((l: Row) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
      {tab === "Dashboard" && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {[
              [
                "Inventory value",
                admin ? money(value(scoped)) : "Staff inventory",
                "Reports",
              ],
              ["Low stock items", low.length, "Restock"],
              [
                "Truck locations",
                locations.filter((l: Row) => l.type.includes("Truck")).length,
                "Trucks",
              ],
              [
                "Open purchase orders",
                documents.filter(
                  (d: Row) =>
                    d.kind === "Purchase Order" &&
                    !["Received", "Cancelled"].includes(d.status),
                ).length,
                "Purchase Orders",
              ],
            ].map(([label, v, destination]) => (
              <button
                key={label}
                onClick={() => setTab(String(destination))}
                className="rounded-xl border bg-card p-5 text-left shadow-sm"
              >
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="mt-2 text-2xl font-bold">{v}</p>
              </button>
            ))}
          </div>
          <Card>
            <CardContent className="p-5">
              <h2 className="mb-3 font-semibold">Get started</h2>
              <p className="mb-4 text-sm text-muted-foreground">
                Create your shop and trucks, add items, then record opening
                quantities or receive a purchase order. Quotes do not remove
                stock; confirmed job usage does.
              </p>
              <div className="flex flex-wrap gap-2">
                {admin && (
                  <Button variant="outline" onClick={() => open("Location")}>
                    Add Shop or Truck
                  </Button>
                )}
                <Button variant="outline" onClick={() => workflow("Count")}>
                  Friday Truck Count
                </Button>
                {admin && (
                  <Button
                    variant="outline"
                    onClick={() => workflow("Allocation")}
                  >
                    Reserve Parts for a Job
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </>
      )}
      {["Items", "Equipment"].includes(tab) && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items
            .filter(
              (r: Row) =>
                match(r) &&
                (tab !== "Equipment" ||
                  r.serialized ||
                  r.category === "Equipment"),
            )
            .map((r: Row) => (
              <Card key={r.id}>
                <CardContent className="space-y-2 p-4">
                  <div className="flex justify-between">
                    <h2 className="font-semibold">{r.name}</h2>
                    <Badge variant="outline">
                      {r.active ? "Active" : "Archived"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {r.sku} · {r.category}
                  </p>
                  <p className="text-lg font-bold">
                    {units(
                      scoped
                        .filter((s: Row) => s.item_id === r.id)
                        .reduce(
                          (n: number, s: Row) => n + Number(s.on_hand),
                          0,
                        ),
                    )}{" "}
                    on hand
                  </p>
                  {admin && (
                    <p className="text-sm">
                      Cost {money(r.cost_cents)} · Price {money(r.sale_cents)}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {admin && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            open("Item", {
                              ...r,
                              cost: r.cost_cents / 100,
                              sale: r.sale_cents / 100,
                            })
                          }
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            open("Policy", {
                              item_id: r.id,
                              minimum: "0",
                              target: "0",
                              bin: "",
                            })
                          }
                        >
                          Stock Targets
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
        </div>
      )}
      {["Locations", "Shop", "Trucks"].includes(tab) && (
        <>
          <div className="flex justify-end">
            {admin && (
              <Button onClick={() => open("Location")}>Add Location</Button>
            )}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {locations
              .filter(
                (l: Row) =>
                  match(l) &&
                  (tab === "Locations" ||
                    (tab === "Trucks"
                      ? l.type.includes("Truck")
                      : ["Shop", "Warehouse"].includes(l.type))),
              )
              .map((l: Row) => (
                <Card key={l.id}>
                  <CardContent className="space-y-3 p-5">
                    <h2 className="flex items-center gap-2 font-semibold">
                      <Truck size={18} />
                      {l.name}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {l.type} ·{" "}
                      {staff.find((p: Row) => p.id === l.assigned_to)
                        ?.full_name || "Unassigned"}
                    </p>
                    <p>
                      {stock.filter((s: Row) => s.location_id === l.id).length}{" "}
                      stocked items{" "}
                      {admin &&
                        `· ${money(value(stock.filter((s: Row) => s.location_id === l.id)))}`}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => {
                          setLocation(l.id);
                          setTab("Restock");
                        }}
                      >
                        View Stock
                      </Button>
                      {admin && !l.details?.system_transit && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => open("Location", l)}
                        >
                          Edit
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          workflow(
                            "Count",
                            { location_id: l.id },
                            stock
                              .filter((s: Row) => s.location_id === l.id)
                              .map((s: Row) => ({
                                item_id: s.item_id,
                                quantity: String(units(s.on_hand)),
                                cost: String(
                                  (item(s.item_id).cost_cents || 0) / 100,
                                ),
                              })),
                          )
                        }
                      >
                        Count
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
          </div>
        </>
      )}
      {tab === "Restock" && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Available excludes reservations. Targets determine restocking.
            Existing transfers are considered before creating another.
          </p>
          {scoped
            .filter((s: Row) => match({ ...s, name: item(s.item_id).name }))
            .map((s: Row) => (
              <Card key={s.item_id + s.location_id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div>
                    <h2 className="font-semibold">{item(s.item_id).name}</h2>
                    <p className="text-sm text-muted-foreground">
                      {place(s.location_id)} · Bin {s.bin || "—"}
                    </p>
                    <p className="text-sm">
                      On hand {units(s.on_hand)} · Reserved {units(s.reserved)}{" "}
                      · Available {units(s.on_hand - s.reserved)} · Min{" "}
                      {units(s.minimum)} · Target {units(s.target)}
                    </p>
                  </div>
                  {admin && (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => restock(s)}>
                        Restock
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          open("Policy", {
                            ...s,
                            minimum: units(s.minimum),
                            target: units(s.target),
                          })
                        }
                      >
                        Edit Target
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
        </div>
      )}
      {[
        "Transfers",
        "Purchase Orders",
        "Receiving",
        "Counts",
        "Settings",
      ].includes(tab) && (
        <>
          <div className="flex flex-wrap justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {tab === "Settings"
                ? "Stock templates define desired quantities; they never create physical stock."
                : "Review each document before changing stock. Purchase orders are not emailed automatically."}
            </p>
            {tab !== "Receiving" && (
              <Button onClick={() => workflow(docKind[tab])}>
                New {docKind[tab]}
              </Button>
            )}
          </div>
          {visibleDocs.map((d: Row) => (
            <button
              key={d.id}
              className="flex w-full justify-between gap-3 rounded-xl border bg-card p-4 text-left"
              onClick={() => setSelected(d)}
            >
              <span>
                <strong>
                  {d.kind} #{d.number}
                </strong>
                <span className="block text-sm text-muted-foreground">
                  {place(d.location_id)}
                  {d.destination_id && ` → ${place(d.destination_id)}`} ·{" "}
                  {new Date(d.created_at).toLocaleDateString()}
                </span>
              </span>
              <Badge variant="outline">{d.status}</Badge>
            </button>
          ))}
        </>
      )}
      {tab === "Vendors" && (
        <>
          <Button onClick={() => open("Vendor")}>Add Vendor</Button>
          <div className="grid gap-3 md:grid-cols-2">
            {vendors.filter(match).map((v: Row) => (
              <Card key={v.id}>
                <CardContent className="space-y-2 p-4">
                  <h2 className="font-semibold">{v.name}</h2>
                  <p className="text-sm">
                    {v.details.email} · {v.details.phone}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {
                      documents.filter(
                        (d: Row) =>
                          d.vendor_id === v.id &&
                          !["Received", "Cancelled"].includes(d.status),
                      ).length
                    }{" "}
                    open orders
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => open("Vendor", v)}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    className="ml-2"
                    onClick={() =>
                      workflow("Purchase Order", { vendor_id: v.id })
                    }
                  >
                    Create Purchase Order
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
      {["Inventory History", "Reports", "Dashboard"].includes(tab) && (
        <Card>
          <CardContent className="space-y-3 p-5">
            <div className="flex justify-between">
              <h2 className="font-semibold">
                {tab === "Reports"
                  ? "Inventory value by location"
                  : "Recent inventory activity"}
              </h2>
              <Button size="sm" variant="outline" onClick={exportHistory}>
                <Download size={14} className="mr-1" />
                Export History
              </Button>
            </div>
            {tab === "Reports"
              ? locations.map((l: Row) => (
                  <div
                    className="flex justify-between border-b py-2"
                    key={l.id}
                  >
                    <span>{l.name}</span>
                    <strong>
                      {money(
                        value(stock.filter((s: Row) => s.location_id === l.id)),
                      )}
                    </strong>
                  </div>
                ))
              : movements
                  .filter(
                    (m: Row) =>
                      (!location || m.location_id === location) &&
                      match({ ...m, name: item(m.item_id).name }),
                  )
                  .slice(0, tab === "Dashboard" ? 8 : 500)
                  .map((m: Row) => (
                    <div
                      key={m.id}
                      className="flex justify-between gap-3 border-b py-2 text-sm"
                    >
                      <div>
                        <strong>{item(m.item_id).name}</strong>
                        <p className="text-xs text-muted-foreground">
                          {m.kind} · {place(m.location_id)} ·{" "}
                          {new Date(m.created_at).toLocaleString()}
                        </p>
                        <p>
                          {m.notes}
                          {m.job_id && ` · ${m.job_id}`}
                        </p>
                      </div>
                      <strong>{units(m.quantity_units)}</strong>
                    </div>
                  ))}
            <p className="text-xs text-muted-foreground">
              History displays the latest {data.history_limit} movements. All
              movements remain stored in the ledger.
            </p>
          </CardContent>
        </Card>
      )}
      {tab === "Equipment" && (
        <section className="space-y-3">
          {admin && (
            <Button onClick={() => open("Receive Equipment")}>
              Receive Serialized Equipment
            </Button>
          )}
          {serials
            .filter((s: Row) => match({ ...s, name: item(s.item_id).name }))
            .map((s: Row) => (
              <Card key={s.id}>
                <CardContent className="flex flex-wrap justify-between gap-3 p-4">
                  <div>
                    <strong>{item(s.item_id).name}</strong>
                    <p className="text-sm">
                      Serial {s.serial} · {s.status} · {place(s.location_id)}
                    </p>
                    {s.installed_at && (
                      <p className="text-sm">
                        Installed {s.installed_at} · Job {s.job_id}
                      </p>
                    )}
                  </div>
                  {admin && s.status !== "Installed" && (
                    <Button
                      size="sm"
                      onClick={() =>
                        open("Install Equipment", {
                          ...s,
                          job_id: s.job_id || "",
                          equipment_type: "AC",
                          installed_at: new Date().toISOString().slice(0, 10),
                        })
                      }
                    >
                      Install on Customer Job
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
        </section>
      )}
      {items.length === 0 && (
        <p className="rounded-xl border border-dashed p-8 text-center text-muted-foreground">
          No inventory items yet. Add your catalog and locations to begin.
        </p>
      )}
      <Dialog open={!!modal} onOpenChange={(v) => !busy && !v && setModal("")}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {modal === "Document"
                ? `New ${form.kind}`
                : modal === "Receive"
                  ? "Receive Inventory"
                  : modal}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {["Item", "Location", "Vendor"].includes(modal) && (
              <>
                <Label>
                  Name
                  <Input
                    value={form.name || ""}
                    onChange={(e) => field("name", e.target.value)}
                  />
                </Label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(e) => field("active", e.target.checked)}
                  />
                  Active
                </label>
              </>
            )}
            {modal === "Item" && (
              <>
                <Label>
                  SKU
                  <Input
                    value={form.sku || ""}
                    onChange={(e) => field("sku", e.target.value)}
                  />
                </Label>
                <Label>
                  Category
                  <Input
                    list="inventory-categories"
                    value={form.category || ""}
                    onChange={(e) => field("category", e.target.value)}
                  />
                  <datalist id="inventory-categories">
                    {categories.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </datalist>
                </Label>
                <div className="grid grid-cols-2 gap-3">
                  <Label>
                    Cost ($)
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.cost}
                      onChange={(e) => field("cost", e.target.value)}
                    />
                  </Label>
                  <Label>
                    Selling price ($)
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.sale}
                      onChange={(e) => field("sale", e.target.value)}
                    />
                  </Label>
                </div>
                {[
                  "description",
                  "brand",
                  "model",
                  "manufacturer_part_number",
                  "barcode",
                  "unit",
                  "notes",
                ].map((k) => (
                  <Label className="block capitalize" key={k}>
                    {k.replaceAll("_", " ")}
                    <Input
                      value={form.details?.[k] || ""}
                      onChange={(e) =>
                        field("details", {
                          ...form.details,
                          [k]: e.target.value,
                        })
                      }
                    />
                  </Label>
                ))}
              </>
            )}
            {modal === "Location" && (
              <>
                <Select
                  label="Location type"
                  value={form.type}
                  onChange={(v) => field("type", v)}
                  options={[
                    "Shop",
                    "Warehouse",
                    "Service Truck",
                    "Install Truck",
                    "Job Staging",
                    "Returns",
                    "Damaged",
                    "Other",
                  ].map((v) => ({ id: v, name: v }))}
                />
                <Select
                  label="Assigned technician"
                  value={form.assigned_to}
                  onChange={(v) => field("assigned_to", v)}
                  options={staff.map((s: Row) => ({
                    id: s.id,
                    name: s.full_name || s.role,
                  }))}
                />
                {["address", "vehicle_number", "license_plate", "notes"].map(
                  (k) => (
                    <Label className="block capitalize" key={k}>
                      {k.replaceAll("_", " ")}
                      <Input
                        value={form.details?.[k] || ""}
                        onChange={(e) =>
                          field("details", {
                            ...form.details,
                            [k]: e.target.value,
                          })
                        }
                      />
                    </Label>
                  ),
                )}
              </>
            )}
            {modal === "Vendor" &&
              [
                "contact",
                "email",
                "phone",
                "website",
                "account_number",
                "payment_terms",
                "address",
                "pickup_address",
                "shipping_address",
                "notes",
              ].map((k) => (
                <Label className="block capitalize" key={k}>
                  {k.replaceAll("_", " ")}
                  <Input
                    value={form.details?.[k] || ""}
                    onChange={(e) =>
                      field("details", { ...form.details, [k]: e.target.value })
                    }
                  />
                </Label>
              ))}
            {["Policy", "Movement", "Document"].includes(modal) && (
              <Select
                label="Inventory location"
                value={form.location_id}
                onChange={(v) => field("location_id", v)}
                options={locations.filter(
                  (l: Row) => !l.details?.system_transit,
                )}
              />
            )}
            {modal === "Apply Template" && (
              <>
                <p className="text-sm text-muted-foreground">
                  This sets the minimum and target quantities for the selected
                  location. It does not add or remove physical stock.
                </p>
                <Select
                  label="Apply template to"
                  value={form.destination_id}
                  onChange={(v) => field("destination_id", v)}
                  options={locations.filter(
                    (l: Row) => !l.details?.system_transit,
                  )}
                />
              </>
            )}
            {["Policy", "Movement"].includes(modal) && (
              <Select
                label="Item"
                value={form.item_id}
                onChange={(v) => field("item_id", v)}
                options={items.filter((i: Row) => i.active)}
              />
            )}
            {modal === "Policy" &&
              ["minimum", "target", "bin"].map((k) => (
                <Label className="block capitalize" key={k}>
                  {k}
                  <Input
                    value={form[k] || ""}
                    onChange={(e) => field(k, e.target.value)}
                  />
                </Label>
              ))}
            {modal === "Movement" && (
              <>
                <Select
                  label="Movement type"
                  value={form.kind}
                  onChange={(v) => field("kind", v)}
                  options={(admin
                    ? ["Opening", "Adjustment", "Job Usage", "Return"]
                    : ["Job Usage"]
                  ).map((v) => ({ id: v, name: v }))}
                />
                <Label>
                  Quantity{" "}
                  {form.kind === "Adjustment" ? "(negative to remove)" : ""}
                  <Input
                    type="number"
                    step="0.001"
                    value={form.quantity}
                    onChange={(e) => field("quantity", e.target.value)}
                  />
                </Label>
                <Select
                  label="Job (required for usage)"
                  value={form.job_id}
                  onChange={(v) => field("job_id", v)}
                  options={workOrders.map((j) => ({
                    id: j.id,
                    name: `${j.id} · ${j.customerName}`,
                  }))}
                />
                <Label>
                  Reason / notes
                  <Input
                    value={form.notes || ""}
                    onChange={(e) => field("notes", e.target.value)}
                  />
                </Label>
              </>
            )}
            {modal === "Document" && (
              <>
                {form.kind === "Transfer" && (
                  <Select
                    label="Destination"
                    value={form.destination_id}
                    onChange={(v) => field("destination_id", v)}
                    options={locations.filter(
                      (l: Row) =>
                        l.id !== form.location_id && !l.details?.system_transit,
                    )}
                  />
                )}{" "}
                {form.kind === "Purchase Order" && (
                  <Select
                    label="Vendor"
                    value={form.vendor_id}
                    onChange={(v) => field("vendor_id", v)}
                    options={vendors.filter((v: Row) => v.active)}
                  />
                )}
                <Select
                  label="Job (required for allocation)"
                  value={form.job_id}
                  onChange={(v) => field("job_id", v)}
                  options={workOrders.map((j) => ({
                    id: j.id,
                    name: `${j.id} · ${j.customerName}`,
                  }))}
                />
                <Label>
                  Notes
                  <Input
                    value={form.details?.notes || ""}
                    onChange={(e) =>
                      field("details", {
                        ...form.details,
                        notes: e.target.value,
                      })
                    }
                  />
                </Label>
              </>
            )}
            {["Document", "Receive"].includes(modal) && (
              <>
                {lines.map((l, i) => (
                  <div
                    key={i}
                    className="grid gap-2 rounded-lg border p-3 sm:grid-cols-3"
                  >
                    {modal === "Document" ? (
                      <Select
                        label="Item"
                        value={l.item_id}
                        onChange={(v) =>
                          setLines((ls) =>
                            ls.map((r, j) =>
                              j === i
                                ? {
                                    ...r,
                                    item_id: v,
                                    cost: String(
                                      (item(v).cost_cents || 0) / 100,
                                    ),
                                  }
                                : r,
                            ),
                          )
                        }
                        options={items.filter(
                          (r: Row) => r.active && r.tracked && !r.serialized,
                        )}
                      />
                    ) : (
                      <p className="text-sm">
                        {item(l.item_id).name}
                        <br />
                        Remaining: {units(l.remaining)}
                      </p>
                    )}
                    <Label>
                      {form.kind === "Count" ? "Actual counted" : "Quantity"}
                      <Input
                        type="number"
                        min="0"
                        step="0.001"
                        value={l.quantity}
                        onChange={(e) =>
                          setLines((ls) =>
                            ls.map((r, j) =>
                              j === i ? { ...r, quantity: e.target.value } : r,
                            ),
                          )
                        }
                      />
                    </Label>
                    {modal === "Document" && (
                      <Label>
                        Unit cost ($)
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={l.cost}
                          onChange={(e) =>
                            setLines((ls) =>
                              ls.map((r, j) =>
                                j === i ? { ...r, cost: e.target.value } : r,
                              ),
                            )
                          }
                        />
                      </Label>
                    )}
                  </div>
                ))}
                {modal === "Document" && (
                  <Button
                    variant="outline"
                    onClick={() =>
                      setLines((ls) => [
                        ...ls,
                        { item_id: "", quantity: "1", cost: "0" },
                      ])
                    }
                  >
                    Add Line
                  </Button>
                )}
              </>
            )}
            {modal === "Item" && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.serialized}
                  disabled={items.some((i: Row) => i.id === form.id)}
                  onChange={(e) => field("serialized", e.target.checked)}
                />
                Track each unit by serial number (cannot change later)
              </label>
            )}
            {modal === "Receive Equipment" && (
              <>
                <Select
                  label="Serialized item"
                  value={form.item_id}
                  onChange={(v) => field("item_id", v)}
                  options={items.filter((i: Row) => i.serialized && i.active)}
                />
                <Select
                  label="Receiving location"
                  value={form.location_id}
                  onChange={(v) => field("location_id", v)}
                  options={locations.filter(
                    (l: Row) => !l.details?.system_transit,
                  )}
                />
                <Label>
                  Serial number
                  <Input
                    value={form.serial || ""}
                    onChange={(e) => field("serial", e.target.value)}
                  />
                </Label>
              </>
            )}
            {modal === "Install Equipment" && (
              <>
                <Select
                  label="Installation job"
                  value={form.job_id}
                  onChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      job_id: v,
                      property_id: "",
                      existing_system_id: "",
                      invoice_id: "",
                    }))
                  }
                  options={workOrders.map((j) => ({
                    id: j.id,
                    name: `${j.id} · ${j.customerName}`,
                  }))}
                />
                <Select
                  label="Customer property"
                  value={form.property_id}
                  onChange={(v) => field("property_id", v)}
                  options={(installCustomer?.properties || []).map((p) => ({
                    id: p.id,
                    name: p.address,
                  }))}
                />
                <Select
                  label="Match an existing provisional equipment record (optional)"
                  value={form.existing_system_id}
                  onChange={(v) => field("existing_system_id", v)}
                  options={(installProperty?.systems || [])
                    .filter((s) => !s.serial || s.serial === "Not recorded")
                    .map((s) => ({ id: s.id, name: `${s.brand} ${s.model}` }))}
                />
                <Select
                  label="Invoice (optional)"
                  value={form.invoice_id}
                  onChange={(v) => field("invoice_id", v)}
                  options={invoices
                    .filter((i) => i.customerId === installCustomer?.id)
                    .map((i) => ({ id: i.id, name: i.id }))}
                />
                <Select
                  label="Equipment type"
                  value={form.equipment_type}
                  onChange={(v) => field("equipment_type", v)}
                  options={[
                    "AC",
                    "Coil",
                    "Furnace",
                    "Air Handler",
                    "Heat Pump",
                    "Mini-Split",
                    "Package Unit",
                  ].map((v) => ({ id: v, name: v }))}
                />
                <Label>
                  Installed date
                  <Input
                    type="date"
                    value={form.installed_at || ""}
                    onChange={(e) => field("installed_at", e.target.value)}
                  />
                </Label>
                <Label>
                  Warranty expires (optional)
                  <Input
                    type="date"
                    value={form.warranty_exp || ""}
                    onChange={(e) => field("warranty_exp", e.target.value)}
                  />
                </Label>
              </>
            )}
            {notice && (
              <p role="alert" className="text-sm text-red-600">
                {notice}
              </p>
            )}
            <Button disabled={busy} onClick={save}>
              {busy
                ? "Saving…"
                : modal === "Receive"
                  ? "Confirm Receipt"
                  : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!selected}
        onOpenChange={(v) => !busy && !v && setSelected(null)}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selected?.kind} #{selected?.number}
            </DialogTitle>
          </DialogHeader>
          {selected && (
            <>
              <Badge variant="outline">{selected.status}</Badge>
              <p>
                {place(selected.location_id)}
                {selected.destination_id &&
                  ` → ${place(selected.destination_id)}`}
              </p>
              {docLines(selected.id).map((l: Row) => (
                <div
                  className="flex justify-between border-b py-2 text-sm"
                  key={l.id}
                >
                  <span>{item(l.item_id).name}</span>
                  <span>
                    {units(l.quantity)}{" "}
                    {["Purchase Order", "Transfer"].includes(selected.kind) &&
                      `· ${units(l.processed)} received`}
                  </span>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                {selected.status === "Draft" &&
                  ["Purchase Order", "Count"].includes(selected.kind) && (
                    <Button
                      disabled={busy}
                      onClick={() => action(selected, "submit")}
                    >
                      Submit for Review
                    </Button>
                  )}
                {admin && (
                  <>
                    {selected.kind === "Purchase Order" &&
                      selected.status === "Submitted" && (
                        <Button
                          disabled={busy}
                          onClick={() => action(selected, "order")}
                        >
                          Mark Ordered
                        </Button>
                      )}
                    {["Transfer", "Allocation"].includes(selected.kind) &&
                      selected.status === "Draft" && (
                        <Button
                          disabled={busy}
                          onClick={() => action(selected, "reserve")}
                        >
                          Reserve Stock
                        </Button>
                      )}
                    {selected.kind === "Transfer" &&
                      selected.status === "Ready" && (
                        <Button
                          disabled={busy}
                          onClick={() => action(selected, "pick")}
                        >
                          Mark Picked
                        </Button>
                      )}
                    {selected.kind === "Transfer" &&
                      selected.status === "Picked" && (
                        <Button
                          disabled={busy}
                          onClick={() => action(selected, "dispatch")}
                        >
                          Dispatch Transfer
                        </Button>
                      )}
                    {selected.kind === "Allocation" &&
                      selected.status === "Reserved" && (
                        <Button
                          disabled={busy}
                          onClick={() => action(selected, "consume")}
                        >
                          Confirm Used on Job
                        </Button>
                      )}
                    {selected.kind === "Count" &&
                      ["Draft", "Submitted"].includes(selected.status) && (
                        <Button
                          disabled={busy}
                          onClick={() => action(selected, "post")}
                        >
                          Approve &amp; Post Count
                        </Button>
                      )}
                    {selected.kind === "Template" &&
                      selected.status === "Draft" && (
                        <Button
                          disabled={busy}
                          onClick={() => {
                            open("Apply Template", {
                              document_id: selected.id,
                              destination_id: "",
                            });
                            setSelected(null);
                          }}
                        >
                          Apply to Location
                        </Button>
                      )}
                    {![
                      "Received",
                      "Posted",
                      "Consumed",
                      "Cancelled",
                      "In Transit",
                      "Partially Received",
                    ].includes(selected.status) && (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => action(selected, "cancel")}
                      >
                        Cancel Document
                      </Button>
                    )}
                  </>
                )}
                {["Ordered", "In Transit", "Partially Received"].includes(
                  selected.status,
                ) && (
                  <Button
                    disabled={busy}
                    onClick={() => {
                      open("Receive", { document_id: selected.id });
                      setLines(
                        docLines(selected.id)
                          .filter((l: Row) => l.processed < l.quantity)
                          .map((l: Row) => ({
                            ...l,
                            remaining: l.quantity - l.processed,
                            quantity: String(units(l.quantity - l.processed)),
                          })),
                      );
                      setSelected(null);
                    }}
                  >
                    Receive Items
                  </Button>
                )}
              </div>
              {notice && (
                <p role="status" className="text-sm">
                  {notice}
                </p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
