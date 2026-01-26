# PLANPAL - Free Hosting Deployment Guide

## Overview
This guide will help you deploy PLANPAL to completely free hosting services:
- **Database**: Supabase (Free PostgreSQL - 500MB)
- **Backend**: Render (Free - 750 hours/month)
- **Frontend**: Vercel (Free - Unlimited)

## Prerequisites
- GitHub account
- Supabase account
- Render account  
- Vercel account

## Step 1: Database Setup (Supabase)

### 1.1 Create Supabase Project
1. Go to [supabase.com](https://supabase.com)
2. Click "Start your project" and sign up/login
3. Click "New Project"
4. Choose your organization
5. Fill in project details:
   - **Name**: planpal-db
   - **Database Password**: Create a strong password (save this!)
   - **Region**: Choose closest to your users
6. Click "Create new project"
7. Wait for project setup (2-3 minutes)

### 1.2 Get Database Connection String
1. In your Supabase dashboard, go to **Settings** → **Database**
2. Scroll down to **Connection string**
3. Select **URI** tab
4. Copy the connection string (looks like):
   ```
   postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
   ```
5. Replace `[YOUR-PASSWORD]` with your actual database password

### 1.3 Set Up Database Schema
1. Update your local `.env` file:
   ```env
   DATABASE_URL=your_supabase_connection_string_here
   SESSION_SECRET=your_session_secret
   TELEGRAM_BOT_TOKEN=your_bot_token
   ```

2. Push the schema to Supabase:
   ```bash
   npm run db:push
   ```

3. Verify the tables were created:
   - Go to Supabase Dashboard → **Table Editor**
   - You should see: `users`, `events`, `expenses`, `payments` tables

## Step 2: Backend Deployment (Render)

### 2.1 Prepare Code for Deployment
1. **Push to GitHub** (if not already done):
   ```bash
   git init
   git add .
   git commit -m "Initial PLANPAL commit with OCR features"
   git branch -M main
   git remote add origin https://github.com/yourusername/planpal.git
   git push -u origin main
   ```

### 2.2 Deploy to Render
1. Go to [render.com](https://render.com) and sign up/login
2. Click "New +" → "Web Service"
3. Connect your GitHub account and select your PLANPAL repository
4. Configure the service:
   - **Name**: `planpal-backend`
   - **Environment**: `Node`
   - **Region**: Choose closest to your users
   - **Branch**: `main`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Plan**: `Free`

### 2.3 Set Environment Variables in Render
1. In the Render dashboard, go to your service
2. Click **Environment** tab
3. Add these environment variables:
   ```
   NODE_ENV=production
   DATABASE_URL=your_supabase_connection_string
   SESSION_SECRET=generate_random_64_char_string
   TELEGRAM_BOT_TOKEN=your_telegram_bot_token
   ```

4. Click **Save Changes**
5. Your service will automatically redeploy

### 2.4 Get Your Render URL
- After deployment, your backend will be available at:
  `https://planpal-backend.onrender.com`
- Save this URL for the next step

## Step 3: Frontend Deployment (Vercel)

### 3.1 Update API Configuration
1. Update `vercel.json` with your actual Render URL:
   ```json
   {
     "version": 2,
     "builds": [
       {
         "src": "client/index.html",
         "use": "@vercel/static-build",
         "config": {
           "distDir": "dist"
         }
       }
     ],
     "routes": [
       {
         "src": "/api/(.*)",
         "dest": "https://your-actual-render-url.onrender.com/api/$1"
       },
       {
         "src": "/(.*)",
         "dest": "/client/index.html"
       }
     ]
   }
   ```

### 3.2 Deploy to Vercel
1. Go to [vercel.com](https://vercel.com) and sign up/login
2. Click "New Project"
3. Import your GitHub repository
4. Configure the project:
   - **Framework Preset**: Vite
   - **Root Directory**: `./` (leave default)
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
5. Click "Deploy"

### 3.3 Get Your Vercel URL
- After deployment, your frontend will be available at:
  `https://your-project-name.vercel.app`

## Step 4: Telegram Bot Configuration

### 4.1 Update Bot Webhook (Optional)
If you want to use webhooks instead of polling:

1. **Set webhook URL**:
   ```bash
   curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \
        -H "Content-Type: application/json" \
        -d '{"url": "https://your-render-url.onrender.com/api/telegram/webhook"}'
   ```

2. **Verify webhook**:
   ```bash
   curl "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getWebhookInfo"
   ```

### 4.2 Test Bot Commands
1. Find your bot on Telegram
2. Send `/help` to see all available commands
3. Test basic functionality:
   - `/start` - Should show help
   - Create an event on your web app
   - Use `/startevent <code>` in a group
   - Try `/addexpense 100 Test expense @someone`
   - Upload a photo with `/addexpense Test @someone` in caption

## Step 5: Complete Testing

### 5.1 Test Web Application
1. Visit your Vercel URL
2. Register a new account
3. Create an event
4. Note the event code

### 5.2 Test Telegram Integration
1. Add your bot to a Telegram group
2. Use `/startevent <your-event-code>`
3. Test expense creation with text and photos
4. Test manual fallback by uploading unclear images

### 5.3 Test OCR Features
1. Upload a clear invoice photo with caption: `/addexpense Lunch @friend`
2. Upload an unclear image to test manual fallback
3. Verify the conversation flow works correctly

## Free Tier Limitations & Monitoring

### Supabase (Free Tier)
- **Database**: 500MB storage
- **Bandwidth**: 2GB/month
- **API Requests**: 50,000/month
- **Auth Users**: 50,000 MAU
- **File Storage**: 1GB
- **Realtime**: 200 concurrent connections

### Render (Free Tier)
- **Runtime**: 750 hours/month (31 days = 744 hours)
- **Memory**: 512MB RAM
- **CPU**: Shared
- **Sleep**: After 15 minutes of inactivity
- **Build Time**: 500 minutes/month

### Vercel (Free Tier)
- **Bandwidth**: 100GB/month
- **Serverless Functions**: 1000 invocations/day
- **Build Time**: 6000 minutes/month
- **Team Members**: 1 (just you)

## Monitoring & Maintenance

### 1. Set Up Monitoring
- **Render**: Check service logs in dashboard
- **Supabase**: Monitor database usage in dashboard
- **Vercel**: Check function logs and analytics

### 2. Usage Optimization
- **Database**: Use efficient queries, add indexes for performance
- **Backend**: Implement caching for frequently accessed data
- **OCR**: Optimize image processing to reduce CPU usage

### 3. Scaling Preparation
When you outgrow free tiers:
- **Supabase Pro**: $25/month (8GB storage, 250GB bandwidth)
- **Render Starter**: $7/month (no sleep, 1GB RAM)
- **Vercel Pro**: $20/month (higher limits, team features)

## Troubleshooting

### Common Issues

1. **Database Connection Errors**
   - Verify Supabase connection string format
   - Check if database password contains special characters (URL encode them)
   - Ensure database is not paused (free tier auto-pauses after 1 week inactivity)

2. **Render Service Not Starting**
   - Check build logs for errors
   - Verify all environment variables are set
   - Ensure Node.js version compatibility

3. **Telegram Bot Not Responding**
   - Verify bot token is correct
   - Check if webhook URL is accessible
   - Look for errors in Render service logs

4. **OCR Not Working**
   - Check if Tesseract.js is properly installed
   - Verify image download from Telegram works
   - Monitor memory usage (OCR is memory-intensive)

5. **Frontend API Calls Failing**
   - Verify Render backend URL in vercel.json
   - Check CORS configuration
   - Ensure API routes are correctly proxied

### Getting Help
- **Supabase**: [docs.supabase.com](https://docs.supabase.com)
- **Render**: [render.com/docs](https://render.com/docs)
- **Vercel**: [vercel.com/docs](https://vercel.com/docs)
- **Telegram Bot API**: [core.telegram.org/bots/api](https://core.telegram.org/bots/api)

## Success Checklist

✅ **Database Setup**
- [ ] Supabase project created
- [ ] Database schema deployed
- [ ] Connection string working

✅ **Backend Deployment**
- [ ] Code pushed to GitHub
- [ ] Render service deployed
- [ ] Environment variables configured
- [ ] Service responding to health checks

✅ **Frontend Deployment**
- [ ] Vercel project deployed
- [ ] API routes properly proxied
- [ ] Web app accessible and functional

✅ **Telegram Integration**
- [ ] Bot responding to commands
- [ ] Event linking working
- [ ] Expense creation functional
- [ ] OCR processing working
- [ ] Manual fallback tested

✅ **End-to-End Testing**
- [ ] User registration/login works
- [ ] Event creation works
- [ ] Telegram bot integration works
- [ ] Photo OCR processing works
- [ ] Manual entry fallback works
- [ ] Payment tracking works
- [ ] Reports and summaries work

Your PLANPAL application is now running on completely free hosting! 🚀

## Production URLs
- **Web App**: `https://your-project.vercel.app`
- **API Backend**: `https://planpal-backend.onrender.com`
- **Database**: Supabase (managed)
- **Bot**: @YourBotName on Telegram