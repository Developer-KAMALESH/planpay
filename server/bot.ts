import TelegramBot from 'node-telegram-bot-api';
import { storage } from './storage';

let bot: TelegramBot | null = null;

export function setupTelegramBot() {
  //const token = process.env.TELEGRAM_BOT_TOKEN;
    const token = "8380678251:AAETIXsCFZS8HsulqfTWDjcrSxN8HD2wp2c";
  if (!token) {
    console.warn("TELEGRAM_BOT_TOKEN not set. Bot functionality disabled.");
    return;
  }

  bot = new TelegramBot(token, { polling: true });

  console.log("Telegram Bot started!");

  // /start <EVENT_CODE> (Private chat)
  bot.onText(/\/start (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const eventCode = match ? match[1] : null;

    if (!eventCode) {
        bot?.sendMessage(chatId, "Welcome to PLANPAL! Please use a valid event link to get started.");
        return;
    }

    // Check if event exists
    const event = await storage.getEventByCode(eventCode);
    if (!event) {
        bot?.sendMessage(chatId, "Invalid Event Code.");
        return;
    }

    // In a real app, we would ask the user to login via web to link their account
    // For MVP, we'll try to find a user with this telegram ID or create a placeholder logic
    // Since we can't easily auth via telegram without a web login flow, we will just say:
    // "Please add me to your group to track expenses for " + event.name

    bot?.sendMessage(chatId, `✅ Event "${event.name}" recognized.\nPlease add me to your Telegram group and run /start_event ${eventCode} inside the group.`);
  });

  // /start_event <EVENT_CODE> (Group chat)
  bot.onText(/\/start_event (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const eventCode = match ? match[1] : null;

    if (msg.chat.type === 'private') {
        bot?.sendMessage(chatId, "This command is meant for groups.");
        return;
    }

    if (!eventCode) {
        return;
    }

    const event = await storage.getEventByCode(eventCode);
    if (!event) {
        bot?.sendMessage(chatId, "Event not found.");
        return;
    }

    // Link group to event
    await storage.updateEventTelegramGroup(event.id, chatId.toString());

    bot?.sendMessage(chatId, `✅ Event "${event.name}" is now active in this group.\nExpense logging will follow group consensus.`);
  });

  // /add_expense <amount> <description>
  bot.onText(/\/add_expense (\d+) (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const amount = match ? parseInt(match[1]) : 0;
    const description = match ? match[2] : "";
    const userId = msg.from?.id;

    if (!userId) return;

    // Find event linked to this group
    // This is tricky because getEventByTelegramGroupId is not implemented yet in storage
    // For MVP, we assume 1 active event per group? Or we need to query events by telegramGroupId.
    // Let's implement a quick lookup if possible, or skip for now.
    
    // Simplification for MVP: Just echo back
    bot?.sendMessage(chatId, `Creating expense request for ${amount} (${description})... \n(Database logic pending implementation in full version)`);
  });
}
