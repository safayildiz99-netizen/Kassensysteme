import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const receipts = sqliteTable("receipts", {
  id: text("id").primaryKey(),
  barcode: text("barcode").notNull().unique(),
  receiptNumber: text("receipt_number").notNull(),
  kind: text("kind").notNull(),
  createdAt: integer("created_at").notNull(),
  data: text("data").notNull(),
});
