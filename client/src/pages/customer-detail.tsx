import {CustomerCommunications} from "@/pages/communications";
import { useState, useRef } from "react";
import { useParams, Link } from "wouter";
import {
  ArrowLeft,
  Phone,
  Mail,
  MapPin,
  Building2,
  Home,
  Plus,
  Wrench,
  Calendar,
  FileText,
  DollarSign,
  Crown,
  CheckCircle2,
  Clock,
  MessageSquare,
  Settings,
  Search,
  X,
  TrendingUp,
  Sparkles,
  Camera,
  Upload,
  Loader2,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useData } from "@/context/data-context";
import { customers as seedCustomers, quotes, fmtCurrency } from "@/data/mock-data";
import { pricebook, addOnServices } from "@/data/pricebook";

const activityIcons: Record<string, typeof Phone> = {
  call: Phone,
  note: MessageSquare,
  quote: FileText,
  approval: CheckCircle2,
  "work-order": Wrench,
  invoice: FileText,
  payment: DollarSign,
  membership: Crown,
  visit: Calendar,
  email: Mail,
  text: MessageSquare,
};

const systemStatusColors: Record<string, string> = {
  Active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400",
  Warranty: "bg-sky-100 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400",
  Inactive: "bg-muted text-muted-foreground",
};

const jobTypes = ["Changeout", "Service Call", "New Construction", "Maintenance", "Commercial"] as const;

