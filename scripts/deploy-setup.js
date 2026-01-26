#!/usr/bin/env node

/**
 * PLANPAL Deployment Setup Script
 * Helps prepare the application for free hosting deployment
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

console.log('🚀 PLANPAL Deployment Setup\n');

// Check if we're in the right directory
try {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
  if (packageJson.name !== 'rest-express') {
    console.error('❌ Please run this script from the PLANPAL root directory');
    process.exit(1);
  }
} catch (error) {
  console.error('❌ package.json not found. Are you in the right directory?');
  process.exit(1);
}

console.log('✅ Found PLANPAL project');

// Check Node.js version
const nodeVersion = process.version;
console.log(`📦 Node.js version: ${nodeVersion}`);

if (parseInt(nodeVersion.slice(1)) < 18) {
  console.warn('⚠️  Node.js 18+ recommended for deployment');
}

// Check if git is initialized
try {
  execSync('git status', { stdio: 'ignore' });
  console.log('✅ Git repository found');
} catch (error) {
  console.log('📝 Initializing git repository...');
  execSync('git init');
  console.log('✅ Git repository initialized');
}

// Check for .env file
try {
  const envContent = readFileSync('.env', 'utf8');
  console.log('✅ Environment file found');
  
  // Check for required variables
  const requiredVars = ['DATABASE_URL', 'SESSION_SECRET', 'TELEGRAM_BOT_TOKEN'];
  const missingVars = requiredVars.filter(varName => !envContent.includes(varName));
  
  if (missingVars.length > 0) {
    console.warn(`⚠️  Missing environment variables: ${missingVars.join(', ')}`);
  } else {
    console.log('✅ All required environment variables found');
  }
} catch (error) {
  console.error('❌ .env file not found. Please create one with your configuration.');
  process.exit(1);
}

// Create .gitignore if it doesn't exist
try {
  readFileSync('.gitignore', 'utf8');
  console.log('✅ .gitignore found');
} catch (error) {
  console.log('📝 Creating .gitignore...');
  const gitignoreContent = `# Dependencies
node_modules/
npm-debug.log*
yarn-debug.log*
yarn-error.log*

# Environment variables
.env
.env.local
.env.development.local
.env.test.local
.env.production.local

# Build outputs
dist/
build/

# Database
*.db
*.sqlite

# Logs
logs
*.log

# Runtime data
pids
*.pid
*.seed
*.pid.lock

# Coverage directory used by tools like istanbul
coverage/

# IDE files
.vscode/
.idea/
*.swp
*.swo

# OS generated files
.DS_Store
.DS_Store?
._*
.Spotlight-V100
.Trashes
ehthumbs.db
Thumbs.db
`;
  writeFileSync('.gitignore', gitignoreContent);
  console.log('✅ .gitignore created');
}

// Test build
console.log('🔨 Testing build process...');
try {
  execSync('npm run build', { stdio: 'inherit' });
  console.log('✅ Build successful');
} catch (error) {
  console.error('❌ Build failed. Please fix build errors before deploying.');
  process.exit(1);
}

console.log('\n🎉 Deployment setup complete!');
console.log('\nNext steps:');
console.log('1. Push your code to GitHub');
console.log('2. Set up Supabase database');
console.log('3. Deploy backend to Render');
console.log('4. Deploy frontend to Vercel');
console.log('\nSee DEPLOYMENT.md for detailed instructions.');