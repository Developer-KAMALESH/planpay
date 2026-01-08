import { db } from "./db";
import { eq } from "drizzle-orm";
import {
  users, events, expenses, payments,
  type User, type InsertUser,
  type Event, type InsertEvent,
  type Expense, type InsertExpense,
  type Payment, type InsertPayment
} from "@shared/schema";
import session from "express-session";
import connectPg from "connect-pg-simple";
import { pool } from "./db";

const PostgresSessionStore = connectPg(session);

export interface IStorage {
  // User & Auth
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Telegram User Mapping
  getUserByTelegramId(telegramId: string): Promise<User | undefined>;
  linkUserTelegram(userId: number, telegramId: string, telegramUsername?: string): Promise<void>;

  // Events
  createEvent(event: InsertEvent): Promise<Event>;
  getEvent(id: number): Promise<Event | undefined>;
  getEventByCode(code: string): Promise<Event | undefined>;
  getEventByTelegramGroupId(groupId: string): Promise<Event | undefined>;
  getEventsForUser(userId: number): Promise<Event[]>; // Created by user
  updateEventTelegramGroup(eventId: number, groupId: string): Promise<void>;
  updateEventStatus(eventId: number, status: string): Promise<void>;

  // Expenses
  createExpense(expense: InsertExpense): Promise<Expense>;
  getExpense(id: number): Promise<Expense | undefined>;
  getExpensesForEvent(eventId: number): Promise<Expense[]>;
  updateExpenseVotes(expenseId: number, votes: Record<string, 'agree' | 'disagree'>): Promise<void>;
  updateExpenseStatus(expenseId: number, status: string): Promise<void>;

  // Payments
  createPayment(payment: InsertPayment): Promise<Payment>;
  getPayment(id: number): Promise<Payment | undefined>;
  getPaymentsForEvent(eventId: number): Promise<Payment[]>;
  updatePaymentStatus(paymentId: number, status: string): Promise<void>;
  
  sessionStore: session.Store;
}

export class DatabaseStorage implements IStorage {
  sessionStore: session.Store;

  constructor() {
    this.sessionStore = new PostgresSessionStore({
      pool,
      createTableIfMissing: true,
    });
  }

  // User
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async getUserByTelegramId(telegramId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.telegramId, telegramId));
    return user;
  }

  async linkUserTelegram(userId: number, telegramId: string, telegramUsername?: string): Promise<void> {
    await db.update(users)
      .set({ telegramId, telegramUsername })
      .where(eq(users.id, userId));
  }

  // Event
  async createEvent(event: InsertEvent): Promise<Event> {
    const [newEvent] = await db.insert(events).values(event).returning();
    return newEvent;
  }

  async getEvent(id: number): Promise<Event | undefined> {
    const [event] = await db.select().from(events).where(eq(events.id, id));
    return event;
  }

  async getEventByCode(code: string): Promise<Event | undefined> {
    const [event] = await db.select().from(events).where(eq(events.code, code));
    return event;
  }

  async getEventByTelegramGroupId(groupId: string): Promise<Event | undefined> {
    const [event] = await db.select().from(events).where(eq(events.telegramGroupId, groupId));
    return event;
  }

  async getEventsForUser(userId: number): Promise<Event[]> {
    return db.select().from(events).where(eq(events.creatorId, userId));
  }

  async updateEventTelegramGroup(eventId: number, groupId: string): Promise<void> {
    await db.update(events)
      .set({ telegramGroupId: groupId, status: 'ACTIVE' })
      .where(eq(events.id, eventId));
  }

  async updateEventStatus(eventId: number, status: string): Promise<void> {
    await db.update(events)
      .set({ status })
      .where(eq(events.id, eventId));
  }

  // Expense
  async createExpense(expense: InsertExpense): Promise<Expense> {
    const [newExpense] = await db.insert(expenses).values(expense).returning();
    return newExpense;
  }

  async getExpense(id: number): Promise<Expense | undefined> {
    const [expense] = await db.select().from(expenses).where(eq(expenses.id, id));
    return expense;
  }

  async getExpensesForEvent(eventId: number): Promise<Expense[]> {
    return db.select().from(expenses).where(eq(expenses.eventId, eventId));
  }

  async updateExpenseVotes(expenseId: number, votes: Record<string, 'agree' | 'disagree'>): Promise<void> {
    await db.update(expenses)
      .set({ votes })
      .where(eq(expenses.id, expenseId));
  }

  async updateExpenseStatus(expenseId: number, status: string): Promise<void> {
    await db.update(expenses)
      .set({ status })
      .where(eq(expenses.id, expenseId));
  }

  // Payment
  async createPayment(payment: InsertPayment): Promise<Payment> {
    const [newPayment] = await db.insert(payments).values(payment).returning();
    return newPayment;
  }

  async getPayment(id: number): Promise<Payment | undefined> {
    const [payment] = await db.select().from(payments).where(eq(payments.id, id));
    return payment;
  }

  async getPaymentsForEvent(eventId: number): Promise<Payment[]> {
    return db.select().from(payments).where(eq(payments.eventId, eventId));
  }

  async updatePaymentStatus(paymentId: number, status: string): Promise<void> {
    await db.update(payments)
      .set({ status })
      .where(eq(payments.id, paymentId));
  }
  async updateEvent(id: number, data: Partial<InsertEvent>): Promise<Event> {
    const [updated] = await db.update(events).set(data).where(eq(events.id, id)).returning();
    return updated;
  }

  async deleteEvent(id: number): Promise<void> {
    await db.delete(events).where(eq(events.id, id));
  }
}

export const storage = new DatabaseStorage();
