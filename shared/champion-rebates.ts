// Champion consumer rebate flyer DX2410004, updated 2026-01-16, page 2.
// Amounts identify potential model-family offers, not approved claims. Never
// infer eligibility from SEER/AFUE or subtract these from job cost/selling price.
export const CHAMPION_REBATE_URL = 'https://www.ductedsystemsincentives.com/ConsumerRebates/default.aspx';
export interface RebateEquipment { brand: string; category: string; model: string }
export interface ChampionRebateItem {
  model: string;
  family: string;
  category: string;
  base: number;
  bonusTotal: number;
}
export interface ChampionRebateOffer {
  program: 'champion-consumer-2026';
  source: 'DX2410004 · January 16, 2026';
  installationStart: '2026-01-01';
  installationEnd: '2026-12-31';
  items: ChampionRebateItem[];
}
const rules = [
  { categories: ['Condenser'], families: ['XC8','XCV'], base: 360, bonusTotal: 430 },
  { categories: ['Heat Pump'], families: ['XH9','XHV'], base: 360, bonusTotal: 430 },
  { categories: ['Condenser'], families: ['XC6'], base: 300, bonusTotal: 365 },
  { categories: ['Heat Pump'], families: ['XH6','HH8'], base: 300, bonusTotal: 365 },
  { categories: ['Heat Pump'], families: ['XH5'], base: 250, bonusTotal: 300 },
  { categories: ['Furnace'], families: ['TP9C','TPLC','Z9VV'], base: 220, bonusTotal: 265 },
  { categories: ['Furnace'], families: ['TM8V','TM8Y','TM9V','TM9Y','Z8ET','Z8VT','Z9VT','Z9ET'], base: 165, bonusTotal: 200 },
  { categories: ['Air Handler'], families: ['JHV','JHC','JMC','JHE','JME','JSC','JSE'], base: 75, bonusTotal: 90 },
] as const;
export function potentialChampionRebates(equipment: RebateEquipment[]): ChampionRebateOffer | undefined {
  const items: ChampionRebateItem[] = [];
  for (const item of equipment) {
    if (item.brand !== 'Champion') continue;
    const model = item.model.trim().toUpperCase();
    // Family must begin the model and be followed by its numeric size code.
    // Full suffix eligibility still requires program confirmation.
    for (const rule of rules) {
      if (!(rule.categories as readonly string[]).includes(item.category)) continue;
      const family = rule.families.find(f => new RegExp(`^${f}[0-9]{2,3}[A-Z0-9]+$`).test(model));
      if (family && !items.some(i => i.model === model && i.category === item.category)) {
        items.push({ model, family, category: item.category, base: rule.base, bonusTotal: rule.bonusTotal });
        break;
      }
    }
  }
  return items.length ? { program:'champion-consumer-2026',source:'DX2410004 · January 16, 2026',installationStart:'2026-01-01',installationEnd:'2026-12-31',items } : undefined;
}
export function championRebateSummary(offer: ChampionRebateOffer, today = new Date().toISOString().slice(0,10)) {
  const expired = today > offer.installationEnd;
  const beforeWindow = today < offer.installationStart;
  // The flyer supports an AC/furnace combination. Do not invent aggregation
  // rules for repeated units, other combinations, or other incentive programs.
  const canCombine = offer.items.length === 2 && offer.items.some(i=>i.category==='Condenser') && offer.items.some(i=>i.category==='Furnace');
  return { expired, beforeWindow, combined: canCombine ? {
    base: offer.items.reduce((sum,i)=>sum+i.base,0),
    bonusTotal: offer.items.reduce((sum,i)=>sum+i.bonusTotal,0),
  } : undefined };
}

// Explicit public projection; never expose arbitrary private option metadata.
export function publicChampionRebateOffer(value: unknown): ChampionRebateOffer | undefined {
  const offer=value as ChampionRebateOffer | undefined;
  if (offer?.program !== 'champion-consumer-2026' || !Array.isArray(offer.items)) return undefined;
  const items=offer.items.filter(i=>i && typeof i.model==='string' && typeof i.family==='string' && typeof i.category==='string' && Number.isFinite(i.base) && Number.isFinite(i.bonusTotal)).map(i=>({model:i.model,family:i.family,category:i.category,base:i.base,bonusTotal:i.bonusTotal}));
  return items.length ? {program:offer.program,source:'DX2410004 · January 16, 2026',installationStart:'2026-01-01',installationEnd:'2026-12-31',items} : undefined;
}
