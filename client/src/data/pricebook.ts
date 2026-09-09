// Air King HVAC Pricebook — Champion & Guardian equipment
// Sourced from Kearney Winsupply pricing sheets (02/05/2026)

export type EquipmentCategory =
  | "Heat Pump"
  | "Condenser"
  | "Air Handler"
  | "Evaporator Coil"
  | "Furnace"
  | "Heat Strip"
  | "Accessory";

export type Brand = "Champion" | "Guardian";

export interface PricebookItem {
  id: string;
  brand: Brand;
  category: EquipmentCategory;
  model: string;
  cost: number; // internal cost (not shown to customers)
  tier?: string; // efficiency tier
  tonnage?: number;
  description: string;
}

// Champion brand equipment (internal cost prices from Kearney Winsupply)
const championItems: PricebookItem[] = [
  // Heat Pumps — HH series (80% AFUE)
  { id: "chp-hh824", brand: "Champion", category: "Heat Pump", model: "HH824E2S11", cost: 2458, tier: "80% AFUE", tonnage: 2, description: "Champion HH Series 2-Ton Heat Pump" },
  { id: "chp-hh836", brand: "Champion", category: "Heat Pump", model: "HH836E2S11", cost: 3090, tier: "80% AFUE", tonnage: 3, description: "Champion HH Series 3-Ton Heat Pump" },
  { id: "chp-hh860", brand: "Champion", category: "Heat Pump", model: "HH860E2S11", cost: 3664, tier: "80% AFUE", tonnage: 5, description: "Champion HH Series 5-Ton Heat Pump" },
  // Heat Pumps — XH6 series (16 SEER)
  { id: "chp-xh624", brand: "Champion", category: "Heat Pump", model: "XH624E2S11", cost: 2402, tier: "16 SEER", tonnage: 2, description: "Champion XH6 16 SEER 2-Ton Heat Pump" },
  { id: "chp-xh636", brand: "Champion", category: "Heat Pump", model: "XH636E2S11", cost: 3077, tier: "16 SEER", tonnage: 3, description: "Champion XH6 16 SEER 3-Ton Heat Pump" },
  { id: "chp-xh648", brand: "Champion", category: "Heat Pump", model: "XH648E2S11", cost: 3564, tier: "16 SEER", tonnage: 4, description: "Champion XH6 16 SEER 4-Ton Heat Pump" },
  { id: "chp-xh660", brand: "Champion", category: "Heat Pump", model: "XH660E2S11", cost: 3927, tier: "16 SEER", tonnage: 5, description: "Champion XH6 16 SEER 5-Ton Heat Pump" },
  // Heat Pumps — XH5 series (15 SEER)
  { id: "chp-xh518", brand: "Champion", category: "Heat Pump", model: "XH518E2S11", cost: 2089, tier: "15 SEER", tonnage: 1.5, description: "Champion XH5 15 SEER 1.5-Ton Heat Pump" },
  { id: "chp-xh524", brand: "Champion", category: "Heat Pump", model: "XH524E2S11", cost: 2176, tier: "15 SEER", tonnage: 2, description: "Champion XH5 15 SEER 2-Ton Heat Pump" },
  { id: "chp-xh536", brand: "Champion", category: "Heat Pump", model: "XH536E2S11", cost: 2788, tier: "15 SEER", tonnage: 3, description: "Champion XH5 15 SEER 3-Ton Heat Pump" },
  { id: "chp-xh548", brand: "Champion", category: "Heat Pump", model: "XH548E2S11", cost: 3229, tier: "15 SEER", tonnage: 4, description: "Champion XH5 15 SEER 4-Ton Heat Pump" },
  { id: "chp-xh560", brand: "Champion", category: "Heat Pump", model: "XH560E2S11", cost: 3556, tier: "15 SEER", tonnage: 5, description: "Champion XH5 15 SEER 5-Ton Heat Pump" },
  // Heat Pumps — XH4 series (14 SEER)
  { id: "chp-xh418", brand: "Champion", category: "Heat Pump", model: "XH418E2S11", cost: 1989, tier: "14 SEER", tonnage: 1.5, description: "Champion XH4 14 SEER 1.5-Ton Heat Pump" },
  { id: "chp-xh424", brand: "Champion", category: "Heat Pump", model: "XH424E2S11", cost: 1982, tier: "14 SEER", tonnage: 2, description: "Champion XH4 14 SEER 2-Ton Heat Pump" },
  { id: "chp-xh436", brand: "Champion", category: "Heat Pump", model: "XH436E2S11", cost: 2503, tier: "14 SEER", tonnage: 3, description: "Champion XH4 14 SEER 3-Ton Heat Pump" },
  { id: "chp-xh448", brand: "Champion", category: "Heat Pump", model: "XH448E2S11", cost: 2908, tier: "14 SEER", tonnage: 4, description: "Champion XH4 14 SEER 4-Ton Heat Pump" },
  { id: "chp-xh460", brand: "Champion", category: "Heat Pump", model: "XH460E2S11", cost: 3243, tier: "14 SEER", tonnage: 5, description: "Champion XH4 14 SEER 5-Ton Heat Pump" },

  // Condensers — XC6 series (16 SEER)
  { id: "chp-xc618", brand: "Champion", category: "Condenser", model: "XC618E2S11", cost: 1900, tier: "16 SEER", tonnage: 1.5, description: "Champion XC6 16 SEER 1.5-Ton Condenser" },
  { id: "chp-xc624", brand: "Champion", category: "Condenser", model: "XC624E2S11", cost: 1997, tier: "16 SEER", tonnage: 2, description: "Champion XC6 16 SEER 2-Ton Condenser" },
  { id: "chp-xc636", brand: "Champion", category: "Condenser", model: "XC636E2S11", cost: 2397, tier: "16 SEER", tonnage: 3, description: "Champion XC6 16 SEER 3-Ton Condenser" },
  { id: "chp-xc648", brand: "Champion", category: "Condenser", model: "XC648E2S11", cost: 3124, tier: "16 SEER", tonnage: 4, description: "Champion XC6 16 SEER 4-Ton Condenser" },
  { id: "chp-xc660", brand: "Champion", category: "Condenser", model: "XC660E2S11", cost: 3361, tier: "16 SEER", tonnage: 5, description: "Champion XC6 16 SEER 5-Ton Condenser" },
  // Condensers — XC4 series (14 SEER)
  { id: "chp-xc418", brand: "Champion", category: "Condenser", model: "XC418E2S11", cost: 1692, tier: "14 SEER", tonnage: 1.5, description: "Champion XC4 14 SEER 1.5-Ton Condenser" },
  { id: "chp-xc424", brand: "Champion", category: "Condenser", model: "XC424E2S11", cost: 1764, tier: "14 SEER", tonnage: 2, description: "Champion XC4 14 SEER 2-Ton Condenser" },
  { id: "chp-xc430", brand: "Champion", category: "Condenser", model: "XC430E2S11", cost: 1902, tier: "14 SEER", tonnage: 2.5, description: "Champion XC4 14 SEER 2.5-Ton Condenser" },
  { id: "chp-xc436", brand: "Champion", category: "Condenser", model: "XC436E2S11", cost: 2119, tier: "14 SEER", tonnage: 3, description: "Champion XC4 14 SEER 3-Ton Condenser" },
  { id: "chp-xc442", brand: "Champion", category: "Condenser", model: "XC442E2S11", cost: 2369, tier: "14 SEER", tonnage: 3.5, description: "Champion XC4 14 SEER 3.5-Ton Condenser" },
  { id: "chp-xc448", brand: "Champion", category: "Condenser", model: "XC448E2S11", cost: 2683, tier: "14 SEER", tonnage: 4, description: "Champion XC4 14 SEER 4-Ton Condenser" },
  { id: "chp-xc460", brand: "Champion", category: "Condenser", model: "XC460E2S11", cost: 3075, tier: "14 SEER", tonnage: 5, description: "Champion XC4 14 SEER 5-Ton Condenser" },
  // Condensers — XC3 series (13 SEER)
  { id: "chp-xc318", brand: "Champion", category: "Condenser", model: "XC318E2S11", cost: 1351, tier: "13 SEER", tonnage: 1.5, description: "Champion XC3 13 SEER 1.5-Ton Condenser" },
  { id: "chp-xc324", brand: "Champion", category: "Condenser", model: "XC324E2S11", cost: 1533, tier: "13 SEER", tonnage: 2, description: "Champion XC3 13 SEER 2-Ton Condenser" },
  { id: "chp-xc330", brand: "Champion", category: "Condenser", model: "XC330E2S11", cost: 1665, tier: "13 SEER", tonnage: 2.5, description: "Champion XC3 13 SEER 2.5-Ton Condenser" },
  { id: "chp-xc336", brand: "Champion", category: "Condenser", model: "XC336E2S11", cost: 1865, tier: "13 SEER", tonnage: 3, description: "Champion XC3 13 SEER 3-Ton Condenser" },
  { id: "chp-xc342", brand: "Champion", category: "Condenser", model: "XC342E2S11", cost: 2101, tier: "13 SEER", tonnage: 3.5, description: "Champion XC3 13 SEER 3.5-Ton Condenser" },
  { id: "chp-xc348", brand: "Champion", category: "Condenser", model: "XC348E2S11", cost: 2354, tier: "13 SEER", tonnage: 4, description: "Champion XC3 13 SEER 4-Ton Condenser" },
  { id: "chp-xc360", brand: "Champion", category: "Condenser", model: "XC360E2S11", cost: 2660, tier: "13 SEER", tonnage: 5, description: "Champion XC3 13 SEER 5-Ton Condenser" },

  // Air Handlers
  { id: "chp-ah18", brand: "Champion", category: "Air Handler", model: "JHE18B5AB2SS1", cost: 965, tonnage: 1.5, description: "Champion 1.5-Ton Air Handler" },
  { id: "chp-ah24", brand: "Champion", category: "Air Handler", model: "JHE24B5AC2SS1", cost: 1095, tonnage: 2, description: "Champion 2-Ton Air Handler" },
  { id: "chp-ah30", brand: "Champion", category: "Air Handler", model: "JHE30B5AD2SS1", cost: 1168, tonnage: 2.5, description: "Champion 2.5-Ton Air Handler" },
  { id: "chp-ah36cd", brand: "Champion", category: "Air Handler", model: "JHE36B5CD2SS1", cost: 1214, tonnage: 3, description: "Champion 3-Ton Air Handler" },
  { id: "chp-ah36c", brand: "Champion", category: "Air Handler", model: "JHE36C5AD2SS1", cost: 1232, tonnage: 3, description: "Champion 3-Ton Multi-Position Air Handler" },
  { id: "chp-ah36cc", brand: "Champion", category: "Air Handler", model: "JHE36C5CD2SS1", cost: 1232, tonnage: 3, description: "Champion 3-Ton Multi-Position Air Handler" },
  { id: "chp-ah42", brand: "Champion", category: "Air Handler", model: "JHE42C5CF2SS1", cost: 1322, tonnage: 3.5, description: "Champion 3.5-Ton Air Handler" },
  { id: "chp-ah48c", brand: "Champion", category: "Air Handler", model: "JHE48C5CG2SS1", cost: 1438, tonnage: 4, description: "Champion 4-Ton Air Handler" },
  { id: "chp-ah48d", brand: "Champion", category: "Air Handler", model: "JHE48D5CG2SS1", cost: 1471, tonnage: 4, description: "Champion 4-Ton Multi-Position Air Handler" },
  { id: "chp-ah60c", brand: "Champion", category: "Air Handler", model: "JHE60C5CH2SS1", cost: 1508, tonnage: 5, description: "Champion 5-Ton Air Handler" },
  { id: "chp-ah60d", brand: "Champion", category: "Air Handler", model: "JHE60D5CH2SS1", cost: 1561, tonnage: 5, description: "Champion 5-Ton Multi-Position Air Handler" },
  { id: "chp-ah60j", brand: "Champion", category: "Air Handler", model: "JHE60D5CJ2SS1", cost: 1577, tonnage: 5, description: "Champion 5-Ton Premium Air Handler" },

  // Evaporator Coils
  { id: "chp-ec18a", brand: "Champion", category: "Evaporator Coil", model: "CTM18A5AAS1", cost: 583, tonnage: 1.5, description: "Champion 1.5-Ton Evaporator Coil" },
  { id: "chp-ec18n", brand: "Champion", category: "Evaporator Coil", model: "CTM18A5AAN1", cost: 583, tonnage: 1.5, description: "Champion 1.5-Ton Evaporator Coil (N)" },
  { id: "chp-ec24ab", brand: "Champion", category: "Evaporator Coil", model: "CTM24A5ABN1", cost: 616, tonnage: 2, description: "Champion 2-Ton Evaporator Coil" },
  { id: "chp-ec24abs", brand: "Champion", category: "Evaporator Coil", model: "CTM24A5ABS1", cost: 616, tonnage: 2, description: "Champion 2-Ton Evaporator Coil (S)" },
  { id: "chp-ec24bb", brand: "Champion", category: "Evaporator Coil", model: "CTM24B5ABN1", cost: 618, tonnage: 2, description: "Champion 2-Ton B-Series Coil" },
  { id: "chp-ec24bs", brand: "Champion", category: "Evaporator Coil", model: "CTM24B5ABS1", cost: 618, tonnage: 2, description: "Champion 2-Ton B-Series Coil (S)" },
  { id: "chp-ec30bn", brand: "Champion", category: "Evaporator Coil", model: "CTM30B5ACN1", cost: 682, tonnage: 2.5, description: "Champion 2.5-Ton B-Series Coil" },
  { id: "chp-ec30bs", brand: "Champion", category: "Evaporator Coil", model: "CTM30B5ACS1", cost: 682, tonnage: 2.5, description: "Champion 2.5-Ton B-Series Coil (S)" },
  { id: "chp-ec30cn", brand: "Champion", category: "Evaporator Coil", model: "CTM30C5ACN1", cost: 680, tonnage: 2.5, description: "Champion 2.5-Ton C-Series Coil" },
  { id: "chp-ec30cs", brand: "Champion", category: "Evaporator Coil", model: "CTM30C5ACS1", cost: 680, tonnage: 2.5, description: "Champion 2.5-Ton C-Series Coil (S)" },
  { id: "chp-ec36bn", brand: "Champion", category: "Evaporator Coil", model: "CTM36B5ADN1", cost: 715, tonnage: 3, description: "Champion 3-Ton B-Series Coil" },
  { id: "chp-ec36bs", brand: "Champion", category: "Evaporator Coil", model: "CTM36B5ADS1", cost: 715, tonnage: 3, description: "Champion 3-Ton B-Series Coil (S)" },
  { id: "chp-ec36cdn", brand: "Champion", category: "Evaporator Coil", model: "CTM36B5CDN1", cost: 740, tonnage: 3, description: "Champion 3-Ton C-Series Coil" },
  { id: "chp-ec36cds", brand: "Champion", category: "Evaporator Coil", model: "CTM36B5CDS1", cost: 740, tonnage: 3, description: "Champion 3-Ton C-Series Coil (S)" },
  { id: "chp-ec36cn", brand: "Champion", category: "Evaporator Coil", model: "CTM36C5ADN1", cost: 702, tonnage: 3, description: "Champion 3-Ton Multi-Position Coil" },
  { id: "chp-ec36cs", brand: "Champion", category: "Evaporator Coil", model: "CTM36C5ADS1", cost: 702, tonnage: 3, description: "Champion 3-Ton Multi-Position Coil (S)" },
  { id: "chp-ec42", brand: "Champion", category: "Evaporator Coil", model: "CTM42C5CES1", cost: 805, tonnage: 3.5, description: "Champion 3.5-Ton Evaporator Coil" },
  { id: "chp-ec48c", brand: "Champion", category: "Evaporator Coil", model: "CTM48C5CFS1", cost: 911, tonnage: 4, description: "Champion 4-Ton Evaporator Coil" },
  { id: "chp-ec48d", brand: "Champion", category: "Evaporator Coil", model: "CTM48D5CFS1", cost: 972, tonnage: 4, description: "Champion 4-Ton D-Series Coil" },
  { id: "chp-ec60c", brand: "Champion", category: "Evaporator Coil", model: "CTM60C5CGS1", cost: 1078, tonnage: 5, description: "Champion 5-Ton Evaporator Coil" },
  { id: "chp-ec60ch", brand: "Champion", category: "Evaporator Coil", model: "CTM60C5CHS1", cost: 1098, tonnage: 5, description: "Champion 5-Ton H-Series Coil" },
  { id: "chp-ec60d", brand: "Champion", category: "Evaporator Coil", model: "CTM60D5CGS1", cost: 1122, tonnage: 5, description: "Champion 5-Ton D-Series Coil" },
  { id: "chp-ec60dh", brand: "Champion", category: "Evaporator Coil", model: "CTM60DSCHS1", cost: 1135, tonnage: 5, description: "Champion 5-Ton D-Series H-Coil" },
  { id: "chp-ec60j", brand: "Champion", category: "Evaporator Coil", model: "CTM60D5CJS1", cost: 1303, tonnage: 5, description: "Champion 5-Ton Premium Coil" },

  // Heat Strips
  { id: "chp-hs08", brand: "Champion", category: "Heat Strip", model: "S1-8HK16500806", cost: 94, description: "8kW Electric Heat Strip" },
  { id: "chp-hs10", brand: "Champion", category: "Heat Strip", model: "S1-8HK16501006", cost: 117, description: "10kW Electric Heat Strip" },
  { id: "chp-hs15", brand: "Champion", category: "Heat Strip", model: "S1-8HK16501506", cost: 193, description: "15kW Electric Heat Strip" },
  { id: "chp-hs20", brand: "Champion", category: "Heat Strip", model: "S1-8HK16502006", cost: 203, description: "20kW Electric Heat Strip" },

  // Furnaces — Z9 series (96% AFUE)
  { id: "chp-z9e040", brand: "Champion", category: "Furnace", model: "Z9ES040A10SMPS1", cost: 1649, tier: "96% AFUE", tonnage: 1, description: "Champion Z9 40K BTU 96% AFUE Furnace" },
  { id: "chp-z9e060a", brand: "Champion", category: "Furnace", model: "Z9ES060A10SMPS1", cost: 1700, tier: "96% AFUE", tonnage: 1.5, description: "Champion Z9 60K BTU 96% AFUE Furnace" },
  { id: "chp-z9e060b", brand: "Champion", category: "Furnace", model: "Z9ES060B12SMPS1", cost: 1743, tier: "96% AFUE", tonnage: 1.5, description: "Champion Z9 60K BTU 96% AFUE Furnace (B)" },
  { id: "chp-z9e080b", brand: "Champion", category: "Furnace", model: "Z9ES080B12SMPS1", cost: 1785, tier: "96% AFUE", tonnage: 2, description: "Champion Z9 80K BTU 96% AFUE Furnace" },
  { id: "chp-z9e080c16", brand: "Champion", category: "Furnace", model: "Z9ES080C16SMPS1", cost: 2016, tier: "96% AFUE", tonnage: 2, description: "Champion Z9 80K BTU 96% AFUE Furnace (C16)" },
  { id: "chp-z9e080c20", brand: "Champion", category: "Furnace", model: "Z9ES080C20SMPS1", cost: 2068, tier: "96% AFUE", tonnage: 2, description: "Champion Z9 80K BTU 96% AFUE Furnace (C20)" },
  { id: "chp-z9e100c16", brand: "Champion", category: "Furnace", model: "Z9ES100C16SMPS1", cost: 2110, tier: "96% AFUE", tonnage: 2.5, description: "Champion Z9 100K BTU 96% AFUE Furnace (C16)" },
  { id: "chp-z9e100c20", brand: "Champion", category: "Furnace", model: "Z9ES100C20SMPS1", cost: 2195, tier: "96% AFUE", tonnage: 2.5, description: "Champion Z9 100K BTU 96% AFUE Furnace (C20)" },
  { id: "chp-z9e120", brand: "Champion", category: "Furnace", model: "Z9ES120D20SMPS1", cost: 2263, tier: "96% AFUE", tonnage: 3, description: "Champion Z9 120K BTU 96% AFUE Furnace" },
  // Furnaces — Z9T series (96% AFUE variable speed)
  { id: "chp-z9t040", brand: "Champion", category: "Furnace", model: "Z9ET040A10SMPS1", cost: 1847, tier: "96% AFUE Variable", tonnage: 1, description: "Champion Z9T 40K BTU Variable Speed Furnace" },
  { id: "chp-z9t060", brand: "Champion", category: "Furnace", model: "Z9ET060B12SMPS1", cost: 1944, tier: "96% AFUE Variable", tonnage: 1.5, description: "Champion Z9T 60K BTU Variable Speed Furnace" },
  { id: "chp-z9t080", brand: "Champion", category: "Furnace", model: "Z9ET080B12SMPS1", cost: 2047, tier: "96% AFUE Variable", tonnage: 2, description: "Champion Z9T 80K BTU Variable Speed Furnace" },
  { id: "chp-z9t080c16", brand: "Champion", category: "Furnace", model: "Z9ET080C16SMPS1", cost: 2120, tier: "96% AFUE Variable", tonnage: 2, description: "Champion Z9T 80K BTU Variable Speed Furnace (C16)" },
  { id: "chp-z9t100c16", brand: "Champion", category: "Furnace", model: "Z9ET100C16SMPS1", cost: 2175, tier: "96% AFUE Variable", tonnage: 2.5, description: "Champion Z9T 100K BTU Variable Speed Furnace (C16)" },
  { id: "chp-z9t100c20", brand: "Champion", category: "Furnace", model: "Z9ET100C20SMPS1", cost: 2285, tier: "96% AFUE Variable", tonnage: 2.5, description: "Champion Z9T 100K BTU Variable Speed Furnace (C20)" },
  { id: "chp-z9t120", brand: "Champion", category: "Furnace", model: "Z9ET120D20SMPS1", cost: 2367, tier: "96% AFUE Variable", tonnage: 3, description: "Champion Z9T 120K BTU Variable Speed Furnace" },
  // Furnaces — Z8 series (80% AFUE)
  { id: "chp-z8e040", brand: "Champion", category: "Furnace", model: "Z8ES040A12SMPS1", cost: 1033, tier: "80% AFUE", tonnage: 1, description: "Champion Z8 40K BTU 80% AFUE Furnace" },
  { id: "chp-z8e060", brand: "Champion", category: "Furnace", model: "Z8ES060A12SMPS1", cost: 1066, tier: "80% AFUE", tonnage: 1.5, description: "Champion Z8 60K BTU 80% AFUE Furnace" },
  { id: "chp-z8e080b", brand: "Champion", category: "Furnace", model: "Z8ES080B12SMPS1", cost: 1120, tier: "80% AFUE", tonnage: 2, description: "Champion Z8 80K BTU 80% AFUE Furnace" },
  { id: "chp-z8e080g", brand: "Champion", category: "Furnace", model: "Z8ES080G16SMPS1", cost: 1161, tier: "80% AFUE", tonnage: 2, description: "Champion Z8 80K BTU 80% AFUE Furnace (G16)" },
  { id: "chp-z8e100b", brand: "Champion", category: "Furnace", model: "Z8ES100B12SMPS1", cost: 1202, tier: "80% AFUE", tonnage: 2.5, description: "Champion Z8 100K BTU 80% AFUE Furnace (B12)" },
  { id: "chp-z8e100c16", brand: "Champion", category: "Furnace", model: "Z8ES100C16SMPS1", cost: 1201, tier: "80% AFUE", tonnage: 2.5, description: "Champion Z8 100K BTU 80% AFUE Furnace (C16)" },
  { id: "chp-z8e100c20", brand: "Champion", category: "Furnace", model: "Z8ES100C20SMPS1", cost: 1241, tier: "80% AFUE", tonnage: 2.5, description: "Champion Z8 100K BTU 80% AFUE Furnace (C20)" },
  { id: "chp-z8e120c16", brand: "Champion", category: "Furnace", model: "Z8ES120C16SMPS1", cost: 1302, tier: "80% AFUE", tonnage: 3, description: "Champion Z8 120K BTU 80% AFUE Furnace (C16)" },
  { id: "chp-z8e120c20", brand: "Champion", category: "Furnace", model: "Z8ES120C20SMPS1", cost: 1329, tier: "80% AFUE", tonnage: 3, description: "Champion Z8 120K BTU 80% AFUE Furnace (C20)" },
  { id: "chp-z8e130", brand: "Champion", category: "Furnace", model: "Z8ES130D20SMPS1", cost: 1363, tier: "80% AFUE", tonnage: 3.5, description: "Champion Z8 130K BTU 80% AFUE Furnace" },

  // Accessories
  { id: "chp-acc-np", brand: "Champion", category: "Accessory", model: "S1-1NP0347", cost: 86, description: "Champion Accessory Kit" },
];

