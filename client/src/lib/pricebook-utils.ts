export const AIR_KING_MARGIN = 0.2;

export function dollarsToCents(value: string | number): number {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("Prices and costs must be zero or greater.");
  }
  return Math.round(amount * 100);
}

export function sellingPriceFromCost(cost: string | number): string {
  const costCents = dollarsToCents(cost);
  return (costCents / (1 - AIR_KING_MARGIN) / 100).toFixed(2);
}

export function missingCatalogRows<T extends { sku: string | null }>(
  rows: T[],
  existingSkus: Array<string | null>,
): T[] {
  const existing = new Set(
    existingSkus.filter(Boolean).map((sku) => sku!.trim().toLowerCase()),
  );
  return rows.filter((row) => {
    if (!row.sku) return true;
    const normalized = row.sku.trim().toLowerCase();
    if (existing.has(normalized)) return false;
    existing.add(normalized);
    return true;
  });
}
