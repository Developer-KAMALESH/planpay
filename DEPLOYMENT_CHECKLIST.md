# PLANPAL Deployment Checklist

## Pre-Deployment Checklist

### ✅ Code Preparation
- [ ] All features implemented and tested locally
- [ ] TypeScript compilation successful (`npm run check`)
- [ ] Build process working (`npm run build`)
- [ ] Environment variables documented
- [ ] Git repository up to date

### ✅ Database Setup
- [ ] Supabase project created
- [ ] Database password saved securely
- [ ] Connection string obtained
- [ ] Schema deployed (`npm run db:push`)
- [ ] Tables visible in Supabase dashboard

### ✅ Telegram Bot Setup
- [ ] Bot created via @BotFather
- [ ] Bot token obtained and secured
- [ ] Bot commands configured
- [ ] Bot tested locally

## Deployment Steps

### 1. Database Migration (Supabase)
- [ ] Run migration script: `npm run migrate:supabase`
- [ ] Verify tables created in Supabase dashboard
- [ ] Test connection with new DATABASE_URL
- [ ] Backup old database if migrating existing data

### 2. Backend Deployment (Render)
- [ ] Code pushed to GitHub
- [ ] Render account created
- [ ] Web service created and configured
- [ ] Environment variables set:
  - [ ] `NODE_ENV=production`
  - [ ] `DATABASE_URL` (Supabase connection string)
  - [ ] `SESSION_SECRET` (64-character random string)
  - [ ] `TELEGRAM_BOT_TOKEN`
- [ ] Service deployed successfully
- [ ] Health check endpoint responding
- [ ] Logs showing no errors

### 3. Frontend Deployment (Vercel)
- [ ] Vercel account created
- [ ] Project imported from GitHub
- [ ] Build configuration verified
- [ ] `vercel.json` updated with correct Render URL
- [ ] Deployment successful
- [ ] Website accessible

### 4. Integration Testing
- [ ] Web app loads correctly
- [ ] User registration/login works
- [ ] Event creation works
- [ ] Event code generation works
- [ ] Telegram bot responds to `/help`
- [ ] Bot linking works (`/startevent <code>`)
- [ ] Text expense creation works
- [ ] Photo OCR processing works
- [ ] Manual fallback works for unclear images
- [ ] Payment tracking works
- [ ] Reports and summaries work

## Post-Deployment Verification

### ✅ Functional Testing
- [ ] Create test user account
- [ ] Create test event
- [ ] Link bot to test group
- [ ] Test all bot commands:
  - [ ] `/start`
  - [ ] `/help`
  - [ ] `/startevent <code>`
  - [ ] `/addexpense 100 Test @user`
  - [ ] Photo with `/addexpense Test @user`
  - [ ] `/paid @user 50`
  - [ ] `/confirmpayment @user 50`
  - [ ] `/summary`
  - [ ] `/report`
  - [ ] `/closeevent`

### ✅ OCR Testing
- [ ] Upload clear invoice image
- [ ] Verify automatic amount extraction
- [ ] Upload unclear/blurry image
- [ ] Verify manual fallback triggers
- [ ] Complete manual entry workflow
- [ ] Verify expense created correctly

### ✅ Performance Testing
- [ ] Web app loads in <3 seconds
- [ ] Bot responds in <5 seconds
- [ ] OCR processing completes in <30 seconds
- [ ] Database queries perform well
- [ ] No memory leaks in long-running processes

### ✅ Error Handling Testing
- [ ] Invalid bot commands handled gracefully
- [ ] Network errors handled properly
- [ ] Database connection failures handled
- [ ] OCR processing errors handled
- [ ] Manual entry cancellation works

## Monitoring Setup

### ✅ Service Monitoring
- [ ] Render service health monitoring enabled
- [ ] Vercel deployment notifications configured
- [ ] Supabase usage monitoring set up
- [ ] Error logging configured

### ✅ Usage Tracking
- [ ] Monitor Supabase database usage
- [ ] Track Render service uptime
- [ ] Monitor Vercel bandwidth usage
- [ ] Track Telegram bot API usage

## Documentation Updates

### ✅ User Documentation
- [ ] README updated with deployment URLs
- [ ] User guide created/updated
- [ ] Bot command reference updated
- [ ] Troubleshooting guide created

### ✅ Technical Documentation
- [ ] API documentation updated
- [ ] Database schema documented
- [ ] Environment variables documented
- [ ] Deployment process documented

## Security Checklist

### ✅ Secrets Management
- [ ] All API keys stored securely
- [ ] Database credentials not exposed
- [ ] Session secrets are random and secure
- [ ] Environment variables not committed to git

### ✅ Access Control
- [ ] Database access restricted to application
- [ ] API endpoints properly authenticated
- [ ] Bot token permissions minimized
- [ ] Admin functions protected

## Backup & Recovery

### ✅ Data Backup
- [ ] Database backup strategy defined
- [ ] Regular backup schedule configured
- [ ] Backup restoration tested
- [ ] Critical data identified and protected

### ✅ Disaster Recovery
- [ ] Recovery procedures documented
- [ ] Alternative hosting options identified
- [ ] Data export procedures tested
- [ ] Service restoration time estimated

## Production URLs

After successful deployment, document your production URLs:

- **Web Application**: `https://your-project.vercel.app`
- **API Backend**: `https://planpal-backend.onrender.com`
- **Database**: Supabase (managed service)
- **Bot Username**: `@YourBotName`

## Support Information

### Service Dashboards
- **Supabase**: https://app.supabase.com/projects
- **Render**: https://dashboard.render.com/
- **Vercel**: https://vercel.com/dashboard
- **Telegram Bot**: https://t.me/BotFather

### Monitoring Commands
```bash
# Check service health
curl https://planpal-backend.onrender.com/health

# Check database connection
npm run db:push --dry-run

# Test bot webhook
curl https://api.telegram.org/bot<TOKEN>/getWebhookInfo
```

## Troubleshooting Quick Reference

### Common Issues
1. **Service won't start**: Check environment variables and logs
2. **Database connection failed**: Verify Supabase connection string
3. **Bot not responding**: Check token and webhook configuration
4. **OCR not working**: Verify Tesseract.js installation and memory limits
5. **Frontend API errors**: Check Render backend URL in vercel.json

### Emergency Contacts
- **Technical Issues**: Check service status pages
- **Database Issues**: Supabase support
- **Hosting Issues**: Render/Vercel support
- **Bot Issues**: Telegram Bot API documentation

---

**Deployment Date**: ___________
**Deployed By**: ___________
**Version**: ___________
**Notes**: ___________