// Guardian brand equipment (wholesale costs)
const guardianItems: PricebookItem[] = [
  // Guardian AC — RC3 series (13 SEER)
  { id: "grd-rc318", brand: "Guardian", category: "Condenser", model: "RC318E2S11", cost: 1024, tier: "13 SEER", tonnage: 1.5, description: "Guardian RC3 13 SEER 1.5-Ton Condenser" },
  { id: "grd-rc324", brand: "Guardian", category: "Condenser", model: "RC324E2S11", cost: 1044, tier: "13 SEER", tonnage: 2, description: "Guardian RC3 13 SEER 2-Ton Condenser" },
  { id: "grd-rc330", brand: "Guardian", category: "Condenser", model: "RC330E2S11", cost: 1204, tier: "13 SEER", tonnage: 2.5, description: "Guardian RC3 13 SEER 2.5-Ton Condenser" },
  { id: "grd-rc336", brand: "Guardian", category: "Condenser", model: "RC336E2S11", cost: 1232, tier: "13 SEER", tonnage: 3, description: "Guardian RC3 13 SEER 3-Ton Condenser" },
  { id: "grd-rc342", brand: "Guardian", category: "Condenser", model: "RC342E2S11", cost: 1439, tier: "13 SEER", tonnage: 3.5, description: "Guardian RC3 13 SEER 3.5-Ton Condenser" },
  { id: "grd-rc348", brand: "Guardian", category: "Condenser", model: "RC348E2S11", cost: 1473, tier: "13 SEER", tonnage: 4, description: "Guardian RC3 13 SEER 4-Ton Condenser" },
  { id: "grd-rc360", brand: "Guardian", category: "Condenser", model: "RC360E2S11", cost: 1715, tier: "13 SEER", tonnage: 5, description: "Guardian RC3 13 SEER 5-Ton Condenser" },
  // Guardian AC — RC4 series (14 SEER)
  { id: "grd-rc418", brand: "Guardian", category: "Condenser", model: "RC418E2S11", cost: 1204, tier: "14 SEER", tonnage: 1.5, description: "Guardian RC4 14 SEER 1.5-Ton Condenser" },
  { id: "grd-rc424", brand: "Guardian", category: "Condenser", model: "RC424E2S11", cost: 1228, tier: "14 SEER", tonnage: 2, description: "Guardian RC4 14 SEER 2-Ton Condenser" },
  { id: "grd-rc430", brand: "Guardian", category: "Condenser", model: "RC430E2S11", cost: 1417, tier: "14 SEER", tonnage: 2.5, description: "Guardian RC4 14 SEER 2.5-Ton Condenser" },
  { id: "grd-rc436", brand: "Guardian", category: "Condenser", model: "RC436E2S11", cost: 1450, tier: "14 SEER", tonnage: 3, description: "Guardian RC4 14 SEER 3-Ton Condenser" },
  { id: "grd-rc442", brand: "Guardian", category: "Condenser", model: "RC442E2S11", cost: 1693, tier: "14 SEER", tonnage: 3.5, description: "Guardian RC4 14 SEER 3.5-Ton Condenser" },
  { id: "grd-rc448", brand: "Guardian", category: "Condenser", model: "RC448E2S11", cost: 1733, tier: "14 SEER", tonnage: 4, description: "Guardian RC4 14 SEER 4-Ton Condenser" },
  { id: "grd-rc460", brand: "Guardian", category: "Condenser", model: "RC460E2S11", cost: 2016, tier: "14 SEER", tonnage: 5, description: "Guardian RC4 14 SEER 5-Ton Condenser" },

  // Guardian Furnaces — RG19 series (96% AFUE)
  { id: "grd-rg040", brand: "Guardian", category: "Furnace", model: "RG19040A10MPS", cost: 1157, tier: "96% AFUE", tonnage: 1, description: "Guardian RG19 40K BTU 96% AFUE Furnace" },
  { id: "grd-rg060a", brand: "Guardian", category: "Furnace", model: "RG19060A10MPS", cost: 1192, tier: "96% AFUE", tonnage: 1.5, description: "Guardian RG19 60K BTU 96% AFUE Furnace" },
  { id: "grd-rg060b", brand: "Guardian", category: "Furnace", model: "RG19060B12MPS", cost: 1233, tier: "96% AFUE", tonnage: 1.5, description: "Guardian RG19 60K BTU 96% AFUE Furnace (B)" },
  { id: "grd-rg080b", brand: "Guardian", category: "Furnace", model: "RG19080B12MPS", cost: 1267, tier: "96% AFUE", tonnage: 2, description: "Guardian RG19 80K BTU 96% AFUE Furnace" },
  { id: "grd-rg080c", brand: "Guardian", category: "Furnace", model: "RG19080C16MPS", cost: 1427, tier: "96% AFUE", tonnage: 2, description: "Guardian RG19 80K BTU 96% AFUE Furnace (C16)" },
  { id: "grd-rg100c16", brand: "Guardian", category: "Furnace", model: "RG19100C16MPS", cost: 1488, tier: "96% AFUE", tonnage: 2.5, description: "Guardian RG19 100K BTU 96% AFUE Furnace (C16)" },
  { id: "grd-rg100c20", brand: "Guardian", category: "Furnace", model: "RG19100C20MPS", cost: 1550, tier: "96% AFUE", tonnage: 2.5, description: "Guardian RG19 100K BTU 96% AFUE Furnace (C20)" },
  { id: "grd-rg120", brand: "Guardian", category: "Furnace", model: "RG19120D20MPS", cost: 1605, tier: "96% AFUE", tonnage: 3, description: "Guardian RG19 120K BTU 96% AFUE Furnace" },
  // Guardian Furnaces — RL18 series (80% AFUE)
  { id: "grd-rl040", brand: "Guardian", category: "Furnace", model: "RL18040A12MPS1", cost: 809, tier: "80% AFUE", tonnage: 1, description: "Guardian RL18 40K BTU 80% AFUE Furnace" },
  { id: "grd-rl060", brand: "Guardian", category: "Furnace", model: "RL18060A12MPS1", cost: 830, tier: "80% AFUE", tonnage: 1.5, description: "Guardian RL18 60K BTU 80% AFUE Furnace" },
  { id: "grd-rl080b", brand: "Guardian", category: "Furnace", model: "RL18080B12MPS1", cost: 878, tier: "80% AFUE", tonnage: 2, description: "Guardian RL18 80K BTU 80% AFUE Furnace" },
  { id: "grd-rl080c", brand: "Guardian", category: "Furnace", model: "RL18080C16MPS1", cost: 912, tier: "80% AFUE", tonnage: 2, description: "Guardian RL18 80K BTU 80% AFUE Furnace (C16)" },
  { id: "grd-rl100b", brand: "Guardian", category: "Furnace", model: "RL18100B12MPS1", cost: 923, tier: "80% AFUE", tonnage: 2.5, description: "Guardian RL18 100K BTU 80% AFUE Furnace (B12)" },
  { id: "grd-rl100c16", brand: "Guardian", category: "Furnace", model: "RL18100C16MPS1", cost: 940, tier: "80% AFUE", tonnage: 2.5, description: "Guardian RL18 100K BTU 80% AFUE Furnace (C16)" },
  { id: "grd-rl100c20", brand: "Guardian", category: "Furnace", model: "RL18100C20MPS1", cost: 973, tier: "80% AFUE", tonnage: 2.5, description: "Guardian RL18 100K BTU 80% AFUE Furnace (C20)" },

  // Guardian Heat Pumps — RH4 series (14 SEER)
  { id: "grd-rh418", brand: "Guardian", category: "Heat Pump", model: "RH418E2S11", cost: 1526, tier: "14 SEER", tonnage: 1.5, description: "Guardian RH4 14 SEER 1.5-Ton Heat Pump" },
  { id: "grd-rh424", brand: "Guardian", category: "Heat Pump", model: "RH424E2S11", cost: 1672, tier: "14 SEER", tonnage: 2, description: "Guardian RH4 14 SEER 2-Ton Heat Pump" },
  { id: "grd-rh436", brand: "Guardian", category: "Heat Pump", model: "RH436E2S11", cost: 1930, tier: "14 SEER", tonnage: 3, description: "Guardian RH4 14 SEER 3-Ton Heat Pump" },
  { id: "grd-rh448", brand: "Guardian", category: "Heat Pump", model: "RH448E2S11", cost: 2110, tier: "14 SEER", tonnage: 4, description: "Guardian RH4 14 SEER 4-Ton Heat Pump" },
  { id: "grd-rh460", brand: "Guardian", category: "Heat Pump", model: "RH460E2S11", cost: 2367, tier: "14 SEER", tonnage: 5, description: "Guardian RH4 14 SEER 5-Ton Heat Pump" },
  { id: "grd-rhp318", brand: "Guardian", category: "Heat Pump", model: "RHP14318B21S", cost: 1470, tier: "14 SEER", tonnage: 1.5, description: "Guardian RHP14 14 SEER 1.5-Ton Heat Pump" },

  // Guardian Air Handlers
  { id: "grd-ah18", brand: "Guardian", category: "Air Handler", model: "JHE18B5AB2SS1", cost: 965, tonnage: 1.5, description: "Guardian 1.5-Ton Air Handler" },
  { id: "grd-ah24", brand: "Guardian", category: "Air Handler", model: "JHE24B5AC2SS1", cost: 1095, tonnage: 2, description: "Guardian 2-Ton Air Handler" },
  { id: "grd-ah30", brand: "Guardian", category: "Air Handler", model: "JHE30B5AD2SS1", cost: 1168, tonnage: 2.5, description: "Guardian 2.5-Ton Air Handler" },
  { id: "grd-ah36b", brand: "Guardian", category: "Air Handler", model: "JHE36B5CD2SS1", cost: 1214, tonnage: 3, description: "Guardian 3-Ton Air Handler" },
  { id: "grd-ah36c", brand: "Guardian", category: "Air Handler", model: "JHE36C5AD2SS1", cost: 1232, tonnage: 3, description: "Guardian 3-Ton Multi-Position Air Handler" },
  { id: "grd-ah36cc", brand: "Guardian", category: "Air Handler", model: "JHE36C5CD2SS1", cost: 1232, tonnage: 3, description: "Guardian 3-Ton Multi-Position Air Handler" },
  { id: "grd-ah42", brand: "Guardian", category: "Air Handler", model: "JHE42C5CF2SS1", cost: 1322, tonnage: 3.5, description: "Guardian 3.5-Ton Air Handler" },
  { id: "grd-ah48c", brand: "Guardian", category: "Air Handler", model: "JHE48C5CG2SS1", cost: 1438, tonnage: 4, description: "Guardian 4-Ton Air Handler" },
  { id: "grd-ah48d", brand: "Guardian", category: "Air Handler", model: "JHE48D5CG2SS1", cost: 1471, tonnage: 4, description: "Guardian 4-Ton Multi-Position Air Handler" },
  { id: "grd-ah60c", brand: "Guardian", category: "Air Handler", model: "JHE60C5CH2SS1", cost: 1508, tonnage: 5, description: "Guardian 5-Ton Air Handler" },
  { id: "grd-ah60d", brand: "Guardian", category: "Air Handler", model: "JHE60D5CH2SS1", cost: 1561, tonnage: 5, description: "Guardian 5-Ton Multi-Position Air Handler" },
  { id: "grd-ah60j", brand: "Guardian", category: "Air Handler", model: "JHE60D5CJ2SS1", cost: 1577, tonnage: 5, description: "Guardian 5-Ton Premium Air Handler" },

  // Guardian Cased Coils
  { id: "grd-cc24", brand: "Guardian", category: "Evaporator Coil", model: "JHC24B5AC2SS1", cost: 1703, tonnage: 2, description: "Guardian 2-Ton Cased Coil" },
  { id: "grd-cc30a", brand: "Guardian", category: "Evaporator Coil", model: "JHETB30DBAS2N", cost: 1225, tonnage: 2.5, description: "Guardian 2.5-Ton Cased Coil" },
  { id: "grd-cc36a", brand: "Guardian", category: "Evaporator Coil", model: "JHETB36DBAS2N", cost: 1252, tonnage: 3, description: "Guardian 3-Ton Cased Coil" },
  { id: "grd-cc36c", brand: "Guardian", category: "Evaporator Coil", model: "JHETB36DBCS2N", cost: 1252, tonnage: 3, description: "Guardian 3-Ton Cased Coil (C)" },
  { id: "grd-cc42", brand: "Guardian", category: "Evaporator Coil", model: "JHETC42FBAS2N", cost: 1362, tonnage: 3.5, description: "Guardian 3.5-Ton Cased Coil" },
  { id: "grd-cc48", brand: "Guardian", category: "Evaporator Coil", model: "JHETC48GBCS2N", cost: 1484, tonnage: 4, description: "Guardian 4-Ton Cased Coil" },

  // Guardian Heat Strips
  { id: "grd-hs6-05", brand: "Guardian", category: "Heat Strip", model: "S1-6HK16500506", cost: 70, description: "5kW Electric Heat Strip" },
  { id: "grd-hs6-08", brand: "Guardian", category: "Heat Strip", model: "S1-6HK16500806", cost: 119, description: "8kW Electric Heat Strip" },
  { id: "grd-hs6-10", brand: "Guardian", category: "Heat Strip", model: "S1-6HK16501006", cost: 98, description: "10kW Electric Heat Strip" },
  { id: "grd-hs6-15", brand: "Guardian", category: "Heat Strip", model: "S1-6HK16501506", cost: 171, description: "15kW Electric Heat Strip" },
  { id: "grd-hs6-20", brand: "Guardian", category: "Heat Strip", model: "S1-6HK16502006", cost: 197, description: "20kW Electric Heat Strip" },
  { id: "grd-hs8-08", brand: "Guardian", category: "Heat Strip", model: "S1-8HK16500806", cost: 94, description: "8kW Electric Heat Strip (8HK)" },
  { id: "grd-hs8-10", brand: "Guardian", category: "Heat Strip", model: "S1-8HK16501006", cost: 117, description: "10kW Electric Heat Strip (8HK)" },
  { id: "grd-hs8-15", brand: "Guardian", category: "Heat Strip", model: "S1-8HK16501506", cost: 193, description: "15kW Electric Heat Strip (8HK)" },
  { id: "grd-hs8-20", brand: "Guardian", category: "Heat Strip", model: "S1-8HK16502006", cost: 203, description: "20kW Electric Heat Strip (8HK)" },
];

