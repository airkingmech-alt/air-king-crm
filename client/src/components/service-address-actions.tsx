import React, { useRef, useState } from "react";
import { Copy, MapPin } from "lucide-react";
import { Button } from "./ui/button";
import { copyAddress } from "../lib/copy-address";
import { serviceAddressLinks } from "../../../shared/service-address";

export function ServiceAddressActions({ address }: { address: string }) {
  const [notice, setNotice] = useState<{ address: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  if (!address.trim()) return null;
  const links = serviceAddressLinks(address);
  async function copy() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setNotice(null);
    try { setNotice({ address, ok: await copyAddress(address) }); }
    catch { setNotice({ address, ok: false }); }
    finally { lock.current = false; setBusy(false); }
  }
  return <div className="space-y-1" role="group" aria-label={`Service address actions: ${address}`}>
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={busy} onClick={copy}>
        <Copy aria-hidden="true" />{busy ? "Copying…" : "Copy Address"}
      </Button>
      <Button asChild variant="outline" size="sm" className="min-h-11">
        <a href={links.apple} target="_blank" rel="noopener noreferrer" aria-label={`Open service address in Apple Maps: ${address}`}><MapPin aria-hidden="true" />Apple Maps</a>
      </Button>
      <Button asChild variant="outline" size="sm" className="min-h-11">
        <a href={links.google} target="_blank" rel="noopener noreferrer" aria-label={`Open service address in Google Maps: ${address}`}><MapPin aria-hidden="true" />Google Maps</a>
      </Button>
    </div>
    <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
      {notice?.address === address ? notice.ok ? "Address copied" : "Couldn’t copy automatically. Select the address below to copy it." : ""}
    </p>
    {notice?.address === address && !notice.ok && <textarea aria-label="Service address for manual copying" readOnly value={address} onFocus={event => event.currentTarget.select()} className="w-full rounded border bg-background p-2 text-sm" />}
  </div>;
}
