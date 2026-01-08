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
    // Also check for text mentions if entities are not correctly populated by some clients
    // but usually entities are better. 
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
    const amountRaw = match ? parseInt(match[1]) : 0;
    const amount = amountRaw * 100;
    const description = match ? match[2] : "";
    const fromId = msg.from?.id.toString();
    const fromUsername = msg.from?.username;

    if (!fromId) return;

    const event = await storage.getEventByTelegramGroupId(chatId.toString());
    if (!event) {
      bot?.sendMessage(chatId, "No active event linked to this group.");
      return;
    }

    if (event.status === 'CLOSED') {
      bot?.sendMessage(chatId, "❌ Event is closed. No more expenses can be added.");
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
      amount: amount,
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

    bot?.sendMessage(chatId, `⏳ Expense Proposed: ${description} - ₹${amountRaw}\nSplit among: ${splitAmong.map(u => '@' + u).join(', ')}\nWaiting for approval from all tagged participants.`, opts);
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

      const amountRaw = expense.amount / 100;

      if (vote === 'disagree') {
        await storage.updateExpenseStatus(expenseId, 'REJECTED');
        bot?.editMessageText(`❌ REJECTED: Expense "${expense.description}" - ₹${amountRaw} was rejected by @${fromUsername}.`, {
          chat_id: msg.chat.id,
          message_id: msg.message_id
        });
      } else {
        const agreedUsers = Object.keys(votes).filter(u => votes[u] === 'agree');
        if (agreedUsers.length >= splitAmong.length) {
          await storage.updateExpenseStatus(expenseId, 'CONFIRMED');
          bot?.editMessageText(`✅ CONFIRMED: Expense "${expense.description}" - ₹${amountRaw} confirmed by all participants.`, {
            chat_id: msg.chat.id,
            message_id: msg.message_id
          });
        } else {
          bot?.answerCallbackQuery(callbackQuery.id, { text: "Vote recorded! Waiting for others." });
          // Update message to show current progress
          const remaining = splitAmong.filter(u => !votes[u]);
          bot?.editMessageText(`⏳ Expense Proposed: ${expense.description} - ₹${amountRaw}\nSplit among: ${splitAmong.map(u => '@' + u).join(', ')}\nWaiting for: ${remaining.map(u => '@' + u).join(', ')}`, {
            chat_id: msg.chat.id,
            message_id: msg.message_id,
            reply_markup: msg.reply_markup as TelegramBot.InlineKeyboardMarkup
          });
        }
      }
    }
  });

  bot.onText(/\/paid @([\w_]+) (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const toUsername = match ? match[1] : "";
    const amountRaw = match ? parseInt(match[2]) : 0;
    const amount = amountRaw * 100;
    const fromUsername = msg.from?.username;

    if (!fromUsername || !toUsername) return;

    const event = await storage.getEventByTelegramGroupId(chatId.toString());
    if (!event) return;

    if (event.status === 'CLOSED') {
      bot?.sendMessage(chatId, "❌ Event is closed. No more payments can be recorded.");
      return;
    }

    await storage.createPayment({
      eventId: event.id,
      fromUserId: 0, 
      fromUsername: fromUsername,
      toUserId: 0, 
      toUsername: toUsername,
      amount: amount,
      status: 'PENDING'
    });

    const escapeMarkdown = (text: string) => text.replace(/[_*[\]()~`>#+-=|{}.!]/g, '\\$&');

    bot?.sendMessage(chatId, `⏳ Payment claimed: @${escapeMarkdown(fromUsername)} → @${escapeMarkdown(toUsername)} ₹${amountRaw}\nWaiting for confirmation from @${escapeMarkdown(toUsername)}\\. Run \`/confirm_payment @${escapeMarkdown(fromUsername)} ${amountRaw}\``, { parse_mode: 'MarkdownV2' });
  });

  bot.onText(/\/confirm_payment @([\w_]+) (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const fromUsername = match ? match[1] : "";
    const amountRaw = match ? parseInt(match[2]) : 0;
    const amount = amountRaw * 100; // Convert to cents
    const toUsername = msg.from?.username;

    if (!toUsername || !fromUsername) return;

    const event = await storage.getEventByTelegramGroupId(chatId.toString());
    if (!event) return;

    const payments = await storage.getPaymentsForEvent(event.id);
    // Find pending payment matching amount, fromUser and toUser
    const pending = payments.find(p => 
      p.amount === amount && 
      p.status === 'PENDING' && 
      p.fromUsername === fromUsername && 
      p.toUsername === toUsername
    );

    const escapeMarkdown = (text: string) => text.replace(/[_*[\]()~`>#+-=|{}.!]/g, '\\$&');

    if (pending) {
      await storage.updatePaymentStatus(pending.id, 'CONFIRMED');
      bot?.sendMessage(chatId, `✅ Payment confirmed: @${escapeMarkdown(fromUsername)} → @${escapeMarkdown(toUsername)} ₹${amountRaw}`, { parse_mode: 'MarkdownV2' });
    } else {
      bot?.sendMessage(chatId, `❌ No pending payment found for @${escapeMarkdown(fromUsername)} to @${escapeMarkdown(toUsername)} of ₹${amountRaw}`, { parse_mode: 'MarkdownV2' });
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

    // Step 2.5: Process confirmed payments to update net balances
    const payments = await storage.getPaymentsForEvent(event.id);
    const confirmedPayments = payments.filter(p => p.status === 'CONFIRMED');
    confirmedPayments.forEach(pay => {
      const from = pay.fromUsername;
      const to = pay.toUsername;
      const amount = pay.amount;
      if (!from || !to) return;
      if (!(from in netBalances)) netBalances[from] = 0;
      if (!(to in netBalances)) netBalances[to] = 0;
      netBalances[from] += amount;
      netBalances[to] -= amount;
    });

    const escapeMarkdown = (text: string) => {
      return text.replace(/[_*[\]()~`>#+-=|{}.!]/g, '\\$&');
    };

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

      settlements.push(`@${escapeMarkdown(debtor.user)} owes @${escapeMarkdown(creditor.user)} ₹${(settlementAmount / 100).toFixed(2).replace('.', '\\.')}`);

      debtor.balance -= settlementAmount;
      creditor.balance -= settlementAmount;

      if (debtor.balance < 0.01) dIdx++;
      if (creditor.balance < 0.01) cIdx++;
    }

    // Format output
    let summaryText = `📊 *Expense Summary: ${escapeMarkdown(event.name)}*\n\n`;
    
    if (settlements.length === 0) {
      summaryText += "Everything is settled\\! ✅";
    } else {
      summaryText += settlements.join('\n');
    }

    bot?.sendMessage(chatId, summaryText, { parse_mode: 'MarkdownV2' });
  });

  bot.onText(/\/close_event/, async (msg) => {
    const chatId = msg.chat.id;
    const event = await storage.getEventByTelegramGroupId(chatId.toString());
    if (!event) return;

    const expenses = await storage.getExpensesForEvent(event.id);
    const confirmedExpenses = expenses.filter(e => e.status === 'CONFIRMED');
    
    // Calculate net balances to check if settled
    const netBalances: Record<string, number> = {};
    confirmedExpenses.forEach(exp => {
      const amount = exp.amount;
      const splitAmong = Array.from(new Set(exp.splitAmong || []));
      const payer = exp.payerUsername;
      if (!payer || splitAmong.length === 0 || !splitAmong.includes(payer)) return;
      const share = amount / splitAmong.length;
      if (!(payer in netBalances)) netBalances[payer] = 0;
      splitAmong.forEach(u => { if (!(u in netBalances)) netBalances[u] = 0; });
      netBalances[payer] += share * (splitAmong.length - 1);
      splitAmong.forEach(user => { if (user !== payer) netBalances[user] -= share; });
    });

    const payments = await storage.getPaymentsForEvent(event.id);
    const confirmedPayments = payments.filter(p => p.status === 'CONFIRMED');
    confirmedPayments.forEach(pay => {
      const from = pay.fromUsername;
      const to = pay.toUsername;
      const amount = pay.amount;
      if (!from || !to) return;
      if (!(from in netBalances)) netBalances[from] = 0;
      if (!(to in netBalances)) netBalances[to] = 0;
      netBalances[from] += amount;
      netBalances[to] -= amount;
    });

    const isSettled = Object.values(netBalances).every(b => Math.abs(b) < 1); // 1 cent threshold
    const pendingExpenses = expenses.filter(e => e.status === 'PENDING');
    const pendingPayments = payments.filter(p => p.status === 'PENDING');

    const escapeMarkdown = (text: string) => text.replace(/[_*[\]()~`>#+-=|{}.!]/g, '\\$&');

    if (pendingExpenses.length > 0 || pendingPayments.length > 0 || !isSettled) {
      let reason = "";
      if (pendingExpenses.length > 0) reason += "• Pending expenses waiting for approval\\.\n";
      if (pendingPayments.length > 0) reason += "• Pending payments waiting for confirmation\\.\n";
      if (!isSettled) reason += "• Group is not fully settled\\.\n";

      bot?.sendMessage(chatId, `⚠️ Cannot close event:\n\n${reason}`, { parse_mode: 'MarkdownV2' });
    } else {
      await storage.updateEventStatus(event.id, 'CLOSED');
      bot?.sendMessage(chatId, `🏁 Event "${escapeMarkdown(event.name)}" is now closed\\.`, { parse_mode: 'MarkdownV2' });
    }
  });

  bot.onText(/\/report/, async (msg) => {
    const chatId = msg.chat.id;
    const event = await storage.getEventByTelegramGroupId(chatId.toString());
    if (!event) return;

    const expenses = await storage.getExpensesForEvent(event.id);
    const confirmedExpenses = expenses.filter(e => e.status === 'CONFIRMED');
    const payments = await storage.getPaymentsForEvent(event.id);
    const confirmedPayments = payments.filter(p => p.status === 'CONFIRMED');

    const escapeMarkdown = (text: string) => text.replace(/[_*[\]()~`>#+-=|{}.!]/g, '\\$&');

    let report = `📋 *Event Report: ${escapeMarkdown(event.name)}*\n`;
    report += `📅 Start: ${escapeMarkdown(format(new Date(event.createdAt || new Date()), "PPP, p"))}\n\n`;

    report += `💰 *Confirmed Expenses:*\n`;
    if (confirmedExpenses.length === 0) report += "None\n";
    confirmedExpenses.forEach(exp => {
      report += `• ${escapeMarkdown(exp.description)}: ₹${(exp.amount / 100).toFixed(2).replace('.', '\\.')} \\(by @${escapeMarkdown(exp.payerUsername || 'Unknown')}\\)\n`;
    });

    report += `\n🤝 *Settlement History:*\n`;
    if (confirmedPayments.length === 0) report += "None\n";
    confirmedPayments.forEach(pay => {
      report += `• @${escapeMarkdown(pay.fromUsername || 'Unknown')} → @${escapeMarkdown(pay.toUsername || 'Unknown')} ₹${(pay.amount / 100).toFixed(2).replace('.', '\\.')} \\(${escapeMarkdown(format(new Date(pay.createdAt || new Date()), "MMM d, HH:mm"))}\\)\n`;
    });

    // Calculate net balances for "yet to be paid"
    const netBalances: Record<string, number> = {};
    confirmedExpenses.forEach(exp => {
      const amount = exp.amount;
      const splitAmong = Array.from(new Set(exp.splitAmong || []));
      const payer = exp.payerUsername;
      if (!payer || splitAmong.length === 0 || !splitAmong.includes(payer)) return;
      const share = amount / splitAmong.length;
      if (!(payer in netBalances)) netBalances[payer] = 0;
      splitAmong.forEach(u => { if (!(u in netBalances)) netBalances[u] = 0; });
      netBalances[payer] += share * (splitAmong.length - 1);
      splitAmong.forEach(user => { if (user !== payer) netBalances[user] -= share; });
    });

    confirmedPayments.forEach(pay => {
      const from = pay.fromUsername;
      const to = pay.toUsername;
      if (!from || !to) return;
      if (!(from in netBalances)) netBalances[from] = 0;
      if (!(to in netBalances)) netBalances[to] = 0;
      netBalances[from] += pay.amount;
      netBalances[to] -= pay.amount;
    });

    const debtors: { user: string, balance: number }[] = [];
    const creditors: { user: string, balance: number }[] = [];
    Object.entries(netBalances).forEach(([user, balance]) => {
      if (balance < -0.01) debtors.push({ user, balance: Math.abs(balance) });
      else if (balance > 0.01) creditors.push({ user, balance });
    });

    report += `\n⚖️ *Outstanding Balances:*\n`;
    let settlements = 0;
    let dIdx = 0, cIdx = 0;
    while (dIdx < debtors.length && cIdx < creditors.length) {
      const debtor = debtors[dIdx];
      const creditor = creditors[cIdx];
      const settlementAmount = Math.min(debtor.balance, creditor.balance);
      report += `• @${escapeMarkdown(debtor.user)} owes @${escapeMarkdown(creditor.user)} ₹${(settlementAmount / 100).toFixed(2).replace('.', '\\.')}\n`;
      debtor.balance -= settlementAmount;
      creditor.balance -= settlementAmount;
      if (debtor.balance < 0.01) dIdx++;
      if (creditor.balance < 0.01) cIdx++;
      settlements++;
    }
    if (settlements === 0) report += "All settled\\! ✅\n";

    bot?.sendMessage(chatId, report, { parse_mode: 'MarkdownV2' });
  });

  bot.onText(/\/report/, async (msg) => {
    const chatId = msg.chat.id;
    const event = await storage.getEventByTelegramGroupId(chatId.toString());
    if (!event) return;

    const expenses = await storage.getExpensesForEvent(event.id);
    const payments = await storage.getPaymentsForEvent(event.id);
    const confirmedExpenses = expenses.filter(e => e.status === 'CONFIRMED');
    const confirmedPayments = payments.filter(p => p.status === 'CONFIRMED');

    const escapeMarkdown = (text: string) => text.replace(/[_*[\]()~`>#+-=|{}.!]/g, '\\$&');

    let report = `📋 *Event Report: ${escapeMarkdown(event.name)}*\n`;
    report += `📅 Start: ${format(new Date(event.createdAt || new Date()), "MMM d, yyyy h:mm a")}\n\n`;

    report += `💰 *Confirmed Expenses:*\n`;
    if (confirmedExpenses.length === 0) report += "_None_\n";
    confirmedExpenses.forEach(e => {
      report += `• ${escapeMarkdown(e.description)}: ₹${(e.amount / 100).toFixed(2).replace('.', '\\.')} \\(by @${escapeMarkdown(e.payerUsername || 'unknown')}\\)\n`;
    });

    report += `\n🤝 *Settlements:*\n`;
    if (confirmedPayments.length === 0) report += "_None_\n";
    confirmedPayments.forEach(p => {
      const time = format(new Date(p.createdAt || new Date()), "HH:mm");
      report += `• @${escapeMarkdown(p.fromUsername || 'unknown')} → @${escapeMarkdown(p.toUsername || 'unknown')} ₹${(p.amount / 100).toFixed(2).replace('.', '\\.')} \\(@ ${time}\\)\n`;
    });

    // Net balances for "Yet to be paid"
    const netBalances: Record<string, number> = {};
    confirmedExpenses.forEach(exp => {
      const splitAmong = Array.from(new Set(exp.splitAmong || []));
      const payer = exp.payerUsername;
      if (!payer || splitAmong.length === 0 || !splitAmong.includes(payer)) return;
      const share = exp.amount / splitAmong.length;
      if (!(payer in netBalances)) netBalances[payer] = 0;
      splitAmong.forEach(u => { if (!(u in netBalances)) netBalances[u] = 0; });
      netBalances[payer] += share * (splitAmong.length - 1);
      splitAmong.forEach(user => { if (user !== payer) netBalances[user] -= share; });
    });
    confirmedPayments.forEach(pay => {
      if (!pay.fromUsername || !pay.toUsername) return;
      if (!(pay.fromUsername in netBalances)) netBalances[pay.fromUsername] = 0;
      if (!(pay.toUsername in netBalances)) netBalances[pay.toUsername] = 0;
      netBalances[pay.fromUsername] += pay.amount;
      netBalances[pay.toUsername] -= pay.amount;
    });

    const debtors: { user: string, balance: number }[] = [];
    const creditors: { user: string, balance: number }[] = [];
    Object.entries(netBalances).forEach(([user, balance]) => {
      if (balance < -1) debtors.push({ user, balance: Math.abs(balance) });
      else if (balance > 1) creditors.push({ user, balance });
    });

    report += `\n⏳ *Pending Debts:*\n`;
    let hasDebts = false;
    let dIdx = 0, cIdx = 0;
    const tempDebtors = JSON.parse(JSON.stringify(debtors));
    const tempCreditors = JSON.parse(JSON.stringify(creditors));
    while (dIdx < tempDebtors.length && cIdx < tempCreditors.length) {
      const settlement = Math.min(tempDebtors[dIdx].balance, tempCreditors[cIdx].balance);
      report += `• @${escapeMarkdown(tempDebtors[dIdx].user)} owes @${escapeMarkdown(tempCreditors[cIdx].user)} ₹${(settlement / 100).toFixed(2).replace('.', '\\.')}\n`;
      tempDebtors[dIdx].balance -= settlement;
      tempCreditors[cIdx].balance -= settlement;
      if (tempDebtors[dIdx].balance < 1) dIdx++;
      if (tempCreditors[cIdx].balance < 1) cIdx++;
      hasDebts = true;
    }
    if (!hasDebts) report += "_All settled\\!_ ✅\n";

    bot?.sendMessage(chatId, report, { parse_mode: 'MarkdownV2' });
  });
    const helpMessage = `
🤖 *PLANPAL Bot Commands*

*General Commands:*
/start <event_code> \\- Initialize the bot with your event (Private Chat)
/start_event <event_code> \\- Link this group to your event

*Expense Tracking:*
/add_expense <amount> <description> @mentions \\- Log an expense.
/summary \\- View total confirmed expenses for the event.

*Payments:*
/paid @username <amount> \\- Record that you paid someone.
/confirm_payment @username <amount> \\- Confirm you received a payment.

*Event Management:*
/close_event \\- Close the event.
/help \\- Show this help message.

*Note:* All amounts are in ₹ (INR).
    `;
    bot?.sendMessage(msg.chat.id, helpMessage.trim(), { parse_mode: 'MarkdownV2' });
  });
}
