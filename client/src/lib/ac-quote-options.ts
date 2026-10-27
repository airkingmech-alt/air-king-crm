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
export { approximateEfficiencyDisclosure } from '../../../shared/quote-efficiency';
export type AcOptionPlan = Omit<typeof acOptionDefinitions[number], 'label' | 'rating'> & { label: string; rating: string; reviewNotes?: string[] } & { items?: PricebookItem[]; match?: ReviewedQuoteMatch; blocker?: string };
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
  return acOptionDefinitions.map(baseDefinition => {
    const retain80 = baseDefinition.tier === 'Best' && furnaces.length === 1 && afue(furnaces[0]) === '80';
    const requireTwoStage = baseDefinition.tier === 'Best' && !retain80;
    const selectedCapacity = acs.length === 1 ? acs[0].tonnage : undefined;
    const upsized = baseDefinition.tier === 'Best' && (selectedCapacity === 2.5 || selectedCapacity === 3.5);
    const targetCapacity = upsized ? Math.ceil(selectedCapacity!) : selectedCapacity;
    const definition = { ...baseDefinition, label: `Approx. ${retain80 ? 'Champion 16+ SEER2 · same 80% furnace' : baseDefinition.label}${upsized ? ` · ${targetCapacity}-ton AC (upsized from ${selectedCapacity} ton)` : ''}` };
    const fail = (blocker: string): AcOptionPlan => ({ ...definition, blocker });
    if (acs.length !== 1 || furnaces.length !== 1 || coils.length !== 1) return fail('Select exactly one AC, furnace and Champion coil.');
    const [ac] = acs, [furnace] = furnaces, [originalCoil] = coils;
    let coil = originalCoil;
    if (!ac.tonnage || coil.brand !== 'Champion' || !afue(furnace) || !furnaceSize(furnace)) return fail('A confirmed capacity, furnace input/cabinet/blower, AFUE and Champion coil are required.');
    if (selected.some(i => !priced(i))) return fail('Selected equipment has a missing or invalid price.');
    const outdoor = catalog.filter(i => i.category === 'Condenser' && i.brand === definition.brand && i.model.startsWith(definition.series) && i.tonnage === targetCapacity && priced(i));
    if (!outdoor.length) return fail(`No priced ${targetCapacity}-ton ${definition.series} model. No further capacity substitution will be made.`);
    const indoor = definition.tier === 'Good' || definition.tier === 'Better' || retain80
      ? (furnace.brand === 'Champion' && (!retain80 || /^Z8ES/.test(furnace.model)) ? [furnace] : [])
      : catalog.filter(i => i.category === 'Furnace' && i.model !== 'RG19080C20MPS1' && i.brand === definition.brand && afue(i) === afue(furnace) && furnaceSize(i) === furnaceSize(furnace) && priced(i) && (!requireTwoStage || /^Z[89]ET/.test(i.model)));
    if (!indoor.length) return fail(`No priced ${definition.brand}${requireTwoStage ? ' two-stage' : ''} furnace retaining ${afue(furnace)}% AFUE and ${furnaceSize(furnace)} input/cabinet/blower. Select a Champion furnace for options 2–3.`);
    // XC6 technical guide 6601765-LTG-A-0125, table 5: explicit coil groups,
    // not an AHRI rating. Only the authorized upsized tier may change its coil.
    if (upsized) {
      const supported = targetCapacity === 3 ? /^CTM(?:36C5[AC]D|42C5CE)[SN]1$/ : /^CTM48[CD]5CF[SN]1$/;
      if (!supported.test(coil.model)) {
        const candidates = catalog.filter(i => i.category === 'Evaporator Coil' && i.brand === 'Champion' && supported.test(i.model) && i.tonnage === targetCapacity && i.model.endsWith(originalCoil.model.slice(-2)) && priced(i));
        candidates.sort((a,b) => Number(b.model[5] === furnaceSize(furnace)![3]) - Number(a.model[5] === furnaceSize(furnace)![3]) || a.cost-b.cost || a.model.localeCompare(b.model));
        if (!candidates.length) return fail(`No priced Champion coil in the documented ${targetCapacity}-ton XC6 coil group. Confirm a compatible coil and price.`);
        coil = candidates[0];
      }
    }
    // Certification is optional. Explicit model families identify R-454B equipment;
    // unknown physical details remain installer review items, never invented matches.
    const coilCode = coil.model.match(/^CTM(\d{2})([A-D])(5)/);
    if (/\bR[- ]?(?:410A|22|32)\b/i.test(`${coil.description} ${coil.tier || ''}`)) return fail('Known refrigerant mismatch: selected coil specifies a different refrigerant from these R-454B condensers.');
    const combinations = outdoor.flatMap(condenser => indoor.map(heat => ({
      condenser, heat, match: matches.find(m => m.condenser === condenser.model && m.furnace === heat.model && m.coil === coil.model),
    }))).sort((a, b) => (a.condenser.cost + a.heat.cost) - (b.condenser.cost + b.heat.cost) || a.condenser.model.localeCompare(b.condenser.model) || a.heat.model.localeCompare(b.heat.model));
    const { condenser, heat, match } = combinations[0];
    const reviewNotes = ['Installer review required before installation: verify coil application, refrigerant, metering/TXV, cabinet transition, actual blower airflow/static pressure, controls and installation orientation. Any required scope or accessory changes must be confirmed separately.'];
    if (upsized) reviewNotes.push(`Top option uses a ${targetCapacity}-ton XC6 condenser instead of the selected ${selectedCapacity} ton. ${coil.id === originalCoil.id ? `The selected coil ${coil.model} is retained` : `Coil changes from ${originalCoil.model} to ${coil.model} (${coil.tonnage} ton), included in this option price`}; installer must verify coil application, ${targetCapacity === 3 ? '5A1' : '5C1'} metering and airflow for the larger condenser before installation.`);
    if (!coilCode) reviewNotes.push(`Refrigerant and coil application for ${coil.model} are not established by catalog metadata.`);
    if (coilCode && coilCode[2] !== furnaceSize(heat)![3]) reviewNotes.push('Coil and furnace cabinet codes differ; confirm transition and installation fit.');
    if (coil.tonnage !== condenser.tonnage) reviewNotes.push('Selected coil nominal capacity differs from the condenser; verify this exact coil application without changing selected capacity.');
    const nominalAirflow = Number(furnaceSize(heat)!.slice(-2)) * 100;
    if (nominalAirflow < condenser.tonnage! * 400) reviewNotes.push(`Nominal blower code is ${nominalAirflow} CFM; verify required cooling airflow from manufacturer tables at actual static pressure.`);
    const rating = `Approx. ${definition.tier === 'Value' ? (condenser.model.startsWith('RC4') ? '14.3' : '13.4') + ' SEER2 series' : definition.rating}`;
    // Duplicate model records are ambiguous even if one has a lower price.
    if ([condenser, heat, coil].some(item => catalog.filter(i => i.model === item.model && i.brand === item.brand && i.category === item.category).length !== 1)) return fail('Duplicate model records: confirm the equipment model and price.');
    return { ...definition, rating, reviewNotes, match, items: selected.map(i => i.id === ac.id ? condenser : i.id === furnace.id ? heat : i.id === originalCoil.id ? coil : i) };
  });
}
