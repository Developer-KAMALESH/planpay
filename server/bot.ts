import TelegramBot from 'node-telegram-bot-api';
import { storage } from './storage';
import { format } from 'date-fns';

export function setupTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  const bot = new TelegramBot(token, { polling: true });

  const escapeMarkdown = (text: string) => text.replace(/[_*[\]()~`>#+-=|{}.!]/g, '\\$&').replace(/\./g, '\\.');

  bot.onText(/\/start/, (msg) => {
    const helpText = `
🤖 *PLANPAL Bot Commands*

General Commands:
/start \\<eventcode\\> \\- Initialize the bot with your event \\(Private Chat\\)
/startevent \\<eventcode\\> \\- Link this group to your event

*Expense Tracking:*
/addexpense \\<amount\\> \\<description\\> @mentions \\- Log an expense\\. If participants are mentioned, it waits for everyone's approval\\.
/summary \\- View total confirmed expenses for the event\\.
/report \\- View full detailed event report\\.

Payments:
/paid @username \\<amount\\> \\- Record that you paid someone\\.
/confirmpayment @username \\<amount\\> \\- Confirm you received a payment\\.

*Event Management:*
/closeevent \\- Close the event \\(all expenses must be confirmed/rejected\\)\\.
/help \\- Show this help message\\.

Note: All amounts are in ₹ \\(INR\\)\\.
    `;
    bot.sendMessage(msg.chat.id, helpText, { parse_mode: 'MarkdownV2' });
  });

  bot.onText(/\/startevent (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const code = match?.[1];
    if (!code) return;

    const event = await storage.getEventByCode(code);
    if (!event) {
      bot.sendMessage(chatId, "Event not found.");
      return;
    }

    await storage.updateEventTelegramGroup(event.id, chatId.toString());
    bot.sendMessage(chatId, `Successfully joined event: ${event.name}`);
  });

  bot.onText(/\/summary/, async (msg) => {
    const chatId = msg.chat.id;
    const event = await storage.getEventByTelegramGroupId(chatId.toString());
    if (!event) return;

    const expenses = await storage.getExpensesForEvent(event.id);
    const confirmedExpenses = expenses.filter(e => e.status === 'CONFIRMED');
    const totalCents = confirmedExpenses.reduce((sum, e) => sum + e.amount, 0);

    let text = `💰 *Event Summary: ${escapeMarkdown(event.name)}*\n`;
    text += `Total Confirmed Expenses: ₹${escapeMarkdown((totalCents / 100).toFixed(2))}\n`;
    
    bot.sendMessage(chatId, text, { parse_mode: 'MarkdownV2' });
  });

  bot.onText(/\/report/, async (msg) => {
    const chatId = msg.chat.id;
    const event = await storage.getEventByTelegramGroupId(chatId.toString());
    if (!event) return;

    const expenses = await storage.getExpensesForEvent(event.id);
    const payments = await storage.getPaymentsForEvent(event.id);
    const confirmedExpenses = expenses.filter(e => e.status === 'CONFIRMED');
    const confirmedPayments = payments.filter(p => p.status === 'CONFIRMED');

    let report = `📋 *Event Report: ${escapeMarkdown(event.name)}*\n`;
    report += `📅 Start: ${format(new Date(event.createdAt || new Date()), "MMM d, yyyy h:mm a")}\n\n`;

    report += `💰 *Confirmed Expenses:*\n`;
    if (confirmedExpenses.length === 0) report += "_None_\n";
    confirmedExpenses.forEach(e => {
      report += `• ${escapeMarkdown(e.description)}: ₹${escapeMarkdown((e.amount / 100).toFixed(2))} \\(by @${escapeMarkdown(e.payerUsername || 'unknown')}\\)\n`;
    });

    report += `\n🤝 *Settlements:*\n`;
    if (confirmedPayments.length === 0) report += "_None_\n";
    confirmedPayments.forEach(p => {
      const time = format(new Date(p.createdAt || new Date()), "HH:mm");
      report += `• @${escapeMarkdown(p.fromUsername || 'unknown')} → @${escapeMarkdown(p.toUsername || 'unknown')} ₹${escapeMarkdown((p.amount / 100).toFixed(2))} \\(@ ${time}\\)\n`;
    });

    // Net balances for "Yet to be paid"
    const netBalances: Record<string, number> = {};
    confirmedExpenses.forEach(exp => {
      const splitAmong = Array.from(new Set(exp.splitAmong || []));
      const payer = exp.payerUsername;
      if (!payer || splitAmong.length === 0) return;
      const share = exp.amount / splitAmong.length;
      if (!(payer in netBalances)) netBalances[payer] = 0;
      netBalances[payer] += share * (splitAmong.length - 1);
      splitAmong.forEach(user => {
        if (user === payer) return;
        if (!(user in netBalances)) netBalances[user] = 0;
        netBalances[user] -= share;
      });
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
      report += `• @${escapeMarkdown(tempDebtors[dIdx].user)} owes @${escapeMarkdown(tempCreditors[cIdx].user)} ₹${escapeMarkdown((settlement / 100).toFixed(2))}\n`;
      tempDebtors[dIdx].balance -= settlement;
      tempCreditors[cIdx].balance -= settlement;
      if (tempDebtors[dIdx].balance < 1) dIdx++;
      if (tempCreditors[cIdx].balance < 1) cIdx++;
      hasDebts = true;
    }
    if (!hasDebts) report += "_All settled\\!_ ✅\n";

    bot.sendMessage(chatId, report, { parse_mode: 'MarkdownV2' });
  });

  bot.onText(/\/closeevent/, async (msg) => {
    const chatId = msg.chat.id;
    const event = await storage.getEventByTelegramGroupId(chatId.toString());
    if (!event) {
      bot.sendMessage(chatId, "This group is not linked to any event.");
      return;
    }

    if (event.status === 'CLOSED') {
      bot.sendMessage(chatId, "Event is already closed.");
      return;
    }

    const expenses = await storage.getExpensesForEvent(event.id);
    const pendingExpenses = expenses.filter(e => e.status === 'PENDING');

    if (pendingExpenses.length > 0) {
      bot.sendMessage(chatId, `⚠️ Cannot close event. There are ${pendingExpenses.length} pending expenses that need approval or rejection.`);
      return;
    }

    const payments = await storage.getPaymentsForEvent(event.id);
    const pendingPayments = payments.filter(p => p.status === 'PENDING');

    if (pendingPayments.length > 0) {
      bot.sendMessage(chatId, `⚠️ Cannot close event. There are ${pendingPayments.length} pending payments that need confirmation.`);
      return;
    }

    await storage.updateEventStatus(event.id, 'CLOSED');
    bot.sendMessage(chatId, `🏁 *Event Closed\\!* 🏁\n\nEvent *${escapeMarkdown(event.name)}* has been successfully closed. No further expenses or payments can be recorded.`, { parse_mode: 'MarkdownV2' });
  });

  bot.onText(/\/(addexpense|ae)(?:\s+([\d.]+))?(?:\s+(.*))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const command = match?.[1];
    const amountStr = match?.[2];
    const restOfMessage = match?.[3] || "";

    console.log(`[bot] Received /${command} from ${msg.from?.username} in chat ${chatId}. Amount: ${amountStr}, Rest: ${restOfMessage}`);

    if (!amountStr) {
      bot.sendMessage(chatId, "⚠️ Usage: /addexpense <amount> <description> [@mentions]\nExample: /addexpense 500 Dinner @friend");
      return;
    }

    const event = await storage.getEventByTelegramGroupId(chatId.toString());
    if (!event) {
      bot.sendMessage(chatId, "❌ This group is not linked to any event. Use /startevent <code| to link.");
      return;
    }

    const amount = Math.round(parseFloat(amountStr) * 100);
    const mentions = msg.entities?.filter(e => e.type === 'mention').map(e => msg.text?.substring(e.offset + 1, e.offset + e.length)) || [];
    
    // Description is everything in restOfMessage except the mentions
    let description = restOfMessage;
    if (msg.entities) {
      // Sort entities in reverse order to remove mentions from description without breaking offsets
      const sortedEntities = [...msg.entities].sort((a, b) => b.offset - a.offset);
      for (const entity of sortedEntities) {
        if (entity.type === 'mention') {
          const start = entity.offset - (msg.text?.indexOf(restOfMessage) || 0);
          if (start >= 0) {
            description = description.substring(0, start) + description.substring(start + entity.length);
          }
        }
      }
    }
    description = description.trim() || "Unspecified expense";

    const payerUsername = msg.from?.username;
    if (!payerUsername) {
      bot.sendMessage(chatId, "❌ Could not identify you. Please ensure you have a Telegram username.");
      return;
    }

    const splitAmong = (mentions.length > 0 ? mentions : [payerUsername]).filter((m): m is string => !!m);
    
    try {
      await storage.createExpense({
        eventId: event.id,
        amount,
        description,
        payerUsername,
        payerId: 0, 
        splitAmong,
        status: mentions.length > 0 ? 'PENDING' : 'CONFIRMED',
      } as any);

      // Using a safer manual escaping for the amount to ensure it is always escaped correctly
      const amountRaw = (amount / 100).toFixed(2);
      const amountFormatted = amountRaw.replace(/\./g, '\\.');

      if (mentions.length > 0) {
        bot.sendMessage(chatId, `Expense of ₹${amountFormatted} for "${escapeMarkdown(description)}" added. Waiting for approval from: ${mentions.map(m => '@' + escapeMarkdown(m || 'unknown')).join(', ')}`, { parse_mode: 'MarkdownV2' });
      } else {
        bot.sendMessage(chatId, `✅ Expense of ₹${amountFormatted} for "${escapeMarkdown(description)}" confirmed.`, { parse_mode: 'MarkdownV2' });
      }
    } catch (error) {
      console.error(`[bot] Error creating expense:`, error);
      bot.sendMessage(chatId, "❌ An error occurred while saving the expense.");
    }
  });

  bot.onText(/\/paid @(\w+) (\d+)(?:\.\d{2})?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const toUsername = match?.[1];
    const amountStr = match?.[2];
    if (!toUsername || !amountStr) return;

    const event = await storage.getEventByTelegramGroupId(chatId.toString());
    if (!event) return;

    const fromUsername = msg.from?.username;
    if (!fromUsername) return;

    const amount = Math.round(parseFloat(amountStr) * 100);
    
    await storage.createPayment({
      eventId: event.id,
      fromUsername,
      toUsername,
      amount,
      fromUserId: 0,
      toUserId: 0,
    } as any);

    const amountRaw = (amount / 100).toFixed(2);
    const amountFormatted = amountRaw.replace(/\./g, '\\.');
    bot.sendMessage(chatId, `Payment of ₹${amountFormatted} recorded from @${escapeMarkdown(fromUsername)} to @${escapeMarkdown(toUsername)}. @${escapeMarkdown(toUsername)}, please confirm with /confirmpayment @${escapeMarkdown(fromUsername)} ₹${amountFormatted}`, { parse_mode: 'MarkdownV2' });
  });

  bot.onText(/\/confirmpayment @(\w+) (\d+(?:\.\d{2})?)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const fromUsername = match?.[1];
    const amountStr = match?.[2];
    if (!fromUsername || !amountStr) return;

    const event = await storage.getEventByTelegramGroupId(chatId.toString());
    if (!event) return;

    const toUsername = msg.from?.username;
    if (!toUsername) return;

    const amount = Math.round(parseFloat(amountStr) * 100);
    const payments = await storage.getPaymentsForEvent(event.id);
    const payment = payments.find(p => p.fromUsername === fromUsername && p.toUsername === toUsername && p.amount === amount && p.status === 'PENDING');

    if (!payment) {
      bot.sendMessage(chatId, "No pending payment found matching these details.");
      return;
    }

    await storage.updatePaymentStatus(payment.id, 'CONFIRMED');
    const amountRaw = (amount / 100).toFixed(2);
    const amountFormatted = amountRaw.replace(/\./g, '\\.');
    bot.sendMessage(chatId, `✅ Payment of ₹${amountFormatted} from @${escapeMarkdown(fromUsername)} to @${escapeMarkdown(toUsername)} confirmed.`, { parse_mode: 'MarkdownV2' });
  });

  bot.onText(/\/help/, (msg) => {
    const helpText = `
🤖 *PLANPAL Bot Commands*

General Commands:
/start \\<eventcode\\> \\- Initialize the bot with your event \\(Private Chat\\)
/startevent \\<eventcode\\> \\- Link this group to your event

*Expense Tracking:*
/addexpense \\<amount\\> \\<description\\> @mentions \\- Log an expense\\. If participants are mentioned, it waits for everyone's approval\\.
/summary \\- View total confirmed expenses for the event\\.
/report \\- View full detailed event report\\.

Payments:
/paid @username \\<amount\\> \\- Record that you paid someone\\.
/confirmpayment @username \\<amount\\> \\- Confirm you received a payment\\.

*Event Management:*
/closeevent \\- Close the event \\(all expenses must be confirmed/rejected\\)\\.
/help \\- Show this help message\\.

Note: All amounts are in ₹ \\(INR\\)\\.
    `;
    bot.sendMessage(msg.chat.id, helpText, { parse_mode: 'MarkdownV2' });
  });
}
