import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import { apiRequest } from "@/lib/queryClient";
import { supabase, extractEntities } from "@/lib/supabase";
import {
  customers as seedCustomers,
  workOrders as seedWorkOrders,
  invoices as seedInvoices,
  quotes as seedQuotes,
  memberships as seedMemberships,
  type Customer,
  type WorkOrder,
  type Invoice,
  type Quote,
  type CrownCareMembership,
} from "@/data/mock-data";

// === Types ===
export interface CustomerNote {
  id: string;
  customerId: string;
  text: string;
  author: string;
  date: string;
}

export interface CustomerPhoto {
  id: string;
  customerId: string;
  dataUrl: string;
  fileName: string;
  uploadedAt: string;
  analysis?: string;
  analyzing?: boolean;
}

export interface NewCustomerData {
  name: string;
  type: "Residential" | "Commercial";
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  leadSource: string;
}

interface DataContextValue {
  customers: Customer[];
  workOrders: WorkOrder[];
  invoices: Invoice[];
  quotes: Quote[];
  notes: CustomerNote[];
  photos: CustomerPhoto[];
  loading: boolean;

  addCustomer: (data: NewCustomerData) => Customer;
  getNotes: (customerId: string) => CustomerNote[];
  addNote: (customerId: string, text: string) => void;
  getPhotos: (customerId: string) => CustomerPhoto[];
  addPhoto: (customerId: string, file: File) => Promise<void>;
  createWorkOrder: (data: { customerId: string; customerName: string; type: string; property: string; description: string; quoteId?: string }) => WorkOrder;
  createInvoice: (data: { customerId: string; customerName: string; amount: number; description: string; workOrderId?: string }) => Invoice;
  createQuote: (data: { customerId: string; customerName: string; jobType: string; title: string; totalCost: number; customerPrice: number; equipmentItems?: string[]; laborDescription?: string }) => Quote;
  updateQuoteStatus: (quoteId: string, status: string) => void;
  updateWorkOrder: (workOrderId: string, updates: Partial<WorkOrder>) => void;
  memberships: CrownCareMembership[];
  enrollMembership: (data: { customerId: string; customerName: string; propertyAddress: string; systemDescription: string; billingFrequency: "Annual" | "Monthly" }) => CrownCareMembership;
}

// Collision-safe ID generator: prefix + 8 hex chars from a UUID.
const uid = (prefix: string) => `${prefix}${crypto.randomUUID().slice(0, 8)}`;

