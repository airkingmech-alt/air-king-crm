// Mock data for Air King CRM prototype
// All customer names, addresses, and transactions are synthetic test data

export type LeadStatus =
  "New" | "Contacted" | "Appointment" | "Quote Sent" | "Won" | "Lost";
export type WorkOrderStatus =
  | "Unscheduled"
  | "Scheduled"
  | "Dispatched"
  | "In Progress"
  | "Completed"
  | "Cancelled"
  | "Needs Follow-up";
export type InvoiceStatus =
  "Draft" | "Sent" | "Paid" | "Overdue" | "Partial" | "Void";
export type CustomerType = "Residential" | "Commercial";

export interface Contact {
  name: string;
  phone: string;
  email: string;
  role?: string;
}

export interface HVACSystem {
  id: string;
  type:
    | "AC"
    | "Coil"
    | "Furnace"
    | "Air Handler"
    | "Heat Pump"
    | "Mini-Split"
    | "Package Unit";
  brand: string;
  model: string;
  serial: string;
  installDate: string;
  warrantyExp?: string;
  refrigerant?: string;
  filterSize?: string;
  status: "Active" | "Inactive" | "Warranty";
  notes?: string;
}

export interface Property {
  id: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  accessNotes?: string;
  gateCode?: string;
  systems: HVACSystem[];
}

export interface ActivityEntry {
  id: string;
  date: string;
  type:
    | "call"
    | "note"
    | "quote"
    | "approval"
    | "work-order"
    | "invoice"
    | "payment"
    | "membership"
    | "visit"
    | "email"
    | "text";
  title: string;
  description: string;
  user?: string;
}

export interface Customer {
  id: string;
  type: CustomerType;
  name: string;
  contacts: Contact[];
  properties: Property[];
  leadSource: string;
  leadStatus: LeadStatus;
  tags: string[];
  activity: ActivityEntry[];
  createdAt: string;
}

export interface QuoteLineItem {
  id: string;
  description: string;
  category: string;
  cost: number; // internal cost
  customerPrice: number; // what customer pays
  quantity: number;
}

export interface QuoteOption {
  tier: "Good" | "Better" | "Best";
  label: string;
  equipment: string;
  efficiency: string;
  features: string[];
  totalCost: number; // internal
  customerPrice: number; // what customer sees
  isPopular?: boolean;
}

export interface Quote {
  id: string;
  customerId: string;
  customerName: string;
  jobType:
    | "Changeout"
    | "Service Call"
    | "New Construction"
    | "Maintenance"
    | "Commercial";
  title: string;
  status: LeadStatus;
  createdAt: string;
  options: QuoteOption[];
  selectedAddOns: string[];
  selectedOption?: string;
  acceptedAt?: string;
  declinedAt?: string;
  expiresAt?: string;
  laborCost: number;
  materialsCost: number;
  taxRate: number;
  financingEstimate?: number;
  equipmentItems?: string[]; // pricebook item IDs selected for this quote
  laborDescription?: string;
}

export interface WorkOrder {
  id: string;
  customerId: string;
  customerName: string;
  property: string;
  type: string;
  status: WorkOrderStatus;
  scheduledDate?: string;
  scheduledTime?: string;
  technician?: string;
  priority: "Low" | "Normal" | "High" | "Emergency";
  description: string;
  laborHours?: number;
  quoteId?: string;
}

export interface Invoice {
  id: string;
  customerId: string;
  customerName: string;
  workOrderId?: string;
  quoteId?: string;
  equipmentItems?: string[];
  amount: number;
  paidAmount: number;
  status: InvoiceStatus;
  dueDate: string;
  sentDate?: string;
  items: { description: string; amount: number }[];
}

export interface CrownCareMembership {
  id: string;
  customerId: string;
  customerName: string;
  propertyAddress: string;
  systemId: string;
  systemDescription: string;
  startDate: string;
  renewalDate: string;
  billingFrequency: "Annual" | "Monthly";
  paymentStatus: "Paid" | "Pending" | "Overdue";
  autoRenew: boolean;
  visitsIncluded: number;
  visitsUsed: number;
  springVisit?: { status: string; scheduledDate?: string };
  fallVisit?: { status: string; scheduledDate?: string };
  status: "Active" | "Expired" | "Cancelled";
}

