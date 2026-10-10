export type ItemType = "equipment" | "part" | "service" | "labor";
export type PricebookTab = "all" | "mini-splits" | ItemType;
export const MINI_SPLITS_CATEGORY = "Mini Splits";
export const pricebookTabs: Record<PricebookTab, string> = {
  all: "All items", equipment: "Equipment", "mini-splits": MINI_SPLITS_CATEGORY,
  part: "Parts", service: "Services", labor: "Labor",
};
export function isMiniSplit(item: { category: string; item_type: ItemType }) {
  return ["equipment", "part"].includes(item.item_type) &&
    item.category.trim().toLowerCase() === MINI_SPLITS_CATEGORY.toLowerCase();
}
export function matchesPricebookTab(item: { category: string; item_type: ItemType }, tab: PricebookTab) {
  return tab === "all" || (tab === "mini-splits" ? isMiniSplit(item) : item.item_type === tab);
}
export function newItemDefaults(tab: PricebookTab) {
  return tab === "mini-splits" ? { item_type: "equipment" as ItemType, category: MINI_SPLITS_CATEGORY } :
    tab === "all" ? { item_type: "part" as ItemType, category: "Parts" } :
    { item_type: tab, category: pricebookTabs[tab] };
}
export function categoryAfterTypeChange(category: string, type: ItemType) {
  return category.trim().toLowerCase() === MINI_SPLITS_CATEGORY.toLowerCase() &&
    ["equipment", "part"].includes(type) ? MINI_SPLITS_CATEGORY : pricebookTabs[type];
}
