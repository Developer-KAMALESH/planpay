import { pgTable, text, serial, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// === TABLE DEFINITIONS ===

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(), // Acts as email
  password: text("password").notNull(),
  telegramId: text("telegram_id"),
  telegramUsername: text("telegram_username"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(), // Short event code
  name: text("name").notNull(),
  date: timestamp("date").notNull(),
  location: text("location"),
  description: text("description"),
  creatorId: integer("creator_id").notNull(), // Foreign key to users
  telegramGroupId: text("telegram_group_id"),
  status: text("status").default("CREATED"), // CREATED, ACTIVE
  createdAt: timestamp("created_at").defaultNow(),
});

export const expenses = pgTable("expenses", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull(),
  payerId: integer("payer_id").notNull(), // Who paid
  payerUsername: text("payer_username"), // Cache for bot/unlinked users
  description: text("description").notNull(),
  amount: integer("amount").notNull(), // Stored in cents/lowest unit
  splitAmong: jsonb("split_among").$type<string[]>(), // Array of telegram IDs or User IDs
  votes: jsonb("votes").$type<Record<string, 'agree' | 'disagree'>>(), // Map of userId/telegramId -> vote
  status: text("status").default("PENDING"), // PENDING, CONFIRMED, REJECTED
  createdAt: timestamp("created_at").defaultNow(),
});

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull(),
  fromUserId: integer("from_user_id").notNull(),
  fromUsername: text("from_username"),
  toUserId: integer("to_user_id").notNull(),
  toUsername: text("to_username"),
  amount: integer("amount").notNull(),
  status: text("status").default("PENDING"), // PENDING, CONFIRMED
  createdAt: timestamp("created_at").defaultNow(),
});

// === RELATIONS ===

export const eventsRelations = relations(events, ({ one, many }) => ({
  creator: one(users, {
    fields: [events.creatorId],
    references: [users.id],
  }),
  expenses: many(expenses),
  payments: many(payments),
}));

export const expensesRelations = relations(expenses, ({ one }) => ({
  event: one(events, {
    fields: [expenses.eventId],
    references: [events.id],
  }),
  payer: one(users, {
    fields: [expenses.payerId],
    references: [users.id],
  }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  event: one(events, {
    fields: [payments.eventId],
    references: [events.id],
  }),
  fromUser: one(users, {
    fields: [payments.fromUserId],
    references: [users.id],
    relationName: 'paymentsSent',
  }),
  toUser: one(users, {
    fields: [payments.toUserId],
    references: [users.id],
    relationName: 'paymentsReceived',
  }),
}));

// === SCHEMAS ===

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertEventSchema = createInsertSchema(events).omit({ id: true, createdAt: true, status: true, telegramGroupId: true });
export const insertExpenseSchema = createInsertSchema(expenses).omit({ id: true, createdAt: true, status: true, votes: true });
export const insertPaymentSchema = createInsertSchema(payments).omit({ id: true, createdAt: true, status: true });

// === EXPLICIT TYPES ===

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

export type Event = typeof events.$inferSelect;
export type InsertEvent = z.infer<typeof insertEventSchema>;

export type Expense = typeof expenses.$inferSelect;
export type InsertExpense = z.infer<typeof insertExpenseSchema>;

export type Payment = typeof payments.$inferSelect;
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
