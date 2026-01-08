import TelegramBot from 'node-telegram-bot-api';
import { storage } from './storage';
import { format } from 'date-fns';

export function setupTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  const bot = new TelegramBot(token, { polling: true });

  const escapeMarkdown = (text: string) => text.replace(/[_*[\]()~`>#+-=|{}.!]/g, '\\$&');

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
    text += `Total Confirmed Expenses: ₹${(totalCents / 100).toFixed(2).replace('.', '\\.')}\n`;
    
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
      report += `• @${escapeMarkdown(tempDebtors[dIdx].user)} owes @${escapeMarkdown(tempCreditors[cIdx].user)} ₹${(settlement / 100).toFixed(2).replace('.', '\\.')}\n`;
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
    if (!event) return;

    if (event.status === 'CLOSED') {
      bot.sendMessage(chatId, "Event is already closed.");
      return;
    }

    const expenses = await storage.getExpensesForEvent(event.id);
    const pendingExpenses = expenses.filter(e => e.status === 'PENDING');

    if (pendingExpenses.length > 0) {
      bot.sendMessage(chatId, `Cannot close event. There are ${pendingExpenses.length} pending expenses that need approval or rejection.`);
      return;
    }

    await storage.updateEventStatus(event.id, 'CLOSED');
    bot.sendMessage(chatId, `✅ Event *${escapeMarkdown(event.name)}* has been closed successfully.`, { parse_mode: 'MarkdownV2' });
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
