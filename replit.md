# PLANPAL - Group Expense Splitting Application

## Overview

PLANPAL is a full-stack web application for managing group expenses with Telegram bot integration. The app enables consensus-based expense logging where expenses are only recorded after group agreement, eliminating disputes in group financial settlements. Users create events, add expenses through either the web dashboard or a Telegram bot, and track who owes whom with automatic balance calculations.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Build Tool**: Vite with custom configuration for Replit integration
- **Routing**: Wouter (lightweight React router)
- **State Management**: TanStack Query (React Query) for server state
- **UI Components**: shadcn/ui component library with Radix UI primitives
- **Styling**: Tailwind CSS with custom theme variables and CSS custom properties
- **Forms**: React Hook Form with Zod validation via @hookform/resolvers
- **Animations**: Framer Motion for smooth transitions

### Backend Architecture
- **Runtime**: Node.js with Express.js
- **Language**: TypeScript with ESM modules
- **Authentication**: Passport.js with local strategy (username/password)
- **Session Management**: Express-session with PostgreSQL session store (connect-pg-simple)
- **Password Hashing**: Node.js crypto module with scrypt algorithm
- **API Design**: RESTful endpoints with Zod schema validation

### Data Storage
- **Database**: PostgreSQL
- **ORM**: Drizzle ORM with drizzle-zod for schema-to-validation integration
- **Schema Location**: `shared/schema.ts` contains all table definitions
- **Migrations**: Drizzle Kit with `db:push` command for schema synchronization

### Key Data Models
- **Users**: Authentication credentials, Telegram ID linking
- **Events**: Group expense events with unique codes and Telegram group linking
- **Expenses**: Individual expenses with split tracking, voting/consensus system, and status workflow
- **Payments**: Peer-to-peer payment records with confirmation status

### Telegram Bot Integration
- **Library**: node-telegram-bot-api
- **Features**: Event linking via codes, expense logging with @mentions, consensus voting, payment recording
- **Commands**: /startevent, /addexpense, /summary, /report, /paid, /confirmpayment, /closeevent

### Code Organization
```
client/           # React frontend
  src/
    components/   # UI components (shadcn/ui)
    hooks/        # Custom React hooks (auth, events, toast)
    pages/        # Route pages (auth, dashboard, event-details)
    lib/          # Utilities (queryClient, utils)
server/           # Express backend
  auth.ts         # Passport authentication setup
  bot.ts          # Telegram bot handlers
  db.ts           # Database connection
  routes.ts       # API endpoint definitions
  storage.ts      # Data access layer interface
shared/           # Shared code between client/server
  schema.ts       # Drizzle table definitions
  routes.ts       # API contract with Zod schemas
```

### Build System
- **Development**: `npm run dev` runs tsx for hot-reload TypeScript execution
- **Production Build**: Custom esbuild script bundles server, Vite builds client
- **Type Checking**: `npm run check` runs TypeScript compiler

## External Dependencies

### Database
- **PostgreSQL**: Primary data store, connection via DATABASE_URL environment variable
- **connect-pg-simple**: Session storage in PostgreSQL

### Telegram Integration
- **Telegram Bot API**: Requires TELEGRAM_BOT_TOKEN environment variable
- **Polling Mode**: Bot uses long-polling for message updates

### Environment Variables Required
- `DATABASE_URL`: PostgreSQL connection string
- `SESSION_SECRET`: Express session secret (defaults to "r3pl1t" in development)
- `TELEGRAM_BOT_TOKEN`: Optional, enables Telegram bot features

### Key NPM Packages
- drizzle-orm / drizzle-kit: Database ORM and migrations
- @tanstack/react-query: Server state management
- passport / passport-local: Authentication
- node-telegram-bot-api: Telegram bot functionality
- zod: Runtime type validation
- date-fns: Date formatting utilities