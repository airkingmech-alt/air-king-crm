import { useState } from "react";
import { useLocation } from "wouter";
import { Trash2 } from "lucide-react";
import { useAuth } from "@/context/auth-context";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

export function DeleteRecord({ kind, record, destination }: {
  kind: "customer" | "invoice" | "quote";
  record: { id: string };
  destination: string;
}) {
  const { profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [, navigate] = useLocation();
  const { toast } = useToast();
  if (!profile || !["owner", "admin"].includes(profile.role)) return null;
  const remove = async () => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const response = await supabase.rpc("crm_delete_record", {
        p_table: `${kind}s`, p_id: record.id, p_previous: record,
      });
      if (response.error) throw response.error;
      window.dispatchEvent(new Event("crm-refresh"));
      setOpen(false);
      navigate(destination);
      toast({ title: `${kind[0].toUpperCase()}${kind.slice(1)} deleted` });
    } catch (e: any) {
      setError(e.message || "Could not delete this record. Please try again.");
    } finally { setBusy(false); }
  };
  return <>
    <Button size="sm" variant="outline" className="text-destructive print:hidden" onClick={() => {setError("");setOpen(true);}} data-testid={`delete-${kind}`}>
      <Trash2 size={14} className="mr-1.5" /> Delete {kind}
    </Button>
    <Dialog open={open} onOpenChange={(value) => {if (!busy) setOpen(value);}}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete this {kind}?</DialogTitle>
          <DialogDescription>
            {record.id} will be removed from active screens. Its history will be retained.
            {kind === "customer" ? " Customers with linked work, memberships, or financial records cannot be deleted." : " Its customer link will stop working and queued reminders will be cancelled."}
            {kind === "invoice" && " Invoices with payments, online payment attempts, or linked quotes/jobs cannot be deleted."}
            {kind === "quote" && " Accepted quotes and quotes linked to jobs or invoices cannot be deleted."}
          </DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>Keep {kind}</Button>
          <Button variant="destructive" disabled={busy} onClick={remove}>{busy ? "Deleting…" : `Delete ${kind}`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
