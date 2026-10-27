import { Card, CardContent } from "@/components/ui/card";
export const optionOrder = (tier: string) => ["Value", "Good", "Better", "Best"].indexOf(tier);
export function unavailableQuoteOptions(quote: { options: { tier: string }[]; unavailableOptions?: { tier: string; label: string; reason: string }[] }) {
  return (quote.unavailableOptions || []).filter(o => !quote.options.some(a => a.tier === o.tier));
}
export function UnavailableQuoteOptions({ quote }: { quote: Parameters<typeof unavailableQuoteOptions>[0] }) {
  return <>{unavailableQuoteOptions(quote).map(o => <Card key={o.tier} style={{ order: optionOrder(o.tier) }} className="quote-option" aria-disabled="true"><CardContent className="quote-option-content p-5 space-y-4"><p className="text-xs font-semibold uppercase">{o.tier}</p><h2 className="text-lg font-bold">{o.label}</h2><p className="font-semibold">Unavailable</p><p className="text-sm">{o.reason}</p><p className="text-xs text-muted-foreground">This option cannot be selected or accepted.</p></CardContent></Card>)}</>;
}