export const pricebook: PricebookItem[] = [...championItems, ...guardianItems];

// Format equipment into a simple, human-readable description
// Examples: "3 Ton Champion AC 16 SEER", "80,000 BTU Champion Furnace 96% AFUE"
export function formatEquipmentDescription(item: PricebookItem): string {
  const { brand, category, tier, tonnage, description } = item;

  // Extract BTU from description (e.g., "80K BTU" -> "80,000 BTU")
  const btuMatch = description.match(/(\d+)K\s*BTU/i);
  const btu = btuMatch ? `${parseInt(btuMatch[1])},000 BTU` : null;

  // Determine equipment type label
  let typeLabel: string;
  if (category === "Condenser" || category === "Heat Pump") {
    typeLabel = category === "Heat Pump" ? "Heat Pump" : "AC";
  } else if (category === "Furnace") {
    typeLabel = "Furnace";
  } else if (category === "Air Handler") {
    typeLabel = "Air Handler";
  } else if (category === "Evaporator Coil") {
    typeLabel = "Coil";
  } else if (category === "Heat Strip") {
    return description; // Heat strips: use description as-is (e.g., "8kW Electric Heat Strip")
  } else {
    return description;
  }

  // Build the description
  const parts: string[] = [];

  if (category === "Furnace" && btu) {
    parts.push(`${btu} ${brand} ${typeLabel}`);
  } else if (tonnage) {
    parts.push(`${tonnage} Ton ${brand} ${typeLabel}`);
  } else {
    parts.push(`${brand} ${typeLabel}`);
  }

  if (tier) {
    parts.push(tier);
  }

  return parts.join(" ");
}

