import TelegramBot from "node-telegram-bot-api";
import { storage } from "./storage";
import { format } from "date-fns";
import { OCRService, ManualEntryHandler } from "./ocr.js";
import { log } from "./index.js";
function setupTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  const bot = new TelegramBot(token, { polling: true });
  const escapeMarkdown = (text) => {
    return text.replace(/[_*[\]()~`>#+=|{}.!\\-]/g, "\\$&");
  };
  bot.onText(/\/start/, (msg) => {
    const helpText = `
\u{1F916} *PLANPAL Bot \\- 100% Functional Commands*

*\u{1F517} Setup Commands:*
/start \\<eventcode\\> \\- Initialize bot with your event \\(Private Chat\\)
/startevent \\<eventcode\\> \\- Link this group to your event \\(Group Chat\\)

*\u{1F4B0} Expense Tracking:*
/addexpense \\<amount\\> \\<description\\> @mentions \\- Add expense with participants
  Example: \`/addexpense 1200 Team dinner @alice @bob\`
  
\u{1F4F7} *Photo Expenses:* Send photo with caption:
  \`/addexpense Team lunch @alice @bob\` \\(amount auto\\-extracted\\)

*\u2705 Expense Approval:*
/approve \\- Approve pending expenses you're mentioned in
/reject \\- Reject pending expenses you're mentioned in
  
*\u{1F4CA} Reports & Summaries:*
/summary \\- View total confirmed expenses
/report \\- Detailed expense breakdown with settlements

*\u{1F4B8} Payment Tracking:*
/paid @username \\<amount\\> \\- Record payment made
  Example: \`/paid @alice 600\`
/confirmpayment @username \\<amount\\> \\- Confirm payment received
  Example: \`/confirmpayment @bob 600\`

*\u2699\uFE0F Event Management:*
/closeevent \\- Close event \\(requires all expenses confirmed\\)
/help \\- Show this comprehensive help

*\u{1F3AF} Key Features:*
\u2022 OCR invoice processing from photos
\u2022 Manual fallback for unclear images
\u2022 Automatic expense splitting
\u2022 Consensus\\-based approvals
\u2022 Smart settlement calculations

*\u{1F4A1} Pro Tips:*
\u2022 Mention participants for expense splitting
\u2022 Upload clear invoice photos for auto\\-extraction
\u2022 All amounts in \u20B9 \\(INR\\)
\u2022 Bot guides you through manual entry if needed
\u2022 Approve/reject expenses you're mentioned in
    `;
    bot.sendMessage(msg.chat.id, helpText, { parse_mode: "MarkdownV2" });
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
    const confirmedExpenses = expenses.filter((e) => e.status === "CONFIRMED");
    const totalCents = confirmedExpenses.reduce((sum, e) => sum + e.amount, 0);
    let text = `\u{1F4B0} *Event Summary: ${escapeMarkdown(event.name)}*
`;
    text += `Total Confirmed Expenses: \u20B9${escapeMarkdown((totalCents / 100).toFixed(2))}
`;
    bot.sendMessage(chatId, text, { parse_mode: "MarkdownV2" });
  });
  bot.onText(/\/report/, async (msg) => {
    const chatId = msg.chat.id;
    const event = await storage.getEventByTelegramGroupId(chatId.toString());
    if (!event) return;
    const expenses = await storage.getExpensesForEvent(event.id);
    const payments = await storage.getPaymentsForEvent(event.id);
    const confirmedExpenses = expenses.filter((e) => e.status === "CONFIRMED");
    const confirmedPayments = payments.filter((p) => p.status === "CONFIRMED");
    let report = `\u{1F4CB} *Event Report: ${escapeMarkdown(event.name)}*
`;
    report += `\u{1F4C5} Start: ${format(new Date(event.createdAt || /* @__PURE__ */ new Date()), "MMM d, yyyy h:mm a")}

`;
    report += `\u{1F4B0} *Confirmed Expenses:*
`;
    if (confirmedExpenses.length === 0) report += "_None_\n";
    confirmedExpenses.forEach((e) => {
      report += `\u2022 ${escapeMarkdown(e.description)}: \u20B9${escapeMarkdown((e.amount / 100).toFixed(2))} \\(by @${escapeMarkdown(e.payerUsername || "unknown")}\\)
`;
    });
    report += `
\u{1F91D} *Settlements:*
`;
    if (confirmedPayments.length === 0) report += "_None_\n";
    confirmedPayments.forEach((p) => {
      const time = format(new Date(p.createdAt || /* @__PURE__ */ new Date()), "HH:mm");
      report += `\u2022 @${escapeMarkdown(p.fromUsername || "unknown")} \u2192 @${escapeMarkdown(p.toUsername || "unknown")} \u20B9${escapeMarkdown((p.amount / 100).toFixed(2))} \\(@ ${time}\\)
`;
    });
    const netBalances = {};
    confirmedExpenses.forEach((exp) => {
      const splitAmong = Array.from(new Set(exp.splitAmong || []));
      const payer = exp.payerUsername;
      if (!payer || splitAmong.length === 0) return;
      const share = exp.amount / splitAmong.length;
      if (!(payer in netBalances)) netBalances[payer] = 0;
      netBalances[payer] += share * (splitAmong.length - 1);
      splitAmong.forEach((user) => {
        if (user === payer) return;
        if (!(user in netBalances)) netBalances[user] = 0;
        netBalances[user] -= share;
      });
    });
    confirmedPayments.forEach((pay) => {
      if (!pay.fromUsername || !pay.toUsername) return;
      if (!(pay.fromUsername in netBalances)) netBalances[pay.fromUsername] = 0;
      if (!(pay.toUsername in netBalances)) netBalances[pay.toUsername] = 0;
      netBalances[pay.fromUsername] += pay.amount;
      netBalances[pay.toUsername] -= pay.amount;
    });
    const debtors = [];
    const creditors = [];
    Object.entries(netBalances).forEach(([user, balance]) => {
      if (balance < -1) debtors.push({ user, balance: Math.abs(balance) });
      else if (balance > 1) creditors.push({ user, balance });
    });
    report += `
\u23F3 *Pending Debts:*
`;
    let hasDebts = false;
    let dIdx = 0, cIdx = 0;
    const tempDebtors = JSON.parse(JSON.stringify(debtors));
    const tempCreditors = JSON.parse(JSON.stringify(creditors));
    while (dIdx < tempDebtors.length && cIdx < tempCreditors.length) {
      const settlement = Math.min(tempDebtors[dIdx].balance, tempCreditors[cIdx].balance);
      report += `\u2022 @${escapeMarkdown(tempDebtors[dIdx].user)} owes @${escapeMarkdown(tempCreditors[cIdx].user)} \u20B9${escapeMarkdown((settlement / 100).toFixed(2))}
`;
      tempDebtors[dIdx].balance -= settlement;
      tempCreditors[cIdx].balance -= settlement;
      if (tempDebtors[dIdx].balance < 1) dIdx++;
      if (tempCreditors[cIdx].balance < 1) cIdx++;
      hasDebts = true;
    }
    if (!hasDebts) report += "_All settled\\!_ \u2705\n";
    bot.sendMessage(chatId, report, { parse_mode: "MarkdownV2" });
  });
  bot.onText(/\/closeevent/, async (msg) => {
    const chatId = msg.chat.id;
    const event = await storage.getEventByTelegramGroupId(chatId.toString());
    if (!event) {
      bot.sendMessage(chatId, "This group is not linked to any event.");
      return;
    }
    if (event.status === "CLOSED") {
      bot.sendMessage(chatId, "Event is already closed.");
      return;
    }
    const expenses = await storage.getExpensesForEvent(event.id);
    const pendingExpenses = expenses.filter((e) => e.status === "PENDING");
    if (pendingExpenses.length > 0) {
      bot.sendMessage(chatId, `\u26A0\uFE0F Cannot close event. There are ${pendingExpenses.length} pending expenses that need approval or rejection.`);
      return;
    }
    const payments = await storage.getPaymentsForEvent(event.id);
    const pendingPayments = payments.filter((p) => p.status === "PENDING");
    if (pendingPayments.length > 0) {
      bot.sendMessage(chatId, `\u26A0\uFE0F Cannot close event. There are ${pendingPayments.length} pending payments that need confirmation.`);
      return;
    }
    await storage.updateEventStatus(event.id, "CLOSED");
    bot.sendMessage(chatId, `\u{1F3C1} *Event Closed\\!* \u{1F3C1}

Event *${escapeMarkdown(event.name)}* has been successfully closed. No further expenses or payments can be recorded.`, { parse_mode: "MarkdownV2" });
  });
  bot.on("photo", async (msg) => {
    const chatId = msg.chat.id;
    const caption = msg.caption || "";
    try {
      if (!caption.startsWith("/addexpense")) {
        return;
      }
      log(`Received photo with caption: ${caption}`, "bot");
      const event = await storage.getEventByTelegramGroupId(chatId.toString());
      if (!event) {
        bot.sendMessage(chatId, "\u274C This group is not linked to any event. Use /startevent <code> to link.");
        return;
      }
      const payerUsername = msg.from?.username;
      if (!payerUsername) {
        bot.sendMessage(chatId, "\u274C Could not identify you. Please ensure you have a Telegram username.");
        return;
      }
      const mentions = msg.caption_entities?.filter((e) => e.type === "mention").map(
        (e) => caption.substring(e.offset + 1, e.offset + e.length)
      ).filter((mention) => !!mention) || [];
      if (mentions.length === 0) {
        bot.sendMessage(chatId, "\u26A0\uFE0F Please mention participants in the photo caption.\nExample: `/addexpense Team lunch @alice @bob`", { parse_mode: "MarkdownV2" });
        return;
      }
      const photo = msg.photo?.[msg.photo.length - 1];
      if (!photo) {
        bot.sendMessage(chatId, "\u274C Could not process photo. Please try again.");
        return;
      }
      log(`Processing photo with file_id: ${photo.file_id}`, "bot");
      bot.sendMessage(chatId, "\u{1F4F7} Processing invoice image... Please wait.");
      log(`Getting file link for photo...`, "bot");
      const fileLink = await bot.getFileLink(photo.file_id);
      log(`File link obtained: ${fileLink}`, "bot");
      const response = await fetch(fileLink);
      const imageBuffer = Buffer.from(await response.arrayBuffer());
      log(`Image downloaded, size: ${imageBuffer.length} bytes`, "bot");
      log(`Starting OCR processing...`, "bot");
      const ocrResult = await OCRService.processInvoiceImage(imageBuffer);
      log(`OCR completed, result: ${JSON.stringify(ocrResult)}`, "bot");
      if (OCRService.shouldTriggerManualEntry(ocrResult)) {
        ManualEntryHandler.initiateManualEntry(payerUsername, mentions, event.id);
        let message = "\u{1F4F7} Image processed, but details are unclear. Let me help you enter them manually.\n\n";
        if (ocrResult.description) {
          message += `\u{1F4A1} Detected description: "${ocrResult.description}"

`;
        }
        message += "\u{1F4B0} Please enter the expense amount (e.g., 1200):";
        bot.sendMessage(chatId, message);
        return;
      }
      const amount = Math.round((ocrResult.amount || 0) * 100);
      const description = ocrResult.description || "Expense from invoice";
      const splitAmong = [payerUsername, ...mentions];
      const expense = await storage.createExpense({
        eventId: event.id,
        amount,
        description,
        payerUsername,
        payerId: 0,
        splitAmong,
        status: mentions.length > 0 ? "PENDING" : "CONFIRMED"
      });
      const amountFormatted = (amount / 100).toFixed(2).replace(/\./g, "\\.");
      let successMessage = `\u2705 *Invoice processed successfully\\!*

`;
      successMessage += `\u{1F4B0} Amount: \u20B9${amountFormatted}
`;
      successMessage += `\u{1F4DD} Description: ${escapeMarkdown(description)}
`;
      successMessage += `\u{1F465} Split among: ${splitAmong.map((u) => "@" + escapeMarkdown(u)).join(", ")}
`;
      if (ocrResult.confidence) {
        successMessage += `\u{1F3AF} OCR Confidence: ${Math.round(ocrResult.confidence)}%
`;
      }
      if (mentions.length > 0) {
        successMessage += `
\u23F3 *Waiting for approval from mentioned participants*
`;
        successMessage += `\u{1F4AC} Mentioned users can reply: "yes/agree/ok" to approve or "no/reject/disagree" to reject`;
        const expenses = await storage.getExpensesForEvent(event.id);
        const createdExpense = expenses.find(
          (e) => e.payerUsername === payerUsername && e.amount === amount && e.description === description && e.status === "PENDING"
        );
        if (createdExpense) {
          mentions.forEach((mention) => {
            ManualEntryHandler.initiateExpenseVoting(mention, createdExpense.id, event.id);
          });
        }
      } else {
        successMessage += `
\u2705 Expense confirmed automatically`;
      }
      bot.sendMessage(chatId, successMessage, { parse_mode: "MarkdownV2" });
    } catch (error) {
      log(`Error processing photo: ${error}`, "bot");
      bot.sendMessage(chatId, "\u274C Error processing image. Please try again or enter details manually with `/addexpense <amount> <description> @mentions`", { parse_mode: "MarkdownV2" });
    }
  });
  bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text || "";
    const username = msg.from?.username;
    if (!username || text.startsWith("/") || !text.trim()) {
      return;
    }
    const conversationState = ManualEntryHandler.getConversationState(username);
    if (!conversationState) {
      return;
    }
    const event = await storage.getEventByTelegramGroupId(chatId.toString());
    if (!event || event.id !== conversationState.eventId) {
      return;
    }
    try {
      if (conversationState.step === "awaiting_expense_vote") {
        const response = text.trim().toLowerCase();
        const approvalWords = ["yes", "agree", "ok", "approve", "confirm", "y", "\u2705", "\u{1F44D}"];
        const rejectionWords = ["no", "reject", "disagree", "deny", "cancel", "n", "\u274C", "\u{1F44E}"];
        let voteType = null;
        if (approvalWords.some((word) => response.includes(word))) {
          voteType = "agree";
        } else if (rejectionWords.some((word) => response.includes(word))) {
          voteType = "disagree";
        } else {
          bot.sendMessage(chatId, `\u26A0\uFE0F Please reply with "yes/agree/ok" to approve or "no/reject/disagree" to reject the expense.`);
          return;
        }
        if (!conversationState.expenseId) {
          bot.sendMessage(chatId, "\u274C Error: No expense found for voting.");
          ManualEntryHandler.cancelManualEntry(username);
          return;
        }
        const expense = await storage.getExpense(conversationState.expenseId);
        if (!expense || expense.status !== "PENDING") {
          bot.sendMessage(chatId, "\u274C This expense is no longer pending approval.");
          ManualEntryHandler.cancelManualEntry(username);
          return;
        }
        if (!expense.splitAmong?.includes(username)) {
          bot.sendMessage(chatId, "\u274C You are not mentioned in this expense and cannot vote on it.");
          ManualEntryHandler.cancelManualEntry(username);
          return;
        }
        const votes = expense.votes || {};
        votes[username] = voteType;
        const splitAmong = expense.splitAmong || [];
        const agreeVotes = Object.values(votes).filter((v) => v === "agree").length;
        const disagreeVotes = Object.values(votes).filter((v) => v === "disagree").length;
        const totalParticipants = splitAmong.length;
        const majorityThreshold = Math.ceil(totalParticipants / 2);
        if (disagreeVotes > 0) {
          await storage.updateExpenseStatus(conversationState.expenseId, "REJECTED");
          await storage.updateExpenseVotes(conversationState.expenseId, votes);
          splitAmong.forEach((participant) => {
            ManualEntryHandler.cancelManualEntry(participant);
          });
          const amountFormatted = (expense.amount / 100).toFixed(2).replace(/\./g, "\\.");
          bot.sendMessage(chatId, `\u274C *Expense Rejected\\!*

Amount: \u20B9${amountFormatted}
Description: ${escapeMarkdown(expense.description)}
Reason: Participant disagreement`, { parse_mode: "MarkdownV2" });
        } else if (agreeVotes >= majorityThreshold) {
          await storage.updateExpenseStatus(conversationState.expenseId, "CONFIRMED");
          await storage.updateExpenseVotes(conversationState.expenseId, votes);
          splitAmong.forEach((participant) => {
            ManualEntryHandler.cancelManualEntry(participant);
          });
          const amountFormatted = (expense.amount / 100).toFixed(2).replace(/\./g, "\\.");
          bot.sendMessage(chatId, `\u2705 *Expense Approved\\!*

Amount: \u20B9${amountFormatted}
Description: ${escapeMarkdown(expense.description)}
Approved by majority consensus`, { parse_mode: "MarkdownV2" });
        } else {
          await storage.updateExpenseVotes(conversationState.expenseId, votes);
          ManualEntryHandler.completeManualEntry(username);
          const remainingVotes = totalParticipants - agreeVotes - disagreeVotes;
          bot.sendMessage(chatId, `\u2705 Your ${voteType === "agree" ? "approval" : "rejection"} recorded. Waiting for ${remainingVotes} more vote(s).`);
        }
      } else if (conversationState.step === "awaiting_amount") {
        const amount = parseFloat(text.trim());
        if (isNaN(amount) || amount <= 0) {
          bot.sendMessage(chatId, "\u26A0\uFE0F Please enter a valid amount (numbers only, e.g., 1200):");
          return;
        }
        ManualEntryHandler.updateConversationState(username, {
          amount: Math.round(amount * 100),
          step: "awaiting_description"
        });
        bot.sendMessage(chatId, "\u{1F4DD} Great! Now please enter a description for this expense:");
      } else if (conversationState.step === "awaiting_description") {
        const description = text.trim();
        if (description.length < 3) {
          bot.sendMessage(chatId, "\u26A0\uFE0F Please enter a more detailed description (at least 3 characters):");
          return;
        }
        ManualEntryHandler.updateConversationState(username, {
          description,
          step: "awaiting_confirmation"
        });
        const updatedState = ManualEntryHandler.getConversationState(username);
        if (!updatedState) return;
        const amountFormatted = ((updatedState.amount || 0) / 100).toFixed(2);
        let confirmMessage = `\u{1F4CB} *Please confirm the expense details:*

`;
        confirmMessage += `\u{1F4B0} Amount: \u20B9${escapeMarkdown(amountFormatted)}
`;
        confirmMessage += `\u{1F4DD} Description: ${escapeMarkdown(description)}
`;
        confirmMessage += `\u{1F465} Split among: ${updatedState.mentions.map((u) => "@" + escapeMarkdown(u)).join(", ")}, @${escapeMarkdown(username)}

`;
        confirmMessage += `Type *confirm* to create expense or *cancel* to abort\\.`;
        bot.sendMessage(chatId, confirmMessage, { parse_mode: "MarkdownV2" });
      } else if (conversationState.step === "awaiting_confirmation") {
        const response = text.trim().toLowerCase();
        if (response === "confirm") {
          const finalState = ManualEntryHandler.completeManualEntry(username);
          if (!finalState || !finalState.amount || !finalState.description) {
            bot.sendMessage(chatId, "\u274C Error: Missing expense details. Please start over.");
            return;
          }
          const splitAmong = [username, ...finalState.mentions];
          const expense = await storage.createExpense({
            eventId: event.id,
            amount: finalState.amount,
            description: finalState.description,
            payerUsername: username,
            payerId: 0,
            splitAmong,
            status: finalState.mentions.length > 0 ? "PENDING" : "CONFIRMED"
          });
          const amountFormatted = (finalState.amount / 100).toFixed(2).replace(/\./g, "\\.");
          let successMessage = `\u2705 *Expense created manually\\!*

`;
          successMessage += `\u{1F4B0} Amount: \u20B9${amountFormatted}
`;
          successMessage += `\u{1F4DD} Description: ${escapeMarkdown(finalState.description)}
`;
          successMessage += `\u{1F465} Split among: ${splitAmong.map((u) => "@" + escapeMarkdown(u)).join(", ")}
`;
          if (finalState.mentions.length > 0) {
            successMessage += `
\u23F3 *Waiting for approval from mentioned participants*
`;
            successMessage += `\u{1F4AC} Mentioned users can reply: "yes/agree/ok" to approve or "no/reject/disagree" to reject`;
            const expenses = await storage.getExpensesForEvent(event.id);
            const createdExpense = expenses.find(
              (e) => e.payerUsername === username && e.amount === finalState.amount && e.description === finalState.description && e.status === "PENDING"
            );
            if (createdExpense) {
              finalState.mentions.forEach((mention) => {
                ManualEntryHandler.initiateExpenseVoting(mention, createdExpense.id, event.id);
              });
            }
          } else {
            successMessage += `
\u2705 Expense confirmed automatically`;
          }
          bot.sendMessage(chatId, successMessage, { parse_mode: "MarkdownV2" });
        } else if (response === "cancel") {
          ManualEntryHandler.cancelManualEntry(username);
          bot.sendMessage(chatId, "\u274C Expense entry cancelled.");
        } else {
          bot.sendMessage(chatId, "\u26A0\uFE0F Please type *confirm* to create the expense or *cancel* to abort\\.", { parse_mode: "MarkdownV2" });
        }
      }
    } catch (error) {
      log(`Error in manual entry workflow: ${error}`, "bot");
      ManualEntryHandler.cancelManualEntry(username);
      bot.sendMessage(chatId, "\u274C An error occurred. Please try again with `/addexpense <amount> <description> @mentions`", { parse_mode: "MarkdownV2" });
    }
  });
  bot.onText(/\/(addexpense|ae)(?:\s+([\d.]+))?(?:\s+(.*))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const command = match?.[1];
    const amountStr = match?.[2];
    const restOfMessage = match?.[3] || "";
    console.log(`[bot] Received /${command} from ${msg.from?.username} in chat ${chatId}. Amount: ${amountStr}, Rest: ${restOfMessage}`);
    if (!amountStr) {
      bot.sendMessage(chatId, "\u26A0\uFE0F Usage: /addexpense <amount> <description> [@mentions]\nExample: /addexpense 500 Dinner @friend");
      return;
    }
    const event = await storage.getEventByTelegramGroupId(chatId.toString());
    if (!event) {
      bot.sendMessage(chatId, "\u274C This group is not linked to any event. Use /startevent <code| to link.");
      return;
    }
    const amount = Math.round(parseFloat(amountStr) * 100);
    const mentions = msg.entities?.filter((e) => e.type === "mention").map((e) => msg.text?.substring(e.offset + 1, e.offset + e.length)).filter((mention) => !!mention) || [];
    let description = restOfMessage;
    if (msg.entities) {
      const sortedEntities = [...msg.entities].sort((a, b) => b.offset - a.offset);
      for (const entity of sortedEntities) {
        if (entity.type === "mention") {
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
      bot.sendMessage(chatId, "\u274C Could not identify you. Please ensure you have a Telegram username.");
      return;
    }
    const splitAmong = (mentions.length > 0 ? mentions : [payerUsername]).filter((m) => !!m);
    try {
      const expense = await storage.createExpense({
        eventId: event.id,
        amount,
        description,
        payerUsername,
        payerId: 0,
        splitAmong,
        status: mentions.length > 0 ? "PENDING" : "CONFIRMED"
      });
      const amountFormatted = (amount / 100).toFixed(2).replace(/\./g, "\\.");
      if (mentions.length > 0) {
        let message = `\u{1F4B0} *Expense Added\\!*

`;
        message += `Amount: \u20B9${amountFormatted}
`;
        message += `Description: ${escapeMarkdown(description)}
`;
        message += `Split among: ${mentions.map((m) => "@" + escapeMarkdown(m || "unknown")).join(", ")}

`;
        message += `\u23F3 *Waiting for approval from mentioned participants*
`;
        message += `\u{1F4AC} Mentioned users can reply: "yes/agree/ok" to approve or "no/reject/disagree" to reject`;
        bot.sendMessage(chatId, message, { parse_mode: "MarkdownV2" });
        const expenses = await storage.getExpensesForEvent(event.id);
        const createdExpense = expenses.find(
          (e) => e.payerUsername === payerUsername && e.amount === amount && e.description === description && e.status === "PENDING"
        );
        if (createdExpense) {
          mentions.forEach((mention) => {
            ManualEntryHandler.initiateExpenseVoting(mention, createdExpense.id, event.id);
          });
        }
      } else {
        bot.sendMessage(chatId, `\u2705 Expense of \u20B9${amountFormatted} for "${escapeMarkdown(description)}" confirmed.`, { parse_mode: "MarkdownV2" });
      }
    } catch (error) {
      console.error(`[bot] Error creating expense:`, error);
      bot.sendMessage(chatId, "\u274C An error occurred while saving the expense.");
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
      toUserId: 0
    });
    const amountFormatted = (amount / 100).toFixed(2).replace(/\./g, "\\.");
    bot.sendMessage(chatId, `Payment of \u20B9${amountFormatted} recorded from @${escapeMarkdown(fromUsername)} to @${escapeMarkdown(toUsername)}. @${escapeMarkdown(toUsername)}, please confirm with /confirmpayment @${escapeMarkdown(fromUsername)} \u20B9${amountFormatted}`, { parse_mode: "MarkdownV2" });
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
    const payment = payments.find((p) => p.fromUsername === fromUsername && p.toUsername === toUsername && p.amount === amount && p.status === "PENDING");
    if (!payment) {
      bot.sendMessage(chatId, "No pending payment found matching these details.");
      return;
    }
    await storage.updatePaymentStatus(payment.id, "CONFIRMED");
    const amountFormatted = (amount / 100).toFixed(2).replace(/\./g, "\\.");
    bot.sendMessage(chatId, `\u2705 Payment of \u20B9${amountFormatted} from @${escapeMarkdown(fromUsername)} to @${escapeMarkdown(toUsername)} confirmed.`, { parse_mode: "MarkdownV2" });
  });
  bot.onText(/\/approve/, async (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from?.username;
    if (!username) {
      bot.sendMessage(chatId, "\u274C Could not identify you. Please ensure you have a Telegram username.");
      return;
    }
    const event = await storage.getEventByTelegramGroupId(chatId.toString());
    if (!event) {
      bot.sendMessage(chatId, "\u274C This group is not linked to any event.");
      return;
    }
    const expenses = await storage.getExpensesForEvent(event.id);
    const pendingExpenses = expenses.filter(
      (e) => e.status === "PENDING" && e.splitAmong?.includes(username)
    );
    if (pendingExpenses.length === 0) {
      bot.sendMessage(chatId, "\u2705 No pending expenses require your approval.");
      return;
    }
    let approvedCount = 0;
    for (const expense of pendingExpenses) {
      const votes = expense.votes || {};
      votes[username] = "agree";
      const splitAmong = expense.splitAmong || [];
      const agreeVotes = Object.values(votes).filter((v) => v === "agree").length;
      const totalParticipants = splitAmong.length;
      const majorityThreshold = Math.ceil(totalParticipants / 2);
      if (agreeVotes >= majorityThreshold) {
        await storage.updateExpenseStatus(expense.id, "CONFIRMED");
        await storage.updateExpenseVotes(expense.id, votes);
        approvedCount++;
      } else {
        await storage.updateExpenseVotes(expense.id, votes);
      }
    }
    if (approvedCount > 0) {
      bot.sendMessage(chatId, `\u2705 You approved ${pendingExpenses.length} expense(s). ${approvedCount} expense(s) now confirmed with majority approval.`);
    } else {
      bot.sendMessage(chatId, `\u2705 You approved ${pendingExpenses.length} expense(s). Waiting for more approvals to confirm.`);
    }
  });
  bot.onText(/\/reject/, async (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from?.username;
    if (!username) {
      bot.sendMessage(chatId, "\u274C Could not identify you. Please ensure you have a Telegram username.");
      return;
    }
    const event = await storage.getEventByTelegramGroupId(chatId.toString());
    if (!event) {
      bot.sendMessage(chatId, "\u274C This group is not linked to any event.");
      return;
    }
    const expenses = await storage.getExpensesForEvent(event.id);
    const pendingExpenses = expenses.filter(
      (e) => e.status === "PENDING" && e.splitAmong?.includes(username)
    );
    if (pendingExpenses.length === 0) {
      bot.sendMessage(chatId, "\u2705 No pending expenses require your approval.");
      return;
    }
    let rejectedCount = 0;
    for (const expense of pendingExpenses) {
      const votes = expense.votes || {};
      votes[username] = "disagree";
      await storage.updateExpenseStatus(expense.id, "REJECTED");
      await storage.updateExpenseVotes(expense.id, votes);
      rejectedCount++;
    }
    bot.sendMessage(chatId, `\u274C You rejected ${rejectedCount} expense(s). These expenses have been cancelled.`);
  });
  bot.onText(/\/help/, (msg) => {
    const helpText = `
\u{1F916} *PLANPAL Bot \\- 100% Functional Commands*

*\u{1F517} Setup Commands:*
/start \\<eventcode\\> \\- Initialize bot with your event \\(Private Chat\\)
/startevent \\<eventcode\\> \\- Link this group to your event \\(Group Chat\\)

*\u{1F4B0} Expense Tracking:*
/addexpense \\<amount\\> \\<description\\> @mentions \\- Add expense with participants
  Example: \`/addexpense 1200 Team dinner @alice @bob\`
  
\u{1F4F7} *Photo Expenses:* Send photo with caption:
  \`/addexpense Team lunch @alice @bob\` \\(amount auto\\-extracted\\)

*\u2705 Expense Approval:*
/approve \\- Approve pending expenses you're mentioned in
/reject \\- Reject pending expenses you're mentioned in
  
*\u{1F4CA} Reports & Summaries:*
/summary \\- View total confirmed expenses
/report \\- Detailed expense breakdown with settlements

*\u{1F4B8} Payment Tracking:*
/paid @username \\<amount\\> \\- Record payment made
  Example: \`/paid @alice 600\`
/confirmpayment @username \\<amount\\> \\- Confirm payment received
  Example: \`/confirmpayment @bob 600\`

*\u2699\uFE0F Event Management:*
/closeevent \\- Close event \\(requires all expenses confirmed\\)
/help \\- Show this comprehensive help

*\u{1F3AF} Key Features:*
\u2022 OCR invoice processing from photos
\u2022 Manual fallback for unclear images
\u2022 Automatic expense splitting
\u2022 Consensus\\-based approvals
\u2022 Smart settlement calculations

*\u{1F4A1} Pro Tips:*
\u2022 Mention participants for expense splitting
\u2022 Upload clear invoice photos for auto\\-extraction
\u2022 All amounts in \u20B9 \\(INR\\)
\u2022 Bot guides you through manual entry if needed
\u2022 Approve/reject expenses you're mentioned in
    `;
    bot.sendMessage(msg.chat.id, helpText, { parse_mode: "MarkdownV2" });
  });
}
export {
  setupTelegramBot
};
