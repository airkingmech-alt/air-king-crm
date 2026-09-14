// Quantities use thousandths of a unit. Database transactions must still lock
// and re-read stock before applying these rules; this module is not a ledger.
export const QUANTITY_SCALE = 1000;

export function quantityUnits(value: unknown, serialized = false): number {
  const text = String(value);
  if (!/^\d+(?:\.\d{1,3})?$/.test(text))
    throw new Error("Enter a non-negative quantity with at most three decimal places.");
  const [whole, fraction = ""] = text.split(".");
  const units = BigInt(whole) * BigInt(1000) + BigInt(fraction.padEnd(3, "0"));
  if (units > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Quantity is too large.");
  if (serialized && units % BigInt(1000) !== BigInt(0))
    throw new Error("Serialized equipment requires whole units.");
  return Number(units);
}

function nonnegativeInteger(value: number) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error("Invalid stock quantity.");
}

export function availableUnits(onHand: number, reserved: number, committed: number) {
  [onHand, reserved, committed].forEach(nonnegativeInteger);
  if (reserved > onHand || committed > onHand - reserved)
    throw new Error("Stock commitments exceed physical stock.");
  return onHand - reserved - committed;
}

export function restockSuggestion(input: {
  available: number;
  inbound: number;
  minimum: number;
  target: number;
  sourceAvailable: number;
}) {
  Object.values(input).forEach(nonnegativeInteger);
  if (input.target < input.minimum) throw new Error("Target must be at least the minimum.");
  const belowMinimum = input.available < input.minimum;
  const needed = belowMinimum
    ? Math.max(0, input.target - input.available - input.inbound)
    : 0;
  const transferable = Math.min(needed, input.sourceAvailable);
  return { belowMinimum, needed, transferable, purchaseShortage: needed - transferable };
}

export type TransferStatus = "Draft" | "Ready" | "Picked" | "In Transit" | "Received" | "Cancelled";
const nextStatuses: Record<TransferStatus, TransferStatus[]> = {
  Draft: ["Ready", "Cancelled"],
  Ready: ["Picked", "Cancelled"],
  Picked: ["In Transit", "Cancelled"],
  "In Transit": ["Received"],
  Received: [],
  Cancelled: [],
};

export function assertTransferTransition(from: TransferStatus, to: TransferStatus) {
  if (!nextStatuses[from]?.includes(to))
    throw new Error("This transfer transition is not allowed. Dispatched stock must be received or returned.");
}

export function receiptResult(ordered: number, received: number, incoming: number) {
  [ordered, received, incoming].forEach(nonnegativeInteger);
  if (!incoming || received > ordered || incoming > ordered - received)
    throw new Error("Receipt quantity exceeds the remaining order or is zero.");
  const totalReceived = received + incoming;
  return {
    received: totalReceived,
    remaining: ordered - totalReceived,
    status: totalReceived === ordered ? "Received" : "Partially Received",
  };
}

export function assertCountCanPost(role: string, expectedVersion: number, currentVersion: number) {
  if (!["owner", "admin"].includes(role))
    throw new Error("An administrator must approve inventory adjustments.");
  [expectedVersion, currentVersion].forEach(nonnegativeInteger);
  if (expectedVersion !== currentVersion)
    throw new Error("Stock changed after this count. Review the count before posting.");
}