export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const { customers, notes: contextNotes, getPhotos, addNote, addPhoto, quotes: contextQuotes, createQuote, createInvoice } = useData();
  const customer = customers.find((c) => c.id === id);
  const [showNoteDialog, setShowNoteDialog] = useState(false);
  const [noteText, setNoteText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Quote dialog state
  const [showQuoteDialog, setShowQuoteDialog] = useState(false);
  const [quoteStep, setQuoteStep] = useState(1);
  const [jobType, setJobType] = useState<string>("Changeout");
  const [eqSearch, setEqSearch] = useState("");
  const [eqFilter, setEqFilter] = useState<string>("All");
  const [selectedEquipment, setSelectedEquipment] = useState<string[]>([]);
  const [selectedAddOns, setSelectedAddOns] = useState<string[]>([]);
  const [laborCost, setLaborCost] = useState("1200");
  const [laborDesc, setLaborDesc] = useState("Remove old equipment, install new system, reconnect electrical and refrigerant lines");
  const [materialsCost, setMaterialsCost] = useState("450");
  const [eqDropdown, setEqDropdown] = useState("");

  const customerQuotes = contextQuotes.filter((q) => q.customerId === id);
  const customerNotes = contextNotes.filter((n) => n.customerId === id);
  const customerPhotos = getPhotos(id || "");

  // Equipment filtering
  const categories = ["All", "Heat Pump", "Condenser", "Air Handler", "Evaporator Coil", "Furnace", "Heat Strip", "Accessory"];
  const filteredEquipment = pricebook.filter((p) => {
    const matchesSearch =
      p.model.toLowerCase().includes(eqSearch.toLowerCase()) ||
      p.description.toLowerCase().includes(eqSearch.toLowerCase());
    const matchesFilter = eqFilter === "All" || p.category === eqFilter;
    return matchesSearch && matchesFilter;
  });

  const toggleEquipment = (eid: string) => {
    setSelectedEquipment((prev) => prev.includes(eid) ? prev.filter((x) => x !== eid) : [...prev, eid]);
  };
  const toggleAddOn = (aid: string) => {
    setSelectedAddOns((prev) => prev.includes(aid) ? prev.filter((x) => x !== aid) : [...prev, aid]);
  };

  // Pricing calculations
  const selectedItems = pricebook.filter((p) => selectedEquipment.includes(p.id));
  const equipmentCost = selectedItems.reduce((sum, item) => sum + item.cost, 0);
  const labor = parseFloat(laborCost) || 0;
  const materials = parseFloat(materialsCost) || 0;
  const totalCost = equipmentCost + labor + materials;
  const customerPrice = Math.round(totalCost / 0.75);
  const grossProfit = customerPrice - totalCost;
  const margin = customerPrice > 0 ? ((grossProfit / customerPrice) * 100).toFixed(1) : "0.0";
  const addOnsTotal = addOnServices.filter((a) => selectedAddOns.includes(a.id)).reduce((sum, a) => sum + a.price, 0);
  const grandTotal = customerPrice + addOnsTotal;

  const resetQuoteForm = () => {
    setQuoteStep(1);
    setJobType("Changeout");
    setEqSearch("");
    setEqFilter("All");
    setSelectedEquipment([]);
    setSelectedAddOns([]);
    setLaborCost("1200");
    setLaborDesc("Remove old equipment, install new system, reconnect electrical and refrigerant lines");
    setMaterialsCost("450");
    setEqDropdown("");
  };

  const handleCreateQuote = () => {
    if (selectedEquipment.length === 0) {
      toast({ title: "No equipment selected", description: "Please select at least one equipment item.", variant: "destructive" });
      return;
    }
    const truncatedDesc = laborDesc.length > 50
      ? laborDesc.substring(0, 50).replace(/\s+\S*$/, "") + "…"
      : laborDesc;
    const newQuote = createQuote({
      customerId: customer?.id || "",
      customerName: customer?.name || "",
      jobType: jobType,
      title: `${jobType} — ${selectedEquipment.length} item(s) · ${truncatedDesc}`,
      totalCost: grandTotal,
      customerPrice: grandTotal,
      equipmentItems: selectedEquipment,
      laborDescription: laborDesc,
    });
    toast({
      title: "Quote created",
      description: `${newQuote.id} for ${customer?.name} — ${fmtCurrency(grandTotal)} total. View it in the Quotes tab or the Quotes page.`,
    });
    setShowQuoteDialog(false);
    resetQuoteForm();
  };

  const handleAddNote = () => {
    if (!noteText.trim()) {
      toast({ title: "Empty note", description: "Please enter a note.", variant: "destructive" });
      return;
    }
    addNote(id || "", noteText.trim());
    toast({ title: "Note added", description: "Note has been added to the customer timeline." });
    setNoteText("");
    setShowNoteDialog(false);
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    toast({ title: "Photo uploading", description: "Uploading and analyzing photo with AI..." });
    for (const file of Array.from(files)) {
      await addPhoto(id || "", file);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  if (!customer) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Customer not found.</p>
        <Link href="/customers">
          <Button variant="outline" size="sm" className="mt-4">
            <ArrowLeft size={16} className="mr-1.5" /> Back to Customers
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
      <Link href="/customers">
        <Button variant="ghost" size="sm" className="mb-1">
          <ArrowLeft size={16} className="mr-1.5" /> Back to Customers
        </Button>
      </Link>

      {/* Header */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-start gap-4 flex-wrap">
            <div className={`flex h-14 w-14 items-center justify-center rounded-full shrink-0 ${
              customer.type === "Commercial"
                ? "bg-purple-100 text-purple-700 dark:bg-purple-950/30 dark:text-purple-400"
                : "bg-sky-100 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400"
            }`}>
              {customer.type === "Commercial" ? <Building2 size={24} /> : <Home size={24} />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold tracking-tight">{customer.name}</h1>
                <Badge variant="outline" className="text-xs">{customer.type}</Badge>
                <Badge className="text-xs">{customer.leadStatus}</Badge>
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                <span>Lead source: {customer.leadSource}</span>
                <span>·</span>
                <span>Customer since {customer.createdAt}</span>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {customer.tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-[10px] py-0">{tag}</Badge>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setShowQuoteDialog(true)} data-testid="button-customer-new-quote">
                <FileText size={14} className="mr-1.5" /> New Quote
              </Button>
              <Button size="sm" variant="outline" onClick={() => {
                const inv = createInvoice({
                  customerId: customer?.id || "",
                  customerName: customer?.name || "",
                  amount: 0,
                  description: "Manual invoice",
                });
                toast({ title: "Invoice created", description: `${inv.id} created for ${customer?.name}. Set the amount on the Invoices page.` });
              }} data-testid="button-customer-create-invoice">
                <DollarSign size={14} className="mr-1.5" /> Create Invoice
              </Button>
              <Button size="sm" className="bg-primary text-primary-foreground" onClick={() => setShowNoteDialog(true)} data-testid="button-add-note">
                <Plus size={14} className="mr-1.5" /> Add Note
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="properties">Properties & Equipment</TabsTrigger>
          <TabsTrigger value="quotes">Quotes</TabsTrigger>
          <TabsTrigger value="photos">Photos</TabsTrigger>
          <TabsTrigger value="activity">Timeline</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Contacts */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">Contacts</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {customer.contacts.map((contact, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-xs font-bold">
                      {contact.name.split(" ").filter(n => /^[A-Za-z]/.test(n)).map(n => n[0]).slice(0, 2).join("")}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{contact.name}</p>
                      <p className="text-xs text-muted-foreground">{contact.role}</p>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <Phone size={14} />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <Mail size={14} />
                      </Button>
                    </div>
                  </div>
                ))}
                <div className="text-xs text-muted-foreground space-y-1 pt-2">
                  {customer.contacts.map((c, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <Phone size={11} /> {c.phone}
                      <span className="mx-1">·</span>
                      <Mail size={11} /> {c.email}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Properties */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold">Properties</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {customer.properties.map((prop) => (
                  <div key={prop.id} className="space-y-1">
                    <div className="flex items-start gap-2">
                      <MapPin size={14} className="text-muted-foreground mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm font-medium">{prop.address}</p>
                        <p className="text-xs text-muted-foreground">{prop.city}, {prop.state} {prop.zip}</p>
                      </div>
                    </div>
                    {prop.accessNotes && (
                      <p className="text-xs text-amber-600 dark:text-amber-500 pl-5">⚠ {prop.accessNotes}</p>
                    )}
                    {prop.gateCode && (
                      <p className="text-xs text-muted-foreground pl-5">Gate code: {prop.gateCode}</p>
                    )}
                    <div className="pl-5 mt-1">
                      <Badge variant="outline" className="text-[10px]">{prop.systems.length} HVAC system(s)</Badge>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* Notes Section */}
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <MessageSquare size={16} className="text-sky-500" />
                Notes
              </CardTitle>
              <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setShowNoteDialog(true)} data-testid="button-overview-add-note">
                <Plus size={12} className="mr-1" /> Add Note
              </Button>
            </CardHeader>
            <CardContent>
              {customerNotes.length > 0 ? (
                <div className="space-y-3">
                  {customerNotes.map((note) => (
                    <div key={note.id} className="flex gap-3 pb-3 border-b border-border last:border-0 last:pb-0">
                      <div className={`flex h-8 w-8 items-center justify-center rounded-full shrink-0 ${
                        note.author === "AI Assistant" ? "bg-purple-100 text-purple-600 dark:bg-purple-950/30 dark:text-purple-400" : "bg-sky-100 text-sky-600 dark:bg-sky-950/30 dark:text-sky-400"
                      }`}>
                        {note.author === "AI Assistant" ? <Sparkles size={14} /> : <MessageSquare size={14} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-medium">{note.author}</p>
                          <span className="text-[10px] text-muted-foreground">{note.date}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{note.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground text-center py-4">No notes yet. Add a note or upload a photo for AI analysis.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Properties & Equipment Tab */}
        <TabsContent value="properties" className="space-y-4">
          {customer.properties.map((prop) => (
            <Card key={prop.id}>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <MapPin size={14} className="text-muted-foreground" />
                  {prop.address}, {prop.city}, {prop.state} {prop.zip}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {prop.accessNotes && (
                  <div className="mb-3 p-2 rounded-lg bg-amber-50 dark:bg-amber-950/20 text-xs text-amber-700 dark:text-amber-500">
                    ⚠ Access: {prop.accessNotes}
                    {prop.gateCode && ` · Gate code: ${prop.gateCode}`}
                  </div>
                )}
                <div className="space-y-3">
                  {prop.systems.map((sys) => (
                    <div key={sys.id} className="flex items-start gap-3 p-3 rounded-lg border border-border">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted shrink-0">
                        <Wrench size={18} className="text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold">{sys.brand} {sys.type}</p>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${systemStatusColors[sys.status]}`}>
                            {sys.status}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">Model: {sys.model} · Serial: {sys.serial}</p>
                        <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5 text-xs text-muted-foreground">
                          <span>Installed: {sys.installDate}</span>
                          {sys.warrantyExp && <span>Warranty: {sys.warrantyExp}</span>}
                          {sys.refrigerant && <span>Refrigerant: {sys.refrigerant}</span>}
                          {sys.filterSize && <span>Filter: {sys.filterSize}</span>}
                        </div>
                        {sys.notes && (
                          <p className="text-xs text-muted-foreground mt-1.5 italic">{sys.notes}</p>
                        )}
                      </div>
                    </div>
                  ))}
                  {prop.systems.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">No HVAC systems recorded</p>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        {/* Quotes Tab */}
        <TabsContent value="quotes" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Quotes for {customer.name}</h3>
            <Button size="sm" variant="outline" onClick={() => setShowQuoteDialog(true)}>
              <FileText size={14} className="mr-1.5" /> New Quote
            </Button>
          </div>
          {customerQuotes.length > 0 ? (
            <div className="space-y-3">
              {customerQuotes.map((q) => (
                <Card key={q.id} className="hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3 flex-wrap">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 text-purple-600 dark:bg-purple-950/30 dark:text-purple-400 shrink-0">
                        <FileText size={18} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <Link href={`/proposals/${q.id}`}>
                            <p className="text-sm font-semibold hover:text-primary cursor-pointer">{q.id}</p>
                          </Link>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium ${
                            q.status === "Won" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400" :
                            q.status === "Quote Sent" ? "bg-purple-100 text-purple-700 dark:bg-purple-950/30 dark:text-purple-400" :
                            "bg-sky-100 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400"
                          }`}>
                            {q.status}
                          </span>
                        </div>
                        <p className="text-sm font-medium">{q.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{q.jobType} · Created {q.createdAt}</p>
                        <div className="flex gap-2 mt-2">
                          {q.options.map((opt) => (
                            <div key={opt.tier} className="text-xs px-2 py-1 rounded border border-border">
                              <span className="font-semibold">{opt.tier}</span>: {fmtCurrency(opt.customerPrice)}
                            </div>
                          ))}
                        </div>
                      </div>
                      <Link href={`/proposals/${q.id}`}>
                        <Button size="sm" variant="outline" className="text-xs shrink-0">View Proposal</Button>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="p-8 text-center">
                <FileText size={32} className="mx-auto text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground mb-3">No quotes yet for this customer.</p>
                <Button size="sm" onClick={() => setShowQuoteDialog(true)}>
                  <Plus size={14} className="mr-1.5" /> Create First Quote
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Photos Tab */}
        <TabsContent value="photos" className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Photos for {customer.name}</h3>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handlePhotoUpload}
                className="hidden"
                data-testid="input-photo-upload"
              />
              <Button size="sm" onClick={() => fileInputRef.current?.click()} data-testid="button-upload-photo">
                <Camera size={14} className="mr-1.5" /> Upload Photos
              </Button>
            </div>
          </div>
          {customerPhotos.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {customerPhotos.map((photo) => (
                <Card key={photo.id}>
                  <CardContent className="p-3">
                    <img
                      src={photo.dataUrl}
                      alt={photo.fileName}
                      className="w-full h-40 object-cover rounded-md mb-2"
                    />
                    <p className="text-xs font-medium truncate">{photo.fileName}</p>
                    <p className="text-[10px] text-muted-foreground">Uploaded {photo.uploadedAt}</p>
                    {photo.analyzing ? (
                      <div className="flex items-center gap-1.5 mt-2 text-xs text-sky-600">
                        <Loader2 size={12} className="animate-spin" /> AI analyzing photo...
                      </div>
                    ) : photo.analysis ? (
                      <div className="mt-2 p-2 rounded-md bg-sky-50 dark:bg-sky-950/20 text-[11px] text-muted-foreground">
                        <p className="flex items-center gap-1 font-medium text-sky-700 dark:text-sky-400 mb-0.5">
                          <Sparkles size={11} /> AI Analysis
                        </p>
                        {photo.analysis}
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="p-8 text-center">
                <Camera size={32} className="mx-auto text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground mb-1">No photos uploaded yet.</p>
                <p className="text-xs text-muted-foreground mb-3">Upload photos of equipment, job sites, or property conditions. AI will automatically analyze and create notes.</p>
                <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
                  <Upload size={14} className="mr-1.5" /> Upload First Photo
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Activity Timeline */}
        <TabsContent value="activity">
          <CustomerCommunications customerId={customer.id}/>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Activity Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="relative space-y-4">
                {customerNotes.map((note) => (
                  <div key={note.id} className="flex gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full shrink-0 bg-sky-100 text-sky-600 dark:bg-sky-950/30 dark:text-sky-400">
                      <MessageSquare size={15} />
                    </div>
                    <div className="flex-1 pb-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <p className="text-sm font-medium">{note.author === "AI Assistant" ? "AI Photo Analysis" : "Note"}</p>
                        <span className="text-xs text-muted-foreground">{note.date}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{note.text}</p>
                      <span className="text-[10px] text-muted-foreground/70">by {note.author}</span>
                    </div>
                  </div>
                ))}
                {customer.activity.slice().reverse().map((entry, i) => {
                  const Icon = activityIcons[entry.type] || MessageSquare;
                  return (
                    <div key={entry.id} className="flex gap-3">
                      {/* Timeline line */}
                      {i < customer.activity.length - 1 && (
                        <div className="absolute left-[18px] mt-9 w-px h-[calc(100%-2rem)] bg-border" style={{ height: "3rem" }} />
                      )}
                      <div className={`flex h-9 w-9 items-center justify-center rounded-full shrink-0 ${
                        entry.type === "approval" ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400" :
                        entry.type === "payment" ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400" :
                        entry.type === "membership" ? "bg-yellow-100 text-yellow-600 dark:bg-yellow-950/30 dark:text-yellow-400" :
                        entry.type === "quote" ? "bg-purple-100 text-purple-600 dark:bg-purple-950/30 dark:text-purple-400" :
                        "bg-muted text-muted-foreground"
                      }`}>
                        <Icon size={15} />
                      </div>
                      <div className="flex-1 pb-2">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <p className="text-sm font-medium">{entry.title}</p>
                          <span className="text-xs text-muted-foreground">{entry.date}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{entry.description}</p>
                        {entry.user && (
                          <span className="text-[10px] text-muted-foreground/70">by {entry.user}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* New Quote Dialog */}
      <Dialog open={showQuoteDialog} onOpenChange={(open) => { setShowQuoteDialog(open); if (!open) resetQuoteForm(); }}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText size={18} />
              New Quote — {customer.name}
            </DialogTitle>
            <DialogDescription>Build a quote with equipment from the pricebook. Good/Better/Best tiers will be generated automatically.</DialogDescription>
          </DialogHeader>

          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-2">
            {[1, 2, 3].map((s) => (
              <div key={s} className="flex items-center gap-2">
                <div className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${
                  quoteStep >= s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                }`}>
                  {s}
                </div>
                {s < 3 && <div className={`h-px w-8 ${quoteStep > s ? "bg-primary" : "bg-border"}`} />}
              </div>
            ))}
            <span className="text-xs text-muted-foreground ml-2">
              {quoteStep === 1 ? "Job Type" : quoteStep === 2 ? "Equipment" : "Pricing Summary"}
            </span>
          </div>

          <Separator />

          {/* Step 1: Job Type */}
          {quoteStep === 1 && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Job Type</Label>
                <Select value={jobType} onValueChange={setJobType}>
                  <SelectTrigger data-testid="select-quote-job-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {jobTypes.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="labor-cost">Labor Cost</Label>
                  <div className="relative">
                    <DollarSign size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="labor-cost"
                      type="number"
                      value={laborCost}
                      onChange={(e) => setLaborCost(e.target.value)}
                      className="pl-9"
                      data-testid="input-labor-cost"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="materials-cost">Materials Cost</Label>
                  <div className="relative">
                    <DollarSign size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="materials-cost"
                      type="number"
                      value={materialsCost}
                      onChange={(e) => setMaterialsCost(e.target.value)}
                      className="pl-9"
                      data-testid="input-materials-cost"
                    />
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="labor-desc">Labor Description</Label>
                <Textarea
                  id="labor-desc"
                  value={laborDesc}
                  onChange={(e) => setLaborDesc(e.target.value)}
                  rows={2}
                  className="text-sm"
                  placeholder="Describe the labor being performed..."
                  data-testid="input-labor-desc"
                />
              </div>
              <div className="rounded-lg bg-sky-50 dark:bg-sky-950/20 border border-sky-200 dark:border-sky-900/30 p-3 text-xs text-muted-foreground">
                <p className="flex items-center gap-1.5 font-medium text-sky-700 dark:text-sky-400">
                  <Sparkles size={14} /> Pricing Formula
                </p>
                <p className="mt-1">Customer price = Total Internal Cost ÷ 0.75 (25% margin). Internal costs are never shown to customers.</p>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowQuoteDialog(false)}>Cancel</Button>
                <Button onClick={() => setQuoteStep(2)} data-testid="button-quote-next-1">Next: Select Equipment</Button>
              </DialogFooter>
            </div>
          )}

          {/* Step 2: Equipment Selection */}
          {quoteStep === 2 && (
            <div className="space-y-3">
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
                        {filteredEquipment.filter(p => p.category === cat).map((item) => (
                          <SelectItem key={item.id} value={item.id} className="text-xs">
                            {item.model} — {fmtCurrency(item.cost)}
                          </SelectItem>
                        ))}
                      </div>
                    ))}
                  </SelectContent>
                </Select>
              </div>

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

              {/* Selected items summary */}
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

              {/* Equipment list */}
              <div className="max-h-[280px] overflow-y-auto space-y-1 rounded-lg border border-border p-1">
                {filteredEquipment.slice(0, 50).map((item) => {
                  const isSelected = selectedEquipment.includes(item.id);
                  return (
                    <button
                      key={item.id}
                      onClick={() => toggleEquipment(item.id)}
                      className={`w-full text-left p-2 rounded-md transition-colors flex items-center gap-2 ${
                        isSelected ? "bg-primary/10 border border-primary/30" : "hover:bg-muted/50 border border-transparent"
                      }`}
                    >
                      <div className={`flex h-4 w-4 items-center justify-center rounded shrink-0 ${
                        isSelected ? "bg-primary text-primary-foreground" : "border border-border"
                      }`}>
                        {isSelected && <CheckCircle2 size={12} />}
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

              <DialogFooter>
                <Button variant="outline" onClick={() => setQuoteStep(1)}>Back</Button>
                <Button onClick={() => setQuoteStep(3)} disabled={selectedEquipment.length === 0} data-testid="button-quote-next-2">
                  Next: Add-ons & Summary
                </Button>
              </DialogFooter>
            </div>
          )}

          {/* Step 3: Add-ons & Pricing Summary */}
          {quoteStep === 3 && (
            <div className="space-y-4">
              {/* Add-on services */}
              <div>
                <Label className="text-xs font-semibold mb-2 block">Optional Add-Ons</Label>
                <div className="grid grid-cols-1 gap-1.5">
                  {addOnServices.map((addon) => {
                    const isSelected = selectedAddOns.includes(addon.id);
                    return (
                      <button
                        key={addon.id}
                        onClick={() => toggleAddOn(addon.id)}
                        className={`w-full text-left p-2 rounded-md transition-colors flex items-center gap-2 ${
                          isSelected ? "bg-primary/10 border border-primary/30" : "hover:bg-muted/50 border border-transparent"
                        }`}
                      >
                        <div className={`flex h-4 w-4 items-center justify-center rounded shrink-0 ${
                          isSelected ? "bg-primary text-primary-foreground" : "border border-border"
                        }`}>
                          {isSelected && <CheckCircle2 size={12} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium">{addon.name}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{addon.description}</p>
                        </div>
                        <p className="text-xs font-semibold shrink-0">{fmtCurrency(addon.price)}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              <Separator />

              {/* Pricing Summary */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Equipment ({selectedItems.length} items)</span>
                  <span className="font-medium">{fmtCurrency(equipmentCost)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Labor</span>
                  <span className="font-medium">{fmtCurrency(labor)}</span>
                </div>
                {laborDesc && (
                  <p className="text-[10px] text-muted-foreground/70 pl-2">{laborDesc}</p>
                )}
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Materials</span>
                  <span className="font-medium">{fmtCurrency(materials)}</span>
                </div>
                <div className="flex justify-between text-xs pt-1 border-t border-border">
                  <span className="text-muted-foreground font-medium">Total Internal Cost</span>
                  <span className="font-bold">{fmtCurrency(totalCost)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Customer Price (÷ 0.75)</span>
                  <span className="font-medium text-sky-600">{fmtCurrency(customerPrice)}</span>
                </div>
                {addOnsTotal > 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Add-Ons</span>
                    <span className="font-medium">{fmtCurrency(addOnsTotal)}</span>
                  </div>
                )}
                <Separator />
                <div className="flex justify-between items-center pt-1">
                  <span className="text-sm font-semibold">Customer Total</span>
                  <span className="text-lg font-bold text-primary">{fmtCurrency(grandTotal)}</span>
                </div>
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <TrendingUp size={11} /> Gross Profit: {fmtCurrency(grossProfit)}
                  </span>
                  <span>Margin: {margin}%</span>
                </div>
              </div>

              <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/30 p-2 text-[10px] text-muted-foreground">
                Internal costs shown here are for your reference only and will not appear on the customer-facing proposal.
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setQuoteStep(2)}>Back</Button>
                <Button onClick={handleCreateQuote} data-testid="button-submit-quote" className="bg-primary text-primary-foreground">
                  <FileText size={14} className="mr-1.5" /> Create Quote
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Add Note Dialog */}
      <Dialog open={showNoteDialog} onOpenChange={setShowNoteDialog}>
        <DialogContent className="sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Add Note for {customer.name}</DialogTitle>
            <DialogDescription>Add a note to the customer timeline. Notes are visible to your team.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label htmlFor="note-text">Note</Label>
            <Textarea
              id="note-text"
              placeholder="e.g. Customer interested in upgrading to high-efficiency system. Will follow up with quote next week."
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              rows={4}
              data-testid="input-note-text"
            />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowNoteDialog(false)}>Cancel</Button>
            <Button onClick={handleAddNote} data-testid="button-submit-note">Add Note</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
