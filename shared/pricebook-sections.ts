export type ItemType = "equipment" | "part" | "service" | "labor";
export type PricebookTab = "all" | "mini-splits" | "ductwork" | "sheet-metal" | "thermostats" | "iaq" | ItemType;
export const MINI_SPLITS_CATEGORY = "Mini Splits";
export const DUCTWORK_CATEGORY = "Ductwork & Fittings";
export const SHEET_METAL_CATEGORY = "Sheet Metal & Sheet Metal Fittings";
export const pricebookTabs: Record<PricebookTab, string> = {
  all: "All items", equipment: "Equipment", "mini-splits": MINI_SPLITS_CATEGORY,
  ductwork: DUCTWORK_CATEGORY, "sheet-metal": SHEET_METAL_CATEGORY, thermostats: "Thermostats", iaq: "Indoor Air Quality",
  part: "Parts", service: "Services", labor: "Labor",
};
export function isMiniSplit(item: { category: string; item_type: ItemType }) {
  return ["equipment", "part"].includes(item.item_type) &&
    item.category.trim().toLowerCase() === MINI_SPLITS_CATEGORY.toLowerCase();
}
export function matchesPricebookTab(item: { category: string; item_type: ItemType }, tab: PricebookTab) {
  if (tab === "all") return true;
  if (tab === "mini-splits") return isMiniSplit(item);
  const isSheetMetal = item.item_type === "part" && item.category.trim().toLowerCase() === SHEET_METAL_CATEGORY.toLowerCase();
  if (tab === "sheet-metal") return isSheetMetal;
  if (tab === "part") return item.item_type === "part" && !isSheetMetal;
  if (["ductwork", "thermostats", "iaq"].includes(tab)) return item.category.trim().toLowerCase() === pricebookTabs[tab].toLowerCase();
  return item.item_type === tab;
}
export function newItemDefaults(tab: PricebookTab) {
  return tab === "mini-splits" ? { item_type: "equipment" as ItemType, category: MINI_SPLITS_CATEGORY } :
    ["ductwork", "sheet-metal", "thermostats", "iaq"].includes(tab) ? { item_type: "part" as ItemType, category: pricebookTabs[tab] } :
    tab === "all" ? { item_type: "part" as ItemType, category: "Parts" } :
    { item_type: tab as ItemType, category: pricebookTabs[tab] };
}
export function categoryAfterTypeChange(category: string, type: ItemType) {
  if (type === "part" && category.trim().toLowerCase() === SHEET_METAL_CATEGORY.toLowerCase()) return SHEET_METAL_CATEGORY;
  if (type === "part" && [DUCTWORK_CATEGORY, "Thermostats", "Indoor Air Quality", "Replacement Parts"].includes(category.trim())) return category.trim();
  return category.trim().toLowerCase() === MINI_SPLITS_CATEGORY.toLowerCase() &&
    ["equipment", "part"].includes(type) ? MINI_SPLITS_CATEGORY : pricebookTabs[type];
}
