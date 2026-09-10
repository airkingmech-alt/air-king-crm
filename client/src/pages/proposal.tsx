import { DocumentActions } from "@/components/document-actions";
import { useParams, Link } from "wouter";
import { useState, useEffect } from "react";
import {
  ArrowLeft,
  Check,
  Crown,
  Star,
  PenTool,
  Share2,
  Download,
  Shield,
  Zap,
  Wind,
  Droplet,
  Thermometer,
  Filter,
  TrendingUp,
  Clock,
  FileText,
  Receipt,
  Send,
  Copy,
  Mail,
  MessageSquare,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { fmtCurrency } from "@/data/mock-data";
import {
  addOnServices,
  formatEquipmentDescription,
  pricebook,
  getTieredEquipment,
} from "@/data/pricebook";
import { useData } from "@/context/data-context";

const addOnIcons: Record<string, typeof Wind> = {
  wind: Wind,
  droplet: Droplet,
  zap: Zap,
  thermostat: Thermometer,
  filter: Filter,
  crown: Crown,
};

export default function Proposal() {
  const { id } = useParams<{ id: string }>();
  const { toast } = useToast();
  const {
    createWorkOrder,
    updateQuoteStatus,
    updateWorkOrder,
    createInvoice,
    quotes,
    invoices,
  } = useData();
  const quote = quotes.find((q) => q.id === id);
  const [selectedTier, setSelectedTier] = useState<string | null>(null);
  const [selectedAddOns, setSelectedAddOns] = useState<string[]>([]);
  const [accepted, setAccepted] = useState(false);
  const [showSendDialog, setShowSendDialog] = useState(false);
  const [sendTarget, setSendTarget] = useState({ email: "", phone: "" });

  // Sync accepted state and auto-select tier when quote loads
  useEffect(() => {
    if (quote?.status === "Won") {
      setAccepted(true);
      // Auto-select Better tier if none selected
      setSelectedTier(
        quote.selectedOption ||
          quote.options.find((o) => o.tier === "Better")?.tier ||
          quote.options[0]?.tier ||
          null,
      );
      setSelectedAddOns(quote.selectedAddOns || []);
    }
  }, [quote?.status]);

  if (!quote) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">Proposal not found.</p>
        <Link href="/quotes">
          <Button variant="outline" size="sm" className="mt-4">
            Back to Quotes
          </Button>
        </Link>
      </div>
    );
  }

  const toggleAddOn = (addonId: string) => {
    setSelectedAddOns((prev) =>
      prev.includes(addonId)
        ? prev.filter((x) => x !== addonId)
        : [...prev, addonId],
    );
  };

  const handleDownloadPdf = () => {
    toast({
      title: "Preparing PDF",
      description:
        "Use your browser's print dialog to save this proposal as a PDF.",
    });
    window.print();
  };

  const selectedOption = quote.options.find((o) => o.tier === selectedTier);
  const addOnTotal = addOnServices
    .filter((a: (typeof addOnServices)[number]) =>
      selectedAddOns.includes(a.id),
    )
    .reduce(
      (sum: number, a: (typeof addOnServices)[number]) => sum + a.price,
      0,
    );
  const grandTotal = (selectedOption?.customerPrice || 0) + addOnTotal;
  const monthlyEstimate = Math.round(grandTotal / 60); // ~5 year financing estimate
  const invoiceForQuote = invoices.find(
    (invoice) => invoice.quoteId === quote.id,
  );
  const createInvoiceFromQuote = () => {
    if (invoiceForQuote || !selectedOption) return;
    const equipmentItems = quote.equipmentItems
      ? getTieredEquipment(
          quote.equipmentItems,
          selectedOption.tier as "Good" | "Better" | "Best",
        ).map((item) => item.id)
      : [];
    const invoice = createInvoice({
      customerId: quote.customerId,
      customerName: quote.customerName,
      amount: grandTotal,
      description: `${quote.title} — ${selectedOption.label} package`,
      quoteId: quote.id,
      equipmentItems,
    });
    toast({
      title: "Invoice created",
      description: `${invoice.id} created for ${quote.customerName} — ${fmtCurrency(grandTotal)}.`,
    });
  };

  return (
    <div className="min-h-full bg-gradient-to-b from-sky-50 to-background dark:from-slate-900 dark:to-background">
      <style>{`
        @media print {
          .no-print {
            display: none !important;
          }
          .proposal-printable {
            padding: 0 !important;
            margin: 0 !important;
            max-width: 100% !important;
          }
        }
      `}</style>
      <div className="max-w-4xl mx-auto px-4 py-6 proposal-printable">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3 no-print">
          <Link href="/quotes">
            <Button variant="ghost" size="sm">
              <ArrowLeft size={16} className="mr-1.5" /> Back to Quotes
            </Button>
          </Link>
          <div className="flex gap-2">
            {quote.status === "Won" &&
              (invoiceForQuote ? (
                <Link href="/invoices">
                  <Button
                    size="sm"
                    className="bg-emerald-600 text-white hover:bg-emerald-700"
                  >
                    <Receipt size={14} className="mr-1.5" /> View Invoice
                  </Button>
                </Link>
              ) : (
                <Button
                  size="sm"
                  className="bg-emerald-600 text-white hover:bg-emerald-700"
                  onClick={createInvoiceFromQuote}
                  disabled={!selectedOption}
                  data-testid="button-create-invoice-corner"
                >
                  <Receipt size={14} className="mr-1.5" /> Create Invoice
                </Button>
              ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowSendDialog(true)}
              data-testid="button-send-proposal"
            >
              <Send size={14} className="mr-1.5" /> Send to Customer
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadPdf}
              data-testid="button-download-pdf"
            >
              <Download size={14} className="mr-1.5" /> PDF
            </Button>
          </div>
        </div>

        {/* Proposal Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center mb-3">
            <svg width="48" height="48" viewBox="0 0 40 40" fill="none">
              <path
                d="M6 16L10 8L14 14L20 6L26 14L30 8L34 16L34 20L6 20L6 16Z"
                fill="#D4A53A"
              />
              <circle cx="10" cy="7" r="2" fill="#D4A53A" />
              <circle cx="20" cy="5" r="2" fill="#D4A53A" />
              <circle cx="30" cy="7" r="2" fill="#D4A53A" />
              <ellipse
                cx="20"
                cy="37"
                rx="12"
                ry="1.5"
                fill="#D4A53A"
                opacity="0.6"
              />
            </svg>
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-navy-900 dark:text-white">
            Air King Mechanical Services
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Professional HVAC Proposal for {quote.customerName}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Proposal {quote.id} · {quote.title} · {quote.createdAt}
          </p>
        </div>

        {/* Equipment List */}
        {quote.equipmentItems && quote.equipmentItems.length > 0 && (
          <Card className="mb-6">
            <CardContent className="p-5">
              <h2 className="text-sm font-semibold mb-1">Equipment Included</h2>
              <p className="text-xs text-muted-foreground mb-4">
                {selectedTier
                  ? `Equipment for the ${selectedTier} package`
                  : "Select a package below to see included equipment"}
              </p>
              <div className="space-y-2">
                {(selectedTier
                  ? getTieredEquipment(
                      quote.equipmentItems,
                      selectedTier as "Good" | "Better" | "Best",
                    )
                  : quote.equipmentItems
                      .map((id) => pricebook.find((p) => p.id === id))
                      .filter(Boolean)
                ).map((item) => {
                  if (!item) return null;
                  return (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 p-2 rounded-lg border border-border"
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 dark:bg-sky-950/30 text-sky-600 dark:text-sky-400 shrink-0">
                        <Zap size={14} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">
                          {formatEquipmentDescription(item)}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {item.model}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        {item.brand}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Good/Better/Best Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {quote.options.map((option) => {
            const isSelected = selectedTier === option.tier;
            return (
              <Card
                key={option.tier}
                className={`relative transition-all cursor-pointer ${
                  isSelected
                    ? "ring-2 ring-primary shadow-lg"
                    : "hover:shadow-md"
                } ${option.isPopular ? "md:scale-105" : ""}`}
                onClick={() => {
                  if (!accepted) setSelectedTier(option.tier);
                }}
              >
                {option.isPopular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-primary text-primary-foreground text-xs px-3 py-1">
                      <Star size={10} className="mr-1" /> Most Popular
                    </Badge>
                  </div>
                )}
                <CardContent className="p-5">
                  <div className="text-center mb-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      {option.tier}
                    </p>
                    <p className="text-lg font-bold mt-1">{option.label}</p>
                  </div>

                  <div className="text-center mb-4">
                    <p className="text-2xl font-extrabold tracking-tight">
                      {fmtCurrency(option.customerPrice)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Installed · all-inclusive
                    </p>
                  </div>

                  <div className="space-y-2 mb-4">
                    <p className="text-xs font-semibold text-muted-foreground mb-1">
                      {option.equipment}
                    </p>
                    <p className="text-xs font-medium text-primary">
                      {option.efficiency}
                    </p>
                    <Separator className="my-2" />
                    {option.features.map((feature, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <Check
                          size={14}
                          className="text-emerald-500 shrink-0 mt-0.5"
                        />
                        <span className="text-xs">{feature}</span>
                      </div>
                    ))}
                  </div>

                  <Button
                    className={`w-full ${isSelected ? "bg-primary text-primary-foreground" : ""}`}
                    variant={isSelected ? "default" : "outline"}
                    size="sm"
                  >
                    {isSelected ? (
                      <>
                        <Check size={14} className="mr-1.5" /> Selected
                      </>
                    ) : (
                      `Select ${option.tier}`
                    )}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {/* Add-ons */}
        <Card className="mb-6">
          <CardContent className="p-5">
            <h2 className="text-sm font-semibold mb-1">Enhance Your System</h2>
            <p className="text-xs text-muted-foreground mb-4">
              Optional add-ons — select to add to your package
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {addOnServices.map((addon) => {
                const selected = selectedAddOns.includes(addon.id);
                const Icon = addOnIcons[addon.icon] || Zap;
                return (
                  <button
                    key={addon.id}
                    onClick={() => toggleAddOn(addon.id)}
                    className={`flex items-start gap-3 p-3 rounded-lg border text-left transition-colors ${
                      selected
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <div
                      className={`flex h-8 w-8 items-center justify-center rounded-lg shrink-0 ${
                        selected
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <Icon size={15} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium">{addon.name}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {addon.description}
                      </p>
                      <p className="text-xs font-semibold mt-0.5">
                        {fmtCurrency(addon.price)}
                      </p>
                    </div>
                    <div
                      className={`flex h-5 w-5 items-center justify-center rounded border shrink-0 ${
                        selected
                          ? "bg-primary border-primary text-primary-foreground"
                          : "border-border"
                      }`}
                    >
                      {selected && <Check size={12} />}
                    </div>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Summary & Approval */}
        {selectedTier && (
          <Card className="bg-primary/5 border-primary/20 mb-6">
            <CardContent className="p-5">
              <h2 className="text-sm font-semibold mb-3">Your Selection</h2>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>{selectedOption?.label} Package</span>
                  <span className="font-medium">
                    {fmtCurrency(selectedOption?.customerPrice || 0)}
                  </span>
                </div>
                {selectedAddOns.map((addonId) => {
                  const addon = addOnServices.find((a) => a.id === addonId);
                  return (
                    <div key={addonId} className="flex justify-between text-sm">
                      <span>{addon?.name}</span>
                      <span className="font-medium">
                        {fmtCurrency(addon?.price || 0)}
                      </span>
                    </div>
                  );
                })}
                <Separator className="my-2" />
                <div className="flex justify-between items-center">
                  <span className="text-sm font-semibold">
                    Total Installed Price
                  </span>
                  <span className="text-xl font-extrabold">
                    {fmtCurrency(grandTotal)}
                  </span>
                </div>
                <div className="flex items-center gap-2 p-2 rounded-lg bg-sky-50 dark:bg-sky-950/20 text-xs text-sky-700 dark:text-sky-400">
                  <TrendingUp size={14} />
                  Est. {fmtCurrency(monthlyEstimate)}/mo with financing ·
                  Subject to credit approval · Wisetack
                </div>
              </div>

              <div className="mt-4 space-y-2">
                {accepted ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-center gap-2 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900">
                      <Check size={20} className="text-emerald-600" />
                      <div>
                        <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
                          Proposal Accepted
                        </p>
                        <p className="text-[10px] text-emerald-600 dark:text-emerald-500">
                          Work order created and added to the schedule queue.
                        </p>
                      </div>
                    </div>
                    <Button
                      className="w-full"
                      variant="outline"
                      onClick={createInvoiceFromQuote}
                      disabled={!!invoiceForQuote}
                      data-testid="button-create-invoice-from-quote"
                    >
                      <FileText size={16} className="mr-2" />
                      {invoiceForQuote
                        ? `Invoice ${invoiceForQuote.id} Created`
                        : `Create Invoice (${fmtCurrency(grandTotal)})`}
                    </Button>
                  </div>
                ) : (
                  <>
                    <Button
                      className="w-full bg-primary text-primary-foreground"
                      size="lg"
                      onClick={() => {
                        const wo = createWorkOrder({
                          customerId: quote.customerId,
                          customerName: quote.customerName,
                          type: quote.jobType,
                          property: "TBD",
                          description: quote.title,
                          quoteId: quote.id,
                        });
                        updateWorkOrder(wo.id, {
                          status: "Unscheduled",
                          scheduledDate: undefined,
                          scheduledTime: undefined,
                          technician: undefined,
                        });
                        updateQuoteStatus(quote.id, "Won");
                        toast({
                          title: "Proposal accepted!",
                          description: `Proposal accepted! Work order ${wo.id} created and added to the unassigned queue on the Schedule page.`,
                        });
                        setAccepted(true);
                      }}
                    >
                      <PenTool size={16} className="mr-2" />
                      Approve & Sign Proposal
                    </Button>
                    <p className="text-[10px] text-center text-muted-foreground">
                      By approving, you authorize Air King to proceed with the
                      selected package. No deposit required.
                    </p>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Warranty & Terms */}
        <Card className="mb-6">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center gap-2">
              <Shield size={16} className="text-primary" />
              <h3 className="text-sm font-semibold">Warranty & Guarantees</h3>
            </div>
            <div className="space-y-2 text-xs text-muted-foreground">
              <div className="flex items-start gap-2">
                <Check size={12} className="text-emerald-500 mt-0.5 shrink-0" />
                <span>
                  10-year parts and labor warranty on all Champion equipment
                </span>
              </div>
              <div className="flex items-start gap-2">
                <Check size={12} className="text-emerald-500 mt-0.5 shrink-0" />
                <span>
                  100% satisfaction guarantee — if you're not happy, we'll make
                  it right
                </span>
              </div>
              <div className="flex items-start gap-2">
                <Check size={12} className="text-emerald-500 mt-0.5 shrink-0" />
                <span>Licensed and insured HVAC professionals</span>
              </div>
            </div>
            <Separator />
            <div className="text-[10px] text-muted-foreground">
              <p className="font-medium mb-1">Terms & Conditions:</p>
              <p>
                Proposal valid for 30 days. Installation typically scheduled
                within 1-2 weeks of approval. Balance due upon completion.
                Financing available through Wisetack (subject to credit
                approval). Prices include all equipment, labor, and standard
                materials. Additional charges may apply for non-standard
                ductwork, electrical upgrades, or permits.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="text-center py-4">
          <p className="text-xs text-muted-foreground">
            Air King Mechanical Services LLC · Kansas City, MO · Lic.
            #HVAC-2019-0442
          </p>
          <p className="text-[10px] text-muted-foreground mt-1">
            Prices subject to change without notice. © 2026 Air King Mechanical
            Services.
          </p>
        </div>
      </div>

      {/* Send Dialog */}
      <Dialog open={showSendDialog} onOpenChange={setShowSendDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send to Customer</DialogTitle>
            <DialogDescription>Share this document securely.</DialogDescription>
          </DialogHeader>
          <DocumentActions kind="quote" id={quote.id} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
