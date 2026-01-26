-- Create users table
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  telegram_id TEXT,
  telegram_username TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create events table
CREATE TABLE events (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  date TIMESTAMP NOT NULL,
  location TEXT,
  description TEXT,
  creator_id INTEGER NOT NULL,
  telegram_group_id TEXT,
  status TEXT DEFAULT 'CREATED',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create expenses table
CREATE TABLE expenses (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL,
  payer_id INTEGER NOT NULL,
  payer_username TEXT,
  description TEXT NOT NULL,
  amount INTEGER NOT NULL,
  split_among JSONB,
  votes JSONB,
  status TEXT DEFAULT 'PENDING',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Create payments table
CREATE TABLE payments (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL,
  from_user_id INTEGER NOT NULL,
  from_username TEXT,
  to_user_id INTEGER NOT NULL,
  to_username TEXT,
  amount INTEGER NOT NULL,
  status TEXT DEFAULT 'PENDING',
  created_at TIMESTAMP DEFAULT NOW()
);