// === SAMPLE CUSTOMERS ===
export const customers: Customer[] = [
  {
    id: "cust-001",
    type: "Residential",
    name: "Michael & Sarah Thompson",
    contacts: [
      {
        name: "Michael Thompson",
        phone: "(816) 555-0142",
        email: "mthompson@email.com",
        role: "Primary",
      },
      {
        name: "Sarah Thompson",
        phone: "(816) 555-0143",
        email: "sthompson@email.com",
        role: "Spouse",
      },
    ],
    properties: [
      {
        id: "prop-001",
        address: "4521 Oakridge Dr",
        city: "Lee's Summit",
        state: "MO",
        zip: "64064",
        accessNotes: "Dog in backyard - use side gate",
        gateCode: "4421",
        systems: [
          {
            id: "sys-001",
            type: "AC",
            brand: "Champion",
            model: "XC436E2S11",
            serial: "CH20240315-001",
            installDate: "2024-03-15",
            warrantyExp: "2034-03-15",
            refrigerant: "R-410A",
            filterSize: "16x25x1",
            status: "Warranty",
            notes: "Annual maintenance due",
          },
          {
            id: "sys-002",
            type: "Furnace",
            brand: "Champion",
            model: "Z9ES080C16SMPS1",
            serial: "CH20240315-002",
            installDate: "2024-03-15",
            warrantyExp: "2034-03-15",
            filterSize: "16x25x1",
            status: "Warranty",
          },
        ],
      },
    ],
    leadSource: "Google Ads",
    leadStatus: "Won",
    tags: ["Crown Care", "High Value"],
    createdAt: "2024-02-28",
    activity: [
      {
        id: "act-001",
        date: "2024-02-28",
        type: "call",
        title: "Initial inquiry",
        description: "Called about AC replacement quote",
        user: "Colton",
      },
      {
        id: "act-002",
        date: "2024-03-01",
        type: "note",
        title: "Property assessment",
        description: "3-ton system needed, existing ductwork in good condition",
        user: "Colton",
      },
      {
        id: "act-003",
        date: "2024-03-02",
        type: "quote",
        title: "Quote #Q-1024 sent",
        description: "Good/Better/Best proposal sent via email",
        user: "Colton",
      },
      {
        id: "act-004",
        date: "2024-03-05",
        type: "approval",
        title: "Better option approved",
        description: "Customer selected Better package with Crown Care add-on",
        user: "System",
      },
      {
        id: "act-005",
        date: "2024-03-15",
        type: "work-order",
        title: "Installation completed",
        description: "Champion XC4 + Z9 system installed and commissioned",
        user: "James",
      },
      {
        id: "act-006",
        date: "2024-03-15",
        type: "invoice",
        title: "Invoice #INV-0245",
        description: "Final invoice sent - $7,450",
        user: "System",
      },
      {
        id: "act-007",
        date: "2024-03-16",
        type: "payment",
        title: "Payment received",
        description: "Card payment - $7,450 paid in full",
        user: "System",
      },
      {
        id: "act-008",
        date: "2024-03-15",
        type: "membership",
        title: "Crown Care enrolled",
        description: "Annual membership activated for AC system",
        user: "Colton",
      },
      {
        id: "act-009",
        date: "2024-09-10",
        type: "visit",
        title: "Fall tune-up scheduled",
        description: "Heating tune-up scheduled for Oct 15",
        user: "Office",
      },
    ],
  },
  {
    id: "cust-002",
    type: "Residential",
    name: "Robert Chen",
    contacts: [
      {
        name: "Robert Chen",
        phone: "(816) 555-0198",
        email: "rchen@email.com",
        role: "Primary",
      },
    ],
    properties: [
      {
        id: "prop-002",
        address: "1278 Maplewood Ct",
        city: "Kansas City",
        state: "MO",
        zip: "64114",
        systems: [
          {
            id: "sys-003",
            type: "Heat Pump",
            brand: "Guardian",
            model: "RH436E2S11",
            serial: "GD20230720-003",
            installDate: "2023-07-20",
            warrantyExp: "2033-07-20",
            refrigerant: "R-410A",
            filterSize: "20x25x1",
            status: "Active",
            notes: "Heat pump needs biannual maintenance",
          },
        ],
      },
    ],
    leadSource: "Referral",
    leadStatus: "Won",
    tags: ["Crown Care", "Referral"],
    createdAt: "2023-06-15",
    activity: [
      {
        id: "act-010",
        date: "2023-06-15",
        type: "note",
        title: "Referral from Thompson family",
        description: "Referred by Michael Thompson",
        user: "Colton",
      },
      {
        id: "act-011",
        date: "2023-07-20",
        type: "work-order",
        title: "Heat pump installed",
        description: "Guardian RH4 3-ton heat pump with new air handler",
        user: "James",
      },
      {
        id: "act-012",
        date: "2023-07-21",
        type: "invoice",
        title: "Invoice #INV-0189",
        description: "Paid in full - $5,890",
        user: "System",
      },
      {
        id: "act-013",
        date: "2025-06-18",
        type: "visit",
        title: "Spring tune-up completed",
        description: "Cooling tune-up, all readings normal",
        user: "James",
      },
    ],
  },
  {
    id: "cust-003",
    type: "Residential",
    name: "Jennifer Walsh",
    contacts: [
      {
        name: "Jennifer Walsh",
        phone: "(913) 555-0231",
        email: "jwalsh@email.com",
        role: "Primary",
      },
    ],
    properties: [
      {
        id: "prop-003",
        address: "8912 Birchwood Ln",
        city: "Overland Park",
        state: "KS",
        zip: "66207",
        accessNotes: "Key in lockbox - code 8890",
        systems: [
          {
            id: "sys-004",
            type: "AC",
            brand: "Carrier",
            model: "24ABC636",
            serial: "CA20190815-004",
            installDate: "2019-08-15",
            refrigerant: "R-410A",
            filterSize: "16x25x1",
            status: "Active",
            notes: "System is 7 years old, recommend replacement planning",
          },
        ],
      },
    ],
    leadSource: "Website",
    leadStatus: "Quote Sent",
    tags: ["Replacement Lead"],
    createdAt: "2026-07-18",
    activity: [
      {
        id: "act-014",
        date: "2026-07-18",
        type: "call",
        title: "Inquiry call",
        description: "AC not cooling properly, looking at replacement options",
        user: "Office",
      },
      {
        id: "act-015",
        date: "2026-07-20",
        type: "note",
        title: "Site visit",
        description:
          "Assessed system - 7yr old Carrier, refrigerant leak suspected",
        user: "Colton",
      },
      {
        id: "act-016",
        date: "2026-07-22",
        type: "quote",
        title: "Quote #Q-1102 sent",
        description: "Good/Better/Best proposal for 3-ton AC changeout",
        user: "Colton",
      },
      {
        id: "act-017",
        date: "2026-07-25",
        type: "text",
        title: "Follow-up text",
        description: "Checking if customer has questions about the proposal",
        user: "Office",
      },
    ],
  },
  {
    id: "cust-004",
    type: "Commercial",
    name: "Westport Dental Group",
    contacts: [
      {
        name: "Dr. Amanda Reyes",
        phone: "(816) 555-0355",
        email: "areyes@westportdental.com",
        role: "Owner",
      },
      {
        name: "Tom Buckley",
        phone: "(816) 555-0356",
        email: "tbuckley@westportdental.com",
        role: "Office Manager",
      },
    ],
    properties: [
      {
        id: "prop-004",
        address: "4050 Pennsylvania Ave",
        city: "Kansas City",
        state: "MO",
        zip: "64111",
        accessNotes:
          "Building access via front entrance, HVAC closet in back hall",
        systems: [
          {
            id: "sys-005",
            type: "Package Unit",
            brand: "Champion",
            model: "XH548E2S11",
            serial: "CH20250910-005",
            installDate: "2025-09-10",
            warrantyExp: "2035-09-10",
            refrigerant: "R-410A",
            filterSize: "20x25x2",
            status: "Warranty",
          },
          {
            id: "sys-006",
            type: "AC",
            brand: "Champion",
            model: "XC436E2S11",
            serial: "CH20250910-006",
            installDate: "2025-09-10",
            warrantyExp: "2035-09-10",
            refrigerant: "R-410A",
            status: "Warranty",
            notes: "Zone 2 - operatories",
          },
        ],
      },
    ],
    leadSource: "Referral",
    leadStatus: "Won",
    tags: ["Commercial", "Crown Care", "Multi-System"],
    createdAt: "2025-08-01",
    activity: [
      {
        id: "act-018",
        date: "2025-08-01",
        type: "note",
        title: "Commercial assessment",
        description: "2-zone system for dental office, 8 operatory suite",
        user: "Colton",
      },
      {
        id: "act-019",
        date: "2025-08-15",
        type: "quote",
        title: "Commercial quote sent",
        description: "Package unit + zone AC, commercial installation",
        user: "Colton",
      },
      {
        id: "act-020",
        date: "2025-08-20",
        type: "approval",
        title: "Proposal approved",
        description: "Full system approved, 50% deposit received",
        user: "System",
      },
      {
        id: "act-021",
        date: "2025-09-10",
        type: "work-order",
        title: "Installation completed",
        description: "Commercial installation - 2 systems, 2 days",
        user: "James",
      },
    ],
  },
  {
    id: "cust-005",
    type: "Residential",
    name: "David & Lisa Morrison",
    contacts: [
      {
        name: "David Morrison",
        phone: "(816) 555-0412",
        email: "dmorrison@email.com",
        role: "Primary",
      },
    ],
    properties: [
      {
        id: "prop-005",
        address: "2200 Cherrywood Dr",
        city: "Independence",
        state: "MO",
        zip: "64055",
        systems: [
          {
            id: "sys-007",
            type: "Furnace",
            brand: "Goodman",
            model: "GMVC80603BN",
            serial: "GD20180115-007",
            installDate: "2018-01-15",
            filterSize: "16x25x1",
            status: "Active",
            notes: "Furnace cycling issue - ignition suspect",
          },
        ],
      },
    ],
    leadSource: "Google Ads",
    leadStatus: "Appointment",
    tags: ["Service Call"],
    createdAt: "2026-07-24",
    activity: [
      {
        id: "act-022",
        date: "2026-07-24",
        type: "call",
        title: "Service call booked",
        description: "Furnace not staying lit, intermittent ignition",
        user: "Office",
      },
      {
        id: "act-023",
        date: "2026-07-26",
        type: "note",
        title: "Appointment scheduled",
        description: "James scheduled for today 2:00 PM",
        user: "Office",
      },
    ],
  },
  {
    id: "cust-006",
    type: "Residential",
    name: "Patricia Hayes",
    contacts: [
      {
        name: "Patricia Hayes",
        phone: "(913) 555-0567",
        email: "phayes@email.com",
        role: "Primary",
      },
    ],
    properties: [
      {
        id: "prop-006",
        address: "14500 Cedar Creek Rd",
        city: "Olathe",
        state: "KS",
        zip: "66062",
        accessNotes: "Long driveway, dogs in yard",
        systems: [
          {
            id: "sys-008",
            type: "AC",
            brand: "Trane",
            model: "XR14-024",
            serial: "TR20150620-008",
            installDate: "2015-06-20",
            refrigerant: "R-410A",
            filterSize: "20x25x1",
            status: "Active",
            notes: "11 year old system, frequent repairs",
          },
        ],
      },
    ],
    leadSource: "Google Ads",
    leadStatus: "New",
    tags: ["Replacement Lead"],
    createdAt: "2026-07-25",
    activity: [
      {
        id: "act-024",
        date: "2026-07-25",
        type: "call",
        title: "New lead",
        description:
          "AC not cooling, system is old, interested in replacement options",
        user: "Office",
      },
    ],
  },
  {
    id: "cust-007",
    type: "Residential",
    name: "Marcus Johnson",
    contacts: [
      {
        name: "Marcus Johnson",
        phone: "(816) 555-0789",
        email: "mjohnson@email.com",
        role: "Primary",
      },
    ],
    properties: [
      {
        id: "prop-007",
        address: "3345 Willowbrook Way",
        city: "Blue Springs",
        state: "MO",
        zip: "64015",
        systems: [
          {
            id: "sys-009",
            type: "AC",
            brand: "Champion",
            model: "XC436E2S11",
            serial: "CH20240601-009",
            installDate: "2024-06-01",
            warrantyExp: "2034-06-01",
            refrigerant: "R-410A",
            filterSize: "16x25x1",
            status: "Warranty",
          },
        ],
      },
    ],
    leadSource: "Referral",
    leadStatus: "Won",
    tags: ["Crown Care"],
    createdAt: "2024-05-20",
    activity: [
      {
        id: "act-025",
        date: "2024-06-01",
        type: "work-order",
        title: "AC installed",
        description: "Champion XC4 3-ton installed",
        user: "James",
      },
      {
        id: "act-026",
        date: "2024-06-01",
        type: "membership",
        title: "Crown Care enrolled",
        description: "Annual membership for new AC system",
        user: "Colton",
      },
      {
        id: "act-027",
        date: "2025-04-15",
        type: "visit",
        title: "Spring tune-up completed",
        description: "All systems normal",
        user: "James",
      },
      {
        id: "act-028",
        date: "2025-10-20",
        type: "visit",
        title: "Fall tune-up completed",
        description: "Heating system checked, all good",
        user: "James",
      },
    ],
  },
  {
    id: "cust-008",
    type: "Commercial",
    name: "Brookside Coffee Roasters",
    contacts: [
      {
        name: "Elena Petrov",
        phone: "(816) 555-0890",
        email: "elena@brooksidecoffee.com",
        role: "Owner",
      },
    ],
    properties: [
      {
        id: "prop-008",
        address: "6225 Brookside Blvd",
        city: "Kansas City",
        state: "MO",
        zip: "64113",
        systems: [
          {
            id: "sys-010",
            type: "AC",
            brand: "Guardian",
            model: "RC436E2S11",
            serial: "GD20220801-010",
            installDate: "2022-08-01",
            refrigerant: "R-410A",
            status: "Active",
            notes: "Café area cooling, runs constantly during summer",
          },
        ],
      },
    ],
    leadSource: "Walk-in",
    leadStatus: "Contacted",
    tags: ["Commercial", "Service Call"],
    createdAt: "2026-07-20",
    activity: [
      {
        id: "act-029",
        date: "2026-07-20",
        type: "call",
        title: "Cooling complaint",
        description: "Café not cooling properly, high traffic loads",
        user: "Office",
      },
      {
        id: "act-030",
        date: "2026-07-22",
        type: "note",
        title: "Assessment",
        description: "System undersized for current traffic, recommend upgrade",
        user: "Colton",
      },
    ],
  },
];

