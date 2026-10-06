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

