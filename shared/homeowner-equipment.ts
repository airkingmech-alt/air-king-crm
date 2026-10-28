/** Quote display text only. Technical selections, prices and accepted records stay intact. */
export interface EquipmentDescription {
  brand: string; category: string; model: string; description: string; tier?: string; tonnage?: number;
}
export interface HomeownerOptionSource {
  homeownerEquipment?: string[]; equipment?: string; equipmentSummary?: string; efficiency?: string; features?: string[];
}
export function formatHomeownerEquipment(item: EquipmentDescription): string {
  const size = Number.isFinite(item.tonnage) && item.tonnage! > 0 ? `${item.tonnage}-ton` : '';
  const name = item.category === 'Condenser' ? 'AC' : item.category === 'Evaporator Coil' ? 'coil' : item.category.toLowerCase();
  const family = item.category === 'Condenser' ? item.model.match(/^(XC3|XC4|XC6|RC3|RC4)\d{2}[A-Z0-9]+$/)?.[1] : undefined;
  const reviewedRatings:Record<string,string> = {XC3:'13.4 SEER2',XC4:'14.3 SEER2',XC6:'16+ SEER2',RC3:'13.4 SEER2',RC4:'14.3 SEER2'};
  const rating = family ? reviewedRatings[family] : item.tier?.match(/\d+(?:\.\d+)?\+?\s*SEER2?\b/i)?.[0];
  if (item.category === 'Furnace') {
    const efficiency = item.tier?.match(/(\d+(?:\.\d+)?)%/)?.[1];
    const thousands = item.description.match(/\b(\d+(?:\.\d+)?)K\s*BTU\b/i)?.[1];
    const exact = item.description.match(/\b(\d{2,3},?\d{3})\s*BTU\b/i)?.[1];
    const btu = thousands ? Number(thousands)*1000 : exact ? Number(exact.replaceAll(',','')) : undefined;
    return [efficiency ? `${efficiency}% efficient` : '',btu ? `${btu.toLocaleString('en-US')} BTU ${item.brand} furnace` : `${item.brand} furnace`].filter(Boolean).join(', ');
  }
  if (['Condenser','Heat Pump','Evaporator Coil','Air Handler'].includes(item.category)) {
    return [[size,...(['Condenser','Heat Pump'].includes(item.category)&&rating?[rating]:[])].filter(Boolean).join(', '),item.brand,name].filter(Boolean).join(' ');
  }
  const descriptive = item.description.replaceAll(item.model,'').replace(/\(\s*\)/g,'').trim();
  return descriptive || `${item.brand} ${name}`;
}
function models(option:HomeownerOptionSource):string[] {
  return (option.equipment||'').split(/\s+\+\s+|\n/).map(s=>s.trim()).filter(s=>/^[A-Z0-9][A-Z0-9-]{4,}$/i.test(s)&&/[A-Z]/i.test(s)&&/\d/.test(s));
}
export function homeownerEquipmentLines(option:HomeownerOptionSource):string[] {
  if (option.homeownerEquipment?.length) return option.homeownerEquipment.filter(s=>typeof s==='string'&&s.trim());
  const codes=models(option);
  // Legacy display uses saved descriptions, never a current pricebook lookup or
  // a newly inferred capacity/rating for an old or unknown model.
  const text=option.equipmentSummary || option.equipment || '';
  return text.split(/\n/).map(line=>{
    let result=line;
    for(const model of codes) result=result.replaceAll(` — ${model}`,'').replaceAll(` (${model})`,'').replaceAll(model,'');
    return result.replace(/^[\s+—,;]+|[\s+—,;]+$/g,'').replace(/\s*\+\s*/g,' · ').trim();
  }).filter(Boolean);
}
function replaceModel(text:string, model:string, replacement:string) {
  const escaped=model.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`(^|[^A-Za-z0-9-])${escaped}(?=$|[^A-Za-z0-9-])`, "g"), (_match, prefix:string)=>prefix+replacement);
}
export function homeownerText(text:string|undefined,options:readonly HomeownerOptionSource[]):string {
  let result=text||'';
  for(const option of options) {
    const codes=models(option), lines=homeownerEquipmentLines(option);
    for(let index=0;index<codes.length;index++) {
      const model=codes[index];
      // Remove model annotations without changing surrounding scope/exclusions.
      result=result.replaceAll(` (${model})`,'').replaceAll(` — ${model}`,'');
      result=replaceModel(result,model,lines.length===codes.length?lines[index]:'selected equipment');
    }
  }
  return result;
}
export function homeownerOption(option:HomeownerOptionSource) {
  const lines=homeownerEquipmentLines(option);
  const equipmentSummary=lines.join('\n') || (option.equipment ? 'Equipment details available on request' : '');
  let efficiency=option.efficiency||'';
  for(const model of models(option)) efficiency=efficiency.replaceAll(`${model}: `,'').replaceAll(model,'');
  // Repeated series labels are unnecessary once each saved equipment line has specs.
  const displayedRatings=efficiency.match(/\d+(?:\.\d+)?\+?\s*SEER2?\b/gi)||[];
  if(displayedRatings.length && displayedRatings.every(rating=>lines.some(line=>line.includes(rating)))) efficiency='';
  return {homeownerEquipment:lines,equipment:equipmentSummary,equipmentSummary,efficiency,
    features:Array.from(new Set((option.features||[]).map(feature=> /^(Installer review required|Top option uses|Refrigerant and coil application|Coil and furnace cabinet|Selected coil nominal|Nominal blower code|Manually entered equipment requires)/.test(feature) ? "Equipment fit and installation requirements will be confirmed before installation." : homeownerText(feature,[option]))))};
}
