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
  getEventsForUser(userId: number): Promise<Event[]>; // Created by user
  updateEventTelegramGroup(eventId: number, groupId: string): Promise<void>;
  updateEventStatus(eventId: number, status: string): Promise<void>;

  // Expenses
  createExpense(expense: InsertExpense): Promise<Expense>;
  getExpensesForEvent(eventId: number): Promise<Expense[]>;

  // Payments
  createPayment(payment: InsertPayment): Promise<Payment>;
  getPaymentsForEvent(eventId: number): Promise<Payment[]>;
  
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

  async getExpensesForEvent(eventId: number): Promise<Expense[]> {
    return db.select().from(expenses).where(eq(expenses.eventId, eventId));
  }

  // Payment
  async createPayment(payment: InsertPayment): Promise<Payment> {
    const [newPayment] = await db.insert(payments).values(payment).returning();
    return newPayment;
  }

  async getPaymentsForEvent(eventId: number): Promise<Payment[]> {
    return db.select().from(payments).where(eq(payments.eventId, eventId));
  }
}

export const storage = new DatabaseStorage();
