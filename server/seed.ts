import { storage } from "./storage";
import { hashPassword } from "./auth"; // I need to export hashPassword from auth.ts or re-implement it here.
// Actually, I can just use a helper here.
import { scrypt, randomBytes } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

async function hash(password: string) {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

async function seed() {
  const existingUser = await storage.getUserByUsername("demo");
  if (existingUser) {
    console.log("Database already seeded");
    return;
  }

  console.log("Seeding database...");

  const password = await hash("password");
  const user = await storage.createUser({
    username: "demo",
    password,
    telegramId: "123456",
    telegramUsername: "demouser",
  });

  const event = await storage.createEvent({
    name: "Weekend Trip to Goa",
    code: "GOA2024",
    date: new Date("2024-12-15"),
    location: "Goa, India",
    description: "Beach, Sun, and Fun!",
    creatorId: user.id,
  });

  await storage.createExpense({
    eventId: event.id,
    payerId: user.id,
    description: "Hotel Booking",
    amount: 1200000, // 12000.00
    splitAmong: ["123456"],
    votes: {},
  });

  await storage.createExpense({
    eventId: event.id,
    payerId: user.id,
    description: "Dinner at Martin's Corner",
    amount: 450000, // 4500.00
    splitAmong: ["123456"],
    votes: {},
  });

  console.log("Seeding complete!");
}

seed().catch(console.error);
