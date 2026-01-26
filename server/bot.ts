import TelegramBot from 'node-telegram-bot-api';
import { storage } from './storage';
import { format } from 'date-fns';
import { OCRService, ManualEntryHandler } from './ocr.js';
import { log } from './index.js';

export function setupTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    log('No Telegram bot token found', 'bot');
    return;
  }

  log('Setting up Telegram bot...', 'bot');
  
  // First, stop any existing polling
  const bot = new TelegramBot(token, { polling: false });
  
  // Clear any existing webhooks
  bot.deleteWebHook().then(() => {
    log('Cleared existing webhooks', 'bot');
    
    // Now start polling with conflict resolution
    bot.startPolling({
      restart: true,
      polling: {
        interval: 2000,
        autoStart: false,
        params: {
          timeout: 10,
          allowed_updates: ['message', 'callback_query']
        }
      }
    });
    
    log('Bot polling started', 'bot');
  }).catch((error) => {
    log(`Error clearing webhooks: ${error.message}`, 'bot-error');
    // Try to start polling anyway
    bot.startPolling();
  });

  // Handle polling errors with automatic recovery
  bot.on('polling_error', (error) => {
    log(`Polling error: ${error.message}`, 'bot-error');
    if (error.message.includes('409 Conflict')) {
      log('Bot conflict detected - stopping and restarting polling', 'bot-error');
      bot.stopPolling().then(() => {
        setTimeout(() => {
          log('Restarting bot polling after conflict', 'bot');
          bot.startPolling();
        }, 5000); // Wait 5 seconds before restarting
      });
    }
  });

  // Debug: Log all messages
  bot.on('message', (msg) => {
    log(`Message received: type=${msg.chat.type}, from=${msg.from?.username}, text="${msg.text}", caption="${msg.caption}", has_photo=${!!msg.photo}, has_document=${!!msg.document}`, 'bot-debug');
  });

  // Handle document messages (images sent as files)
  bot.on('document', async (msg) => {
    const chatId = msg.chat.id;
    const caption = msg.caption || '';
    
    log(`Document received in chat ${chatId} with caption: "${caption}", mime_type: ${msg.document?.mime_type}`, 'bot');
    
    // Check if it's an image document with /addexpense caption
    if (msg.document?.mime_type?.startsWith('image/') && caption.startsWith('/addexpense')) {
      log(`Processing image document with /addexpense caption: ${caption}`, 'bot');
      
      try {
        const { event, isActive } = await checkEventActive(chatId);
        if (!event) {
          bot.sendMessage(chatId, "❌ This group is not linked to any event. Use /startevent <code> to link.");
          return;
        }
        if (!isActive) return; // Event is closed, message already sent

        const payerUsername = msg.from?.username;
        if (!payerUsername) {
          bot.sendMessage(chatId, "❌ Could not identify you. Please ensure you have a Telegram username.");
          return;
        }

        // Extract mentions from caption
        const mentions = msg.caption_entities?.filter(e => e.type === 'mention').map(e => 
          caption.substring(e.offset + 1, e.offset + e.length)
        ).filter((mention): mention is string => !!mention) || [];

        if (mentions.length === 0) {
          bot.sendMessage(chatId, "⚠️ Please mention participants in the image caption.\nExample: `/addexpense Team lunch @alice @bob`", { parse_mode: 'MarkdownV2' });
          return;
        }

        log(`Processing document with file_id: ${msg.document.file_id}`, 'bot');
        bot.sendMessage(chatId, "📷 Processing invoice image... Please wait.");

        // Download the document
        log(`Getting file link for document...`, 'bot');
        const fileLink = await bot.getFileLink(msg.document.file_id);
        log(`File link obtained: ${fileLink}`, 'bot');
        
        const response = await fetch(fileLink);
        const imageBuffer = Buffer.from(await response.arrayBuffer());
        log(`Image downloaded, size: ${imageBuffer.length} bytes`, 'bot');

        // Process with OCR (same logic as photo handler)
        log(`Starting OCR processing...`, 'bot');
        const ocrResult = await OCRService.processInvoiceImage(imageBuffer);
        log(`OCR completed, result: ${JSON.stringify(ocrResult)}`, 'bot');
        
        if (OCRService.shouldShowAmountOptions(ocrResult)) {
          // Show amount options for user to choose
          ManualEntryHandler.initiateAmountSelection(payerUsername, mentions, ocrResult.detectedAmounts || [], event.id);
          
          let message = "📷 *Invoice processed\\!* I found multiple amounts\\. Please choose:\n\n";
          
          if (ocrResult.detectedAmounts && ocrResult.detectedAmounts.length > 0) {
            ocrResult.detectedAmounts.forEach((item, index) => {
              const contextPreview = item.context.replace(/[_*[\]()~`>#+=|{}.!\\-]/g, '\\$&');
              message += `*${index + 1}\\)* ₹${escapeMarkdown(item.amount.toFixed(2))} \\- _${contextPreview}_\n`;
            });
          }
          
          message += `*${(ocrResult.detectedAmounts?.length || 0) + 1}\\)* Enter manually\n\n`;
          message += `💬 Reply with the number \\(1, 2, 3, etc\\.\\) to select an amount\\.`;
          
          if (ocrResult.description) {
            message += `\n\n💡 Detected description: "${escapeMarkdown(ocrResult.description)}"`;
          }
          
          bot.sendMessage(chatId, message, { parse_mode: 'MarkdownV2' });
          return;
        }
        
        if (OCRService.shouldTriggerManualEntry(ocrResult)) {
          // Trigger manual entry workflow
          ManualEntryHandler.initiateManualEntry(payerUsername, mentions, event.id);
          
          let message = "📷 Image processed, but details are unclear. Let me help you enter them manually.\n\n";
          if (ocrResult.description) {
            message += `💡 Detected description: "${ocrResult.description}"\n\n`;
          }
          message += "💰 Please enter the expense amount (e.g., 1200):";
          
          bot.sendMessage(chatId, message);
          return;
        }

        // OCR was successful, create expense automatically
        const amount = Math.round((ocrResult.amount || 0) * 100);
        const description = ocrResult.description || 'Expense from invoice';
        const splitAmong = Array.from(new Set([payerUsername, ...mentions])); // Remove duplicates

        const expense = await storage.createExpense({
          eventId: event.id,
          amount,
          description,
          payerUsername,
          payerId: 0,
          splitAmong,
          status: mentions.length > 0 ? 'PENDING' : 'CONFIRMED',
        } as any);

        const amountFormatted = escapeMarkdown((amount / 100).toFixed(2));
        let successMessage = `✅ *Invoice processed successfully\\!*\n\n`;
        successMessage += `💰 Amount: ₹${amountFormatted}\n`;
        successMessage += `📝 Description: ${escapeMarkdown(description)}\n`;
        successMessage += `👥 Split among: ${splitAmong.map(u => '@' + escapeMarkdown(u)).join(', ')}\n`;
        if (ocrResult.confidence) {
          successMessage += `🎯 OCR Confidence: ${Math.round(ocrResult.confidence)}%\n`;
        }
        
        if (mentions.length > 0) {
          successMessage += `\n⏳ *Waiting for approval from mentioned participants*\n`;
          successMessage += `💬 Mentioned users can reply: "yes/agree/ok" to approve or "no/reject/disagree" to reject`;
          
          // Get the created expense for voting
          const expenses = await storage.getExpensesForEvent(event.id);
          const createdExpense = expenses.find(e => 
            e.payerUsername === payerUsername && 
            e.amount === amount && 
            e.description === description &&
            e.status === 'PENDING'
          );
          
          if (createdExpense) {
            // Initiate voting state for mentioned users only
            mentions.forEach(mention => {
              ManualEntryHandler.initiateExpenseVoting(mention, createdExpense.id, event.id);
            });
          }
        } else {
          successMessage += `\n✅ Expense confirmed automatically`;
        }

        bot.sendMessage(chatId, successMessage, { parse_mode: 'MarkdownV2' });

      } catch (error) {
        log(`Error processing document: ${error}`, 'bot');
        bot.sendMessage(chatId, "❌ Error processing image. Please try again or enter details manually with `/addexpense <amount> <description> @mentions`", { parse_mode: 'MarkdownV2' });
      }
    }
  });

  const escapeMarkdown = (text: string) => {
    return text.replace(/[_*[\]()~`>#+=|{}.!\\-]/g, '\\$&');
  };

  // Helper function to check if event is active
  const checkEventActive = async (chatId: number): Promise<{ event: any; isActive: boolean }> => {
    const event = await storage.getEventByTelegramGroupId(chatId.toString());
    if (!event) {
      return { event: null, isActive: false };
    }
    
    if (event.status === 'CLOSED') {
      bot.sendMessage(chatId, "❌ This event is closed. No commands are available until a new event is started with /startevent <code>");
      return { event, isActive: false };
    }
    
    return { event, isActive: true };
  };

  bot.onText(/\/start/, (msg) => {
    const helpText = `
🤖 *PLANPAL Bot \\- 100% Functional Commands*

*🔗 Setup Commands:*
/start \\<eventcode\\> \\- Initialize bot with your event \\(Private Chat\\)
/startevent \\<eventcode\\> \\- Link this group to your event \\(Group Chat\\)

*💰 Expense Tracking:*
/addexpense \\<amount\\> \\<description\\> @mentions \\- Add expense with participants
  Example: \`/addexpense 1200 Team dinner @alice @bob\`
  
📷 *Photo Expenses:* Send photo with caption:
  \`/addexpense Team lunch @alice @bob\` \\(amount auto\\-extracted\\)

*✅ Expense Approval:*
/approve \\- Approve pending expenses you're mentioned in
/reject \\- Reject pending expenses you're mentioned in
  
*📊 Reports & Summaries:*
/summary \\- View total confirmed expenses
/report \\- Detailed expense breakdown with settlements

*💸 Payment Tracking:*
/paid @username \\<amount\\> \\- Record payment made
  Example: \`/paid @alice 600\`
/confirmpayment @username \\<amount\\> \\- Confirm payment received
  Example: \`/confirmpayment @bob 600\`

*⚙️ Event Management:*
/closeevent \\- Close event \\(requires all settlements completed\\)
/help \\- Show this comprehensive help

*🎯 Key Features:*
• OCR invoice processing from photos
• Manual fallback for unclear images
• Automatic expense splitting
• Consensus\\-based approvals
• Smart settlement calculations

*💡 Pro Tips:*
• Mention participants for expense splitting
• Upload clear invoice photos for auto\\-extraction
• All amounts in ₹ \\(INR\\)
• Bot guides you through manual entry if needed
• Approve/reject expenses you're mentioned in
    `;
    bot.sendMessage(msg.chat.id, helpText, { parse_mode: 'MarkdownV2' });
  });

  bot.onText(/\/createevent (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const eventName = match?.[1];
    if (!eventName) return;

    try {
      // Generate a random event code
      const code = Math.random().toString(36).substring(2, 8).toUpperCase();
      
      // Create a dummy user for bot-created events
      const botUser = await storage.createUser({
        username: 'telegram_bot',
        password: 'bot_generated'
      });

      // Create the event
      const event = await storage.createEvent({
        code,
        name: eventName,
        date: new Date(),
        location: 'Telegram Group',
        description: `Event created via Telegram bot`,
        creatorId: botUser.id
      });

      // Link the event to this group
      await storage.updateEventTelegramGroup(event.id, chatId.toString());

      let successMessage = `🎉 *Event Created Successfully\\!*\n\n`;
      successMessage += `📝 *Name:* ${escapeMarkdown(eventName)}\n`;
      successMessage += `🔑 *Code:* \`${escapeMarkdown(code)}\`\n`;
      successMessage += `📅 *Created:* ${format(new Date(), "MMM d, yyyy h:mm a")}\n\n`;
      successMessage += `✅ This group is now linked to the event\\!\n`;
      successMessage += `💡 Share the code \`${escapeMarkdown(code)}\` with others to let them join\\.`;

      bot.sendMessage(chatId, successMessage, { parse_mode: 'MarkdownV2' });

    } catch (error) {
      console.error('Error creating event:', error);
      bot.sendMessage(chatId, "❌ Error creating event. Please try again.");
    }
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
    const { event, isActive } = await checkEventActive(chatId);
    if (!event) {
      bot.sendMessage(chatId, "❌ This group is not linked to any event. Use /startevent <code> to link.");
      return;
    }
    if (!isActive) return; // Event is closed, message already sent

    const expenses = await storage.getExpensesForEvent(event.id);
    const confirmedExpenses = expenses.filter(e => e.status === 'CONFIRMED');
    const totalCents = confirmedExpenses.reduce((sum, e) => sum + e.amount, 0);

    let text = `💰 *Event Summary: ${escapeMarkdown(event.name)}*\n`;
    text += `📅 Start: ${format(new Date(event.createdAt || new Date()), "MMM d, yyyy h:mm a")}\n`;
    text += `📍 Status: ${event.status}\n\n`;
    text += `💵 Total Confirmed Expenses: ₹${escapeMarkdown((totalCents / 100).toFixed(2))}\n`;
    text += `📊 Number of Expenses: ${confirmedExpenses.length}\n`;
    
    if (confirmedExpenses.length > 0) {
      text += `\n📋 *Recent Expenses:*\n`;
      const recentExpenses = confirmedExpenses.slice(-3); // Show last 3 expenses
      recentExpenses.forEach(e => {
        text += `• ${escapeMarkdown(e.description)}: ₹${escapeMarkdown((e.amount / 100).toFixed(2))} \\(by @${escapeMarkdown(e.payerUsername || 'unknown')}\\)\n`;
      });
      
      if (confirmedExpenses.length > 3) {
        text += `_\\.\\.\\. and ${confirmedExpenses.length - 3} more expenses_\n`;
      }
    }
    
    bot.sendMessage(chatId, text, { parse_mode: 'MarkdownV2' });
  });

  bot.onText(/\/report/, async (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from?.username;
    
    if (!username) {
      bot.sendMessage(chatId, "❌ Could not identify you. Please ensure you have a Telegram username.");
      return;
    }

    const { event, isActive } = await checkEventActive(chatId);
    if (!event) {
      bot.sendMessage(chatId, "❌ This group is not linked to any event. Use /startevent <code> to link.");
      return;
    }
    if (!isActive) return; // Event is closed, message already sent

    const expenses = await storage.getExpensesForEvent(event.id);
    const payments = await storage.getPaymentsForEvent(event.id);
    const confirmedExpenses = expenses.filter(e => e.status === 'CONFIRMED');
    const confirmedPayments = payments.filter(p => p.status === 'CONFIRMED');

    let report = `📋 *Personal Report for @${escapeMarkdown(username)}*\n`;
    report += `🎯 Event: ${escapeMarkdown(event.name)}\n`;
    report += `📅 Start: ${format(new Date(event.createdAt || new Date()), "MMM d, yyyy h:mm a")}\n\n`;

    // User's expenses (where they paid)
    const userExpenses = confirmedExpenses.filter(e => e.payerUsername === username);
    report += `💰 *Your Expenses \\(${userExpenses.length}\\):*\n`;
    if (userExpenses.length === 0) {
      report += "_None_\n";
    } else {
      userExpenses.forEach(e => {
        const splitCount = e.splitAmong?.length || 1;
        report += `• ${escapeMarkdown(e.description)}: ₹${escapeMarkdown((e.amount / 100).toFixed(2))} \\(split ${splitCount} ways\\)\n`;
      });
    }

    // Expenses user is involved in (mentioned)
    const involvedExpenses = confirmedExpenses.filter(e => 
      e.splitAmong?.includes(username) && e.payerUsername !== username
    );
    report += `\n🤝 *Expenses You're Involved In \\(${involvedExpenses.length}\\):*\n`;
    if (involvedExpenses.length === 0) {
      report += "_None_\n";
    } else {
      involvedExpenses.forEach(e => {
        const splitCount = e.splitAmong?.length || 1;
        const yourShare = e.amount / splitCount;
        report += `• ${escapeMarkdown(e.description)}: ₹${escapeMarkdown((yourShare / 100).toFixed(2))} \\(paid by @${escapeMarkdown(e.payerUsername || 'unknown')}\\)\n`;
      });
    }

    // Calculate personalized balances
    const personalBalances: Record<string, number> = {};
    
    // From expenses where user paid
    userExpenses.forEach(exp => {
      const splitAmong = exp.splitAmong || [];
      const share = exp.amount / splitAmong.length;
      splitAmong.forEach(participant => {
        if (participant !== username) {
          if (!(participant in personalBalances)) personalBalances[participant] = 0;
          personalBalances[participant] -= share; // They owe you
        }
      });
    });
    
    // From expenses where user is mentioned but didn't pay
    involvedExpenses.forEach(exp => {
      const payer = exp.payerUsername;
      if (payer && payer !== username) {
        const splitAmong = exp.splitAmong || [];
        const share = exp.amount / splitAmong.length;
        if (!(payer in personalBalances)) personalBalances[payer] = 0;
        personalBalances[payer] += share; // You owe them
      }
    });

    // Adjust for confirmed payments
    const userPayments = confirmedPayments.filter(p => 
      p.fromUsername === username || p.toUsername === username
    );
    userPayments.forEach(pay => {
      if (pay.fromUsername === username && pay.toUsername) {
        // You paid someone - reduces what you owe them
        if (!(pay.toUsername in personalBalances)) personalBalances[pay.toUsername] = 0;
        personalBalances[pay.toUsername] -= pay.amount;
      } else if (pay.toUsername === username && pay.fromUsername) {
        // Someone paid you - reduces what they owe you
        if (!(pay.fromUsername in personalBalances)) personalBalances[pay.fromUsername] = 0;
        personalBalances[pay.fromUsername] += pay.amount;
      }
    });

    // Show who owes you and whom you owe
    const owesYou: { user: string, amount: number }[] = [];
    const youOwe: { user: string, amount: number }[] = [];
    
    Object.entries(personalBalances).forEach(([user, balance]) => {
      if (balance < -1) {
        owesYou.push({ user, amount: Math.abs(balance) });
      } else if (balance > 1) {
        youOwe.push({ user, amount: balance });
      }
    });

    report += `\n💚 *Members Who Owe You:*\n`;
    if (owesYou.length === 0) {
      report += "_None_\n";
    } else {
      owesYou.forEach(({ user, amount }) => {
        report += `• @${escapeMarkdown(user)}: ₹${escapeMarkdown((amount / 100).toFixed(2))}\n`;
      });
    }

    report += `\n💸 *You Owe:*\n`;
    if (youOwe.length === 0) {
      report += "_None_ ✅\n";
    } else {
      youOwe.forEach(({ user, amount }) => {
        report += `• @${escapeMarkdown(user)}: ₹${escapeMarkdown((amount / 100).toFixed(2))}\n`;
      });
    }

    // Show recent payments involving the user
    if (userPayments.length > 0) {
      report += `\n🔄 *Your Recent Payments:*\n`;
      userPayments.slice(-3).forEach(p => {
        const time = format(new Date(p.createdAt || new Date()), "MMM d, HH:mm");
        if (p.fromUsername === username) {
          report += `• You → @${escapeMarkdown(p.toUsername || 'unknown')} ₹${escapeMarkdown((p.amount / 100).toFixed(2))} \\(${time}\\)\n`;
        } else {
          report += `• @${escapeMarkdown(p.fromUsername || 'unknown')} → You ₹${escapeMarkdown((p.amount / 100).toFixed(2))} \\(${time}\\)\n`;
        }
      });
    }

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
    
    // Check for unsettled balances FIRST
    const confirmedExpenses = expenses.filter(e => e.status === 'CONFIRMED');
    const confirmedPayments = payments.filter(p => p.status === 'CONFIRMED');

    // Calculate net balances
    const netBalances: Record<string, number> = {};
    
    // Add expenses to balances
    confirmedExpenses.forEach(exp => {
      const splitAmong = Array.from(new Set(exp.splitAmong || []));
      const payer = exp.payerUsername;
      if (!payer || splitAmong.length === 0) return;
      const share = exp.amount / splitAmong.length;
      
      // Payer gets credit for others' shares
      if (!(payer in netBalances)) netBalances[payer] = 0;
      netBalances[payer] += share * (splitAmong.length - 1);
      
      // Others owe their share
      splitAmong.forEach(user => {
        if (user === payer) return;
        if (!(user in netBalances)) netBalances[user] = 0;
        netBalances[user] -= share;
      });
    });
    
    // Subtract confirmed payments from balances
    confirmedPayments.forEach(pay => {
      if (!pay.fromUsername || !pay.toUsername) return;
      if (!(pay.fromUsername in netBalances)) netBalances[pay.fromUsername] = 0;
      if (!(pay.toUsername in netBalances)) netBalances[pay.toUsername] = 0;
      // When someone pays: reduce their debt, reduce the receiver's credit
      netBalances[pay.fromUsername] -= pay.amount;  // Payer's debt decreases
      netBalances[pay.toUsername] += pay.amount;    // Receiver's credit decreases (they're owed less)
    });

    // Check if there are unsettled balances (threshold of ₹1 to account for rounding)
    const unsettledBalances = Object.entries(netBalances).filter(([_, balance]) => Math.abs(balance) > 100); // > ₹1

    // Only check pending payments if there are actual unsettled balances
    if (unsettledBalances.length > 0) {
      const pendingPayments = payments.filter(p => p.status === 'PENDING');

      if (pendingPayments.length > 0) {
        bot.sendMessage(chatId, `⚠️ Cannot close event. There are ${pendingPayments.length} pending payments that need confirmation before settling remaining balances.`);
        return;
      }

      let warningMessage = `⚠️ *Cannot close event\\!* There are unsettled balances:\n\n`;
      
      const debtors: { user: string, balance: number }[] = [];
      const creditors: { user: string, balance: number }[] = [];
      
      unsettledBalances.forEach(([user, balance]) => {
        if (balance < -100) { // Owes more than ₹1
          debtors.push({ user, balance: Math.abs(balance) });
        } else if (balance > 100) { // Is owed more than ₹1
          creditors.push({ user, balance });
        }
      });

      warningMessage += `💸 *Outstanding Debts:*\n`;
      
      // Calculate optimal settlements
      let dIdx = 0, cIdx = 0;
      const tempDebtors = JSON.parse(JSON.stringify(debtors));
      const tempCreditors = JSON.parse(JSON.stringify(creditors));
      let totalUnsettled = 0;
      
      while (dIdx < tempDebtors.length && cIdx < tempCreditors.length) {
        const settlement = Math.min(tempDebtors[dIdx].balance, tempCreditors[cIdx].balance);
        warningMessage += `• @${escapeMarkdown(tempDebtors[dIdx].user)} owes @${escapeMarkdown(tempCreditors[cIdx].user)} ₹${escapeMarkdown((settlement / 100).toFixed(2))}\n`;
        
        totalUnsettled += settlement;
        tempDebtors[dIdx].balance -= settlement;
        tempCreditors[cIdx].balance -= settlement;
        
        if (tempDebtors[dIdx].balance < 100) dIdx++;
        if (tempCreditors[cIdx].balance < 100) cIdx++;
      }
      
      warningMessage += `\n💰 *Total Amount to be Settled: ₹${escapeMarkdown((totalUnsettled / 100).toFixed(2))}*\n\n`;
      warningMessage += `📝 Please complete all payments using /paid and /confirmpayment commands before closing the event\\.`;
      
      bot.sendMessage(chatId, warningMessage, { parse_mode: 'MarkdownV2' });
      return;
    }

    // All balances are settled, close the event
    await storage.updateEventStatus(event.id, 'CLOSED');
    bot.sendMessage(chatId, `🏁 *Event Closed Successfully\\!* 🏁\n\nEvent *${escapeMarkdown(event.name)}* has been closed\\. All balances are settled\\!\n\n⚠️ *Note:* No further commands will work in this group until a new event is started\\.`, { parse_mode: 'MarkdownV2' });
  });

  // Handle photo messages with captions
  bot.on('photo', async (msg) => {
    const chatId = msg.chat.id;
    const caption = msg.caption || '';
    
    // Debug: Log all photo messages
    log(`Photo received in chat ${chatId} with caption: "${caption}"`, 'bot');
    
    try {
      // Check if caption starts with /addexpense
      if (!caption.startsWith('/addexpense')) {
        log(`Photo caption doesn't start with /addexpense, ignoring`, 'bot');
        return;
      }

      log(`Processing photo with /addexpense caption: ${caption}`, 'bot');

      const { event, isActive } = await checkEventActive(chatId);
      if (!event) {
        bot.sendMessage(chatId, "❌ This group is not linked to any event. Use /startevent <code> to link.");
        return;
      }
      if (!isActive) return; // Event is closed, message already sent

    const payerUsername = msg.from?.username;
    if (!payerUsername) {
      bot.sendMessage(chatId, "❌ Could not identify you. Please ensure you have a Telegram username.");
      return;
    }

    // Extract mentions from caption
    const mentions = msg.caption_entities?.filter(e => e.type === 'mention').map(e => 
      caption.substring(e.offset + 1, e.offset + e.length)
    ).filter((mention): mention is string => !!mention) || [];

    if (mentions.length === 0) {
      bot.sendMessage(chatId, "⚠️ Please mention participants in the photo caption.\nExample: `/addexpense Team lunch @alice @bob`", { parse_mode: 'MarkdownV2' });
      return;
    }

    // Get the largest photo size
    const photo = msg.photo?.[msg.photo.length - 1];
    if (!photo) {
      bot.sendMessage(chatId, "❌ Could not process photo. Please try again.");
      return;
    }
    
    log(`Processing photo with file_id: ${photo.file_id}`, 'bot');
    bot.sendMessage(chatId, "📷 Processing invoice image... Please wait.");

      // Download the photo
      log(`Getting file link for photo...`, 'bot');
      const fileLink = await bot.getFileLink(photo.file_id);
      log(`File link obtained: ${fileLink}`, 'bot');
      
      const response = await fetch(fileLink);
      const imageBuffer = Buffer.from(await response.arrayBuffer());
      log(`Image downloaded, size: ${imageBuffer.length} bytes`, 'bot');

      // Process with OCR
      log(`Starting OCR processing...`, 'bot');
      const ocrResult = await OCRService.processInvoiceImage(imageBuffer);
      log(`OCR completed, result: ${JSON.stringify(ocrResult)}`, 'bot');
      
      if (OCRService.shouldShowAmountOptions(ocrResult)) {
        // Show amount options for user to choose
        ManualEntryHandler.initiateAmountSelection(payerUsername, mentions, ocrResult.detectedAmounts || [], event.id);
        
        let message = "📷 *Invoice processed\\!* I found multiple amounts\\. Please choose:\n\n";
        
        if (ocrResult.detectedAmounts && ocrResult.detectedAmounts.length > 0) {
          ocrResult.detectedAmounts.forEach((item, index) => {
            const contextPreview = item.context.replace(/[_*[\]()~`>#+=|{}.!\\-]/g, '\\$&');
            message += `*${index + 1}\\)* ₹${escapeMarkdown(item.amount.toFixed(2))} \\- _${contextPreview}_\n`;
          });
        }
        
        message += `*${(ocrResult.detectedAmounts?.length || 0) + 1}\\)* Enter manually\n\n`;
        message += `💬 Reply with the number \\(1, 2, 3, etc\\.\\) to select an amount\\.`;
        
        if (ocrResult.description) {
          message += `\n\n💡 Detected description: "${escapeMarkdown(ocrResult.description)}"`;
        }
        
        bot.sendMessage(chatId, message, { parse_mode: 'MarkdownV2' });
        return;
      }
      
      if (OCRService.shouldTriggerManualEntry(ocrResult)) {
        // Trigger manual entry workflow
        ManualEntryHandler.initiateManualEntry(payerUsername, mentions, event.id);
        
        let message = "📷 Image processed, but details are unclear. Let me help you enter them manually.\n\n";
        if (ocrResult.description) {
          message += `💡 Detected description: "${ocrResult.description}"\n\n`;
        }
        message += "💰 Please enter the expense amount (e.g., 1200):";
        
        bot.sendMessage(chatId, message);
        return;
      }

      // OCR was successful, create expense automatically
      const amount = Math.round((ocrResult.amount || 0) * 100);
      const description = ocrResult.description || 'Expense from invoice';
      const splitAmong = Array.from(new Set([payerUsername, ...mentions])); // Remove duplicates

      const expense = await storage.createExpense({
        eventId: event.id,
        amount,
        description,
        payerUsername,
        payerId: 0,
        splitAmong,
        status: mentions.length > 0 ? 'PENDING' : 'CONFIRMED',
      } as any);

      const amountFormatted = escapeMarkdown((amount / 100).toFixed(2));
      let successMessage = `✅ *Invoice processed successfully\\!*\n\n`;
      successMessage += `💰 Amount: ₹${amountFormatted}\n`;
      successMessage += `📝 Description: ${escapeMarkdown(description)}\n`;
      successMessage += `👥 Split among: ${splitAmong.map(u => '@' + escapeMarkdown(u)).join(', ')}\n`;
      if (ocrResult.confidence) {
        successMessage += `🎯 OCR Confidence: ${Math.round(ocrResult.confidence)}%\n`;
      }
      
      if (mentions.length > 0) {
        successMessage += `\n⏳ *Waiting for approval from mentioned participants*\n`;
        successMessage += `💬 Mentioned users can reply: "yes/agree/ok" to approve or "no/reject/disagree" to reject`;
        
        // Get the created expense for voting
        const expenses = await storage.getExpensesForEvent(event.id);
        const createdExpense = expenses.find(e => 
          e.payerUsername === payerUsername && 
          e.amount === amount && 
          e.description === description &&
          e.status === 'PENDING'
        );
        
        if (createdExpense) {
          // Initiate voting state for mentioned users only
          mentions.forEach(mention => {
            ManualEntryHandler.initiateExpenseVoting(mention, createdExpense.id, event.id);
          });
        }
      } else {
        successMessage += `\n✅ Expense confirmed automatically`;
      }

      bot.sendMessage(chatId, successMessage, { parse_mode: 'MarkdownV2' });

    } catch (error) {
      log(`Error processing photo: ${error}`, 'bot');
      bot.sendMessage(chatId, "❌ Error processing image. Please try again or enter details manually with `/addexpense <amount> <description> @mentions`", { parse_mode: 'MarkdownV2' });
    }
  });

  // Handle manual entry responses and expense voting
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text || '';
    const username = msg.from?.username;
    
    if (!username || text.startsWith('/') || !text.trim()) {
      return; // Skip commands and empty messages
    }

    const conversationState = ManualEntryHandler.getConversationState(username);
    if (!conversationState) {
      return; // No active conversation
    }

    const { event, isActive } = await checkEventActive(chatId);
    if (!event || event.id !== conversationState.eventId) {
      return; // Wrong event or no event
    }
    if (!isActive) return; // Event is closed, message already sent

    try {
      if (conversationState.step === 'awaiting_expense_vote') {
        // Handle inline expense voting
        const response = text.trim().toLowerCase();
        const approvalWords = ['yes', 'agree', 'ok', 'approve', 'confirm', 'y', '✅', '👍'];
        const rejectionWords = ['no', 'reject', 'disagree', 'deny', 'cancel', 'n', '❌', '👎'];
        
        let voteType: 'agree' | 'disagree' | null = null;
        
        if (approvalWords.some(word => response.includes(word))) {
          voteType = 'agree';
        } else if (rejectionWords.some(word => response.includes(word))) {
          voteType = 'disagree';
        } else {
          bot.sendMessage(chatId, `⚠️ Please reply with "yes/agree/ok" to approve or "no/reject/disagree" to reject the expense.`);
          return;
        }
        
        if (!conversationState.expenseId) {
          bot.sendMessage(chatId, "❌ Error: No expense found for voting.");
          ManualEntryHandler.cancelManualEntry(username);
          return;
        }
        
        // Get the expense and update votes
        const expense = await storage.getExpense(conversationState.expenseId);
        if (!expense || expense.status !== 'PENDING') {
          bot.sendMessage(chatId, "❌ This expense is no longer pending approval.");
          ManualEntryHandler.cancelManualEntry(username);
          return;
        }
        
        // Check if user is actually mentioned in this expense
        if (!expense.splitAmong?.includes(username)) {
          bot.sendMessage(chatId, "❌ You are not mentioned in this expense and cannot vote on it.");
          ManualEntryHandler.cancelManualEntry(username);
          return;
        }
        
        const votes = expense.votes || {};
        votes[username] = voteType;
        
        // Check voting results
        const splitAmong = expense.splitAmong || [];
        const agreeVotes = Object.values(votes).filter(v => v === 'agree').length;
        const disagreeVotes = Object.values(votes).filter(v => v === 'disagree').length;
        const totalParticipants = splitAmong.length;
        const majorityThreshold = Math.ceil(totalParticipants / 2);
        
        if (disagreeVotes > 0) {
          // Any disagreement rejects the expense
          await storage.updateExpenseStatus(conversationState.expenseId, 'REJECTED');
          await storage.updateExpenseVotes(conversationState.expenseId, votes);
          
          // Clear voting states for all participants
          splitAmong.forEach(participant => {
            ManualEntryHandler.cancelManualEntry(participant);
          });
          
          const amountFormatted = escapeMarkdown((expense.amount / 100).toFixed(2));
          bot.sendMessage(chatId, `❌ *Expense Rejected\\!*\n\nAmount: ₹${amountFormatted}\nDescription: ${escapeMarkdown(expense.description)}\nReason: Participant disagreement`, { parse_mode: 'MarkdownV2' });
          
        } else if (agreeVotes >= majorityThreshold) {
          // Majority approval confirms the expense
          await storage.updateExpenseStatus(conversationState.expenseId, 'CONFIRMED');
          await storage.updateExpenseVotes(conversationState.expenseId, votes);
          
          // Clear voting states for all participants
          splitAmong.forEach(participant => {
            ManualEntryHandler.cancelManualEntry(participant);
          });
          
          const amountFormatted = escapeMarkdown((expense.amount / 100).toFixed(2));
          bot.sendMessage(chatId, `✅ *Expense Approved\\!*\n\nAmount: ₹${amountFormatted}\nDescription: ${escapeMarkdown(expense.description)}\nApproved by majority consensus`, { parse_mode: 'MarkdownV2' });
          
        } else {
          // Still waiting for more votes
          await storage.updateExpenseVotes(conversationState.expenseId, votes);
          ManualEntryHandler.completeManualEntry(username);
          
          const remainingVotes = totalParticipants - agreeVotes - disagreeVotes;
          bot.sendMessage(chatId, `✅ Your ${voteType === 'agree' ? 'approval' : 'rejection'} recorded. Waiting for ${remainingVotes} more vote(s).`);
        }
        
      } else if (conversationState.step === 'awaiting_amount_selection') {
        // Handle amount selection from OCR options
        const selection = parseInt(text.trim());
        const detectedAmounts = conversationState.detectedAmounts || [];
        
        if (isNaN(selection) || selection < 1 || selection > detectedAmounts.length + 1) {
          bot.sendMessage(chatId, `⚠️ Please enter a valid number (1-${detectedAmounts.length + 1}):`);
          return;
        }
        
        if (selection === detectedAmounts.length + 1) {
          // User chose "Enter manually"
          ManualEntryHandler.updateConversationState(username, {
            step: 'awaiting_amount'
          });
          bot.sendMessage(chatId, "💰 Please enter the expense amount (e.g., 1200):");
          return;
        }
        
        // User selected one of the detected amounts
        const selectedAmount = detectedAmounts[selection - 1];
        ManualEntryHandler.updateConversationState(username, {
          amount: Math.round(selectedAmount.amount * 100),
          step: 'awaiting_description'
        });
        
        const amountFormatted = selectedAmount.amount.toFixed(2);
        bot.sendMessage(chatId, `✅ Selected amount: ₹${amountFormatted}\n\n📝 Now please enter a description for this expense:`);
        
      } else if (conversationState.step === 'awaiting_amount') {
        const amount = parseFloat(text.trim());
        if (isNaN(amount) || amount <= 0) {
          bot.sendMessage(chatId, "⚠️ Please enter a valid amount (numbers only, e.g., 1200):");
          return;
        }

        ManualEntryHandler.updateConversationState(username, {
          amount: Math.round(amount * 100),
          step: 'awaiting_description'
        });

        bot.sendMessage(chatId, "📝 Great! Now please enter a description for this expense:");

      } else if (conversationState.step === 'awaiting_description') {
        const description = text.trim();
        if (description.length < 3) {
          bot.sendMessage(chatId, "⚠️ Please enter a more detailed description (at least 3 characters):");
          return;
        }

        ManualEntryHandler.updateConversationState(username, {
          description,
          step: 'awaiting_confirmation'
        });

        const updatedState = ManualEntryHandler.getConversationState(username);
        if (!updatedState) return;

        const amountFormatted = ((updatedState.amount || 0) / 100).toFixed(2);
        let confirmMessage = `📋 *Please confirm the expense details:*\n\n`;
        confirmMessage += `💰 Amount: ₹${escapeMarkdown(amountFormatted)}\n`;
        confirmMessage += `📝 Description: ${escapeMarkdown(description)}\n`;
        confirmMessage += `👥 Split among: ${updatedState.mentions.map(u => '@' + escapeMarkdown(u)).join(', ')}, @${escapeMarkdown(username)}\n\n`;
        confirmMessage += `Type *confirm* to create expense or *cancel* to abort\\.`;

        bot.sendMessage(chatId, confirmMessage, { parse_mode: 'MarkdownV2' });

      } else if (conversationState.step === 'awaiting_confirmation') {
        const response = text.trim().toLowerCase();
        
        if (response === 'confirm') {
          const finalState = ManualEntryHandler.completeManualEntry(username);
          if (!finalState || !finalState.amount || !finalState.description) {
            bot.sendMessage(chatId, "❌ Error: Missing expense details. Please start over.");
            return;
          }

          const splitAmong = Array.from(new Set([username, ...finalState.mentions])); // Remove duplicates
          
          const expense = await storage.createExpense({
            eventId: event.id,
            amount: finalState.amount,
            description: finalState.description,
            payerUsername: username,
            payerId: 0,
            splitAmong,
            status: finalState.mentions.length > 0 ? 'PENDING' : 'CONFIRMED',
          } as any);

          const amountFormatted = escapeMarkdown((finalState.amount / 100).toFixed(2));
          let successMessage = `✅ *Expense created manually\\!*\n\n`;
          successMessage += `💰 Amount: ₹${amountFormatted}\n`;
          successMessage += `📝 Description: ${escapeMarkdown(finalState.description)}\n`;
          successMessage += `👥 Split among: ${splitAmong.map(u => '@' + escapeMarkdown(u)).join(', ')}\n`;
          
          if (finalState.mentions.length > 0) {
            successMessage += `\n⏳ *Waiting for approval from mentioned participants*\n`;
            successMessage += `💬 Mentioned users can reply: "yes/agree/ok" to approve or "no/reject/disagree" to reject`;
            
            // Get the created expense for voting
            const expenses = await storage.getExpensesForEvent(event.id);
            const createdExpense = expenses.find(e => 
              e.payerUsername === username && 
              e.amount === finalState.amount && 
              e.description === finalState.description &&
              e.status === 'PENDING'
            );
            
            if (createdExpense) {
              // Initiate voting state for mentioned users only
              finalState.mentions.forEach(mention => {
                ManualEntryHandler.initiateExpenseVoting(mention, createdExpense.id, event.id);
              });
            }
          } else {
            successMessage += `\n✅ Expense confirmed automatically`;
          }

          bot.sendMessage(chatId, successMessage, { parse_mode: 'MarkdownV2' });

        } else if (response === 'cancel') {
          ManualEntryHandler.cancelManualEntry(username);
          bot.sendMessage(chatId, "❌ Expense entry cancelled.");
        } else {
          bot.sendMessage(chatId, "⚠️ Please type *confirm* to create the expense or *cancel* to abort\\.", { parse_mode: 'MarkdownV2' });
        }
      }

    } catch (error) {
      log(`Error in manual entry workflow: ${error}`, 'bot');
      ManualEntryHandler.cancelManualEntry(username);
      bot.sendMessage(chatId, "❌ An error occurred. Please try again with `/addexpense <amount> <description> @mentions`", { parse_mode: 'MarkdownV2' });
    }
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

    const { event, isActive } = await checkEventActive(chatId);
    if (!event) {
      bot.sendMessage(chatId, "❌ This group is not linked to any event. Use /startevent <code> to link.");
      return;
    }
    if (!isActive) return; // Event is closed, message already sent

    const amount = Math.round(parseFloat(amountStr) * 100);
    const mentions = msg.entities?.filter(e => e.type === 'mention').map(e => msg.text?.substring(e.offset + 1, e.offset + e.length)).filter((mention): mention is string => !!mention) || [];
    
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

    const splitAmong = Array.from(new Set(mentions.length > 0 ? [payerUsername, ...mentions] : [payerUsername])).filter((m): m is string => !!m);
    
    try {
      const expense = await storage.createExpense({
        eventId: event.id,
        amount,
        description,
        payerUsername,
        payerId: 0, 
        splitAmong,
        status: mentions.length > 0 ? 'PENDING' : 'CONFIRMED',
      } as any);

      const amountFormatted = escapeMarkdown((amount / 100).toFixed(2));
      if (mentions.length > 0) {
        let message = `💰 *Expense Added\\!*\n\n`;
        message += `Amount: ₹${amountFormatted}\n`;
        message += `Description: ${escapeMarkdown(description)}\n`;
        message += `Split among: ${mentions.map(m => '@' + escapeMarkdown(m || 'unknown')).join(', ')}\n\n`;
        message += `⏳ *Waiting for approval from mentioned participants*\n`;
        message += `💬 Mentioned users can reply: "yes/agree/ok" to approve or "no/reject/disagree" to reject`;
        
        bot.sendMessage(chatId, message, { parse_mode: 'MarkdownV2' });
        
        // Get the created expense for voting
        const expenses = await storage.getExpensesForEvent(event.id);
        const createdExpense = expenses.find(e => 
          e.payerUsername === payerUsername && 
          e.amount === amount && 
          e.description === description &&
          e.status === 'PENDING'
        );
        
        if (createdExpense) {
          // Initiate voting state for mentioned users only
          mentions.forEach(mention => {
            ManualEntryHandler.initiateExpenseVoting(mention, createdExpense.id, event.id);
          });
        }
      } else {
        bot.sendMessage(chatId, `✅ Expense of ₹${amountFormatted} for "${escapeMarkdown(description)}" confirmed.`, { parse_mode: 'MarkdownV2' });
      }
    } catch (error) {
      console.error(`[bot] Error creating expense:`, error);
      bot.sendMessage(chatId, "❌ An error occurred while saving the expense.");
    }
  });

  bot.onText(/\/paid (?:@(\w+) (\d+(?:\.\d{2})?)|(\d+(?:\.\d{2})?) @(\w+))/, async (msg, match) => {
    const chatId = msg.chat.id;
    // Handle both formats: /paid @username amount OR /paid amount @username
    const toUsername = match?.[1] || match?.[4];
    const amountStr = match?.[2] || match?.[3];
    if (!toUsername || !amountStr) return;

    const { event, isActive } = await checkEventActive(chatId);
    if (!event) return;
    if (!isActive) return; // Event is closed, message already sent

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

    const amountFormatted = escapeMarkdown((amount / 100).toFixed(2));
    bot.sendMessage(chatId, `Payment of ₹${amountFormatted} recorded from @${escapeMarkdown(fromUsername)} to @${escapeMarkdown(toUsername)}\\. @${escapeMarkdown(toUsername)}, please confirm with /confirmpayment @${escapeMarkdown(fromUsername)} ${amountFormatted}`, { parse_mode: 'MarkdownV2' });
  });

  bot.onText(/\/confirmpayment @(\w+) (\d+(?:\.\d{2})?)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const fromUsername = match?.[1];
    const amountStr = match?.[2];
    if (!fromUsername || !amountStr) return;

    const { event, isActive } = await checkEventActive(chatId);
    if (!event) return;
    if (!isActive) return; // Event is closed, message already sent

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
    const amountFormatted = escapeMarkdown((amount / 100).toFixed(2));
    bot.sendMessage(chatId, `✅ Payment of ₹${amountFormatted} from @${escapeMarkdown(fromUsername)} to @${escapeMarkdown(toUsername)} confirmed\\.`, { parse_mode: 'MarkdownV2' });
  });

  bot.onText(/\/approve/, async (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from?.username;
    
    if (!username) {
      bot.sendMessage(chatId, "❌ Could not identify you. Please ensure you have a Telegram username.");
      return;
    }

    const { event, isActive } = await checkEventActive(chatId);
    if (!event) {
      bot.sendMessage(chatId, "❌ This group is not linked to any event.");
      return;
    }
    if (!isActive) return; // Event is closed, message already sent

    const expenses = await storage.getExpensesForEvent(event.id);
    const pendingExpenses = expenses.filter(e => 
      e.status === 'PENDING' && 
      e.splitAmong?.includes(username)
    );

    if (pendingExpenses.length === 0) {
      bot.sendMessage(chatId, "✅ No pending expenses require your approval.");
      return;
    }

    let approvedCount = 0;
    for (const expense of pendingExpenses) {
      const votes = expense.votes || {};
      votes[username] = 'agree';
      
      // Check if majority agrees (simple majority of splitAmong participants)
      const splitAmong = expense.splitAmong || [];
      const agreeVotes = Object.values(votes).filter(v => v === 'agree').length;
      const totalParticipants = splitAmong.length;
      const majorityThreshold = Math.ceil(totalParticipants / 2);
      
      if (agreeVotes >= majorityThreshold) {
        // Expense is approved
        await storage.updateExpenseStatus(expense.id, 'CONFIRMED');
        await storage.updateExpenseVotes(expense.id, votes);
        approvedCount++;
      } else {
        // Just update votes
        await storage.updateExpenseVotes(expense.id, votes);
      }
    }

    if (approvedCount > 0) {
      bot.sendMessage(chatId, `✅ You approved ${pendingExpenses.length} expense(s). ${approvedCount} expense(s) now confirmed with majority approval.`);
    } else {
      bot.sendMessage(chatId, `✅ You approved ${pendingExpenses.length} expense(s). Waiting for more approvals to confirm.`);
    }
  });

  bot.onText(/\/reject/, async (msg) => {
    const chatId = msg.chat.id;
    const username = msg.from?.username;
    
    if (!username) {
      bot.sendMessage(chatId, "❌ Could not identify you. Please ensure you have a Telegram username.");
      return;
    }

    const { event, isActive } = await checkEventActive(chatId);
    if (!event) {
      bot.sendMessage(chatId, "❌ This group is not linked to any event.");
      return;
    }
    if (!isActive) return; // Event is closed, message already sent

    const expenses = await storage.getExpensesForEvent(event.id);
    const pendingExpenses = expenses.filter(e => 
      e.status === 'PENDING' && 
      e.splitAmong?.includes(username)
    );

    if (pendingExpenses.length === 0) {
      bot.sendMessage(chatId, "✅ No pending expenses require your approval.");
      return;
    }

    let rejectedCount = 0;
    for (const expense of pendingExpenses) {
      const votes = expense.votes || {};
      votes[username] = 'disagree';
      
      // Any disagreement rejects the expense
      await storage.updateExpenseStatus(expense.id, 'REJECTED');
      await storage.updateExpenseVotes(expense.id, votes);
      rejectedCount++;
    }

    bot.sendMessage(chatId, `❌ You rejected ${rejectedCount} expense(s). These expenses have been cancelled.`);
  });

  bot.onText(/\/help/, (msg) => {
    const helpText = `
🤖 *PLANPAL Bot \\- 100% Functional Commands*

*🔗 Setup Commands:*
/start \\<eventcode\\> \\- Initialize bot with your event \\(Private Chat\\)
/startevent \\<eventcode\\> \\- Link this group to your event \\(Group Chat\\)

*💰 Expense Tracking:*
/addexpense \\<amount\\> \\<description\\> @mentions \\- Add expense with participants
  Example: \`/addexpense 1200 Team dinner @alice @bob\`
  
📷 *Photo Expenses:* Send photo with caption:
  \`/addexpense Team lunch @alice @bob\` \\(amount auto\\-extracted\\)

*✅ Expense Approval:*
/approve \\- Approve pending expenses you're mentioned in
/reject \\- Reject pending expenses you're mentioned in
  
*📊 Reports & Summaries:*
/summary \\- View total confirmed expenses
/report \\- Detailed expense breakdown with settlements

*💸 Payment Tracking:*
/paid @username \\<amount\\> \\- Record payment made
  Example: \`/paid @alice 600\`
/confirmpayment @username \\<amount\\> \\- Confirm payment received
  Example: \`/confirmpayment @bob 600\`

*⚙️ Event Management:*
/closeevent \\- Close event \\(requires all settlements completed\\)
/help \\- Show this comprehensive help

*🎯 Key Features:*
• OCR invoice processing from photos
• Manual fallback for unclear images
• Automatic expense splitting
• Consensus\\-based approvals
• Smart settlement calculations

*💡 Pro Tips:*
• Mention participants for expense splitting
• Upload clear invoice photos for auto\\-extraction
• All amounts in ₹ \\(INR\\)
• Bot guides you through manual entry if needed
• Approve/reject expenses you're mentioned in
    `;
    bot.sendMessage(msg.chat.id, helpText, { parse_mode: 'MarkdownV2' });
  });
}
