import TelegramBot from 'node-telegram-bot-api';
import { storage } from './storage';
import { format } from 'date-fns';

export function setupTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  const bot = new TelegramBot(token, { polling: true });

  bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "Welcome to PlanPal! Join an event with /join <code_here>");
  });

  bot.onText(/\/join (.+)/, async (msg, match) => {
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

  bot.onText(/\/help/, (msg) => {
    const helpText = `
🤖 *PLANPAL Bot Commands*

*Events:*
/start \\- Start interacting with the bot\\.
/join \\<code\\> \\- Join an event using its unique code\\.
/summary \\- View total confirmed expenses for the event\\.
/report \\- View full detailed event report\\.

*Payments:*
/pay \\<amount\\> \\[@username\\] \\- Log a payment made to someone\\.
/settle \\[@username\\] \\- Settle all debts with someone\\.

*Expenses:*
Send an expense in format: \`\\<amount\\> \\<description\\>\`
Example: \`500 Lunch at Central Perk\`
_Note: Expenses require consensus from participants before confirmation\\._
`;
    bot.sendMessage(msg.chat.id, helpText, { parse_mode: 'MarkdownV2' });
  });
}
