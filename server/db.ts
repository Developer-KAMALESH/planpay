import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  // Force IPv4 to avoid IPv6 connection issues
  host: process.env.DATABASE_URL?.includes('supabase.co') 
    ? process.env.DATABASE_URL.match(/\/\/[^:]+:([^@]+)@([^:]+)/)?.[2] 
    : undefined,
  family: 4 // Force IPv4
});
export const db = drizzle(pool, { schema });