// === SAMPLE QUOTES ===
export const quotes: Quote[] = [
  {
    id: "Q-1102",
    customerId: "cust-003",
    customerName: "Jennifer Walsh",
    jobType: "Changeout",
    title: "3-Ton AC Changeout - Birchwood Ln",
    status: "Quote Sent",
    createdAt: "2026-07-22",
    laborCost: 1200,
    materialsCost: 450,
    taxRate: 0.08475,
    financingEstimate: 84.52,
    selectedAddOns: ["crown-care"],
    options: [
      {
        tier: "Good",
        label: "Essential Comfort",
        equipment: "Champion XC3 13 SEER + Z8 80% AFUE",
        efficiency: "13 SEER / 80% AFUE",
        features: [
          "Reliable cooling performance",
          "Standard 80% efficiency furnace",
          "10-year parts and labor warranty",
          "Standard installation",
        ],
        totalCost: 4200,
        customerPrice: 6490,
      },
      {
        tier: "Better",
        label: "Enhanced Comfort",
        equipment: "Champion XC4 14 SEER + Z9 96% AFUE",
        efficiency: "14 SEER / 96% AFUE",
        features: [
          "Upgraded 14 SEER efficiency",
          "96% AFUE variable-speed furnace",
          "10-year parts and labor warranty",
          "Premium installation with new lineset",
          "Wi-Fi thermostat included",
        ],
        totalCost: 5100,
        customerPrice: 8290,
        isPopular: true,
      },
      {
        tier: "Best",
        label: "Ultimate Comfort",
        equipment: "Champion XC6 16 SEER + Z9T 96% AFUE Variable",
        efficiency: "16 SEER / 96% AFUE Variable",
        features: [
          "Premium 16 SEER high efficiency",
          "Variable-speed furnace for perfect comfort",
          "10-year parts and labor warranty",
          "Premium installation with new lineset",
          "Wi-Fi thermostat + media air cleaner",
          "2-year Crown Care included",
        ],
        totalCost: 6300,
        customerPrice: 10290,
      },
    ],
  },
  {
    id: "Q-1024",
    customerId: "cust-001",
    customerName: "Michael & Sarah Thompson",
    jobType: "Changeout",
    title: "3-Ton AC + Furnace Changeout - Oakridge Dr",
    status: "Won",
    createdAt: "2024-03-02",
    laborCost: 1500,
    materialsCost: 500,
    taxRate: 0.08475,
    selectedAddOns: ["crown-care", "wifi-thermostat"],
    options: [
      {
        tier: "Good",
        label: "Essential Comfort",
        equipment: "Champion XC3 13 SEER + Z8 80% AFUE",
        efficiency: "13 SEER / 80% AFUE",
        features: [
          "Reliable cooling",
          "Standard furnace",
          "10-year parts and labor warranty",
        ],
        totalCost: 4000,
        customerPrice: 6290,
      },
      {
        tier: "Better",
        label: "Enhanced Comfort",
        equipment: "Champion XC4 14 SEER + Z9 96% AFUE",
        efficiency: "14 SEER / 96% AFUE",
        features: [
          "14 SEER efficiency",
          "96% AFUE furnace",
          "10-year parts and labor warranty",
          "Wi-Fi thermostat",
        ],
        totalCost: 4900,
        customerPrice: 7990,
        isPopular: true,
      },
      {
        tier: "Best",
        label: "Ultimate Comfort",
        equipment: "Champion XC6 16 SEER + Z9T Variable",
        efficiency: "16 SEER / 96% AFUE Variable",
        features: [
          "16 SEER high efficiency",
          "Variable-speed furnace",
          "10-year parts and labor warranty",
          "Wi-Fi thermostat + media cleaner",
        ],
        totalCost: 6000,
        customerPrice: 9890,
      },
    ],
  },
];

