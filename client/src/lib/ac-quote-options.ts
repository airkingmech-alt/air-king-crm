import type { PricebookItem } from '../data/pricebook';
import { reviewedQuoteMatches, type ReviewedQuoteMatch } from './quote-matches';

// Series ratings are manufacturer catalog descriptions, not promises about a
// particular installed system. See docs/four-ac-options.md for sources.
export const acOptionDefinitions = [
  { tier: 'Value', label: 'Guardian · parts only', brand: 'Guardian', series: 'RC', rating: 'Catalog rating requires confirmation' },
  { tier: 'Good', label: 'Champion 13.4 SEER2', brand: 'Champion', series: 'XC3', rating: '13.4 SEER2 series' },
  { tier: 'Better', label: 'Champion 14.3 SEER2', brand: 'Champion', series: 'XC4', rating: '14.3 SEER2 series' },
  { tier: 'Best', label: 'Champion 16+ SEER2 · two-stage furnace', brand: 'Champion', series: 'XC6', rating: '16+ SEER2 series' },
] as const;
export type AcOptionPlan = typeof acOptionDefinitions[number] & { items?: PricebookItem[]; match?: ReviewedQuoteMatch; blocker?: string };
const priced = (item: PricebookItem) => Number.isFinite(item.cost) && item.cost > 0;
const afue = (item: PricebookItem) => item.tier?.match(/(\d+(?:\.\d+)?)%/)?.[1];
// Input BTU, cabinet and blower code must be retained. Furnace "tonnage" in
// this catalog is derived from heating input, not cooling airflow.
const furnaceSize = (item: PricebookItem) => item.model.match(/(?:Z[89]E[ST]|RG19|RL18)(\d{3}[A-Z]\d{2})/)?.[1];
export function planAcOptions(selected: PricebookItem[], catalog: PricebookItem[], matches: readonly ReviewedQuoteMatch[] = reviewedQuoteMatches): AcOptionPlan[] | undefined {
  const acs = selected.filter(i => i.category === 'Condenser');
  const furnaces = selected.filter(i => i.category === 'Furnace');
  const coils = selected.filter(i => i.category === 'Evaporator Coil');
  if (!acs.length || !furnaces.length || !coils.length || selected.some(i => i.category === 'Heat Pump' || i.category === 'Air Handler')) return undefined;
  return acOptionDefinitions.map(definition => {
    const fail = (blocker: string): AcOptionPlan => ({ ...definition, blocker });
    if (acs.length !== 1 || furnaces.length !== 1 || coils.length !== 1) return fail('Select exactly one AC, furnace and Champion coil.');
    const [ac] = acs, [furnace] = furnaces, [coil] = coils;
    if (!ac.tonnage || coil.brand !== 'Champion' || !afue(furnace) || !furnaceSize(furnace)) return fail('A confirmed capacity, furnace input/cabinet/blower, AFUE and Champion coil are required.');
    if (selected.some(i => !priced(i))) return fail('Selected equipment has a missing or invalid price.');
    const outdoor = catalog.filter(i => i.category === 'Condenser' && i.brand === definition.brand && i.model.startsWith(definition.series) && i.tonnage === ac.tonnage && priced(i));
    if (!outdoor.length) return fail(`No priced ${ac.tonnage}-ton ${definition.series} model. Capacity will not be increased.`);
    const indoor = definition.tier === 'Good' || definition.tier === 'Better'
      ? (furnace.brand === 'Champion' ? [furnace] : [])
      : catalog.filter(i => i.category === 'Furnace' && i.brand === definition.brand && afue(i) === afue(furnace) && furnaceSize(i) === furnaceSize(furnace) && priced(i) && (definition.tier !== 'Best' || /^Z[89]ET/.test(i.model)));
    if (!indoor.length) return fail(`No priced ${definition.brand}${definition.tier === 'Best' ? ' two-stage' : ''} furnace retaining ${afue(furnace)}% AFUE and ${furnaceSize(furnace)} input/cabinet/blower. Select a Champion furnace for options 2–3.`);
    const combinations = outdoor.flatMap(condenser => indoor.flatMap(heat => {
      const match = matches.find(m => m.condenser === condenser.model && m.furnace === heat.model && m.coil === coil.model);
      if (!match || (definition.tier === 'Best' && (match.heatingStages !== 2 || match.furnaceAfue !== Number(afue(furnace))))) return [];
      return [{ condenser, heat, match }];
    })).sort((a, b) => (a.condenser.cost + a.heat.cost) - (b.condenser.cost + b.heat.cost) || a.condenser.model.localeCompare(b.condenser.model) || a.heat.model.localeCompare(b.heat.model));
    if (!combinations.length) return fail(`No reviewed match for ${outdoor.map(i => i.model).join('/')} + ${indoor.map(i => i.model).join('/')} + unchanged ${coil.model}${definition.tier === 'Best' ? ` confirming two-stage heat at ${afue(furnace)}% AFUE (catalog Z9ET says 96%; current manufacturer series says 97%)` : ''}.`);
    const { condenser, heat, match } = combinations[0];
    // Duplicate model records are ambiguous even if one has a lower price.
    if ([condenser, heat, coil].some(item => catalog.filter(i => i.model === item.model && i.brand === item.brand && i.category === item.category).length !== 1)) return fail('Duplicate model records: confirm the equipment model and price.');
    return { ...definition, match, items: selected.map(i => i.id === ac.id ? condenser : i.id === furnace.id ? heat : i) };
  });
}
