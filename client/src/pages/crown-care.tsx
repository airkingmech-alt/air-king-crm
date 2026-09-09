import { useState } from "react";
import { Link } from "wouter";
import {
  Crown,
  Plus,
  Calendar,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Clock,
  Users,
  DollarSign,
  TrendingUp,
  Search,
  ChevronDown,
  UserPlus,
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
import { useToast } from "@/hooks/use-toast";
import { useData } from "@/context/data-context";
import {
  teamMembers,
  fmtCurrency,
} from "@/data/mock-data";

export default function CrownCare() {
  const { toast } = useToast();
  const { customers, memberships, enrollMembership, addCustomer, createWorkOrder, updateWorkOrder } = useData();
  const [showEnrollDialog, setShowEnrollDialog] = useState(false);
  const [form, setForm] = useState({
    customer: "",
    billingFrequency: "Annual",
    autoRenew: "Yes",
    startDate: new Date().toISOString().slice(0, 10),
  });

  // Combobox state
  const [comboboxOpen, setComboboxOpen] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [showNewCustomerForm, setShowNewCustomerForm] = useState(false);
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

  // Post-enrollment schedule state
  const [enrolledMembershipId, setEnrolledMembershipId] = useState<string | null>(null);
  const [enrolledCustomerName, setEnrolledCustomerName] = useState("");
  const [scheduleForm, setScheduleForm] = useState({
    date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    time: "09:00",
    technician: "",
    priority: "Normal",
    visitType: "Spring Tune-Up (Cooling)" as "Spring Tune-Up (Cooling)" | "Fall Tune-Up (Heating)",
  });

  const activeMemberships = memberships.filter((m) => m.status === "Active");
  const pendingRenewals = memberships.filter((m) => m.paymentStatus === "Pending" || m.paymentStatus === "Overdue");
  const totalARR = activeMemberships.length * 189;
  const upcomingRenewals = memberships.filter((m) => {
    if (m.status !== "Active") return false;
    const today = new Date();
    const renewalDate = new Date(m.renewalDate);
    const daysUntil = Math.round((renewalDate.getTime() - today.getTime()) / 86400000);
    return daysUntil >= 0 && daysUntil <= 45;
  }).length;
  const unbookedVisits = activeMemberships.filter((m) => {
    const springUnbooked = !m.springVisit || m.springVisit.status === "Not Scheduled";
    const fallUnbooked = !m.fallVisit || m.fallVisit.status === "Not Scheduled";
    return springUnbooked || fallUnbooked;
  }).length;

  const selectedCustomer = customers.find((c) => c.id === form.customer);
  const filteredCustomers = customers.filter((c) =>
    c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
    (c.contacts[0]?.phone || "").includes(customerSearch) ||
    (c.properties[0]?.address || "").toLowerCase().includes(customerSearch.toLowerCase())
  );
  const exactMatch = customers.find((c) => c.name.toLowerCase() === customerSearch.trim().toLowerCase());
  const canAddNew = customerSearch.trim().length > 0 && !exactMatch;

  const handleSelectCustomer = (customerId: string) => {
    const c = customers.find((x) => x.id === customerId);
    setForm({ ...form, customer: customerId });
    setCustomerSearch(c?.name || "");
    setComboboxOpen(false);
    setShowNewCustomerForm(false);
  };

  const handleAddNewCustomer = (e: React.SyntheticEvent) => {
    e.preventDefault();
    const name = newCustomer.name.trim() || customerSearch.trim();
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
    setForm({ ...form, customer: created.id });
    setCustomerSearch(created.name);
    setShowNewCustomerForm(false);
    setNewCustomer({ name: "", type: "Residential", phone: "", email: "", address: "", city: "Kansas City", state: "MO", zip: "", leadSource: "Google Ads" });
    toast({ title: "Customer added", description: `${created.name} has been added and selected for enrollment.` });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.customer) {
      toast({ title: "Select a customer", description: "Please choose or create a customer to enroll.", variant: "destructive" });
      return;
    }
    const custName = selectedCustomer?.name || "Customer";
    const selectedProperty = selectedCustomer?.properties?.[0];
    const selectedAddress = selectedProperty ? `${selectedProperty.address}, ${selectedProperty.city}, ${selectedProperty.state} ${selectedProperty.zip}` : "TBD";
    const selectedSystemRecord = selectedProperty?.systems?.[0];
    const selectedSystem = selectedSystemRecord ? `${selectedSystemRecord.brand} ${selectedSystemRecord.type}` : "HVAC System";
    const price = form.billingFrequency === "Annual" ? "$189/year" : "$15.75/month";

    const membership = enrollMembership({
      customerId: form.customer,
      customerName: custName,
      propertyAddress: selectedAddress,
      systemDescription: selectedSystem,
      billingFrequency: form.billingFrequency as "Annual" | "Monthly",
    });

    toast({
      title: "Crown Care enrollment complete",
      description: `${custName} enrolled in Crown Care (${form.billingFrequency} billing — ${price}). Schedule the first visit below.`,
    });
    // Switch to schedule step
    setEnrolledMembershipId(membership.id);
    setEnrolledCustomerName(custName);
    setScheduleForm({
      date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      time: "09:00",
      technician: "",
      priority: "Normal",
      visitType: "Spring Tune-Up (Cooling)",
    });
  };

  const handleScheduleVisit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.customer) return;
    const propertyAddress = selectedCustomer?.properties?.[0]?.address || "TBD";
    const wo = createWorkOrder({
      customerId: form.customer,
      customerName: enrolledCustomerName,
      type: scheduleForm.visitType,
      property: propertyAddress,
      description: `Crown Care ${scheduleForm.visitType.toLowerCase()} — precision tune-up`,
    });
    updateWorkOrder(wo.id, {
      scheduledDate: scheduleForm.date,
      scheduledTime: scheduleForm.time,
      technician: scheduleForm.technician || undefined,
      priority: scheduleForm.priority as any,
      status: scheduleForm.technician ? "Scheduled" : "Unscheduled",
    });
    toast({
      title: "Visit scheduled",
      description: `${scheduleForm.visitType} for ${enrolledCustomerName} on ${scheduleForm.date} at ${scheduleForm.time}${scheduleForm.technician ? ` with ${scheduleForm.technician}` : ""}.`,
    });
    closeEnrollDialog();
  };

  const closeEnrollDialog = () => {
    setShowEnrollDialog(false);
    setEnrolledMembershipId(null);
    setEnrolledCustomerName("");
    setForm({ customer: "", billingFrequency: "Annual", autoRenew: "Yes", startDate: new Date().toISOString().slice(0, 10) });
    setCustomerSearch("");
    setShowNewCustomerForm(false);
    setComboboxOpen(false);
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Crown size="20" className="text-yellow-600" />
            Crown Care
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Maintenance membership program</p>
        </div>
        <Button size="sm" className="bg-primary text-primary-foreground" onClick={() => setShowEnrollDialog(true)} data-testid="button-enroll-customer">
          <Plus size={16} className="mr-1.5" />
          Enroll Customer
        </Button>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-yellow-50 dark:bg-yellow-950/30 mb-3">
              <Users size={18} className="text-yellow-600" />
            </div>
            <p className="text-2xl font-bold">{activeMemberships.length}</p>
            <p className="text-xs text-muted-foreground">Active Members</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 mb-3">
              <DollarSign size={18} className="text-emerald-600" />
            </div>
            <p className="text-2xl font-bold">{fmtCurrency(totalARR)}</p>
            <p className="text-xs text-muted-foreground">Annual Recurring Value</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-sky-50 dark:bg-sky-950/30 mb-3">
              <RefreshCw size={18} className="text-sky-600" />
            </div>
            <p className="text-2xl font-bold">{upcomingRenewals}</p>
            <p className="text-xs text-muted-foreground">Upcoming Renewals</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-center h-9 w-9 rounded-lg bg-amber-50 dark:bg-amber-950/30 mb-3">
              <Calendar size={18} className="text-amber-600" />
            </div>
            <p className="text-2xl font-bold">{unbookedVisits}</p>
            <p className="text-xs text-muted-foreground">Unbooked Visits</p>
          </CardContent>
        </Card>
      </div>

      {/* Plan Info Card */}
      <Card className="bg-gradient-to-r from-yellow-50 to-amber-50 dark:from-yellow-950/20 dark:to-amber-950/20 border-yellow-200 dark:border-yellow-900/30">
        <CardContent className="p-5">
          <div className="flex items-start gap-4 flex-wrap">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-yellow-500 text-white shrink-0">
              <Crown size={24} />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-bold">Crown Care Membership</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Two seasonal precision tune-ups per year · Automatic spring/fall reminders · Priority service · Annual renewal
              </p>
              <div className="flex gap-4 mt-3">
                <div>
                  <p className="text-lg font-bold">{fmtCurrency(189)}</p>
                  <p className="text-[10px] text-muted-foreground">Annual (2 visits)</p>
                </div>
                <div>
                  <p className="text-lg font-bold">{fmtCurrency(16)}</p>
                  <p className="text-[10px] text-muted-foreground">Monthly equivalent</p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Memberships List */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Active Memberships</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {memberships.map((m) => (
            <div key={m.id} className="flex items-start gap-3 p-3 rounded-lg border border-border hover:bg-muted/30 transition-colors">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-yellow-100 dark:bg-yellow-950/30 text-yellow-600 shrink-0">
                <Crown size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <Link href={`/customers/${m.customerId}`}>
                  <p className="text-sm font-medium hover:text-primary cursor-pointer">{m.customerName}</p>
                </Link>
                <p className="text-xs text-muted-foreground">{m.propertyAddress}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{m.systemDescription}</p>

                {/* Visit status */}
                <div className="flex gap-2 mt-2 flex-wrap">
                  <div className="flex items-center gap-1 text-xs">
                    <span className="text-muted-foreground">Spring:</span>
                    <Badge
                      variant={
                        m.springVisit?.status === "Completed" ? "default" :
                        m.springVisit?.status === "Scheduled" ? "secondary" : "outline"
                      }
                      className="text-[10px] py-0"
                    >
                      {m.springVisit?.status}
                    </Badge>
                    {m.springVisit?.scheduledDate && (
                      <span className="text-[10px] text-muted-foreground">{m.springVisit.scheduledDate}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 text-xs">
                    <span className="text-muted-foreground">Fall:</span>
                    <Badge
                      variant={
                        m.fallVisit?.status === "Completed" ? "default" :
                        m.fallVisit?.status === "Scheduled" ? "secondary" : "outline"
                      }
                      className="text-[10px] py-0"
                    >
                      {m.fallVisit?.status}
                    </Badge>
                    {m.fallVisit?.scheduledDate && (
                      <span className="text-[10px] text-muted-foreground">{m.fallVisit.scheduledDate}</span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-end gap-1.5 shrink-0">
                <Badge
                  variant={
                    m.paymentStatus === "Paid" ? "default" :
                    m.paymentStatus === "Overdue" ? "destructive" : "secondary"
                  }
                  className="text-[10px]"
                >
                  {m.paymentStatus}
                </Badge>
                <div className="text-right">
                  <p className="text-[10px] text-muted-foreground">Renews</p>
                  <p className="text-xs font-medium">{m.renewalDate}</p>
                </div>
                <div className="flex items-center gap-1">
                  {m.autoRenew && (
                    <Badge variant="outline" className="text-[9px] py-0">Auto</Badge>
                  )}
                  <p className="text-[10px] text-muted-foreground">{m.billingFrequency}</p>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Renewals Needing Attention */}
      {pendingRenewals.length > 0 && (
        <Card className="border-amber-200 dark:border-amber-900/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <AlertCircle size={16} className="text-amber-500" />
              Renewals Needing Attention
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {pendingRenewals.map((m) => (
              <div key={m.id} className="flex items-center gap-3 p-2 rounded-lg bg-amber-50 dark:bg-amber-950/10">
                <Clock size={14} className="text-amber-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{m.customerName}</p>
                  <p className="text-xs text-muted-foreground">Renewal date: {m.renewalDate} · {m.paymentStatus}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs shrink-0"
                  onClick={() => {
                    const customer = customers.find((c) => c.id === m.customerId);
                    const email = customer?.contacts?.[0]?.email;
                    if (!customer || !email) {
                      toast({
                        title: "Email not found",
                        description: `We couldn't find an email address for ${m.customerName}.`,
                        variant: "destructive",
                      });
                      return;
                    }
                    const subject = "Your Crown Care Membership Renewal - Air King Mechanical Services";
                    const renewalBody = `Dear ${m.customerName},\n\nThis is a friendly reminder that your Crown Care membership is due for renewal on ${m.renewalDate} (${m.billingFrequency} billing).\n\nPlease contact us at your earliest convenience to renew your Crown Care membership and continue receiving your seasonal tune-ups and priority service.\n\nBest regards,\nAir King Mechanical Services LLC, Kansas City, MO`;
                    window.location.href = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(renewalBody)}`;
                    toast({
                      title: "Renewal notice opened",
                      description: `Your email client should open with a renewal reminder for ${m.customerName}.`,
                    });
                  }}
                  data-testid={`button-send-renewal-${m.id}`}
                >
                  Send Renewal Notice
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Enroll Customer Dialog */}
      <Dialog open={showEnrollDialog} onOpenChange={(open) => { if (!open) closeEnrollDialog(); else setShowEnrollDialog(true); }}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Crown size={18} className="text-yellow-600" />
              {enrolledMembershipId ? "Schedule First Visit" : "Enroll Customer in Crown Care"}
            </DialogTitle>
            <DialogDescription>
              {enrolledMembershipId
                ? `${enrolledCustomerName} is enrolled. Schedule the first precision tune-up below — or skip and do it later from the Schedule page.`
                : "$189/year (2 visits) or $15.75/month. Includes spring and fall precision tune-ups, priority service, and automatic reminders."}
            </DialogDescription>
          </DialogHeader>

          {/* STEP 1: Enroll */}
          {!enrolledMembershipId && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label>Customer *</Label>
                <Popover open={comboboxOpen} onOpenChange={setComboboxOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      data-testid="select-enroll-customer"
                      className="w-full justify-between font-normal"
                      onClick={() => setComboboxOpen(true)}
                    >
                      {selectedCustomer ? (
                        <span className="flex flex-col items-start gap-0.5">
                          <span className="font-medium">{selectedCustomer.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {selectedCustomer.properties[0]?.address || ""}{selectedCustomer.properties[0]?.city ? ", " + selectedCustomer.properties[0].city : ""}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Type to search all customers...</span>
                      )}
                      <ChevronDown size={16} className="opacity-50 shrink-0" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                    <Command shouldFilter={false}>
                      <CommandInput
                        placeholder="Search by name, phone, or address..."
                        value={customerSearch}
                        onValueChange={setCustomerSearch}
                      />
                      <CommandList>
                        <CommandEmpty>
                          {canAddNew ? "No match — create a new customer below." : "No customers found."}
                        </CommandEmpty>
                        <CommandGroup heading="Customers">
                          {filteredCustomers.slice(0, 50).map((c) => (
                            <CommandItem
                              key={c.id}
                              value={c.id}
                              onSelect={() => handleSelectCustomer(c.id)}
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
                              value={`new-${customerSearch}`}
                              onSelect={() => {
                                setNewCustomer({ ...newCustomer, name: customerSearch.trim() });
                                setShowNewCustomerForm(true);
                                setComboboxOpen(false);
                              }}
                              data-testid="option-add-new-customer"
                            >
                              <UserPlus size={14} className="mr-2" />
                              Add new customer: "{customerSearch.trim()}"
                            </CommandItem>
                          </CommandGroup>
                        )}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              {/* Inline new-customer form */}
              {showNewCustomerForm && (
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
                      <Button type="button" variant="ghost" size="sm" onClick={() => setShowNewCustomerForm(false)}>
                        Cancel
                      </Button>
                      <Button type="button" size="sm" onClick={handleAddNewCustomer} data-testid="button-submit-new-customer">
                        Create & Select
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Billing Frequency</Label>
                  <Select value={form.billingFrequency} onValueChange={(v) => setForm({ ...form, billingFrequency: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Annual">Annual — $189/yr</SelectItem>
                      <SelectItem value="Monthly">Monthly — $15.75/mo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Auto-Renew</Label>
                  <Select value={form.autoRenew} onValueChange={(v) => setForm({ ...form, autoRenew: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Yes">Yes</SelectItem>
                      <SelectItem value="No">No</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="enroll-start">Start Date</Label>
                <Input
                  id="enroll-start"
                  type="date"
                  value={form.startDate}
                  onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                />
              </div>
              <div className="rounded-lg bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-900/30 p-3 text-xs text-muted-foreground">
                <p className="flex items-center gap-1.5 font-medium text-yellow-700 dark:text-yellow-400">
                  <CheckCircle2 size={14} />
                  What's included:
                </p>
                <ul className="mt-1.5 space-y-0.5 ml-5 list-disc">
                  <li>Spring precision tune-up (AC/cooling)</li>
                  <li>Fall precision tune-up (furnace/heating)</li>
                  <li>Priority service scheduling</li>
                  <li>15% discount on repairs</li>
                  <li>Automatic seasonal reminders</li>
                </ul>
              </div>
              <DialogFooter className="gap-2">
                <Button type="button" variant="outline" onClick={closeEnrollDialog}>Cancel</Button>
                <Button type="submit" data-testid="button-submit-enroll">Enroll Customer</Button>
              </DialogFooter>
            </form>
          )}

          {/* STEP 2: Schedule first visit */}
          {enrolledMembershipId && (
            <form onSubmit={handleScheduleVisit} className="space-y-4">
              <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/30 p-3 flex items-center gap-2">
                <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-emerald-700 dark:text-emerald-400">{enrolledCustomerName}</span> is now enrolled in Crown Care. Schedule the first tune-up below.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Visit Type</Label>
                <Select value={scheduleForm.visitType} onValueChange={(v) => setScheduleForm({ ...scheduleForm, visitType: v as any })}>
                  <SelectTrigger data-testid="select-visit-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Spring Tune-Up (Cooling)">Spring Tune-Up (Cooling)</SelectItem>
                    <SelectItem value="Fall Tune-Up (Heating)">Fall Tune-Up (Heating)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="visit-date">Date</Label>
                  <Input
                    id="visit-date"
                    type="date"
                    value={scheduleForm.date}
                    onChange={(e) => setScheduleForm({ ...scheduleForm, date: e.target.value })}
                    data-testid="input-visit-date"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="visit-time">Time</Label>
                  <Input
                    id="visit-time"
                    type="time"
                    value={scheduleForm.time}
                    onChange={(e) => setScheduleForm({ ...scheduleForm, time: e.target.value })}
                    data-testid="input-visit-time"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Technician</Label>
                  <Select value={scheduleForm.technician} onValueChange={(v) => setScheduleForm({ ...scheduleForm, technician: v })}>
                    <SelectTrigger data-testid="select-visit-technician">
                      <SelectValue placeholder="Assign to..." />
                    </SelectTrigger>
                    <SelectContent>
                      {teamMembers.map((t) => (
                        <SelectItem key={t.name} value={t.name}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Priority</Label>
                  <Select value={scheduleForm.priority} onValueChange={(v) => setScheduleForm({ ...scheduleForm, priority: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Low">Low</SelectItem>
                      <SelectItem value="Normal">Normal</SelectItem>
                      <SelectItem value="High">High</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter className="gap-2">
                <Button type="button" variant="outline" onClick={closeEnrollDialog} data-testid="button-skip-visit">
                  Skip for Now
                </Button>
                <Button type="submit" data-testid="button-submit-visit">
                  Schedule Visit
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