// === SAMPLE WORK ORDERS ===
export const workOrders: WorkOrder[] = [
  {
    id: "WO-0312",
    customerId: "cust-005",
    customerName: "David & Lisa Morrison",
    property: "2200 Cherrywood Dr, Independence, MO",
    type: "Service Call",
    status: "Scheduled",
    scheduledDate: "2026-07-26",
    scheduledTime: "14:00",
    technician: "James Nichols",
    priority: "Normal",
    description:
      "Furnace not staying lit, intermittent ignition issue. Goodman GMVC80603BN. Check igniter and flame sensor.",
    quoteId: undefined,
  },
  {
    id: "WO-0310",
    customerId: "cust-007",
    customerName: "Marcus Johnson",
    property: "3345 Willowbrook Way, Blue Springs, MO",
    type: "Maintenance - Spring Tune-up",
    status: "Completed",
    scheduledDate: "2026-07-24",
    scheduledTime: "09:00",
    technician: "James Nichols",
    priority: "Low",
    description:
      "Crown Care spring cooling tune-up. Clean coils, check refrigerant, inspect electrical, test performance.",
  },
  {
    id: "WO-0311",
    customerId: "cust-002",
    customerName: "Robert Chen",
    property: "1278 Maplewood Ct, Kansas City, MO",
    type: "Maintenance - Fall Tune-up",
    status: "Scheduled",
    scheduledDate: "2026-07-28",
    scheduledTime: "10:00",
    technician: "James Nichols",
    priority: "Low",
    description:
      "Crown Care fall heating tune-up. Check heat pump defrost cycle, inspect reversing valve, test aux heat.",
  },
  {
    id: "WO-0313",
    customerId: "cust-001",
    customerName: "Michael & Sarah Thompson",
    property: "4521 Oakridge Dr, Lee's Summit, MO",
    type: "Maintenance - Fall Tune-up",
    status: "Unscheduled",
    priority: "Normal",
    description:
      "Crown Care fall heating tune-up. Furnace Z9ES080C16. Schedule within seasonal window.",
  },
  {
    id: "WO-0309",
    customerId: "cust-004",
    customerName: "Westport Dental Group",
    property: "4050 Pennsylvania Ave, Kansas City, MO",
    type: "Commercial Service",
    status: "Completed",
    scheduledDate: "2026-07-18",
    scheduledTime: "08:00",
    technician: "Colton Nichols",
    priority: "Normal",
    description:
      "Quarterly inspection of both package unit and zone AC. All systems performing within spec.",
  },
  {
    id: "WO-0314",
    customerId: "cust-008",
    customerName: "Brookside Coffee Roasters",
    property: "6225 Brookside Blvd, Kansas City, MO",
    type: "Service Call",
    status: "Needs Follow-up",
    scheduledDate: "2026-07-23",
    scheduledTime: "13:00",
    technician: "Colton Nichols",
    priority: "High",
    description:
      "Café AC not cooling adequately during peak hours. System may be undersized. Follow up with replacement quote.",
  },
];

