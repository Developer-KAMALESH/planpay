#!/usr/bin/env node

/**
 * PLANPAL Supabase Migration Script
 * Helps migrate from local PostgreSQL to Supabase
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function askQuestion(question) {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

console.log('🚀 PLANPAL Supabase Migration Tool\n');

async function main() {
  try {
    // Check if we're in the right directory
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
    if (packageJson.name !== 'rest-express') {
      console.error('❌ Please run this script from the PLANPAL root directory');
      process.exit(1);
    }

    console.log('✅ Found PLANPAL project\n');

    // Get current database URL
    let currentDbUrl = '';
    try {
      const envContent = readFileSync('.env', 'utf8');
      const dbUrlMatch = envContent.match(/DATABASE_URL=(.+)/);
      if (dbUrlMatch) {
        currentDbUrl = dbUrlMatch[1].trim();
        console.log(`📊 Current database: ${currentDbUrl.replace(/:[^:@]*@/, ':****@')}`);
      }
    } catch (error) {
      console.log('⚠️  No .env file found');
    }

    console.log('\n📋 Migration Steps:');
    console.log('1. Create Supabase project at https://supabase.com');
    console.log('2. Get your connection string from Settings → Database');
    console.log('3. This script will help you migrate your data\n');

    const supabaseUrl = await askQuestion('🔗 Enter your Supabase connection string: ');
    
    if (!supabaseUrl.includes('supabase.co')) {
      console.log('⚠️  This doesn\'t look like a Supabase URL. Continuing anyway...');
    }

    console.log('\n🔄 Migration Options:');
    console.log('1. Fresh setup (create tables only)');
    console.log('2. Migrate existing data (export + import)');
    
    const migrationChoice = await askQuestion('Choose option (1 or 2): ');

    if (migrationChoice === '1') {
      // Fresh setup
      console.log('\n📝 Setting up fresh Supabase database...');
      
      // Update .env file
      const envContent = readFileSync('.env', 'utf8');
      const newEnvContent = envContent.replace(
        /DATABASE_URL=.+/,
        `DATABASE_URL=${supabaseUrl}`
      );
      
      require('fs').writeFileSync('.env', newEnvContent);
      console.log('✅ Updated .env file');

      // Push schema
      console.log('🏗️  Creating database schema...');
      execSync('npm run db:push', { stdio: 'inherit' });
      console.log('✅ Database schema created successfully!');

    } else if (migrationChoice === '2') {
      // Data migration
      console.log('\n📦 Migrating existing data...');
      
      if (!currentDbUrl) {
        console.log('❌ No current database URL found in .env');
        process.exit(1);
      }

      // Export current data
      console.log('📤 Exporting current database...');
      try {
        execSync(`pg_dump "${currentDbUrl}" --data-only --inserts > migration_data.sql`, { stdio: 'inherit' });
        console.log('✅ Data exported to migration_data.sql');
      } catch (error) {
        console.log('❌ Export failed. Make sure pg_dump is installed and accessible.');
        console.log('You can manually export your data using your preferred PostgreSQL tool.');
      }

      // Update .env
      const envContent = readFileSync('.env', 'utf8');
      const newEnvContent = envContent.replace(
        /DATABASE_URL=.+/,
        `DATABASE_URL=${supabaseUrl}`
      );
      
      require('fs').writeFileSync('.env', newEnvContent);
      console.log('✅ Updated .env file');

      // Create schema
      console.log('🏗️  Creating database schema on Supabase...');
      execSync('npm run db:push', { stdio: 'inherit' });
      console.log('✅ Schema created');

      // Import data
      console.log('📥 Importing data to Supabase...');
      try {
        execSync(`psql "${supabaseUrl}" < migration_data.sql`, { stdio: 'inherit' });
        console.log('✅ Data imported successfully!');
        console.log('🗑️  You can now delete migration_data.sql');
      } catch (error) {
        console.log('⚠️  Data import failed. You may need to import manually.');
        console.log('Use the Supabase SQL editor or psql to import migration_data.sql');
      }

    } else {
      console.log('❌ Invalid choice. Please run the script again.');
      process.exit(1);
    }

    console.log('\n🎉 Migration completed!');
    console.log('\n📋 Next steps:');
    console.log('1. Test your application locally: npm run dev');
    console.log('2. Verify data in Supabase dashboard');
    console.log('3. Deploy to Render and Vercel (see DEPLOYMENT.md)');
    console.log('4. Update your Telegram bot webhook if needed');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

main();