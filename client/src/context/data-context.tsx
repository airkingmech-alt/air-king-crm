import { buildQuoteDraft, type QuoteDraftInput } from "@/lib/quote-pricing";
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { toast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { cacheSavedCustomerNote, saveCustomerNote, type CustomerNote } from "../../../shared/customer-notes";
import { normalizeLeadSource } from "../../../shared/customer-lead-source";
import { useAuth } from "@/context/auth-context";
import { canAccess } from "../../../shared/access";
import { saveRecords, type RecordWrite } from "@/lib/confirmed-save";
import { supabase, extractEntities } from "@/lib/supabase";
import {
  type Customer,
  type WorkOrder,
  type Invoice,
  type Quote,
  type CrownCareMembership,
} from "@/data/mock-data";
import { pricebook } from "@/data/pricebook";
import { crownVisitLink } from "../../../shared/crown-scheduling";
import { saveCrownVisit } from "@/lib/crown-scheduling";

// === Types ===
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
  leadSource?: string;
}

interface DataContextValue {
  customers: Customer[];
  workOrders: WorkOrder[];
  invoices: Invoice[];
  quotes: Quote[];
  photos: CustomerPhoto[];
  loading: boolean;
  loadError: string | null;

  addCustomer: (data: NewCustomerData, leadId?: string) => Promise<Customer>;
  addNote: (customerId: string, text: string) => Promise<void>;
  getPhotos: (customerId: string) => CustomerPhoto[];
  addPhoto: (customerId: string, file: File) => Promise<void>;
  createWorkOrder: (data: {
    membershipId?: string;
    membershipSeason?: "spring" | "fall";
    customerId: string;
    customerName: string;
    type: string;
    projectName?: string;
    property: string;
    description: string;
    quoteId?: string;
    scheduledDate?:string; scheduledTime?:string; technician?:string; priority?:WorkOrder["priority"];
  }) => Promise<WorkOrder>;
  createInvoice: (data: {
    customerId: string;
    customerName: string;
    amount: number;
    description: string;
    projectName?: string;
    constructionStage?: "Rough-in" | "Finish";
    cardFeePercent?: number;
    items?: { description: string; amount: number }[];
    workOrderId?: string;
    quoteId?: string;
    equipmentItems?: string[];
    installedEquipment?: { brand?: string | null; model?: string | null; category: string; description: string }[];
    dueDate?: string;
  }) => Promise<Invoice>;
  createQuote: (data: QuoteDraftInput) => Promise<Quote>;
  updateQuoteStatus: (quoteId: string, status: string) => Promise<void>;
  updateWorkOrder: (workOrderId: string, updates: Partial<WorkOrder>) => Promise<void>;
  memberships: CrownCareMembership[];
  enrollMembership: (data: {
    customerId: string;
    customerName: string;
    propertyAddress: string;
    systemDescription: string;
    billingFrequency: "Annual" | "Monthly";
  }) => Promise<CrownCareMembership>;
}

