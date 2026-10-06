/** Called only by a user's Copy Address action. No clipboard read permissions. */
export async function copyAddress(address: string): Promise<boolean> {
  if (!address.trim()) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(address);
      return true;
    }
  } catch { /* Older browsers or denied clipboard access can use a local selection. */ }
  const active = document.activeElement as HTMLElement | null;
  const selection = document.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
  const textarea = document.createElement("textarea");
  textarea.value = address;
  textarea.readOnly = true;
  textarea.setAttribute("aria-label", "Service address to copy");
  textarea.style.cssText = "position:fixed;left:0;top:0;opacity:0;font-size:16px;";
  // Keep the temporary selection inside an open modal's focus boundary.
  (active?.closest('[role="dialog"]') || document.body).appendChild(textarea);
  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, address.length);
    return document.execCommand("copy");
  } catch { return false; }
  finally {
    textarea.remove();
    active?.focus({ preventScroll: true });
    if (selection) { selection.removeAllRanges(); ranges.forEach(range => selection.addRange(range)); }
  }
}
