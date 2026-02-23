# PlanPAY - System Architecture

## Overview
PlanPAY is a full-stack expense splitting application with dual interfaces: a web application and a Telegram bot. The system enables users to create events, add expenses, split costs among participants, and manage settlements.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                                   USERS                                         │
├─────────────────────────────────┬───────────────────────────────────────────────┤
│          Web Users              │              Telegram Users                   │
│     (Browser Interface)         │           (Telegram Groups)                   │
└─────────────────┬───────────────┴───────────────────┬───────────────────────────┘
                  │                                   │
                  │ HTTPS/REST API                    │ Telegram Bot API
                  │                                   │
┌─────────────────▼───────────────────────────────────▼───────────────────────────┐
│                          RENDER.COM HOSTING                                    │
│  ┌─────────────────────────────────────────────────────────────────────────┐   │
│  │                     EXPRESS.JS SERVER                                   │   │
│  │                                                                         │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────┐  │   │
│  │  │   STATIC FILES  │  │   API ROUTES    │  │    TELEGRAM BOT         │  │   │
│  │  │                 │  │                 │  │                         │  │   │
│  │  │ • React App     │  │ • Authentication│  │ • Message Handling      │  │   │
│  │  │ • HTML/CSS/JS   │  │ • Events CRUD   │  │ • OCR Processing        │  │   │
│  │  │ • Built Assets  │  │ • Expenses CRUD │  │ • Expense Creation      │  │   │
│  │  │                 │  │ • Payments CRUD │  │ • Voting System         │  │   │
│  │  └─────────────────┘  │ • Health Check  │  │ • Settlement Reports    │  │   │
│  │                       └─────────────────┘  └─────────────────────────┘  │   │
│  │                                                                         │   │
│  │  ┌─────────────────────────────────────────────────────────────────────┐  │   │
│  │  │                    MIDDLEWARE LAYER                                 │  │   │
│  │  │                                                                     │  │   │
│  │  │ • Express Session Management                                        │  │   │
│  │  │ • Passport.js Authentication                                        │  │   │
│  │  │ • CORS Configuration                                                │  │   │
│  │  │ • Request Logging                                                   │  │   │
│  │  │ • Error Handling                                                    │  │   │
│  │  └─────────────────────────────────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────┬───────────────────────────────────────────────┘
                                  │
                                  │ PostgreSQL Connection
                                  │
┌─────────────────────────────────▼───────────────────────────────────────────────┐
│                            SUPABASE DATABASE                                   │
│                                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐   │
│  │    USERS    │  │   EVENTS    │  │  EXPENSES   │  │      PAYMENTS       │   │
│  │             │  │             │  │             │  │                     │   │
│  │ • id        │  │ • id        │  │ • id        │  │ • id                │   │
│  │ • username  │  │ • code      │  │ • event_id  │  │ • event_id          │   │
│  │ • password  │  │ • name      │  │ • payer_id  │  │ • from_user_id      │   │
│  │ • telegram_id│  │ • date      │  │ • amount    │  │ • to_user_id        │   │
│  │ • created_at│  │ • location  │  │ • description│  │ • amount            │   │
│  └─────────────┘  │ • creator_id│  │ • split_among│  │ • status            │   │
│                   │ • telegram_ │  │ • votes     │  │ • created_at        │   │
│                   │   group_id  │  │ • status    │  └─────────────────────┘   │
│                   │ • status    │  │ • created_at│                            │
│                   │ • created_at│  └─────────────┘                            │
│                   └─────────────┘                                             │
└─────────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────────┐
│                           EXTERNAL SERVICES                                    │
├─────────────────────────────────┬───────────────────────────────────────────────┤
│        TELEGRAM BOT API         │              TESSERACT.JS                    │
│                                 │                                               │
│ • Bot Token Authentication      │ • OCR Text Recognition                        │
│ • Message Polling               │ • Invoice Processing                          │
│ • File Download (Images)        │ • Amount Detection                            │
│ • Message Sending               │ • Description Extraction                      │
│ • Inline Keyboards              │ • Multiple Format Support                     │
└─────────────────────────────────┴───────────────────────────────────────────────┘
```

## Component Details

### Frontend (React + TypeScript)
- **Framework**: React 18 with TypeScript
- **Styling**: Tailwind CSS + Shadcn/ui components
- **State Management**: TanStack Query for server state
- **Routing**: Wouter for client-side routing
- **Build Tool**: Vite for fast development and optimized builds

### Backend (Express.js + TypeScript)
- **Framework**: Express.js with TypeScript
- **Authentication**: Passport.js with local strategy
- **Session Management**: Express-session with memory store
- **Database ORM**: Drizzle ORM for type-safe database operations
- **File Processing**: Tesseract.js for OCR functionality

### Database (PostgreSQL via Supabase)
- **Provider**: Supabase (managed PostgreSQL)
- **Connection**: Direct connection with connection pooling
- **Schema**: Four main tables (users, events, expenses, payments)
- **Features**: JSONB support for complex data structures

### Telegram Integration
- **Library**: node-telegram-bot-api
- **Features**: 
  - Message handling and command processing
  - Image/document processing for invoices
  - Inline voting system for expense approval
  - Real-time expense splitting and settlement

### Hosting & Deployment
- **Platform**: Render.com (free tier)
- **Build Process**: Automated via GitHub integration
- **Environment**: Production environment with environment variables
- **SSL**: Automatic HTTPS via Render.com

## Data Flow

### Web Application Flow
1. User accesses web app via browser
2. React app loads and authenticates via API
3. User creates events, adds expenses through REST API
4. Data persisted to Supabase PostgreSQL database
5. Real-time updates via API polling

### Telegram Bot Flow
1. User sends message/image to Telegram group
2. Bot receives webhook/polling update
3. OCR processes invoice images (if applicable)
4. Bot creates expense records in database
5. Participants vote on expense approval
6. Settlement calculations and reports generated

### OCR Processing Flow
1. User uploads invoice image via Telegram
2. Bot downloads image file
3. Tesseract.js processes image for text extraction
4. Smart parsing extracts amount and description
5. Multiple amount options presented to user
6. Manual fallback for unclear images

## Security Features
- Password hashing with scrypt
- Session-based authentication
- CORS protection
- Input validation with Zod schemas
- SQL injection prevention via ORM
- Environment variable protection

## Scalability Considerations
- Stateless server design
- Database connection pooling
- Efficient query patterns with Drizzle ORM
- Optimized build assets with code splitting
- Memory-based sessions (suitable for single instance)

## Monitoring & Logging
- Request/response logging
- Error tracking and handling
- Health check endpoints
- Performance monitoring
- Bot polling error handling