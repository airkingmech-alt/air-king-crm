import { useEffect, useRef, useState } from "react";
import type { CustomerNote } from "../../../shared/customer-notes";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function CustomerNoteEditor({ note, onSave }: {
  note: CustomerNote;
  onSave: (original: CustomerNote, text: string) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [original, setOriginal] = useState(note);
  const [draft, setDraft] = useState(note.text);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const changeOpen = (next: boolean) => {
    if (busy.current) return;
    if (next) {
      setOriginal({ ...note });
      setDraft(note.text);
      setError("");
    }
    setOpen(next);
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy.current || !draft.trim()) return;
    busy.current = true;
    setSaving(true);
    setError("");
    try {
      await onSave(original, draft.trim());
      if (mounted.current) setOpen(false);
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : "The note could not be saved. Please retry.");
    } finally {
      busy.current = false;
      if (mounted.current) setSaving(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <button type="button" className="block w-full text-left text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap break-words rounded-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Edit note by ${note.author} from ${note.date}`}>
          {note.text}
          <span className="block text-[10px] text-primary mt-1">Edit note</span>
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[480px]" onEscapeKeyDown={event => { if (busy.current) event.preventDefault(); }}
        onPointerDownOutside={event => { if (busy.current) event.preventDefault(); }}>
        <DialogHeader>
          <DialogTitle>Edit customer note</DialogTitle>
          <DialogDescription>Written by {original.author} on {original.date}. Editing keeps the original author and date.</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`edit-note-${note.id}`}>Note</Label>
            <Textarea id={`edit-note-${note.id}`} value={draft} onChange={event => setDraft(event.target.value)} rows={6} disabled={saving} required />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" disabled={saving} onClick={() => changeOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={saving || !draft.trim()}>{saving ? "Saving…" : "Save"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