// Fire-and-forget Supabase insert/update for a jsonb-blob table.
// `customerId` is optional because the `customers` table has no customer_id column.
// Returns the error (if any) so callers can surface it to the UI.
const persistBlob = async (
  table: string,
  id: string,
  data: unknown,
  customerId?: string,
): Promise<string | null> => {
  const row: Record<string, unknown> = { id, company_id: "air-king", data };
  if (customerId) row.customer_id = customerId;
  const { error } = await supabase.from(table).upsert(row);
  if (error) {
    console.error(`Failed to persist ${table} ${id}:`, error.message);
    return error.message;
  }
  return null;
};

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const [customers, setCustomers] = useState<Customer[]>(seedCustomers);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>(seedWorkOrders);
  const [invoices, setInvoices] = useState<Invoice[]>(seedInvoices);
  const [quotes, setQuotes] = useState<Quote[]>(seedQuotes);
  const [memberships, setMemberships] = useState<CrownCareMembership[]>(seedMemberships);
  const [notes, setNotes] = useState<CustomerNote[]>([]);
  const [photos, setPhotos] = useState<CustomerPhoto[]>([]);
  const [loading, setLoading] = useState(true);

  // Refs mirror latest state so update handlers can read the full entity
  // to persist (jsonb blobs are replaced wholesale).
  const quotesRef = useRef(quotes);
  const workOrdersRef = useRef(workOrders);
  useEffect(() => { quotesRef.current = quotes; }, [quotes]);
  useEffect(() => { workOrdersRef.current = workOrders; }, [workOrders]);

  // Load all data from Supabase on mount; fall back to seed data if empty
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [custRes, woRes, invRes, quoteRes, memRes] = await Promise.all([
          supabase.from("customers").select("data"),
          supabase.from("work_orders").select("data"),
          supabase.from("invoices").select("data"),
          supabase.from("quotes").select("data"),
          supabase.from("memberships").select("data"),
        ]);
        if (cancelled) return;
        const custData = extractEntities<Customer>(custRes.data);
        const woData = extractEntities<WorkOrder>(woRes.data);
        const invData = extractEntities<Invoice>(invRes.data);
        const quoteData = extractEntities<Quote>(quoteRes.data);
        const memData = extractEntities<CrownCareMembership>(memRes.data);
        if (custData.length > 0) setCustomers(custData);
        if (woData.length > 0) setWorkOrders(woData);
        if (invData.length > 0) setInvoices(invData);
        if (quoteData.length > 0) setQuotes(quoteData);
        if (memData.length > 0) setMemberships(memData);
      } catch (err) {
        console.error("Failed to load data from Supabase, using seed data:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const refresh = async () => {
      const [inv, quotes, jobs] = await Promise.all([supabase.from("invoices").select("data"),supabase.from("quotes").select("data"),supabase.from("work_orders").select("data")]);
      if (!inv.error && inv.data) setInvoices(extractEntities<Invoice>(inv.data));
      if (!quotes.error && quotes.data) setQuotes(extractEntities<Quote>(quotes.data));
      if (!jobs.error && jobs.data) setWorkOrders(extractEntities<WorkOrder>(jobs.data));
    };
    const timer = setInterval(refresh, 30000);
    window.addEventListener("crm-refresh", refresh);
    return () => { clearInterval(timer); window.removeEventListener("crm-refresh", refresh); };
  }, []);

  const loadNotes = useCallback(async (customerId: string) => {
    try {
      const { data, error } = await supabase
        .from("customer_notes")
        .select("id, customer_id, text, author, date")
        .eq("customer_id", customerId);
      if (error) throw error;
      if (Array.isArray(data)) {
        const mapped: CustomerNote[] = data.map((n: any) => ({
          id: n.id,
          customerId: n.customer_id,
          text: n.text,
          author: n.author,
          date: n.date,
        }));
        setNotes((prev) => {
          const filtered = prev.filter((x) => x.customerId !== customerId);
          return [...mapped, ...filtered];
        });
      }
    } catch (err) {
      console.error("Failed to load notes:", err);
    }
  }, []);

  const loadPhotos = useCallback(async (customerId: string) => {
    try {
      const { data, error } = await supabase
        .from("customer_photos")
        .select("id, customer_id, data_url, file_name, uploaded_at, analysis")
        .eq("customer_id", customerId);
      if (error) throw error;
      if (Array.isArray(data)) {
        const mapped: CustomerPhoto[] = data.map((p: any) => ({
          id: p.id,
          customerId: p.customer_id,
          dataUrl: p.data_url,
          fileName: p.file_name,
          uploadedAt: p.uploaded_at,
          analysis: p.analysis ?? undefined,
        }));
        setPhotos((prev) => {
          const filtered = prev.filter((x) => x.customerId !== customerId);
          return [...mapped, ...filtered];
        });
      }
    } catch (err) {
      console.error("Failed to load photos:", err);
    }
  }, []);

  const addCustomer = useCallback((data: NewCustomerData): Customer => {
    const id = uid("cust-");
    const newCustomer: Customer = {
      id,
      type: data.type,
      name: data.name,
      contacts: [
        { name: data.name, phone: data.phone || "(816) 555-0000", email: data.email || "noreply@email.com", role: "Primary" },
      ],
      properties: [
        {
          id: `prop-${crypto.randomUUID().slice(0, 8)}`,
          address: data.address || "TBD",
          city: data.city,
          state: data.state,
          zip: data.zip || "64000",
          systems: [],
          accessNotes: "",
          gateCode: "",
        },
      ],
      leadSource: data.leadSource,
      leadStatus: "New",
      createdAt: new Date().toISOString().slice(0, 10),
      tags: [],
      activity: [
        { id: `act-${crypto.randomUUID().slice(0, 8)}`, type: "note", title: "Customer created", description: `Added via CRM — lead source: ${data.leadSource}`, date: new Date().toISOString().slice(0, 10), user: "Colton Nichols" },
      ],
    };
    setCustomers((prev) => [newCustomer, ...prev]);
    persistBlob("customers", id, newCustomer);
    return newCustomer;
  }, []);

  const getNotes = useCallback((customerId: string): CustomerNote[] => {
    const hasLoaded = notes.some((n) => n.customerId === customerId);
    if (!hasLoaded) loadNotes(customerId);
    return notes.filter((n) => n.customerId === customerId);
  }, [notes, loadNotes]);

  const addNote = useCallback((customerId: string, text: string) => {
    const note: CustomerNote = {
      id: uid("note-"),
      customerId,
      text,
      author: "Colton Nichols",
      date: new Date().toISOString().slice(0, 10),
    };
    setNotes((prev) => [note, ...prev]);
    supabase
      .from("customer_notes")
      .insert({ id: note.id, company_id: "air-king", customer_id: customerId, text, author: note.author, date: note.date })
      .then(({ error }) => { if (error) console.error("Failed to persist note:", error.message); });
  }, []);

  const getPhotos = useCallback((customerId: string): CustomerPhoto[] => {
    const hasLoaded = photos.some((p) => p.customerId === customerId);
    if (!hasLoaded) loadPhotos(customerId);
    return photos.filter((p) => p.customerId === customerId);
  }, [photos, loadPhotos]);

  const addPhoto = useCallback(async (customerId: string, file: File) => {
    let dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });

    if (dataUrl.length > 500000) {
      try {
        const img = new Image();
        img.src = dataUrl;
        await img.decode();
        const canvas = document.createElement("canvas");
        const maxDim = 1024;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const ratio = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx?.drawImage(img, 0, 0, width, height);
        dataUrl = canvas.toDataURL("image/jpeg", 0.8);
      } catch {
        // keep original if compression fails
      }
    }

    const photoId = uid("photo-");
    const uploadedAt = new Date().toISOString().slice(0, 10);
    const photo: CustomerPhoto = {
      id: photoId,
      customerId,
      dataUrl,
      fileName: file.name,
      uploadedAt,
      analyzing: true,
    };
    setPhotos((prev) => [photo, ...prev]);

    // Persist photo metadata + base64 to Supabase
    const { error: insErr } = await supabase
      .from("customer_photos")
      .insert({ id: photoId, company_id: "air-king", customer_id: customerId, data_url: dataUrl, file_name: file.name, uploaded_at: uploadedAt });
    if (insErr) console.error("Failed to persist photo:", insErr.message);

    // AI analysis via Express proxy (needs secret key server-side)
    try {
      const resp = await apiRequest("POST", "/api/analyze-photo", { image: dataUrl, fileName: file.name });
      const result = await resp.json();
      setPhotos((prev) => prev.map((p) => p.id === photoId ? { ...p, analysis: result.note, analyzing: false } : p));
      await supabase.from("customer_photos").update({ analysis: result.note }).eq("id", photoId);

      const aiNote: CustomerNote = {
        id: uid("note-"),
        customerId,
        text: `📸 Photo Analysis (${file.name}): ${result.note}`,
        author: "AI Assistant",
        date: uploadedAt,
      };
      setNotes((prev) => [aiNote, ...prev]);
      await supabase.from("customer_notes").insert({ id: aiNote.id, company_id: "air-king", customer_id: customerId, text: aiNote.text, author: aiNote.author, date: aiNote.date });
    } catch (err) {
      setPhotos((prev) => prev.map((p) => p.id === photoId ? { ...p, analyzing: false } : p));
      const fallbackNote: CustomerNote = {
        id: uid("note-"),
        customerId,
        text: `📸 Photo uploaded: ${file.name}. AI analysis unavailable in this environment.`,
        author: "System",
        date: uploadedAt,
      };
      setNotes((prev) => [fallbackNote, ...prev]);
      await supabase.from("customer_notes").insert({ id: fallbackNote.id, company_id: "air-king", customer_id: customerId, text: fallbackNote.text, author: fallbackNote.author, date: fallbackNote.date });
    }
  }, []);

  const createWorkOrder = useCallback((data: { customerId: string; customerName: string; type: string; property: string; description: string; quoteId?: string }): WorkOrder => {
    const wo: WorkOrder = {
      id: uid("WO-"),
      customerId: data.customerId,
      customerName: data.customerName,
      property: data.property,
      type: data.type,
      status: "Scheduled",
      scheduledDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      scheduledTime: "09:00",
      technician: "James Nichols",
      priority: "Normal",
      description: data.description,
      quoteId: data.quoteId,
    };
    setWorkOrders((prev) => [wo, ...prev]);
    persistBlob("work_orders", wo.id, wo, wo.customerId);
    return wo;
  }, []);

  const createInvoice = useCallback((data: { customerId: string; customerName: string; amount: number; description: string; workOrderId?: string }): Invoice => {
    const inv: Invoice = {
      id: uid("INV-"),
      customerId: data.customerId,
      customerName: data.customerName,
      workOrderId: data.workOrderId,
      amount: data.amount,
      paidAmount: 0,
      status: "Draft",
      dueDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      items: [{ description: data.description, amount: data.amount }],
    };
    setInvoices((prev) => [inv, ...prev]);
    persistBlob("invoices", inv.id, inv, inv.customerId);
    return inv;
  }, []);

  const createQuote = useCallback((data: { customerId: string; customerName: string; jobType: string; title: string; totalCost: number; customerPrice: number; equipmentItems?: string[]; laborDescription?: string }): Quote => {
    const q: Quote = {
      id: uid("Q-"),
      customerId: data.customerId,
      customerName: data.customerName,
      jobType: data.jobType as Quote["jobType"],
      title: data.title,
      status: "Quote Sent",
      createdAt: new Date().toISOString().slice(0, 10),
      equipmentItems: data.equipmentItems,
      laborDescription: data.laborDescription,
      options: [
        { tier: "Good", label: "Essential", equipment: "Standard efficiency", efficiency: "13 SEER", features: ["Reliable cooling", "10-year parts and labor warranty"], totalCost: data.totalCost, customerPrice: Math.round(data.customerPrice * 0.85) },
        { tier: "Better", label: "Enhanced", equipment: "Upgraded efficiency", efficiency: "14 SEER", features: ["Upgraded efficiency", "10-year parts and labor warranty"], totalCost: data.totalCost, customerPrice: data.customerPrice, isPopular: true },
        { tier: "Best", label: "Ultimate", equipment: "Premium high efficiency", efficiency: "16 SEER Variable", features: ["Premium efficiency", "10-year parts and labor warranty", "Wi-Fi thermostat"], totalCost: data.totalCost, customerPrice: Math.round(data.customerPrice * 1.25) },
      ],
      selectedAddOns: [],
      laborCost: 0,
      materialsCost: 0,
      taxRate: 0,
    };
    setQuotes((prev) => [q, ...prev]);
    persistBlob("quotes", q.id, q, q.customerId);
    return q;
  }, []);

  const updateQuoteStatus = useCallback((quoteId: string, status: string) => {
    const current = quotesRef.current.find((q) => q.id === quoteId);
    if (!current) return;
    const updated: Quote = { ...current, status: status as Quote["status"] };
    setQuotes((prev) => prev.map((q) => q.id === quoteId ? updated : q));
    persistBlob("quotes", quoteId, updated, updated.customerId);
  }, []);

  const updateWorkOrder = useCallback((workOrderId: string, updates: Partial<WorkOrder>) => {
    const current = workOrdersRef.current.find((wo) => wo.id === workOrderId);
    if (!current) return;
    const updated: WorkOrder = { ...current, ...updates };
    setWorkOrders((prev) => prev.map((wo) => wo.id === workOrderId ? updated : wo));
    persistBlob("work_orders", workOrderId, updated, updated.customerId);
  }, []);

  const enrollMembership = useCallback((data: { customerId: string; customerName: string; propertyAddress: string; systemDescription: string; billingFrequency: "Annual" | "Monthly" }): CrownCareMembership => {
    const today = new Date();
    const renewal = new Date(today);
    renewal.setFullYear(renewal.getFullYear() + 1);
    const m: CrownCareMembership = {
      id: uid("CC-"),
      customerId: data.customerId,
      customerName: data.customerName,
      propertyAddress: data.propertyAddress,
      systemId: "sys-new",
      systemDescription: data.systemDescription,
      startDate: today.toISOString().slice(0, 10),
      renewalDate: renewal.toISOString().slice(0, 10),
      billingFrequency: data.billingFrequency,
      paymentStatus: "Pending",
      autoRenew: true,
      visitsIncluded: 2,
      visitsUsed: 0,
      springVisit: { status: "Unscheduled" },
      fallVisit: { status: "Unscheduled" },
      status: "Active",
    };
    setMemberships((prev) => [m, ...prev]);
    persistBlob("memberships", m.id, m, m.customerId);
    return m;
  }, []);

  const value: DataContextValue = {
    customers,
    workOrders,
    invoices,
    quotes,
    notes,
    photos,
    loading,
    addCustomer,
    getNotes,
    addNote,
    getPhotos,
    addPhoto,
    createWorkOrder,
    createInvoice,
    createQuote,
    updateQuoteStatus,
    updateWorkOrder,
    memberships,
    enrollMembership,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used within DataProvider");
  return ctx;
}
