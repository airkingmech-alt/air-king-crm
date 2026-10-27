export const approximateEfficiencyDisclosure = 'SEER/SEER2 ratings shown are approximate equipment-series ratings. Actual installed-system efficiency depends on the complete equipment combination and installation. An AHRI-certified rating is not represented unless specifically provided.';

export function quoteEfficiencyDeliveryBody(body: string, options: { features?: string[] }[] = []): string {
  return options.some(option => option.features?.includes(approximateEfficiencyDisclosure)) && !body.includes(approximateEfficiencyDisclosure)
    ? `${body}\n\n${approximateEfficiencyDisclosure}` : body;
}
