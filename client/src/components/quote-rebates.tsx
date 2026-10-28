import { CHAMPION_REBATE_URL, championRebateSummary, type ChampionRebateOffer } from '../../../shared/champion-rebates';

const rebateCategoryNames: Record<string, string> = { Condenser: 'AC', Furnace: 'furnace', 'Heat Pump': 'heat pump', 'Air Handler': 'air handler' };

export function QuoteRebates({ offer, today, homeowner = false }: { offer?: ChampionRebateOffer; today?: string; homeowner?: boolean }) {
  if (!offer?.items.length) return null;
  const { expired, beforeWindow, combined } = championRebateSummary(offer,today);
  return <section className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 mb-4 text-xs space-y-2" aria-label="Potential manufacturer rebates">
    <p className="font-semibold">Potential 2026 Champion rebate</p>
    {expired && <p className="font-semibold">2026 installation window ended. These historical amounts do not apply to a new installation; verify any claim for a qualifying 2026 installation.</p>}
    {beforeWindow && <p>Installation window has not started.</p>}
    {offer.items.map(item=><p key={`${item.category}:${item.model}`} className="break-words"><strong>{homeowner ? `Champion ${rebateCategoryNames[item.category] || 'equipment'}` : item.model}</strong>: ${item.base} base rebate <strong>or</strong> ${item.bonusTotal} total bonus rebate if eligible.</p>)}
    {combined && <p className="font-semibold">AC + furnace: ${combined.base} base total or ${combined.bonusTotal} bonus total.</p>}
    <p>Bonus replaces the base amount; it is not added to it. Quote price is unchanged.</p>
    <p>Potential offer only. Exact model, dealer, installation date and customer eligibility must be verified. See program requirements below.</p>
    <a className="underline" href={CHAMPION_REBATE_URL} target="_blank" rel="noreferrer" onClick={event=>event.stopPropagation()}>Review program and claim requirements</a>
  </section>;
}

export function QuoteRebateTerms() {
  return <section className="rounded-lg border p-4 mb-5 text-xs text-muted-foreground space-y-2" aria-label="Champion rebate requirements">
    <h3 className="font-semibold text-foreground">2026 Champion rebate requirements</h3>
    <p>Subject to exact-model and program verification. Residential installation by an active Champion Elite or Certified Comfort Expert dealer, January 1–December 31, 2026. Homeowner must claim within 60 calendar days of installation.</p>
    <p>Bonus requires program approval and eligibility evidence for educators, nurses, first responders, military personnel, veterans or qualifying natural-disaster communities. The current portal also lists retirees; verify its requirements.</p>
    <p>Claim requires the installation invoice with dealer/customer names and addresses, installation date, models, serial numbers and purchase price. Payment is within 45 days after approval. Other incentive stacking and quantity limits require confirmation.</p>
    <a className="underline" href={CHAMPION_REBATE_URL} target="_blank" rel="noreferrer">Review current program requirements</a>
  </section>;
}
