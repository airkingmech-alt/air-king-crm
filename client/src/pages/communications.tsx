import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { crm } from "@/lib/crm-api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Plus,
  Mail,
  MessageSquare,
  Clock,
  Copy,
  Settings,
  ChevronRight,
} from "lucide-react";
const label = (s: string) =>
  s.replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const selectStyle = "w-full rounded-md border bg-background p-2 text-sm";
function Notice({ text }: { text: string }) {
  return text ? (
    <p role="status" className="rounded-lg bg-muted p-3 text-sm">
      {text}
    </p>
  ) : null;
}
function Toggle({
  title,
  checked,
  onChange,
  disabled = false,
}: {
  title: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center justify-between gap-4 py-2 text-sm">
      <span>{title}</span>
      <Switch
        aria-label={title}
        checked={checked}
        onCheckedChange={onChange}
        disabled={disabled}
      />
    </label>
  );
}
function Conditions({
  value,
  onChange,
  fields,
}: {
  value: any[];
  onChange: (v: any[]) => void;
  fields: string[];
}) {
  return (
    <div className="space-y-2">
      {value.map((c: any, i: number) => (
        <div className="flex flex-wrap gap-2" key={i}>
          <select
            className={selectStyle + " flex-1"}
            value={c.field}
            onChange={(e) =>
              onChange(
                value.map((x, j) =>
                  i === j ? { ...x, field: e.target.value } : x,
                ),
              )
            }
          >
            {fields.map((f) => (
              <option key={f} value={f}>
                {label(f)}
              </option>
            ))}
          </select>
          <select
            aria-label="Condition comparison"
            className="border rounded bg-background p-2"
            value={c.op}
            onChange={(e) =>
              onChange(
                value.map((x, j) =>
                  i === j ? { ...x, op: e.target.value } : x,
                ),
              )
            }
          >
            <option value="eq">is</option>
            <option value="gt">greater than</option>
            <option value="lt">less than</option>
            <option value="exists">is present</option>
          </select>
          {c.op !== "exists" && (
            <Input
              className="w-28"
              value={String(c.value ?? "")}
              placeholder="true / value"
              aria-label="Condition value"
              onChange={(e) =>
                onChange(
                  value.map((x, j) =>
                    i === j ? { ...x, value: e.target.value } : x,
                  ),
                )
              }
            />
          )}
          <Button
            variant="ghost"
            onClick={() => onChange(value.filter((_, j) => j !== i))}
          >
            Remove
          </Button>
        </div>
      ))}
      <Button
        size="sm"
        variant="outline"
        onClick={() =>
          onChange([...value, { field: fields[0], op: "eq", value: true }])
        }
      >
        + Add Condition
      </Button>
    </div>
  );
}
export function Automations() {
  const {
    data: items = [],
    refetch,
    error,
  } = useQuery({
    queryKey: ["automations"],
    queryFn: () => crm("crm/automations"),
  });
  const { data: config } = useQuery({
    queryKey: ["crm-config"],
    queryFn: () => crm("crm/config"),
  });
  const { data: templates = [] } = useQuery({
    queryKey: ["templates"],
    queryFn: () => crm("crm/templates"),
  });
  const { data: runs = [] } = useQuery({
    queryKey: ["automation-runs"],
    queryFn: () => crm("crm/runs"),
    refetchInterval: 30000,
  });
  const [edit, setEdit] = useState<any>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const canEdit = ["owner", "admin"].includes(config?.role);
  const fresh = () => ({
    name: "",
    description: "",
    enabled: false,
    trigger: "quote.sent",
    conditions: [],
    stop_conditions: [],
    steps: [{ action: "sms", wait_minutes: 2880, conditions: [] }],
  });
  const save = async () => {
    setBusy(true);
    try {
      await crm(
        "crm/automations" + (edit.id ? "/" + edit.id : ""),
        edit.id ? "PUT" : "POST",
        edit,
      );
      await refetch();
      setEdit(null);
      setNotice("Automation saved.");
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  };
  const updateStep = (i: number, data: any) =>
    setEdit({
      ...edit,
      steps: edit.steps.map((s: any, j: number) =>
        i === j ? { ...s, ...data } : s,
      ),
    });
  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      <header className="flex flex-wrap gap-3 justify-between">
        <div>
          <h1 className="text-2xl font-bold">Automations</h1>
          <p className="text-sm text-muted-foreground">
            Helpful follow-ups, sent at the right time.
          </p>
        </div>
        {canEdit && (
          <Button onClick={() => setEdit(fresh())}>
            <Plus size={16} className="mr-2" />
            New Automation
          </Button>
        )}
      </header>
      <Notice text={notice || error?.message || ""} />
      {!items.length && (
        <Card>
          <CardContent className="p-6 space-y-3">
            <h2 className="font-semibold">
              Start with Air King's recommended follow-ups
            </h2>
            <p className="text-sm text-muted-foreground">
              Add 14 editable starters. All begin turned off so you can review
              the messages and timing.
            </p>
            <Button
              disabled={!canEdit || busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await crm("crm/starters", "POST");
                  setNotice(r.message);
                  await refetch();
                } catch (e: any) {
                  setNotice(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Add Starter Automations
            </Button>
          </CardContent>
        </Card>
      )}
      <div className="grid md:grid-cols-2 gap-4">
        {items.map((a: any) => (
          <Card key={a.id}>
            <CardContent className="p-5 space-y-3">
              <div className="flex justify-between gap-3">
                <h2 className="font-semibold">{a.name}</h2>
                <Switch
                  aria-label={"Turn on " + a.name}
                  disabled={!canEdit}
                  checked={a.enabled}
                  onCheckedChange={async (enabled) => {
                    try {
                      await crm(`crm/automations/${a.id}/toggle`, "POST", {
                        enabled,
                      });
                      await refetch();
                    } catch (e: any) {
                      setNotice(e.message);
                    }
                  }}
                />
              </div>
              <p className="text-sm text-muted-foreground">{a.description}</p>
              <p className="text-xs">
                <strong>WHEN</strong> {label(a.trigger)}{" "}
                <ChevronRight size={12} className="inline" /> {a.steps.length}{" "}
                steps
              </p>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>
                  {a.runs_count} runs · {a.success_count} completed ·{" "}
                  {a.failure_count} failed
                </span>
                <span>{a.enabled ? "On" : "Off"}</span>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canEdit}
                  onClick={() => setEdit(structuredClone(a))}
                >
                  Edit Automation
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!canEdit}
                  onClick={() =>
                    setEdit({
                      ...structuredClone(a),
                      id: undefined,
                      name: a.name + " copy",
                      enabled: false,
                    })
                  }
                >
                  Duplicate
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent runs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!runs.length && (
            <p className="text-sm text-muted-foreground">
              Execution history will appear here.
            </p>
          )}
          {runs.slice(0, 30).map((r: any) => (
            <div key={r.id} className="border-b pb-2 text-sm">
              <div className="flex justify-between gap-2">
                <span>
                  {items.find((a: any) => a.id === r.automation_id)?.name ||
                    "Automation"}{" "}
                  · Step {r.step_index + 1}
                </span>
                <strong>{label(r.status)}</strong>
              </div>
              <p className="text-xs text-muted-foreground">
                {new Date(r.created_at).toLocaleString()}{" "}
                {r.error && " · " + r.error}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
      <Dialog open={!!edit} onOpenChange={(open) => !open && setEdit(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {edit?.id ? "Edit Automation" : "New Automation"}
            </DialogTitle>
            <DialogDescription>
              Delays are additional time after the preceding step. Conditions
              are checked again before each send.
            </DialogDescription>
          </DialogHeader>
          {edit && (
            <div className="space-y-5">
              <Notice text={notice} />
              <Label>Name</Label>
              <Input
                value={edit.name}
                onChange={(e) => setEdit({ ...edit, name: e.target.value })}
              />
              <Label>Description</Label>
              <Textarea
                value={edit.description}
                onChange={(e) =>
                  setEdit({ ...edit, description: e.target.value })
                }
              />
              <Toggle
                title="Turn On Automation"
                checked={edit.enabled}
                onChange={(enabled) => setEdit({ ...edit, enabled })}
              />
              <div className="border rounded-xl p-4 space-y-3">
                <Label>WHEN</Label>
                <select
                  className={selectStyle}
                  value={edit.trigger}
                  onChange={(e) =>
                    setEdit({ ...edit, trigger: e.target.value })
                  }
                >
                  {(config?.triggers || []).map((t: string) => (
                    <option key={t} value={t}>
                      {label(t)}
                    </option>
                  ))}
                </select>
                <Label>IF — all of these are true</Label>
                <Conditions
                  fields={config?.conditionFields || []}
                  value={edit.conditions}
                  onChange={(conditions) => setEdit({ ...edit, conditions })}
                />
              </div>
              {edit.steps.map((s: any, i: number) => (
                <div
                  key={i}
                  className="border rounded-xl p-4 space-y-3 bg-muted/20"
                >
                  <div className="flex justify-between">
                    <strong className="text-sm">Step {i + 1}</strong>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setEdit({
                          ...edit,
                          steps: edit.steps.filter(
                            (_: any, j: number) => j !== i,
                          ),
                        })
                      }
                    >
                      Remove
                    </Button>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <Label>WAIT — minutes</Label>
                      <Input
                        type="number"
                        min={0}
                        value={s.wait_minutes}
                        onChange={(e) =>
                          updateStep(i, {
                            wait_minutes: Number(e.target.value),
                          })
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        {(s.wait_minutes / 1440).toFixed(2)} days
                      </p>
                    </div>
                    <div>
                      <Label>THEN</Label>
                      <select
                        className={selectStyle}
                        value={s.action}
                        onChange={(e) =>
                          updateStep(i, {
                            action: e.target.value,
                            template_id: undefined,
                          })
                        }
                      >
                        <option value="sms">Send Text Message</option>
                        <option value="email">Send Email</option>
                        <option value="wait">Wait Only</option>
                        <option value="activity">Add Timeline Activity</option>
                        <option value="stop">Stop Automation</option>
                      </select>
                    </div>
                  </div>
                  {["email", "sms"].includes(s.action) && (
                    <select
                      aria-label="Message template"
                      className={selectStyle}
                      value={s.template_id || ""}
                      onChange={(e) =>
                        updateStep(i, { template_id: e.target.value })
                      }
                    >
                      <option value="">Choose a template</option>
                      {templates
                        .filter(
                          (t: any) =>
                            t.channel === s.action && t.active && !t.archived,
                        )
                        .map((t: any) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                    </select>
                  )}
                  {s.action === "activity" && (
                    <Input
                      placeholder="Timeline message"
                      value={s.message || ""}
                      onChange={(e) =>
                        updateStep(i, { message: e.target.value })
                      }
                    />
                  )}
                  <Label>IF — before this step</Label>
                  <Conditions
                    fields={config?.conditionFields || []}
                    value={s.conditions}
                    onChange={(conditions) => updateStep(i, { conditions })}
                  />
                </div>
              ))}
              <Button
                variant="outline"
                onClick={() =>
                  setEdit({
                    ...edit,
                    steps: [
                      ...edit.steps,
                      { action: "email", wait_minutes: 1440, conditions: [] },
                    ],
                  })
                }
              >
                + Add Step
              </Button>
              <div className="space-y-3">
                <Label>Stop when all these conditions are true</Label>
                <Conditions
                  fields={config?.conditionFields || []}
                  value={edit.stop_conditions}
                  onChange={(stop_conditions) =>
                    setEdit({ ...edit, stop_conditions })
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Quote follow-ups always stop after acceptance or decline.
                  Invoice reminders always stop after payment or voiding.
                </p>
              </div>
              <Button disabled={busy || !edit.steps.length} onClick={save}>
                Save Automation
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
export function Templates() {
  const {
    data: items = [],
    refetch,
    error,
  } = useQuery({
    queryKey: ["templates"],
    queryFn: () => crm("crm/templates"),
  });
  const { data: config } = useQuery({
    queryKey: ["crm-config"],
    queryFn: () => crm("crm/config"),
  });
  const [edit, setEdit] = useState<any>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const canEdit = ["owner", "admin"].includes(config?.role);
  const fresh = {
    name: "",
    description: "",
    channel: "email",
    category: "transactional",
    subject: "",
    body: "Hi {{customer_first_name}}, ",
    active: true,
    archived: false,
  };
  const sample: any = {
    customer_first_name: "Taylor",
    customer_last_name: "Smith",
    customer_name: "Taylor Smith",
    company_name: "Air King Mechanical Services",
    quote_number: "Q-100",
    quote_total: "$5,000.00",
    quote_link: "https://example.com/your-quote",
    invoice_number: "INV-100",
    invoice_total: "$5,000.00",
    amount_due: "$3,000.00",
    payment_link: "https://example.com/your-invoice",
    receipt_amount: "$2,000.00",
    appointment_date: "October 1",
    appointment_time: "9:00 AM",
    job_address: "123 Main Street",
    technician_name: "Your technician",
  };
  const save = async () => {
    setBusy(true);
    try {
      await crm(
        "crm/templates" + (edit.id ? "/" + edit.id : ""),
        edit.id ? "PUT" : "POST",
        edit,
      );
      await refetch();
      setEdit(null);
      setNotice("Template saved.");
    } catch (e: any) {
      setNotice(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      <header className="flex justify-between">
        <div>
          <h1 className="text-2xl font-bold">Message Templates</h1>
          <p className="text-sm text-muted-foreground">
            Consistent, personal messages for every customer.
          </p>
        </div>
        <Button disabled={!canEdit} onClick={() => setEdit({ ...fresh })}>
          New Template
        </Button>
      </header>
      <Notice text={notice || error?.message || ""} />
      <div className="grid md:grid-cols-2 gap-4">
        {items
          .filter((t: any) => !t.archived)
          .map((t: any) => (
            <Card key={t.id}>
              <CardContent className="p-5 space-y-3">
                <div className="flex gap-2 items-center">
                  {t.channel === "email" ? (
                    <Mail size={18} />
                  ) : (
                    <MessageSquare size={18} />
                  )}
                  <h2 className="font-semibold">{t.name}</h2>
                </div>
                <p className="text-xs text-muted-foreground">
                  {label(t.category)} · {t.active ? "Active" : "Inactive"}
                </p>
                <p className="text-sm whitespace-pre-wrap line-clamp-3">
                  {t.body}
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canEdit}
                    onClick={() => setEdit({ ...t })}
                  >
                    Preview / Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!canEdit}
                    onClick={() =>
                      setEdit({ ...t, id: undefined, name: t.name + " copy" })
                    }
                  >
                    Duplicate
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!canEdit}
                    onClick={async () => {
                      try {
                        await crm("crm/templates/" + t.id, "PUT", {
                          ...t,
                          archived: true,
                          active: false,
                        });
                        await refetch();
                      } catch (e: any) {
                        setNotice(e.message);
                      }
                    }}
                  >
                    Archive
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
      </div>
      <Dialog open={!!edit} onOpenChange={(open) => !open && setEdit(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Message Template</DialogTitle>
            <DialogDescription>
              Use merge fields to personalize each message.
            </DialogDescription>
          </DialogHeader>
          {edit && (
            <div className="space-y-3">
              <Notice text={notice} />
              <Label>Name</Label>
              <Input
                value={edit.name}
                onChange={(e) => setEdit({ ...edit, name: e.target.value })}
              />
              <Label>Description</Label>
              <Input
                value={edit.description}
                onChange={(e) =>
                  setEdit({ ...edit, description: e.target.value })
                }
              />
              <div className="grid grid-cols-2 gap-3">
                <select
                  className={selectStyle}
                  aria-label="Channel"
                  value={edit.channel}
                  onChange={(e) =>
                    setEdit({ ...edit, channel: e.target.value })
                  }
                >
                  <option value="email">Email</option>
                  <option value="sms">Text Message</option>
                </select>
                <select
                  className={selectStyle}
                  aria-label="Message category"
                  value={edit.category}
                  onChange={(e) =>
                    setEdit({ ...edit, category: e.target.value })
                  }
                >
                  <option value="transactional">Transactional</option>
                  <option value="marketing">Marketing</option>
                </select>
              </div>
              {edit.channel === "email" && (
                <>
                  <Label>Subject</Label>
                  <Input
                    value={edit.subject}
                    onChange={(e) =>
                      setEdit({ ...edit, subject: e.target.value })
                    }
                  />
                </>
              )}
              <Label>Message</Label>
              <Textarea
                rows={6}
                value={edit.body}
                onChange={(e) => setEdit({ ...edit, body: e.target.value })}
              />
              <select
                className={selectStyle}
                aria-label="Insert merge field"
                value=""
                onChange={(e) =>
                  setEdit({
                    ...edit,
                    body: edit.body + " {{" + e.target.value + "}}",
                  })
                }
              >
                <option value="">Insert customer or job detail…</option>
                {(config?.mergeFields || []).map((f: string) => (
                  <option key={f} value={f}>
                    {label(f)}
                  </option>
                ))}
              </select>
              <Toggle
                title="Active"
                checked={edit.active}
                onChange={(active) => setEdit({ ...edit, active })}
              />
              <div className="p-4 bg-sky-50 rounded-xl text-slate-900">
                <p className="text-xs uppercase font-bold mb-2">
                  Preview — sample customer
                </p>
                <p className="whitespace-pre-wrap">
                  {edit.body.replace(
                    /{{\s*(\w+)\s*}}/g,
                    (_: string, k: string) => sample[k] || "[" + label(k) + "]",
                  )}
                </p>
              </div>
              <Button disabled={busy} onClick={save}>
                Save Template
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
export function Integrations() {
  const { data, refetch, error } = useQuery({
    queryKey: ["crm-config"],
    queryFn: () => crm("crm/config"),
  });
  const [draft, setDraft] = useState<any>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const config = draft || data?.settings;
  const canEdit = ["owner", "admin"].includes(data?.role);
  const set = (key: string, value: any) =>
    setDraft({ ...config, [key]: value });
  if (!config)
    return <div className="p-6">{error?.message || "Loading settings…"}</div>;
  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Settings & Integrations</h1>
      <Notice text={notice} />
      <div className="grid sm:grid-cols-3 gap-4">
        {[
          ["Stripe", "stripe"],
          ["Text Messages", "twilio"],
          ["Email", "email"],
        ].map(([name, key]) => (
          <Card key={key}>
            <CardContent className="p-5">
              <h2 className="font-semibold">{name}</h2>
              <p className="text-sm mt-2">
                {data.connections[key] ? "Connected" : "Setup needed"}
              </p>
              {key === "stripe" && (
                <p className="text-xs text-muted-foreground">
                  Mode: {data.connections.stripe_mode}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="p-5 space-y-4">
          <h2 className="font-semibold">Business settings</h2>
          <Label>Company name</Label>
          <Input
            disabled={!canEdit}
            value={config.company_name}
            onChange={(e) => set("company_name", e.target.value)}
          />
          <Toggle
            title="Send customer messages"
            checked={config.sending_enabled}
            onChange={(v) => set("sending_enabled", v)}
            disabled={!canEdit}
          />
          <Toggle
            title="Accept online invoice payments"
            checked={config.payments_enabled}
            onChange={(v) => set("payments_enabled", v)}
            disabled={!canEdit}
          />
          <Toggle
            title="Pass card processing fee to customer"
            checked={config.fee_enabled}
            onChange={(v) => set("fee_enabled", v)}
            disabled={!canEdit || !data.connections.surcharge_available}
          />
          <p className="text-xs text-muted-foreground">
            Card fees remain off until credit-card eligibility is supported.
            Debit and prepaid cards cannot be surcharged.
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label>Fee percentage</Label>
              <Input
                disabled={!canEdit}
                type="number"
                value={config.fee_basis_points / 100}
                onChange={(e) =>
                  set(
                    "fee_basis_points",
                    Math.round(Number(e.target.value) * 100),
                  )
                }
              />
            </div>
            <div>
              <Label>Fixed fee (cents)</Label>
              <Input
                disabled={!canEdit}
                type="number"
                value={config.fee_fixed_cents}
                onChange={(e) => set("fee_fixed_cents", Number(e.target.value))}
              />
            </div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-5 space-y-3">
          <h2 className="font-semibold">Communication hours</h2>
          <Label>Timezone</Label>
          <Input
            disabled={!canEdit}
            value={config.timezone}
            onChange={(e) => set("timezone", e.target.value)}
          />
          <div className="grid grid-cols-2 gap-3">
            {[
              ["sms_start", "Send texts after"],
              ["sms_end", "Send texts before"],
            ].map(([key, name]) => (
              <div key={key}>
                <Label>{name}</Label>
                <select
                  disabled={!canEdit}
                  className={selectStyle}
                  value={config[key]}
                  onChange={(e) => set(key, Number(e.target.value))}
                >
                  {Array.from({ length: 24 }, (_, i) => (
                    <option key={i} value={i}>
                      {String(i).padStart(2, "0")}:00
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Texts outside these hours wait for the next permitted window.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-5 space-y-3">
          <h2 className="font-semibold">Email branding</h2>
          <Label>Sender name</Label>
          <Input
            disabled={!canEdit}
            value={config.sender_name}
            onChange={(e) => set("sender_name", e.target.value)}
          />
          <Label>Verified sender email</Label>
          <Input
            disabled={!canEdit}
            value={config.sender_email}
            onChange={(e) => set("sender_email", e.target.value)}
          />
          <Label>Google review link</Label>
          <Input
            disabled={!canEdit}
            value={config.review_url}
            onChange={(e) => set("review_url", e.target.value)}
          />
        </CardContent>
      </Card>
      <Button
        disabled={!canEdit || busy}
        onClick={async () => {
          setBusy(true);
          try {
            await crm("crm/config", "PUT", config);
            setDraft(null);
            await refetch();
            setNotice("Settings saved.");
          } catch (e: any) {
            setNotice(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Save Settings
      </Button>
      <p className="text-xs text-muted-foreground">
        Connection credentials are securely configured on the server and are
        never displayed here.
      </p>
    </div>
  );
}
export function CustomerCommunications({ customerId }: { customerId: string }) {
  const { data, refetch, error } = useQuery({
    queryKey: ["customer-history", customerId],
    queryFn: () => crm(`crm/customers/${customerId}/history`),
    refetchInterval: 15000,
  });
  const [prefs, setPrefs] = useState<any>(null);
  const [notice, setNotice] = useState("");
  const [showPreferences, setShowPreferences] = useState(false);
  const values = prefs ||
    data?.preferences || {
      email_transactional: true,
      sms_transactional: false,
      email_marketing: false,
      sms_marketing: false,
      consent_source: "",
    };
  const history = [
    ...(data?.events || []).map((e: any) => ({
      ...e,
      title: label(e.event_type),
      detail: e.metadata.message || e.metadata.reason || "",
    })),
    ...(data?.messages || []).map((m: any) => ({
      ...m,
      title: label(m.channel) + " to " + m.recipient,
      detail: m.body,
    })),
  ].sort(
    (a: any, b: any) => Date.parse(b.created_at) - Date.parse(a.created_at),
  );
  return (
    <Card className="mb-4">
      <CardHeader>
        <div className="flex justify-between">
          <CardTitle className="text-base">Communications</CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowPreferences(!showPreferences)}
          >
            Preferences
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Notice text={notice || error?.message || ""} />
        {showPreferences && (
          <div className="bg-muted/30 rounded-lg p-4 space-y-2">
            {[
              ["email_transactional", "Service and invoice emails"],
              ["sms_transactional", "Service and invoice texts"],
              ["email_marketing", "Marketing emails"],
              ["sms_marketing", "Marketing texts"],
            ].map(([key, title]) => (
              <Toggle
                key={key}
                title={title}
                checked={!!values[key]}
                onChange={(v) => setPrefs({ ...values, [key]: v })}
              />
            ))}
            {values.sms_stopped && (
              <p className="text-sm text-amber-700">
                Customer replied STOP. Text messages are blocked.
              </p>
            )}
            <Label>Consent source / note</Label>
            <Input
              value={values.consent_source || ""}
              onChange={(e) =>
                setPrefs({ ...values, consent_source: e.target.value })
              }
              placeholder="How and when did the customer give permission?"
            />
            <Button
              size="sm"
              onClick={async () => {
                try {
                  await crm(
                    `crm/customers/${customerId}/preferences`,
                    "PUT",
                    values,
                  );
                  await refetch();
                  setPrefs(null);
                  setNotice("Preferences saved.");
                } catch (e: any) {
                  setNotice(e.message);
                }
              }}
            >
              Save Preferences
            </Button>
          </div>
        )}
        {!history.length && (
          <p className="text-sm text-muted-foreground">
            New communications and activity will appear here.
          </p>
        )}
        <div className="space-y-4 max-h-[600px] overflow-y-auto">
          {history.map((item: any) => (
            <div key={item.id} className="border-l-2 border-sky-200 pl-4">
              <div className="flex justify-between gap-3 text-sm">
                <strong>{item.title}</strong>
                <span>{label(item.status || "recorded")}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {new Date(item.created_at).toLocaleString()}{" "}
                {item.automation_run_id ? "· Automated" : ""}
              </p>
              <p className="text-sm whitespace-pre-wrap mt-1 break-words">
                {item.detail}
              </p>
              {item.error && (
                <p className="text-sm text-red-600">{item.error}</p>
              )}
              {(item.quote_id || item.invoice_id || item.job_id) && (
                <p className="text-xs text-muted-foreground">
                  {[item.quote_id, item.invoice_id, item.job_id]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
