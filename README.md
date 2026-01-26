# PLANPAL - Smart Group Expense Coordination

**PLANPAL** is an event-scoped, Telegram-integrated group expense coordination system that focuses on human agreement and social fairness rather than payment execution. It records shared agreements about expenses and payments using consensus-based decision making.

## 🎯 Key Features

### 💰 Smart Expense Tracking
- **Text Commands**: Add expenses with `/addexpense 1200 Team dinner @alice @bob`
- **OCR Invoice Processing**: Upload photos with automatic amount extraction
- **Manual Fallback**: Guided manual entry when images are unclear
- **Consensus-Based Approval**: Majority voting for multi-participant expenses

### 📷 Advanced OCR Capabilities
- **Tesseract.js Integration**: 100% free OCR processing
- **Currency Recognition**: Supports ₹, INR, Rs. formats
- **Confidence Validation**: Automatic fallback for unclear images
- **Interactive Manual Entry**: Step-by-step guided input

### 🤖 Telegram Bot Integration
- **Group-Based**: Works within existing Telegram groups
- **Event Linking**: Connect groups to web-created events
- **Real-time Updates**: Instant notifications and confirmations
- **Comprehensive Commands**: Full expense and payment lifecycle

### 🌐 Web Application
- **Event Management**: Create and manage events
- **Dashboard**: Overview of all your events
- **Secure Authentication**: Username/password with sessions
- **Event Codes**: Easy group linking

### 💸 Payment Tracking
- **External Payments**: Records payments made outside the app
- **Confirmation System**: Both parties must confirm payments
- **Smart Settlement**: Optimal debt reduction algorithms
- **Balance Calculations**: Real-time net balance tracking

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL (or Supabase for cloud)
- Telegram Bot Token

### Local Development
1. **Clone and Install**:
   ```bash
   git clone <your-repo>
   cd planpal
   npm install
   ```

2. **Environment Setup**:
   ```bash
   cp .env.example .env
   # Edit .env with your database URL and bot token
   ```

3. **Database Setup**:
   ```bash
   npm run db:push
   ```

4. **Start Development Server**:
   ```bash
   npm run dev
   ```

5. **Access Application**:
   - Web App: http://localhost:3000
   - Bot: Message your bot on Telegram

### Free Cloud Deployment
Use the complete free hosting stack:

```bash
# Migrate to Supabase (free PostgreSQL)
npm run migrate:supabase

# Deploy preparation
npm run deploy:setup
```

Follow the detailed [DEPLOYMENT.md](./DEPLOYMENT.md) guide for:
- **Supabase** (Database) - Free 500MB
- **Render** (Backend) - Free 750 hours/month  
- **Vercel** (Frontend) - Free unlimited

## 📱 Bot Commands

### Setup Commands
- `/start <eventcode>` - Initialize bot (Private Chat)
- `/startevent <eventcode>` - Link group to event

### Expense Management
- `/addexpense <amount> <description> @mentions` - Add text expense
- **Photo Upload**: Send image with caption `/addexpense <description> @mentions`
- `/approve` - Approve pending expenses you're mentioned in
- `/reject` - Reject pending expenses you're mentioned in

### Payment Tracking
- `/paid @username <amount>` - Record payment made
- `/confirmpayment @username <amount>` - Confirm payment received

### Reports & Summaries
- `/summary` - View total confirmed expenses
- `/report` - Detailed breakdown with settlements

### Event Management
- `/closeevent` - Close event (requires all expenses resolved)
- `/help` - Show comprehensive command help

## 🏗️ Architecture

### Technology Stack
- **Frontend**: React 18 + TypeScript + Tailwind CSS
- **Backend**: Node.js + Express + TypeScript
- **Database**: PostgreSQL + Drizzle ORM
- **Bot**: node-telegram-bot-api
- **OCR**: Tesseract.js
- **Authentication**: Passport.js + Sessions

### System Components
```
┌─────────────────┐    ┌─────────────────┐
│   React Web     │    │  Telegram Bot   │
│   Application   │    │   Interface     │
└─────────┬───────┘    └─────────┬───────┘
          │                      │
          └──────────┬───────────┘
                     │
          ┌─────────────────┐
          │  Express.js API │
          │   + OCR Service │
          └─────────┬───────┘
                    │
          ┌─────────────────┐
          │   PostgreSQL    │
          │    Database     │
          └─────────────────┘
```

### Data Models
- **Users**: Authentication and Telegram linking
- **Events**: Group expense coordination sessions
- **Expenses**: Individual expense records with consensus
- **Payments**: External payment acknowledgments

## 🔧 Configuration

### Environment Variables
```env
DATABASE_URL=postgresql://user:pass@host:5432/planpal
SESSION_SECRET=your-64-character-random-string
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
NODE_ENV=development|production
```