// === SAMPLE INVOICES ===
export const invoices: Invoice[] = [
  {
    id: "INV-0289",
    customerId: "cust-003",
    customerName: "Jennifer Walsh",
    amount: 0,
    paidAmount: 0,
    status: "Draft",
    dueDate: "2026-08-15",
    items: [],
  },
  {
    id: "INV-0285",
    customerId: "cust-007",
    customerName: "Marcus Johnson",
    amount: 189,
    paidAmount: 0,
    status: "Sent",
    dueDate: "2026-08-10",
    sentDate: "2026-07-24",
    items: [
      { description: "Crown Care Annual Membership Renewal", amount: 189 },
    ],
  },
  {
    id: "INV-0284",
    customerId: "cust-004",
    customerName: "Westport Dental Group",
    amount: 450,
    paidAmount: 225,
    status: "Partial",
    dueDate: "2026-08-05",
    sentDate: "2026-07-19",
    items: [
      {
        description: "Quarterly commercial HVAC inspection (2 systems)",
        amount: 350,
      },
      { description: "Replacement air filters (4)", amount: 100 },
    ],
  },
  {
    id: "INV-0278",
    customerId: "cust-002",
    customerName: "Robert Chen",
    amount: 145,
    paidAmount: 0,
    status: "Overdue",
    dueDate: "2026-07-15",
    sentDate: "2026-07-01",
    items: [
      {
        description: "Service call: refrigerant top-off and inspection",
        amount: 145,
      },
    ],
  },
  {
    id: "INV-0275",
    customerId: "cust-001",
    customerName: "Michael & Sarah Thompson",
    amount: 7990,
    paidAmount: 7990,
    status: "Paid",
    dueDate: "2026-03-30",
    sentDate: "2024-03-15",
    items: [
      {
        description: "Champion XC4 14 SEER AC system installation",
        amount: 6290,
      },
      { description: "Champion Z9 96% AFUE furnace upgrade", amount: 1200 },
      { description: "Wi-Fi thermostat + Crown Care enrollment", amount: 500 },
    ],
  },
  {
    id: "INV-0271",
    customerId: "cust-007",
    customerName: "Marcus Johnson",
    amount: 124,
    paidAmount: 124,
    status: "Paid",
    dueDate: "2026-07-20",
    sentDate: "2026-07-15",
    items: [{ description: "Service call: replaced capacitor", amount: 124 }],
  },
  {
    id: "INV-0280",
    customerId: "cust-004",
    customerName: "Westport Dental Group",
    amount: 18900,
    paidAmount: 18900,
    status: "Paid",
    dueDate: "2025-09-30",
    sentDate: "2025-09-10",
    items: [
      {
        description: "Commercial HVAC installation - Package unit + Zone AC",
        amount: 16400,
      },
      { description: "Ductwork modifications and electrical", amount: 2500 },
    ],
  },
];

