import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  Clock,
  Gift,
  Mail,
  Plus,
  Search,
  UserRoundPlus,
} from "lucide-react";
import { crm } from "@/lib/crm-api";
import { useData } from "@/context/data-context";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type CouponStatus = "active" | "used" | "expired" | "void";
type Coupon = {
  id: string;
  customer_id: string;
  referral_id: string;
  code: string;
  description: string;
  amount_cents: number;
  status: CouponStatus;
  issued_at: string;
  expires_at?: string;
  emailed_at?: string;
  reminder_sent_at?: string;
  used_at?: string;
};
type Referral = {
  id: string;
  referring_customer_id: string;
  referred_customer_id: string;
  completed_job_id?: string;
  notes: string;
  created_at: string;
};
type Response = { coupons: Coupon[]; referrals: Referral[] };

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
const date = (value?: string) =>
  value
    ? new Date(value).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : "No expiration";

export default function Referrals() {
  const { customers, workOrders } = useData();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | CouponStatus>("active");
  const [search, setSearch] = useState("");
  const [referrer, setReferrer] = useState("");
  const [referred, setReferred] = useState("");
  const [job, setJob] = useState("");
  const [expires, setExpires] = useState(() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [notes, setNotes] = useState("");

  const query = useQuery<Response>({
    queryKey: ["referral-coupons"],
    queryFn: () => crm("crm/referrals"),
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["referral-coupons"] });
  const act = useMutation({
    mutationFn: ({
      path,
      body,
    }: {
      path: string;
      body?: Record<string, unknown>;
    }) => crm(path, "POST", body || {}, crypto.randomUUID()),
    onSuccess: (result) => {
      toast({ title: result.message });
      refresh();
    },
    onError: (error: Error) =>
      toast({
        title: "Unable to complete action",
        description: error.message,
        variant: "destructive",
      }),
  });
  const create = useMutation({
    mutationFn: () =>
      crm("crm/referrals", "POST", {
        referring_customer_id: referrer,
        referred_customer_id: referred,
        completed_job_id: job || null,
        expires_at: new Date(expires + "T23:59:59-05:00").toISOString(),
        notes,
      }),
    onSuccess: (result) => {
      toast({
        title: result.message,
        description: "You can now email the coupon.",
      });
      setOpen(false);
      setReferrer("");
      setReferred("");
      setJob("");
      setNotes("");
      refresh();
    },
    onError: (error: Error) =>
      toast({
        title: "Coupon not created",
        description: error.message,
        variant: "destructive",
      }),
  });

  const customerName = (id: string) =>
    customers.find((customer) => customer.id === id)?.name ||
    "Unknown customer";
  const completedJobs = workOrders.filter(
    (workOrder) =>
      workOrder.customerId === referred && workOrder.status === "Completed",
  );
  const referrals = query.data?.referrals || [];
  const coupons = query.data?.coupons || [];
  const visible = useMemo(
    () =>
      coupons.filter((coupon) => {
        const referral = referrals.find(
          (item) => item.id === coupon.referral_id,
        );
        const names = [
          customerName(coupon.customer_id),
          referral ? customerName(referral.referred_customer_id) : "",
          coupon.code,
        ]
          .join(" ")
          .toLowerCase();
        return (
          (filter === "all" || coupon.status === filter) &&
          names.includes(search.toLowerCase())
        );
      }),
    [coupons, referrals, filter, search, customers],
  );
  const counts = {
    active: coupons.filter((coupon) => coupon.status === "active").length,
    used: coupons.filter((coupon) => coupon.status === "used").length,
    expired: coupons.filter((coupon) => coupon.status === "expired").length,
  };

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Referrals & Coupons
          </h1>
          <p className="text-sm text-muted-foreground">
            Reward customers who send new business to Air King.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <UserRoundPlus size={16} className="mr-2" /> New Referral
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Gift className="text-sky-600" />
            <div>
              <p className="text-2xl font-bold">{counts.active}</p>
              <p className="text-xs text-muted-foreground">Active coupons</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <CheckCircle2 className="text-emerald-600" />
            <div>
              <p className="text-2xl font-bold">{counts.used}</p>
              <p className="text-xs text-muted-foreground">Coupons used</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Clock className="text-amber-600" />
            <div>
              <p className="text-2xl font-bold">{counts.expired}</p>
              <p className="text-xs text-muted-foreground">Expired coupons</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {(["active", "used", "expired", "all"] as const).map((value) => (
              <Button
                key={value}
                size="sm"
                variant={filter === value ? "default" : "outline"}
                onClick={() => setFilter(value)}
                className="capitalize"
              >
                {value}
              </Button>
            ))}
          </div>
          <div className="relative max-w-sm">
            <Search
              size={15}
              className="absolute left-3 top-2.5 text-muted-foreground"
            />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search customer or coupon code"
              className="pl-9"
            />
          </div>
        </CardHeader>
        <CardContent>
          {query.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading coupons…</p>
          ) : visible.length === 0 ? (
            <div className="py-12 text-center">
              <Gift className="mx-auto mb-3 text-muted-foreground" />
              <p className="font-medium">No coupons in this view</p>
              <p className="text-sm text-muted-foreground">
                Create a referral reward after the referred customer's job is
                completed.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {visible.map((coupon) => {
                const referral = referrals.find(
                  (item) => item.id === coupon.referral_id,
                );
                return (
                  <div key={coupon.id} className="rounded-xl border p-4">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold">
                            {customerName(coupon.customer_id)}
                          </p>
                          <Badge
                            variant={
                              coupon.status === "active"
                                ? "default"
                                : "secondary"
                            }
                            className="capitalize"
                          >
                            {coupon.status}
                          </Badge>
                          <Badge variant="outline">
                            {money(coupon.amount_cents)} off
                          </Badge>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Referred{" "}
                          {referral
                            ? customerName(referral.referred_customer_id)
                            : "customer"}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
                          <span className="font-mono font-semibold text-foreground">
                            {coupon.code}
                          </span>
                          <span>Issued {date(coupon.issued_at)}</span>
                          <span>Expires {date(coupon.expires_at)}</span>
                          {coupon.emailed_at && (
                            <span>Emailed {date(coupon.emailed_at)}</span>
                          )}
                          {coupon.used_at && (
                            <span>Used {date(coupon.used_at)}</span>
                          )}
                        </div>
                      </div>
                      {coupon.status === "active" && (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={act.isPending}
                            onClick={() =>
                              act.mutate({
                                path: `crm/coupons/${coupon.id}/send`,
                              })
                            }
                          >
                            <Mail size={14} className="mr-1.5" />{" "}
                            {coupon.emailed_at
                              ? "Resend Coupon"
                              : "Email Coupon"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={act.isPending}
                            onClick={() =>
                              act.mutate({
                                path: `crm/coupons/${coupon.id}/remind`,
                              })
                            }
                          >
                            Follow Up
                          </Button>
                          <Button
                            size="sm"
                            className="bg-emerald-600 hover:bg-emerald-700"
                            disabled={act.isPending}
                            onClick={() =>
                              act.mutate({
                                path: `crm/coupons/${coupon.id}/redeem`,
                              })
                            }
                          >
                            <CheckCircle2 size={14} className="mr-1.5" /> Mark
                            Used
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a $25 referral reward</DialogTitle>
            <DialogDescription>
              Choose who referred Air King and the completed job they referred.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Customer receiving the coupon</Label>
              <Select value={referrer} onValueChange={setReferrer}>
                <SelectTrigger>
                  <SelectValue placeholder="Select referring customer" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((customer) => (
                    <SelectItem key={customer.id} value={customer.id}>
                      {customer.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Customer they referred</Label>
              <Select
                value={referred}
                onValueChange={(value) => {
                  setReferred(value);
                  setJob("");
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select new customer" />
                </SelectTrigger>
                <SelectContent>
                  {customers
                    .filter((customer) => customer.id !== referrer)
                    .map((customer) => (
                      <SelectItem key={customer.id} value={customer.id}>
                        {customer.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Completed job (optional)</Label>
              <Select
                value={job || "none"}
                onValueChange={(value) => setJob(value === "none" ? "" : value)}
                disabled={!referred}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      referred
                        ? "No completed job selected"
                        : "Choose referred customer first"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No completed job</SelectItem>
                  {completedJobs.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.id} — {item.description || item.type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Optional. Select one only when you want the reward connected to
                a specific completed job.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Coupon expiration</Label>
              <Input
                type="date"
                value={expires}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(event) => setExpires(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Internal note (optional)</Label>
              <Textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="How the referral came in"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!referrer || !referred || !expires || create.isPending}
              onClick={() => create.mutate()}
            >
              <Plus size={14} className="mr-1.5" /> Create Coupon
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
