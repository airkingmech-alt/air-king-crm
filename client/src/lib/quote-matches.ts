// Reviewed AHRI model combinations. Supplier stock and field installation fit
// still require confirmation. Do not infer matches from nominal tonnage alone.
export const reviewedQuoteMatches = [
  // https://www.ahridirectory.org/details/101/214727374
  { condenser: "XC342E2S11", coil: "CTM42C5CES1", furnace: "Z9ES080C20SMPS1", ahri: "214727374", seer2: 13.4 },
  // https://www.ahridirectory.org/details/101/215419289
  { condenser: "XC442E2S11", coil: "CTM42C5CES1", furnace: "Z9ES080C20SMPS1", ahri: "215419289", seer2: 14.3 },
  // https://www.ahridirectory.org/details/101/216586593
  { condenser: "XC648E2S11", coil: "CTM48C5CFS1", furnace: "Z9ES080C20SMPS1", ahri: "216586593", seer2: 15.75 },
] as const;
