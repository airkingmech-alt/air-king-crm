import { sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import type * as z from "zod/mini";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// === CRM Tables ===
// Complex entities stored as JSON blobs with key columns for querying

export const customersTable = sqliteTable("customers", {
  id: text("id").primaryKey(),
  data: text("data").notNull(),
});

export const customerNotesTable = sqliteTable("customer_notes", {
  id: text("id").primaryKey(),
  customerId: text("customer_id").notNull(),
  text: text("text").notNull(),
  author: text("author").notNull(),
  date: text("date").notNull(),
});

export const customerPhotosTable = sqliteTable("customer_photos", {
  id: text("id").primaryKey(),
  customerId: text("customer_id").notNull(),
  dataUrl: text("data_url").notNull(),
  fileName: text("file_name").notNull(),
  uploadedAt: text("uploaded_at").notNull(),
  analysis: text("analysis"),
});

export const workOrdersTable = sqliteTable("work_orders", {
  id: text("id").primaryKey(),
  customerId: text("customer_id").notNull(),
  data: text("data").notNull(),
});

export const invoicesTable = sqliteTable("invoices", {
  id: text("id").primaryKey(),
  customerId: text("customer_id").notNull(),
  data: text("data").notNull(),
});

export const quotesTable = sqliteTable("quotes", {
  id: text("id").primaryKey(),
  customerId: text("customer_id").notNull(),
  data: text("data").notNull(),
});

export const membershipsTable = sqliteTable("memberships", {
  id: text("id").primaryKey(),
  customerId: text("customer_id").notNull(),
  data: text("data").notNull(),
});