// Match equipment to the selected proposal tier (Good/Better/Best)
// Good = base series (XC3, Z8, XH4, RC3, RL18)
// Better = mid series (XC4, Z9, XH5, RC4, RG19)
// Best = high series (XC6, Z9T, XH6)
export function getTieredEquipment(itemIds: string[], tier: "Good" | "Better" | "Best"): PricebookItem[] {
  return itemIds.map((id) => {
    const item = pricebook.find((p) => p.id === id);
    if (!item) return null;

    // Non-equipment items (heat strips, accessories) stay the same
    if (item.category === "Heat Strip" || item.category === "Accessory") return item;

    // Find matching items: same brand, same category, same tonnage (for AC/HP/AH/Coil) or same BTU (for furnaces)
    const btuMatch = item.description.match(/(\d+)K\s*BTU/i);
    const btu = btuMatch ? btuMatch[1] : null;

    const candidates = pricebook.filter((p) => {
      if (p.brand !== item.brand) return false;
      if (p.category !== item.category) return false;
      // Match tonnage for AC/HP/AH/Coil
      if (item.tonnage && p.tonnage !== item.tonnage) return false;
      // Match BTU for furnaces
      if (btu) {
 const pBtu = p.description.match(/(\d+)K\s*BTU/i);
        if (!pBtu || pBtu[1] !== btu) return false;
      }
      return true;
    });

    // Series prefix patterns by tier
    const seriesPatterns: Record<string, string[]> = {
      Good: ["XC3", "XH4", "Z8", "RC3", "RL18", "RHP14"],
      Better: ["XC4", "XH5", "Z9", "RC4", "RG19", "RH4"],
      Best: ["XC6", "XH6", "Z9T", "RC4", "RG19", "RH4"], // Guardian doesn't have a "Best" so fall back to Better
    };

    const patterns = seriesPatterns[tier] || seriesPatterns.Good;

    // Find the candidate that matches one of the tier patterns
    const matched = candidates.find((p) => patterns.some((prefix) => p.model.startsWith(prefix) || p.id.includes(prefix.toLowerCase())));

    // If no match found, try to find by SEER/AFUE tier
    if (!matched) {
      const tierEfficiency: Record<string, string[]> = {
        Good: ["13 SEER", "14 SEER", "80% AFUE"],
        Better: ["14 SEER", "15 SEER", "96% AFUE"],
        Best: ["16 SEER", "96% AFUE Variable", "96% AFUE"],
      };
      const effs = tierEfficiency[tier] || tierEfficiency.Good;
      const byEff = candidates.find((p) => p.tier && effs.includes(p.tier));
      return byEff || item;
    }

    return matched;
  }).filter(Boolean) as PricebookItem[];
}

// Add-on services (not equipment — customer-facing installed prices)
export interface AddOnService {
  id: string;
  name: string;
  price: number; // customer-facing installed price
  description: string;
  icon: string;
}

export const addOnServices: AddOnService[] = [
  { id: "duct-clean", name: "Whole-Home Duct Cleaning", price: 449, description: "Complete duct system cleaning to improve air quality and system efficiency", icon: "wind" },
  { id: "humidifier", name: "Whole-Home Humidifier", price: 649, description: "Balanced humidity throughout your home for comfort and health", icon: "droplet" },
  { id: "surge-protector", name: "HVAC Surge Protector", price: 299, description: "Protect your investment from power surges and voltage spikes", icon: "zap" },
  { id: "wifi-thermostat", name: "Wi-Fi Smart Thermostat", price: 399, description: "Control your system from anywhere with smart scheduling", icon: "thermostat" },
  { id: "media-cleaner", name: "Media Air Cleaner", price: 549, description: "Hospital-grade filtration for cleaner indoor air", icon: "filter" },
  { id: "crown-care", name: "Crown Care Membership", price: 189, description: "Two seasonal precision tune-ups plus priority service", icon: "crown" },
];
