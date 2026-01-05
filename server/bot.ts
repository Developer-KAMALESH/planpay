import TelegramBot from 'node-telegram-bot-api';
import { storage } from './storage';

let bot: TelegramBot | null = null;

export function setupTelegramBot() {
  const token = "8380678251:AAETIXsCFZS8HsulqfTWDjcrSxN8HD2wp2c";
  if (!token) {
    console.warn("TELEGRAM_BOT_TOKEN not set. Bot functionality disabled.");
    return;
  }

  bot = new TelegramBot(token, { polling: true });

  console.log("Telegram Bot started!");

  // Helper to get mentions from a message
  const getMentions = (msg: TelegramBot.Message) => {
    const mentions: string[] = [];
    if (msg.entities) {
      msg.entities.forEach(entity => {
        if (entity.type === 'mention') {
          mentions.push(msg.text!.substring(entity.offset, entity.offset + entity.length).replace('@', ''));
        }
      });
    }
    return mentions;
  };

  bot.onText(/\/start (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const eventCode = match ? match[1] : null;
    if (!eventCode) return;

    const event = await storage.getEventByCode(eventCode);
    if (!event) {
      bot?.sendMessage(chatId, "Invalid Event Code.");
      return;
    }

    bot?.sendMessage(chatId, `✅ Event "${event.name}" recognized.\nPlease add me to your Telegram group and run /start_event ${eventCode} inside the group.`);
  });

  bot.onText(/\/start_event (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const eventCode = match ? match[1] : null;
    if (msg.chat.type === 'private' || !eventCode) return;

    const event = await storage.getEventByCode(eventCode);
    if (!event) {
      bot?.sendMessage(chatId, "Event not found.");
      return;
    }

    await storage.updateEventTelegramGroup(event.id, chatId.toString());
    bot?.sendMessage(chatId, `✅ Event "${event.name}" is now active in this group.`);
  });

  bot.onText(/\/add_expense (\d+) (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const amount = match ? parseInt(match[1]) : 0;
    const description = match ? match[2] : "";
    const fromId = msg.from?.id.toString();
    const fromUsername = msg.from?.username;

    if (!fromId) return;

    const event = await storage.getEventByTelegramGroupId(chatId.toString());
    if (!event) {
      bot?.sendMessage(chatId, "No active event linked to this group.");
      return;
    }

    const mentions = getMentions(msg);
    // If no mentions, split among all (logic to be refined later)
    const splitAmong = mentions.length > 0 ? mentions : [fromUsername || fromId];

    const expense = await storage.createExpense({
      eventId: event.id,
      payerId: 0, // Placeholder as we don't have mapping yet
      description,
      amount,
      splitAmong,
      votes: {}
    });

    const opts = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '👍 Agree', callback_data: `vote_${expense.id}_agree` },
            { text: '👎 Disagree', callback_data: `vote_${expense.id}_disagree` }
          ]
        ]
      }
    };

    bot?.sendMessage(chatId, `⏳ Expense Proposed: ${description} - ₹${amount}\nSplit among: ${splitAmong.map(u => '@' + u).join(', ')}`, opts);
  });

  bot.on('callback_query', async (callbackQuery) => {
    const action = callbackQuery.data;
    const msg = callbackQuery.message;
    const fromId = callbackQuery.from.id.toString();
    const fromUsername = callbackQuery.from.username;

    if (!action || !msg || !fromId) return;

    if (action.startsWith('vote_')) {
      const parts = action.split('_');
      const expenseId = parseInt(parts[1]);
      const vote = parts[2] as 'agree' | 'disagree';

      const expense = await storage.getExpense(expenseId);
      if (!expense || expense.status !== 'PENDING') return;

      const votes = expense.votes || {};
      votes[fromUsername || fromId] = vote;
      await storage.updateExpenseVotes(expenseId, votes);

      const splitAmong = expense.splitAmong || [];
      const voteCount = Object.keys(votes).length;

      if (vote === 'disagree') {
        await storage.updateExpenseStatus(expenseId, 'REJECTED');
        bot?.editMessageText(`❌ REJECTED: Expense "${expense.description}" - ₹${expense.amount} was rejected.`, {
          chat_id: msg.chat.id,
          message_id: msg.message_id
        });
      } else if (voteCount >= splitAmong.length) {
        await storage.updateExpenseStatus(expenseId, 'CONFIRMED');
        bot?.editMessageText(`✅ CONFIRMED: Expense "${expense.description}" - ₹${expense.amount} confirmed by all.`, {
          chat_id: msg.chat.id,
          message_id: msg.message_id
        });
      }
    }
  });

  bot.onText(/\/paid @(\w+) (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const toUsername = match ? match[1] : "";
    const amount = match ? parseInt(match[2]) : 0;
    const fromUsername = msg.from?.username;

    if (!fromUsername || !toUsername) return;

    const event = await storage.getEventByTelegramGroupId(chatId.toString());
    if (!event) return;

    const payment = await storage.createPayment({
      eventId: event.id,
      fromUserId: 0, // Placeholder
      toUserId: 0, // Placeholder
      amount,
      status: 'PENDING'
    });

    bot?.sendMessage(chatId, `⏳ Payment claimed: @${fromUsername} → @${toUsername} ₹${amount}\nWaiting for confirmation from @${toUsername}. Run /confirm_payment @${fromUsername} ${amount}`);
  });

  bot.onText(/\/confirm_payment @(\w+) (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const fromUsername = match ? match[1] : "";
    const amount = match ? parseInt(match[2]) : 0;
    const toUsername = msg.from?.username;

    if (!toUsername || !fromUsername) return;

    const event = await storage.getEventByTelegramGroupId(chatId.toString());
    if (!event) return;

    // Logic to find pending payment and confirm it
    const payments = await storage.getPaymentsForEvent(event.id);
    const pending = payments.find(p => p.amount === amount && p.status === 'PENDING');

    if (pending) {
      await storage.updatePaymentStatus(pending.id, 'CONFIRMED');
      bot?.sendMessage(chatId, `✅ Payment confirmed: @${fromUsername} → @${toUsername} ₹${amount}`);
    }
  });

  bot.onText(/\/summary/, async (msg) => {
    const chatId = msg.chat.id;
    const event = await storage.getEventByTelegramGroupId(chatId.toString());
    if (!event) return;

    const expenses = await storage.getExpensesForEvent(event.id);
    const confirmedExpenses = expenses.filter(e => e.status === 'CONFIRMED');
    const total = confirmedExpenses.reduce((sum, e) => sum + e.amount, 0);

    bot?.sendMessage(chatId, `📊 Event Summary: ${event.name}\nTotal Confirmed Expenses: ₹${total}`);
  });

  bot.onText(/\/close_event/, async (msg) => {
    const chatId = msg.chat.id;
    const event = await storage.getEventByTelegramGroupId(chatId.toString());
    if (!event) return;

    const expenses = await storage.getExpensesForEvent(event.id);
    const pending = expenses.some(e => e.status === 'PENDING');

    if (pending) {
      bot?.sendMessage(chatId, "⚠️ Cannot close event: There are pending expenses.");
    } else {
      await storage.updateEventStatus(event.id, 'CLOSED');
      bot?.sendMessage(chatId, `🏁 Event "${event.name}" is now closed.`);
    }
  });
}