// === CROWN CARE MEMBERSHIPS ===
export const memberships: CrownCareMembership[] = [
  {
    id: "CC-001",
    customerId: "cust-001",
    customerName: "Michael & Sarah Thompson",
    propertyAddress: "4521 Oakridge Dr, Lee's Summit, MO",
    systemId: "sys-001",
    systemDescription: "Champion XC4 3-Ton AC",
    startDate: "2024-03-15",
    renewalDate: "2025-03-15",
    billingFrequency: "Annual",
    paymentStatus: "Paid",
    autoRenew: true,
    visitsIncluded: 2,
    visitsUsed: 0,
    springVisit: { status: "Scheduled", scheduledDate: "2026-04-15" },
    fallVisit: { status: "Scheduled", scheduledDate: "2026-10-15" },
    status: "Active",
  },
  {
    id: "CC-002",
    customerId: "cust-002",
    customerName: "Robert Chen",
    propertyAddress: "1278 Maplewood Ct, Kansas City, MO",
    systemId: "sys-003",
    systemDescription: "Guardian RH4 3-Ton Heat Pump",
    startDate: "2023-07-21",
    renewalDate: "2026-07-21",
    billingFrequency: "Annual",
    paymentStatus: "Pending",
    autoRenew: true,
    visitsIncluded: 2,
    visitsUsed: 1,
    springVisit: { status: "Completed", scheduledDate: "2026-04-18" },
    fallVisit: { status: "Scheduled", scheduledDate: "2026-07-28" },
    status: "Active",
  },
  {
    id: "CC-003",
    customerId: "cust-007",
    customerName: "Marcus Johnson",
    propertyAddress: "3345 Willowbrook Way, Blue Springs, MO",
    systemId: "sys-009",
    systemDescription: "Champion XC4 3-Ton AC",
    startDate: "2024-06-01",
    renewalDate: "2025-06-01",
    billingFrequency: "Annual",
    paymentStatus: "Overdue",
    autoRenew: true,
    visitsIncluded: 2,
    visitsUsed: 1,
    springVisit: { status: "Completed", scheduledDate: "2026-04-15" },
    fallVisit: { status: "Scheduled", scheduledDate: "2026-10-20" },
    status: "Active",
  },
  {
    id: "CC-004",
    customerId: "cust-004",
    customerName: "Westport Dental Group",
    propertyAddress: "4050 Pennsylvania Ave, Kansas City, MO",
    systemId: "sys-005",
    systemDescription: "Champion XH5 4-Ton Package Unit",
    startDate: "2025-09-10",
    renewalDate: "2026-09-10",
    billingFrequency: "Annual",
    paymentStatus: "Paid",
    autoRenew: true,
    visitsIncluded: 2,
    visitsUsed: 0,
    springVisit: { status: "Unscheduled" },
    fallVisit: { status: "Unscheduled" },
    status: "Active",
  },
];

// === TEAM MEMBERS ===
export const teamMembers = [
  {
    name: "Colton Nichols",
    role: "Owner / Admin",
    initials: "CN",
    color: "bg-sky-500",
  },
  {
    name: "James Nichols",
    role: "Technician / Installer",
    initials: "JN",
    color: "bg-emerald-500",
  },
  {
    name: "Sarah Nichols",
    role: "Office / Dispatcher",
    initials: "SN",
    color: "bg-amber-500",
  },
];

// === DASHBOARD METRICS ===
export const dashboardMetrics = {
  todaySchedule: 2,
  openLeads: 5,
  quotesPending: 3,
  unpaidInvoices: 4,
  cashCollected: 12618,
  activeMemberships: 4,
  annualRecurringValue: 756,
  upcomingRenewals: 1,
  overdueVisits: 0,
  unbookedVisits: 1,
};

// Helper: currency format
export const fmtCurrency = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
export const fmtCurrencyExact = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
