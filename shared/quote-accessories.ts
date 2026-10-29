import { isCatalogVisible, needsCatalogPrice, type CatalogMetadata } from './pricebook-catalog';

export interface AccessoryCatalogItem {
  id: string; name: string; description?: string; category: string; item_type: string;
  sku?: string | null; model?: string | null; unit: string; cost_cents: number;
  price_cents: number; active: boolean; metadata?: CatalogMetadata;
}
export const accessoryGroups = [
  { name: 'Electrical whip', pattern: /\bwhip\b/i, review: 'Confirm conductor gauge, length, fittings and equipment electrical requirements.' },
  { name: 'Disconnect', pattern: /disconnect/i, review: 'Confirm amperage, voltage, enclosure and fused/non-fused requirements.' },
  { name: 'Surge protection', pattern: /surge/i, review: 'Confirm voltage, phase and installation location. The service record does not specify a device model.' },
  { name: 'Equipment pads', pattern: /(?:equipment|condenser|heat pump|plastic|concrete) pad/i, review: 'Confirm footprint, load rating, elevation and mounting conditions.' },
  { name: 'Line-set items', pattern: /line[- ]?set/i, review: 'Confirm refrigerant, tube sizes, length, insulation and equipment instructions.' },
  { name: 'Condensate pump / safety switch', pattern: /condensate|float switch|safe[- ]?t[- ]?switch/i, review: 'Confirm drainage route, pump lift, voltage and safety-switch wiring.' },
  { name: 'Thermostats', pattern: /thermostat/i, review: 'Confirm system stages, heat-pump/dual-fuel controls, communicating requirements and power wiring.' },
  { name: 'Media air cleaners / filter cabinets', pattern: /media air cleaner|filter cabinet|media cabinet/i, review: 'Confirm cabinet dimensions, filter size and system airflow/static pressure.' },
  { name: 'Humidifiers', pattern: /humidifier/i, review: 'Confirm humidification need, duct space, water/drain connections and controls.' },
];
export function accessoryGroup(item: AccessoryCatalogItem) {
  // Replacement components are not complete installation accessories.
  if (item.category === 'Replacement Parts') return undefined;
  return accessoryGroups.find(group => group.pattern.test(`${item.name} ${item.category} ${item.metadata?.subcategory || ''}`));
}
export function accessoryAvailable(item: AccessoryCatalogItem) {
  return item.active && !item.metadata?.catalog_archived && !needsCatalogPrice(item) && !!item.unit?.trim()
    && Number.isSafeInteger(item.cost_cents) && item.cost_cents >= 0
    && Number.isSafeInteger(item.price_cents) && item.price_cents > 0
    && (item.item_type === 'service' || item.cost_cents > 0);
}
export function accessoryCatalog(items: AccessoryCatalogItem[]) {
  return items.filter(item => ['part', 'material', 'equipment', 'service'].includes(item.item_type) && isCatalogVisible(item) && accessoryGroup(item));
}
export interface QuoteAccessory {
  pricebookId: string; name: string; sku: string; unit: string; quantity: number;
  pricing: 'material' | 'installed-service'; unitCostCents: number; unitPriceCents: number;
  sourceUpdatedAt?: string; review: string;
}
export function snapshotAccessory(item: AccessoryCatalogItem & {updated_at?: string}): QuoteAccessory {
  const group = accessoryGroup(item);
  if (!group || !accessoryAvailable(item)) throw new Error('Accessory needs an active pricebook record with confirmed price and unit.');
  return { pricebookId: item.id, name: item.name, sku: item.sku || item.model || '', unit: item.unit, quantity: 1,
    pricing: item.item_type === 'service' ? 'installed-service' : 'material', unitCostCents: item.cost_cents,
    unitPriceCents: item.price_cents, ...(item.updated_at ? {sourceUpdatedAt: item.updated_at} : {}), review: group.review };
}
export function accessoryTotals(items: QuoteAccessory[] = []) {
  if (items.length > 100 || new Set(items.map(i => i.pricebookId)).size !== items.length) throw new Error('Duplicate accessories or too many accessories.');
  if (items.some(item => items.some(other => item.review && item.review === other.review && item.pricing !== other.pricing))) throw new Error('Choose either an installed service or its component parts to avoid double-counting.');
  let materialCents = 0, serviceCostCents = 0, servicePriceCents = 0;
  for (const item of items) {
    if (!item.pricebookId || !item.name?.trim() || !item.unit?.trim() || !['material', 'installed-service'].includes(item.pricing)
      || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000
      || !Number.isSafeInteger(item.unitCostCents) || item.unitCostCents < 0
      || !Number.isSafeInteger(item.unitPriceCents) || item.unitPriceCents <= 0
      || (item.pricing === 'material' && item.unitCostCents === 0)) throw new Error('Review accessory quantity, price and unit before saving.');
    if (item.pricing === 'material') materialCents += item.unitCostCents * item.quantity;
    else { serviceCostCents += item.unitCostCents * item.quantity; servicePriceCents += item.unitPriceCents * item.quantity; }
  }
  return { materialCost: materialCents / 100, serviceCost: serviceCostCents / 100, servicePrice: servicePriceCents / 100,
    missingServiceCost: items.some(i => i.pricing === 'installed-service' && i.unitCostCents === 0) };
}
export function accessoryDescription(item: QuoteAccessory) {
  return `${item.quantity} ${item.unit} × ${item.name}${item.sku ? ` (${item.sku})` : ''}`;
}
// These installed services now belong to individual options, so a customer cannot
// add the same installation service again from the shared add-on choices.
export const optionAccessoryServiceIds = ['surge-protector', 'wifi-thermostat', 'media-cleaner', 'humidifier'];
