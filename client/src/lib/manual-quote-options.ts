import { pricebook, formatEquipmentDescription, type PricebookItem } from '../data/pricebook';
import type { QuoteOption } from '../data/mock-data';
import { calculateQuotePricing } from './quote-pricing';
import { approximateEfficiencyDisclosure } from '../../../shared/quote-efficiency';
import { potentialChampionRebates, championRebateSummary } from '../../../shared/champion-rebates';

export const MANUAL_LABOR_WARRANTY_COST = 350;
export const manualOptionTiers: QuoteOption['tier'][] = ['Value', 'Good', 'Better', 'Best'];
export interface ManualQuoteOptionInput {
  tier: QuoteOption['tier']; label: string; equipmentItems: string[];
  manualEquipment?: PricebookItem[];
  laborCost: number; materialsCost: number;
  partsWarranty: boolean; laborWarranty: boolean; rebateConfirmed: boolean;
  customerPriceOverride?: number;
}
function money(value: number, label: string, positive = false) {
  if (!Number.isFinite(value) || value < (positive ? .01 : 0) || value > 100000000 || Math.abs(value * 100 - Math.round(value * 100)) > .000001)
    throw new Error(`${label} must be ${positive ? 'positive' : 'zero or more'}, with at most two decimal places.`);
  return value;
}
export function manualOptionInput(option: QuoteOption): ManualQuoteOptionInput {
  if (!option.manualConfiguration) throw new Error('This option uses the previous quote workflow.');
  return { tier: option.tier, label: option.label, equipmentItems: [...(option.equipmentItems || [])], manualEquipment: structuredClone(option.manualEquipment || []),
    laborCost: option.laborCost ?? 0, materialsCost: option.materialsCost ?? 0,
    partsWarranty: !!option.partsWarranty, laborWarranty: !!option.laborWarranty, rebateConfirmed: !!option.rebateConfirmed,
    ...(option.customerPriceOverride !== undefined ? {customerPriceOverride:option.customerPriceOverride} : {}) };
}
export function buildManualQuoteOption(input: ManualQuoteOptionInput, catalog: PricebookItem[] = pricebook, today = new Date().toISOString().slice(0,10)): QuoteOption {
  if (!manualOptionTiers.includes(input.tier)) throw new Error('Choose a valid option identity.');
  if (!input.label.trim() || input.label.trim().length > 200) throw new Error('Enter an option name of 200 characters or fewer.');
  if (![input.partsWarranty,input.laborWarranty,input.rebateConfirmed].every(v=>typeof v==='boolean')) throw new Error('Confirm the option warranty and rebate selections.');
  if (new Set(input.equipmentItems).size !== input.equipmentItems.length) throw new Error('An equipment item is listed twice in this option.');
  const selected = input.equipmentItems.map(id => {
    const matches = catalog.filter(i=>i.id===id);
    if (matches.length !== 1) throw new Error('Selected equipment is missing or duplicated in the pricebook.');
    return matches[0];
  });
  const manual = structuredClone(input.manualEquipment || []);
  for (const item of manual) {
    item.model = item.model?.trim().toUpperCase();
    if (!item.model?.trim() || item.model.length>200 || !item.description?.trim() || item.description.length>2000 || !['Champion','Guardian'].includes(item.brand) || !['Condenser','Furnace','Evaporator Coil','Heat Pump','Air Handler','Heat Strip','Accessory'].includes(item.category)) throw new Error('Enter a model, brand, category and description for each manual item.');
    if(item.tonnage !== undefined && (!Number.isFinite(item.tonnage)||item.tonnage<=0)) throw new Error('Manual capacity must be positive.');
  }
  const items = [...selected,...manual];
  if (!items.length || items.length>100) throw new Error('Add between one and 100 equipment items to this option.');
  for(const item of items) {
    money(item.cost, `Price for ${item.model}`, true);
    if(item.model==='RG19080C20MPS1') throw new Error('Guardian RG19080C20MPS1 is unavailable. Choose another supplied model.');
  }
  if(new Set(items.map(i=>i.model.trim().toUpperCase())).size!==items.length) throw new Error('An equipment model is listed twice in this option.');
  // Do not change selections or pretend that an absent AHRI certificate is a mismatch.
  const acs=items.filter(i=>i.category==='Condenser');
  const coils=items.filter(i=>i.category==='Evaporator Coil');
  if(acs.some(i=>/^(XC[346]|RC[34])/.test(i.model)) && coils.some(i=>/\bR[- ]?(?:410A|22|32)\b/i.test(`${i.description} ${i.tier||''}`))) throw new Error('Known refrigerant mismatch: this AC and coil require review before quoting together.');
  const laborCost=money(input.laborCost,'Labor cost'), materialsCost=money(input.materialsCost,'Materials cost');
  const equipmentCost=items.reduce((sum,i)=>sum+Math.round(i.cost*100),0)/100;
  const laborWarrantyCost=input.laborWarranty ? MANUAL_LABOR_WARRANTY_COST : 0;
  const pricing=calculateQuotePricing(equipmentCost,laborCost+laborWarrantyCost,materialsCost);
  if(pricing.totalCost>100000000 || pricing.customerPrice>100000000) throw new Error('Option total is too large.');
  const suggested=potentialChampionRebates(selected);
  if(input.rebateConfirmed && (!suggested || championRebateSummary(suggested,today).expired || championRebateSummary(suggested,today).beforeWindow)) throw new Error('No current suggested rebate is available for these pricebook models.');
  const ratings=selected.filter(i=>i.category==='Condenser').map(i=> {
    const family=i.model.match(/^(XC3|XC4|XC6|RC3|RC4)/)?.[1];
    const rating=family ? ({XC3:'13.4 SEER2',XC4:'14.3 SEER2',XC6:'16+ SEER2',RC3:'13.4 SEER2',RC4:'14.3 SEER2'} as Record<string,string>)[family] : i.tier;
    return rating ? `${i.model}: approx. ${rating} equipment series` : `${i.model}: efficiency to be verified`;
  });
  const features=[
    'Installation as described in the scope of work',
    ...(input.partsWarranty ? ['10-year parts warranty'] : []),
    ...(input.laborWarranty ? ['10-year labor warranty'] : []),
    ...(input.partsWarranty||input.laborWarranty ? ['Warranty registration and proposal terms apply'] : []),
    approximateEfficiencyDisclosure,
    'Installer review required: confirm equipment compatibility, refrigerant, metering, cabinet fit, airflow, electrical requirements and installation orientation. Selected models and capacities are not automatically changed.',
    ...(manual.length ? ['Manually entered equipment requires supplier price, model and installation review.'] : []),
  ];
  return {tier:input.tier,label:input.label.trim(),manualConfiguration:true,
    equipmentItems:[...input.equipmentItems],manualEquipment:manual,
    equipment:items.map(i=>i.model).join(' + '),equipmentSummary:items.map(i=>`${formatEquipmentDescription(i.category==='Condenser'?{...i,tier:undefined}:i)} — ${i.model}`).join('\n'),
    efficiency:ratings.join('; ')||'Equipment efficiency to be verified',features,
    laborCost,materialsCost,partsWarranty:input.partsWarranty,laborWarranty:input.laborWarranty,rebateConfirmed:input.rebateConfirmed,
    laborWarrantyCost,equipmentCost,purchaseTax:pricing.purchaseTax,totalCost:pricing.totalCost,
    customerPrice:input.customerPriceOverride===undefined?pricing.customerPrice:money(input.customerPriceOverride,'Selling price',true),
    ...(input.customerPriceOverride===undefined?{}:{customerPriceOverride:input.customerPriceOverride}),
    ...(input.rebateConfirmed?{rebateOffer:suggested}:{}),
  };
}
export function buildManualQuoteOptions(inputs: ManualQuoteOptionInput[],catalog:PricebookItem[]=pricebook) {
  if(inputs.length<1 || inputs.length>4 || new Set(inputs.map(i=>i.tier)).size!==inputs.length) throw new Error('Add one to four independent options.');
  return inputs.map(i=>buildManualQuoteOption(i,catalog));
}
