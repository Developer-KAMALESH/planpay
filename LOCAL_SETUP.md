# Local Setup Guide for PLANPAL

To run PLANPAL on your local device, follow these steps:

## Prerequisites
- **Node.js**: Install Node.js (v18 or higher) from [nodejs.org](https://nodejs.org/).
- **PostgreSQL**: Install PostgreSQL from [postgresql.org](https://www.postgresql.org/).
- **Git**: (Optional) For cloning the repository.

## Installation Steps

1. **Extract the ZIP file**:
   Extract the downloaded files into a folder on your computer.

2. **Open Terminal/Command Prompt**:
   Navigate to the project directory:
   ```bash
   cd path/to/planpal-folder
   ```

3. **Install Dependencies**:
   Run the following command to install all necessary packages:
   ```bash
   npm install
   ```

4. **Configure Environment Variables**:
   Create a file named `.env` in the root directory and add the following:
   ```env
   DATABASE_URL=postgresql://username:password@localhost:5432/planpal
   SESSION_SECRET=your_random_secret_here
   TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
   ```
   *Replace the values with your actual database credentials and bot token.*

5. **Set Up the Database**:
   Push the database schema to your local PostgreSQL instance:
   ```bash
   npx drizzle-kit push
   ```

6. **Run the Application**:
   Start the development server:
   ```bash
   npm run dev
   ```
   The application will be available at `http://localhost:5000`.

## Telegram Bot Setup (Optional)
1. Message [@BotFather](https://t.me/botfather) on Telegram to create a new bot.
2. Get your **API Token** and add it to the `.env` file.
3. Your bot will be active once you start the application.

## Troubleshooting
- **Database Connection**: Ensure PostgreSQL is running and the `DATABASE_URL` is correct.
- **Node Version**: Check your version with `node -v`. It should be 18+.
- **Port Conflict**: If port 5000 is in use, you may need to change it in `server/index.ts`.