### Bot Setup
1. Message [@BotFather](https://t.me/botfather) on Telegram
2. Create new bot with `/newbot`
3. Get your bot token
4. Add token to `.env` file

## 📊 OCR Processing

### Supported Formats
- **Currency Symbols**: ₹, INR, Rs.
- **Amount Patterns**: 1,200.50, ₹1200, INR 850
- **Invoice Types**: Restaurant bills, receipts, invoices

### Processing Flow
1. **Image Upload**: User sends photo with `/addexpense` caption
2. **OCR Analysis**: Tesseract.js extracts text and amounts
3. **Confidence Check**: Validates extraction quality
4. **Auto-Creation**: Creates expense if confidence is high
5. **Manual Fallback**: Guided input if image is unclear

### Manual Entry Workflow
```
Unclear Image → Manual Entry Prompt
              ↓
          Amount Input → Description Input → Confirmation
                                         ↓
                                   Expense Created
```

## 🧪 Testing

### Run Tests
```bash
# Type checking
npm run check

# Build verification
npm run build

# OCR functionality test
npx tsx test-ocr.js
```

### Testing Checklist
- [ ] Web app registration/login
- [ ] Event creation and code generation
- [ ] Bot linking with `/startevent`
- [ ] Text expense creation
- [ ] Photo OCR processing
- [ ] Manual fallback workflow
- [ ] Payment tracking
- [ ] Settlement calculations

## 📈 Monitoring

### Health Checks
- **Endpoint**: `GET /health`
- **Metrics**: `GET /metrics` (authenticated)
- **Performance**: OCR processing times, DB queries, bot responses

### Performance Limits
- **OCR Timeout**: 30 seconds
- **Image Size**: 5MB maximum
- **Confidence Threshold**: 60%
- **Processing History**: 100 recent operations

## 🔒 Security

### Data Protection
- **Password Hashing**: Scrypt with salt
- **Session Management**: PostgreSQL session store
- **Input Validation**: Zod schema validation
- **SQL Injection**: Parameterized queries via Drizzle ORM

### Access Control
- **Web Routes**: Authentication required for protected endpoints
- **Bot Commands**: User verification for all operations
- **Event Access**: Creator-only administrative functions

## 🚀 Deployment

### Free Hosting Stack
Total cost: **$0/month** with these limits:
- **Supabase**: 500MB database, 2GB bandwidth
- **Render**: 750 hours runtime (31 days = 744 hours)
- **Vercel**: 100GB bandwidth, unlimited deployments

### Deployment Commands
```bash
# Prepare for deployment
npm run deploy:setup

# Migrate to Supabase
npm run migrate:supabase

# Follow DEPLOYMENT.md for complete setup
```

### Production URLs
After deployment, you'll have:
- **Web App**: `https://your-project.vercel.app`
- **API**: `https://planpal-backend.onrender.com`
- **Database**: Supabase managed PostgreSQL

## 📚 Documentation

### Available Guides
- [DEPLOYMENT.md](./DEPLOYMENT.md) - Complete deployment guide
- [DEPLOYMENT_CHECKLIST.md](./DEPLOYMENT_CHECKLIST.md) - Step-by-step checklist
- [LOCAL_SETUP.md](./LOCAL_SETUP.md) - Local development setup

### API Documentation
- RESTful API with TypeScript contracts
- Zod schema validation
- Express.js middleware stack
- Session-based authentication

## 🤝 Contributing

### Development Workflow
1. Fork the repository
2. Create feature branch
3. Make changes with tests
4. Ensure TypeScript compilation
5. Submit pull request

### Code Standards
- **TypeScript**: Strict mode enabled
- **Formatting**: Consistent code style
- **Testing**: Unit tests for new features
- **Documentation**: Update README for new features

## 📄 License

MIT License - see [LICENSE](./LICENSE) file for details.

## 🆘 Support

### Common Issues
1. **Bot not responding**: Check token and webhook configuration
2. **OCR not working**: Verify image quality and size limits
3. **Database errors**: Check connection string format
4. **Build failures**: Ensure Node.js 18+ and dependencies installed

### Getting Help
- **Issues**: GitHub Issues for bug reports
- **Discussions**: GitHub Discussions for questions
- **Documentation**: Check guides in `/docs` folder

## 🎉 Success Stories

PLANPAL enables groups to:
- **Reduce friction** in expense splitting
- **Maintain transparency** with consensus-based decisions
- **Simplify settlements** with optimal debt reduction
- **Preserve trust** through neutral bot mediation
- **Save time** with OCR automation and manual fallbacks

---

**Built with ❤️ for seamless group expense coordination**

*PLANPAL - Where every expense finds consensus, and every payment finds confirmation.*