// Collision-safe ID generator: prefix + 8 hex chars from a UUID.
const uid = (prefix: string) => `${prefix}${crypto.randomUUID().slice(0, 8)}`;

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const queryClient = useQueryClient();
  const [loadError,setLoadError]=useState<string|null>(null);
  const actor=profile?.full_name || "Staff member";
  const pendingCreates=useRef(new Map<string,string>());
  const crownMutationVersion = useRef(0);
  const createId=(prefix:string,input:unknown)=>{const key=prefix+JSON.stringify(input);let id=pendingCreates.current.get(key);if(!id){id=uid(prefix);pendingCreates.current.set(key,id);}return id;};
  const finishCreate=(prefix:string,input:unknown)=>pendingCreates.current.delete(prefix+JSON.stringify(input));
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [memberships, setMemberships] =
    useState<CrownCareMembership[]>([]);
  const [photos, setPhotos] = useState<CustomerPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const loadedPhotos=useRef(new Set<string>());

  // Refs mirror latest state so update handlers can read the full entity
  // to persist (jsonb blobs are replaced wholesale).
  const quotesRef = useRef(quotes);
  const workOrdersRef = useRef(workOrders);
  const customersRef = useRef(customers);
  useEffect(() => {
    quotesRef.current = quotes;
  }, [quotes]);
  useEffect(() => {
    workOrdersRef.current = workOrders;
  }, [workOrders]);
  useEffect(() => {
    customersRef.current = customers;
  }, [customers]);

  // Empty means empty; a failed read must never show sample business records.
  useEffect(() => {
    let cancelled=false;
    const load=async()=>{
      const crownVersion = crownMutationVersion.current;
      const specs=[['customers','customers',setCustomers],['work_orders','schedule',setWorkOrders],['invoices','invoices',setInvoices],['quotes','quotes',setQuotes],['memberships','memberships',setMemberships]] as const;
      try {
        for(const [table,feature,setter] of specs){
          if(!canAccess(profile,feature)){if(!cancelled)(setter as any)([]);continue;}
          const rows:any[]=[];
          for(let start=0;;start+=500){const {data,error}=await supabase.from(table).select('data').order('id').range(start,start+499);if(error)throw error;rows.push(...(data || []));if(!data || data.length<500)break;}
          // Do not let a pre-save response undo a confirmed paired booking.
          if(!cancelled && (!(table === "memberships" || table === "work_orders") || crownVersion === crownMutationVersion.current))
            (setter as any)(extractEntities(rows));
        }
        if(!cancelled)setLoadError(null);
      }catch(e:any){if(!cancelled)setLoadError('Some records could not be refreshed. Reconnect and refresh before editing. '+e.message);}
      finally{if(!cancelled)setLoading(false);}
    };
    void load();const timer=setInterval(load,30000);window.addEventListener('crm-refresh',load);
    return()=>{cancelled=true;clearInterval(timer);window.removeEventListener('crm-refresh',load);};
  },[profile?.id,profile?.role,JSON.stringify(profile?.permissions)]);

  const loadPhotos = useCallback(async (customerId: string) => {
    loadedPhotos.current.add(customerId);
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
      toast({title:"Could not load customer photos",description:"Refresh the page to retry.",variant:"destructive"});
    }
  }, []);

  const addCustomer = useCallback(async (data: NewCustomerData, leadId?: string): Promise<Customer> => {
    const id = createId("cust-",data);
    const newCustomer: Customer = {
      id,
      type: data.type,
      name: data.name,
      contacts: [
        {
          name: data.name,
          phone: data.phone || "",
          email: data.email || "",
          role: "Primary",
        },
      ],
      properties: [
        {
          id: `prop-${id}`,
          address: data.address || "TBD",
          city: data.city,
          state: data.state,
          zip: data.zip || "",
          systems: [],
          accessNotes: "",
          gateCode: "",
        },
      ],
      leadSource: normalizeLeadSource(data.leadSource),
      leadStatus: "New",
      createdAt: new Date().toISOString().slice(0, 10),
      tags: [],
      activity: [
        {
          id: `act-${id}`,
          type: "note",
          title: "Customer created",
          description: `Added via CRM — lead source: ${normalizeLeadSource(data.leadSource)}`,
          date: new Date().toISOString().slice(0, 10),
          user: actor,
        },
      ],
    };
    let saved:Customer;
    if(leadId){
      const {data:linked,error}=await supabase.rpc("crm_convert_lead",{p_lead_id:leadId,p_customer:newCustomer});
      if(error)throw new Error(error.message);
      saved=linked as Customer;
    }else saved=(await saveRecords([{table:"customers",id,data:newCustomer}]))[0];
    finishCreate("cust-",data);
    setCustomers((prev) => [saved, ...prev.filter(c=>c.id!==saved.id)]);
    return saved;
  }, [actor]);

  const addNote = useCallback(async (customerId: string, text: string) => {
    const input = { customerId, text: text.trim() };
    const id = createId("note-", input);
    const note: CustomerNote = { id, ...input, author: actor, date: new Date().toISOString().slice(0, 10) };
    const saved = await saveCustomerNote(supabase, profile?.company_id || "", note);
    await cacheSavedCustomerNote(queryClient, profile?.id || "", profile?.company_id || "", saved);
    finishCreate("note-", input);
  }, [actor, profile?.id, profile?.company_id, queryClient]);

  const getPhotos = useCallback(
    (customerId: string): CustomerPhoto[] => {
      const hasLoaded = loadedPhotos.current.has(customerId);
      if (!hasLoaded) loadPhotos(customerId);
      return photos.filter((p) => p.customerId === customerId);
    },
    [photos, loadPhotos],
  );

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
      .insert({
        id: photoId,
        company_id: profile?.company_id,
        customer_id: customerId,
        data_url: dataUrl,
        file_name: file.name,
        uploaded_at: uploadedAt,
      });
    if (insErr) {
      setPhotos(prev => prev.filter(p => p.id !== photoId));
      throw new Error("The photo could not be saved. Please try again.");
    }
    setPhotos(prev => prev.map(p => p.id === photoId ? {...p, analyzing:false} : p));
  }, [profile?.company_id]);

  const createWorkOrder = useCallback(
    async (data: {
      membershipId?: string;
      membershipSeason?: "spring" | "fall";
      customerId: string;
      customerName: string;
      type: string;
      projectName?: string;
      property: string;
      description: string;
      quoteId?: string;
      scheduledDate?:string; scheduledTime?:string; technician?:string; priority?:WorkOrder["priority"];
    }): Promise<WorkOrder> => {
      const linked = data.membershipId !== undefined || data.membershipSeason !== undefined;
      if (linked) crownVisitLink.parse(data);
      const wo: WorkOrder = {
        id: createId("WO-",data),
        customerId: data.customerId,
        customerName: data.customerName,
        property: data.property,
        type: data.type,
        projectName: data.projectName?.trim() || undefined,
        status: linked || data.technician ? "Scheduled" : "Unscheduled",
        scheduledDate: data.scheduledDate || new Date(Date.now() + 7 * 86400000)
          .toISOString()
          .slice(0, 10),
        scheduledTime: data.scheduledTime || "09:00",
        technician: data.technician,
        priority: data.priority || "Normal",
        description: data.description,
        quoteId: data.quoteId,
        ...(linked ? { membershipId: data.membershipId, membershipSeason: data.membershipSeason } : {}),
      };
      let saved = wo;
      if (linked) {
        // This RPC commits the appointment and seasonal slot together. A missing
        // migration fails here instead of claiming that only half was saved.
        const result = await saveCrownVisit((name, args) => supabase.rpc(name, args), wo);
        saved = result.workOrder;
        crownMutationVersion.current++;
        setMemberships(previous => [result.membership, ...previous.filter(m => m.id !== result.membership.id)]);
      } else {
        [saved] = await saveRecords([{table:"work_orders",id:wo.id,data:wo}]);
      }
      finishCreate("WO-",data);
      workOrdersRef.current=[saved,...workOrdersRef.current.filter(w=>w.id!==saved.id)];
      setWorkOrders(workOrdersRef.current);
      return saved;
    },
    [],
  );

  const createInvoice = useCallback(
    async (data: {
      customerId: string;
      customerName: string;
      amount: number;
      description: string;
      projectName?: string;
      constructionStage?: "Rough-in" | "Finish";
      cardFeePercent?: number;
      items?: { description: string; amount: number }[];
      workOrderId?: string;
      quoteId?: string;
      equipmentItems?: string[];
      installedEquipment?: { brand?: string | null; model?: string | null; category: string; description: string }[];
      dueDate?: string;
    }): Promise<Invoice> => {
      if(!Number.isFinite(data.amount) || data.amount<0)throw new Error("Enter a valid invoice amount.");
      const inv: Invoice = {
        id: createId("INV-",data),
        customerId: data.customerId,
        customerName: data.customerName,
        workOrderId: data.workOrderId,
        quoteId: data.quoteId,
        equipmentItems: data.equipmentItems,
        projectName: data.projectName?.trim() || undefined,
        constructionStage: data.constructionStage,
        cardFeePercent: data.cardFeePercent,
        amount: data.amount,
        paidAmount: 0,
        status: "Draft",
        dueDate:
          data.dueDate ||
          new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
        items: data.items?.length
          ? data.items
          : [{ description: data.description, amount: data.amount }],
      };
      const writes:RecordWrite[]=[{table:"invoices",id:inv.id,data:inv}];
      let changedCustomer:Customer|undefined;
      if (data.equipmentItems?.length || data.installedEquipment?.length) {
        const customer = customersRef.current.find(
          (c) => c.id === data.customerId,
        );
        const property = customer?.properties[0];
        if (customer && property) {
          const legacyEquipment = (data.equipmentItems || [])
            .map((equipmentId) =>
              pricebook.find((item) => item.id === equipmentId),
            )
            .filter(Boolean)
            .map((item) => ({
              brand: item!.brand,
              model: item!.model,
              category: item!.category,
              description: item!.description,
            }));
          const equipment = [...legacyEquipment, ...(data.installedEquipment || [])]
            .filter((item) =>
              [
                "Condenser",
                "Evaporator Coil",
                "Air Handler",
                "Furnace",
                "Heat Pump",
              ].includes(item.category),
            )
            .filter(
              (item) =>
                !!item.model && !property.systems.some((system) => system.model === item.model),
            );
          const installed = equipment.map((item,index) => {
              const installedAt = new Date().toISOString().slice(0, 10);
              const warranty = new Date();
              warranty.setFullYear(warranty.getFullYear() + 10);
              const type =
                item.category === "Condenser"
                  ? "AC"
                  : item.category === "Evaporator Coil"
                    ? "Coil"
                    : item.category === "Air Handler"
                      ? "Air Handler"
                      : item.category === "Furnace"
                        ? "Furnace"
                        : item.category === "Heat Pump"
                          ? "Heat Pump"
                          : "Package Unit";
              return {
                id: `sys-${inv.id}-${index}`,
                type: type as import("@/data/mock-data").HVACSystem["type"],
                brand: item.brand || "Unknown",
                model: item.model || "Not recorded",
                serial: "Not recorded",
                installDate: installedAt,
                warrantyExp: warranty.toISOString().slice(0, 10),
                status: "Warranty" as const,
                notes: `${item.description} · Added from invoice ${inv.id}`,
              };
            });
          if (installed.length) {
            const updated = {
              ...customer,
              properties: customer.properties.map((candidate, index) =>
                index === 0
                  ? {
                      ...candidate,
                      systems: [...candidate.systems, ...installed],
                    }
                  : candidate,
              ),
            };
            changedCustomer=updated;
            writes.push({table:'customers',id:updated.id,data:updated,previous:customer});
          }
        }
      }
      const [savedInvoice,savedCustomer]=await saveRecords(writes);
      if(savedCustomer)changedCustomer=savedCustomer;
      finishCreate("INV-",data);
      setInvoices(prev=>[savedInvoice,...prev.filter(i=>i.id!==inv.id)]);
      if(changedCustomer)setCustomers(prev=>prev.map(c=>c.id===changedCustomer!.id?changedCustomer!:c));
      return savedInvoice as Invoice;
    },
    [],
  );

  const createQuote = useCallback(
    async (data: QuoteDraftInput): Promise<Quote> => {
      const q = buildQuoteDraft(data, createId("Q-", data), new Date().toISOString().slice(0, 10));
      await saveRecords([{table:"quotes",id:q.id,data:q}]);
      finishCreate("Q-",data);
      setQuotes((prev) => [q, ...prev.filter(x=>x.id!==q.id)]);
      return q;
    },
    [],
  );

  const updateQuoteStatus = useCallback(async (quoteId: string, status: string) => {
    const current = quotesRef.current.find((q) => q.id === quoteId);
    if (!current) throw new Error("Record unavailable. Refresh and try again.");
    const updated: Quote = { ...current, status: status as Quote["status"] };
    const [saved]=await saveRecords([{table:"quotes",id:quoteId,data:updated,previous:current}]);
    quotesRef.current=quotesRef.current.map(q=>q.id===quoteId?saved:q);
    setQuotes(quotesRef.current);
  }, []);

  const updateWorkOrder = useCallback(
    async (workOrderId: string, updates: Partial<WorkOrder>) => {
      const current = workOrdersRef.current.find((wo) => wo.id === workOrderId);
      if (!current) throw new Error("Record unavailable. Refresh and try again.");
      const updated: WorkOrder = { ...current, ...updates };
      const [saved]=await saveRecords([{table:"work_orders",id:workOrderId,data:updated,previous:current}]);
      workOrdersRef.current=workOrdersRef.current.map(wo=>wo.id===workOrderId?saved:wo);
      setWorkOrders(workOrdersRef.current);
      if (saved.membershipId) {
        crownMutationVersion.current++;
        window.dispatchEvent(new Event("crm-refresh"));
      }
    },
    [],
  );

  const enrollMembership = useCallback(
    async (data: {
      customerId: string;
      customerName: string;
      propertyAddress: string;
      systemDescription: string;
      billingFrequency: "Annual" | "Monthly";
    }): Promise<CrownCareMembership> => {
      const today = new Date();
      const renewal = new Date(today);
      renewal.setFullYear(renewal.getFullYear() + 1);
      const m: CrownCareMembership = {
        id: createId("CC-",data),
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
      await saveRecords([{table:"memberships",id:m.id,data:m}]);
      finishCreate("CC-",data);
      setMemberships((prev) => [m, ...prev.filter(x=>x.id!==m.id)]);
      return m;
    },
    [],
  );

  const value: DataContextValue = {
    customers,
    workOrders,
    invoices,
    quotes,
    photos,
    loading,
    loadError,
    addCustomer,
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

  return <DataContext.Provider value={value}>{loadError && <div role="alert" className="p-4 bg-amber-50 text-amber-950"><p>{loadError}</p><button className="underline mt-2" onClick={()=>window.dispatchEvent(new Event("crm-refresh"))}>Retry loading records</button></div>}{loading ? <div className="p-6">Loading CRM records…</div> : children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used within DataProvider");
  return ctx;
}
