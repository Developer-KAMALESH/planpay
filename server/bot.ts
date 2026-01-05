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
    // Remove duplicates
    let splitAmong = Array.from(new Set(mentions));
    
    // If no mentions, split among all? For now, we require at least one mention or default to payer
    if (splitAmong.length === 0) {
      splitAmong = [fromUsername || fromId];
    }

    // Payer must be in the splitAmong list
    if (fromUsername && !splitAmong.includes(fromUsername)) {
      bot?.sendMessage(chatId, `❌ Rejected: @${fromUsername} (payer) must be part of the split participants.`);
      return;
    }

    if (splitAmong.length < 2) {
      bot?.sendMessage(chatId, "❌ Rejected: No splitting needed for a single participant.");
      return;
    }

    const expense = await storage.createExpense({
      eventId: event.id,
      payerId: 0, // Placeholder
      description,
      amount,
      splitAmong,
      votes: {},
      payerUsername: fromUsername || 'Unknown'
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

    bot?.sendMessage(chatId, `⏳ Expense Proposed: ${description} - ₹${amount}\nSplit among: ${splitAmong.map(u => '@' + u).join(', ')}\nWaiting for approval from all tagged participants.`, opts);
  });

  bot.on('callback_query', async (callbackQuery) => {
    const action = callbackQuery.data;
    const msg = callbackQuery.message;
    const fromUsername = callbackQuery.from.username;

    if (!action || !msg || !fromUsername) return;

    if (action.startsWith('vote_')) {
      const parts = action.split('_');
      const expenseId = parseInt(parts[1]);
      const vote = parts[2] as 'agree' | 'disagree';

      const expense = await storage.getExpense(expenseId);
      if (!expense || expense.status !== 'PENDING') return;

      const splitAmong = expense.splitAmong || [];
      
      // Check if the voting user is part of the split
      if (!splitAmong.includes(fromUsername)) {
        bot?.answerCallbackQuery(callbackQuery.id, { text: "You are not part of this expense split." });
        return;
      }

      const votes = expense.votes || {};
      votes[fromUsername] = vote;
      await storage.updateExpenseVotes(expenseId, votes);

      if (vote === 'disagree') {
        await storage.updateExpenseStatus(expenseId, 'REJECTED');
        bot?.editMessageText(`❌ REJECTED: Expense "${expense.description}" - ₹${expense.amount} was rejected by @${fromUsername}.`, {
          chat_id: msg.chat.id,
          message_id: msg.message_id
        });
      } else {
        const agreedUsers = Object.keys(votes).filter(u => votes[u] === 'agree');
        if (agreedUsers.length >= splitAmong.length) {
          await storage.updateExpenseStatus(expenseId, 'CONFIRMED');
          bot?.editMessageText(`✅ CONFIRMED: Expense "${expense.description}" - ₹${expense.amount} confirmed by all participants.`, {
            chat_id: msg.chat.id,
            message_id: msg.message_id
          });
        } else {
          bot?.answerCallbackQuery(callbackQuery.id, { text: "Vote recorded! Waiting for others." });
          // Update message to show current progress
          const remaining = splitAmong.filter(u => !votes[u]);
          bot?.editMessageText(`⏳ Expense Proposed: ${expense.description} - ₹${expense.amount}\nSplit among: ${splitAmong.map(u => '@' + u).join(', ')}\nWaiting for: ${remaining.map(u => '@' + u).join(', ')}`, {
            chat_id: msg.chat.id,
            message_id: msg.message_id,
            reply_markup: msg.reply_markup as TelegramBot.InlineKeyboardMarkup
          });
        }
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
      fromUserId: 0, 
      fromUsername: fromUsername,
      toUserId: 0, 
      toUsername: toUsername,
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
    
    // Step 1: Initialize net balances
    const netBalances: Record<string, number> = {};

    // Step 2: Process each confirmed expense
    confirmedExpenses.forEach(exp => {
      const amount = exp.amount;
      const splitAmong = Array.from(new Set(exp.splitAmong || [])); // Remove duplicates
      const payer = exp.payerUsername;
      
      if (!payer || splitAmong.length === 0) return;
      if (!splitAmong.includes(payer)) return; // Payer must be a participant

      const share = amount / splitAmong.length;

      // Initialize users in netBalances
      if (!(payer in netBalances)) netBalances[payer] = 0;
      splitAmong.forEach(u => {
        if (!(u in netBalances)) netBalances[u] = 0;
      });

      // Payer's net balance increases by (share * (count - 1))
      netBalances[payer] += share * (splitAmong.length - 1);

      // Other participants' net balance decreases by share
      splitAmong.forEach(user => {
        if (user !== payer) {
          netBalances[user] -= share;
        }
      });
    });

    // Step 3: Convert net balances to pairwise debts
    const debtors: { user: string, balance: number }[] = [];
    const creditors: { user: string, balance: number }[] = [];

    Object.entries(netBalances).forEach(([user, balance]) => {
      if (balance < -0.01) {
        debtors.push({ user, balance: Math.abs(balance) });
      } else if (balance > 0.01) {
        creditors.push({ user, balance });
      }
    });

    const settlements: string[] = [];
    let dIdx = 0;
    let cIdx = 0;

    while (dIdx < debtors.length && cIdx < creditors.length) {
      const debtor = debtors[dIdx];
      const creditor = creditors[cIdx];
      const settlementAmount = Math.min(debtor.balance, creditor.balance);

      settlements.push(`@${debtor.user} owes @${creditor.user} ₹${(settlementAmount / 100).toFixed(2)}`);

      debtor.balance -= settlementAmount;
      creditor.balance -= settlementAmount;

      if (debtor.balance < 0.01) dIdx++;
      if (creditor.balance < 0.01) cIdx++;
    }

    // Format output
    let summaryText = `📊 *Expense Summary: ${event.name}*\n\n`;
    
    if (settlements.length === 0) {
      summaryText += "Everything is settled! ✅";
    } else {
      summaryText += settlements.join('\n');
    }

    bot?.sendMessage(chatId, summaryText, { parse_mode: 'Markdown' });
  });

  bot.onText(/\/close_event/, async (msg) => {
    const chatId = msg.chat.id;
    const event = await storage.getEventByTelegramGroupId(chatId.toString());
    if (!event) return;

    const expenses = await storage.getExpensesForEvent(event.id);
    const pending = expenses.some(e => e.status === 'PENDING');

    if (pending) {
      bot?.sendMessage(chatId, "⚠️ Cannot close event: There are pending expenses waiting for approval.");
    } else {
      await storage.updateEventStatus(event.id, 'CLOSED');
      bot?.sendMessage(chatId, `🏁 Event "${event.name}" is now closed.`);
    }
  });

  bot.onText(/\/help/, (msg) => {
    const helpMessage = `
🤖 *PLANPAL Bot Commands*

*General Commands:*
/start <event_code> - Initialize the bot with your event (Private Chat)
/start_event <event_code> - Link this group to your event

*Expense Tracking:*
/add_expense <amount> <description> @mentions - Log an expense. If participants are mentioned, it waits for everyone's approval.
/summary - View total confirmed expenses for the event.

*Payments:*
/paid @username <amount> - Record that you paid someone.
/confirm_payment @username <amount> - Confirm you received a payment.

*Event Management:*
/close_event - Close the event (all expenses must be confirmed/rejected).
/help - Show this help message.

*Note:* All amounts are in ₹ (INR).
    `;
    bot?.sendMessage(msg.chat.id, helpMessage, { parse_mode: 'Markdown' });
  });
}
