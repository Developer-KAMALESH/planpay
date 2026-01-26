import type { Express } from "express";
import { createServer, type Server } from "http";
import { setupAuth } from "./auth";
import { storage } from "./storage";
import { setupTelegramBot } from "./bot";
import { monitoring } from "./monitoring.js";
import { api } from "@shared/routes";
import { z } from "zod";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Setup Auth
  setupAuth(app);

  // Setup Telegram Bot
  setupTelegramBot();

  // API Routes
  
  // Root test endpoint
  app.get('/', (req, res) => {
    res.json({ 
      message: 'PlanPal API is running!', 
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV 
    });
  });
  
  // Health check endpoint
  app.get('/health', (req, res) => {
    const health = monitoring.getHealthStatus();
    res.status(health.status === 'healthy' ? 200 : health.status === 'warning' ? 200 : 503).json({
      status: health.status,
      details: health.details,
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  });

  // Metrics endpoint (for debugging)
  app.get('/metrics', (req, res) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({ message: 'Unauthorized' });
    }
    res.json({
      summary: monitoring.getMetricsSummary(),
      health: monitoring.getHealthStatus()
    });
  });
  // Events
  app.get(api.events.list.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const events = await storage.getEventsForUser(req.user.id);
    res.json(events);
  });

  app.post(api.events.create.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
      const input = api.events.create.input.parse(req.body);
      // Generate a simple code if not provided (though schema says required, frontend might generate or backend should)
      // Since schema defines it, we expect it in body or we generate it here.
      // Let's assume frontend might send it, or we generate it. 
      // The schema in shared/schema.ts says 'code' is required.
      // Let's ensure creatorId is set to current user.
      const eventData = { ...input, creatorId: req.user.id };
      const event = await storage.createEvent(eventData);
      res.status(201).json(event);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({ message: err.errors[0].message });
      } else {
        res.status(500).json({ message: "Internal Server Error" });
      }
    }
  });

  app.get(api.events.get.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const event = await storage.getEvent(Number(req.params.id));
    if (!event) return res.status(404).json({ message: "Event not found" });

    // Fetch details
    const expenses = await storage.getExpensesForEvent(event.id);
    const payments = await storage.getPaymentsForEvent(event.id);

    // Attach user info to expenses
    const expensesWithUsers = await Promise.all(expenses.map(async (e) => {
      const user = await storage.getUser(e.payerId);
      return { ...e, payerUsername: user?.username || 'Unknown' };
    }));

    res.json({ ...event, expenses: expensesWithUsers, payments });
  });

  // Expenses
  app.post(api.expenses.create.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    try {
        const input = api.expenses.create.input.parse(req.body);
        const eventId = Number(req.params.eventId);
        const expense = await storage.createExpense({ 
            ...input, 
            eventId, 
            payerId: req.user.id,
            payerUsername: req.user.username 
        });
        res.status(201).json(expense);
    } catch (err) {
        res.status(400).json({ message: "Invalid Input" });
    }
  });

  app.get(api.expenses.list.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const expenses = await storage.getExpensesForEvent(Number(req.params.eventId));
    res.json(expenses);
  });

  app.patch(api.events.get.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const event = await storage.getEvent(Number(req.params.id));
    if (!event) return res.status(404).json({ message: "Event not found" });
    if (event.telegramGroupId) return res.status(403).json({ message: "Cannot edit active events" });
    
    const input = api.events.create.input.partial().parse(req.body);
    const updated = await storage.updateEvent(event.id, input);
    res.json(updated);
  });

  app.delete(api.events.get.path, async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const event = await storage.getEvent(Number(req.params.id));
    if (!event) return res.status(404).json({ message: "Event not found" });
    if (event.telegramGroupId) return res.status(403).json({ message: "Cannot delete active events" });
    
    await storage.deleteEvent(event.id);
    res.sendStatus(204);
  });

  return httpServer;
}
