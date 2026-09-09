import {
  customersTable,
  customerNotesTable,
  customerPhotosTable,
  workOrdersTable,
  invoicesTable,
  quotesTable,
  membershipsTable,
} from '@shared/schema';
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
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

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite);

// Run migrations (create tables if they don't exist)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS customers (id TEXT PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS customer_notes (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, text TEXT NOT NULL, author TEXT NOT NULL, date TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS customer_photos (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, data_url TEXT NOT NULL, file_name TEXT NOT NULL, uploaded_at TEXT NOT NULL, analysis TEXT);
  CREATE TABLE IF NOT EXISTS work_orders (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS invoices (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS quotes (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS memberships (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, data TEXT NOT NULL);
`);

// === Storage Functions ===

export function getAllCustomers(): Customer[] {
  const rows = db.select().from(customersTable).all();
  return rows.map(r => JSON.parse(r.data));
}

export function addCustomerToDb(customer: Customer): void {
  db.insert(customersTable).values({ id: customer.id, data: JSON.stringify(customer) }).run();
}

export function getAllNotes(customerId: string): any[] {
  return db.select().from(customerNotesTable).where(eq(customerNotesTable.customerId, customerId)).all();
}

export function addNoteToDb(note: { id: string; customerId: string; text: string; author: string; date: string }): void {
  db.insert(customerNotesTable).values({
    id: note.id,
    customerId: note.customerId,
    text: note.text,
    author: note.author,
    date: note.date,
  }).run();
}

export function getAllPhotos(customerId: string): any[] {
  return db.select().from(customerPhotosTable).where(eq(customerPhotosTable.customerId, customerId)).all();
}

export function addPhotoToDb(photo: { id: string; customerId: string; dataUrl: string; fileName: string; uploadedAt: string; analysis?: string }): void {
  db.insert(customerPhotosTable).values({
    id: photo.id,
    customerId: photo.customerId,
    dataUrl: photo.dataUrl,
    fileName: photo.fileName,
    uploadedAt: photo.uploadedAt,
    analysis: photo.analysis || null,
  }).run();
}

export function updatePhotoAnalysis(photoId: string, analysis: string): void {
  db.update(customerPhotosTable).set({ analysis }).where(eq(customerPhotosTable.id, photoId)).run();
}

export function getAllWorkOrders(): WorkOrder[] {
  const rows = db.select().from(workOrdersTable).all();
  return rows.map(r => JSON.parse(r.data));
}

export function addWorkOrderToDb(wo: WorkOrder): void {
  db.insert(workOrdersTable).values({ id: wo.id, customerId: wo.customerId, data: JSON.stringify(wo) }).run();
}

export function getAllInvoices(): Invoice[] {
  const rows = db.select().from(invoicesTable).all();
  return rows.map(r => JSON.parse(r.data));
}

export function addInvoiceToDb(inv: Invoice): void {
  db.insert(invoicesTable).values({ id: inv.id, customerId: inv.customerId, data: JSON.stringify(inv) }).run();
}

export function getAllQuotes(): Quote[] {
  const rows = db.select().from(quotesTable).all();
  return rows.map(r => JSON.parse(r.data));
}

export function addQuoteToDb(quote: Quote): void {
  db.insert(quotesTable).values({ id: quote.id, customerId: quote.customerId, data: JSON.stringify(quote) }).run();
}

export function getAllMemberships(): CrownCareMembership[] {
  const rows = db.select().from(membershipsTable).all();
  return rows.map(r => JSON.parse(r.data));
}

export function addMembershipToDb(m: CrownCareMembership): void {
  db.insert(membershipsTable).values({ id: m.id, customerId: m.customerId, data: JSON.stringify(m) }).run();
}

// === Seed function — only runs if database is empty ===
export function seedIfEmpty(): void {
  const count = db.select().from(customersTable).all().length;
  if (count > 0) return;

  console.log("[storage] Seeding database with initial data...");
  
  for (const c of seedCustomers) {
    db.insert(customersTable).values({ id: c.id, data: JSON.stringify(c) }).run();
  }
  for (const wo of seedWorkOrders) {
    db.insert(workOrdersTable).values({ id: wo.id, customerId: wo.customerId, data: JSON.stringify(wo) }).run();
  }
  for (const inv of seedInvoices) {
    db.insert(invoicesTable).values({ id: inv.id, customerId: inv.customerId, data: JSON.stringify(inv) }).run();
  }
  for (const q of seedQuotes) {
    db.insert(quotesTable).values({ id: q.id, customerId: q.customerId, data: JSON.stringify(q) }).run();
  }
  for (const m of seedMemberships) {
    db.insert(membershipsTable).values({ id: m.id, customerId: m.customerId, data: JSON.stringify(m) }).run();
  }
  
  console.log("[storage] Seeded successfully.");
}

export function updateWorkOrderInDb(id: string, updates: Record<string, any>): void {
  const rows = db.select().from(workOrdersTable).where(eq(workOrdersTable.id, id)).all();
  if (rows.length === 0) return;
  const existing = JSON.parse(rows[0].data);
  const updated = { ...existing, ...updates };
  db.update(workOrdersTable).set({ data: JSON.stringify(updated) }).where(eq(workOrdersTable.id, id)).run();
}

export function updateQuoteInDb(id: string, updates: Record<string, any>): void {
  const rows = db.select().from(quotesTable).where(eq(quotesTable.id, id)).all();
  if (rows.length === 0) return;
  const existing = JSON.parse(rows[0].data);
  const updated = { ...existing, ...updates };
  db.update(quotesTable).set({ data: JSON.stringify(updated) }).where(eq(quotesTable.id, id)).run();
}

// === One-time data migration: normalize warranty text on existing quotes ===
// Older seeded/persisted quotes may have inconsistent per-tier warranty
// phrasing ("10-year parts warranty", "10-year parts + 2-year labor", etc.)
// baked into their stored JSON. This patches any existing rows in place so
// the unified "10-year parts and labor warranty" text shows everywhere,
// without touching any other quote data.
export function migrateWarrantyText(): void {
  const staleVariants = [
    "10-year parts warranty",
    "10-year parts + 2-year labor warranty",
    "10-year parts + 5-year labor warranty",
    "10-year parts + 2-year labor",
    "10-year parts + 5-year labor",
  ];
  const unified = "10-year parts and labor warranty";
  const rows = db.select().from(quotesTable).all();
  let patchedCount = 0;
  for (const row of rows) {
    let changed = false;
    let quote: any;
    try {
      quote = JSON.parse(row.data);
    } catch {
      continue;
    }
    if (Array.isArray(quote.options)) {
      for (const option of quote.options) {
        if (Array.isArray(option.features)) {
          option.features = option.features.map((f: string) => {
            if (staleVariants.includes(f)) {
              changed = true;
              return unified;
            }
            return f;
          });
        }
      }
    }
    if (changed) {
      db.update(quotesTable).set({ data: JSON.stringify(quote) }).where(eq(quotesTable.id, row.id)).run();
      patchedCount++;
    }
  }
  if (patchedCount > 0) {
    console.log(`[storage] Migrated warranty text on ${patchedCount} quote(s).`);
  }
}

// Run seed and migrations on module load
seedIfEmpty();
migrateWarrantyText();
