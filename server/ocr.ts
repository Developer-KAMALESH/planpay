import Tesseract from 'tesseract.js';
import { log } from './index.js';

export interface OCRResult {
  text: string;
  confidence: number;
  amount?: number;
  description?: string;
  merchantName?: string;
  isUnclear: boolean;
  detectedAmounts?: Array<{amount: number, priority: number, context: string}>;
}

export interface ConversationState {
  userId: string;
  step: 'awaiting_amount' | 'awaiting_description' | 'awaiting_confirmation' | 'awaiting_expense_vote' | 'awaiting_amount_selection';
  mentions: string[];
  amount?: number;
  description?: string;
  originalImageData?: Buffer;
  eventId?: number;
  expenseId?: number; // For expense voting
  detectedAmounts?: Array<{amount: number, priority: number, context: string}>; // For amount selection
  timestamp: number;
}

// Store conversation states in memory (in production, use Redis or database)
const conversationStates = new Map<string, ConversationState>();

export class OCRService {
  private static readonly CONFIDENCE_THRESHOLD = 70; // Slightly higher threshold for better accuracy
  private static readonly MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
  private static readonly PROCESSING_TIMEOUT = 30000; // 30 seconds
  private static readonly AMOUNT_PATTERNS = [
    // Highest priority - explicit total patterns with currency (more comprehensive)
    /(?:Total|Grand Total|Net Total|Final Total|Bill Total|Invoice Total)[:\s]*₹?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/gi,
    /₹\s*(\d+(?:,\d{3})*(?:\.\d{2})?)\s*(?:Total|Grand Total|Net Total|Bill Total|Invoice Total)/gi,
    
    // Very high priority - Net Amount patterns (common in sales invoices)
    /(?:Net Amount|Net Total)[:\s]*₹?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/gi,
    /₹\s*(\d+(?:,\d{3})*(?:\.\d{2})?)\s*(?:Net Amount|Net Total)/gi,
    
    // Very high priority - amount payable patterns
    /(?:Amount Payable|Total Payable|Net Payable)[:\s]*₹?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/gi,
    /₹\s*(\d+(?:,\d{3})*(?:\.\d{2})?)\s*(?:Payable|Due)/gi,
    
    // High priority - amount/total patterns
    /(?:Total Amount|Bill Amount|Amount Due|Final Amount|Invoice Amount)[:\s]*₹?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/gi,
    /(?:Pay|Due Amount)[:\s]*₹?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/gi,
    
    // High priority - amount in words context (common in Indian invoices)
    /(?:Rupee|Rupees)\s+.*?(\d+(?:,\d{3})*(?:\.\d{2})?)/gi,
    /(\d+(?:,\d{3})*(?:\.\d{2})?)\s*(?:Only|Rupees?\s+Only)/gi,
    
    // High priority - patterns for garbled OCR text (like ]z41300 -> 4130.00)
    /[^\d]*(\d{4,})(?:\.?00)?\s*(?:\n|$)/g,
    
    // Medium-high priority - end of line totals (common in invoices)
    /Total[:\s]*₹?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)\s*$/gim,
    /₹\s*(\d+(?:,\d{3})*(?:\.\d{2})?)\s*Total\s*$/gim,
    
    // Medium priority - currency patterns in likely total contexts
    /₹\s*(\d+(?:,\d{3})*(?:\.\d{2})?)\s*(?:\n|$|\.)/g,
    /Rs\.?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)\s*(?:\n|$|\.)/g,
    
    // Lower priority - standalone currency patterns
    /₹\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/g,
    /Rs\.?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/g,
    /INR\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/g,
    
    // Reverse patterns (amount before currency)
    /(\d+(?:,\d{3})*(?:\.\d{2})?)\s*₹/g,
    /(\d+(?:,\d{3})*(?:\.\d{2})?)\s*Rs\.?/g,
    /(\d+(?:,\d{3})*(?:\.\d{2})?)\s*INR/g,
  ];

  static async processInvoiceImage(imageBuffer: Buffer): Promise<OCRResult> {
    try {
      // Check image size
      if (imageBuffer.length > this.MAX_IMAGE_SIZE) {
        log(`Image too large: ${imageBuffer.length} bytes`, 'ocr');
        return {
          text: '',
          confidence: 0,
          isUnclear: true
        };
      }

      log(`Starting OCR processing for ${imageBuffer.length} byte image...`, 'ocr');
      
      // Set up timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('OCR processing timeout')), this.PROCESSING_TIMEOUT);
      });

      const ocrPromise = Tesseract.recognize(imageBuffer, 'eng', {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            log(`OCR Progress: ${Math.round(m.progress * 100)}%`, 'ocr');
          }
        }
      });

      const { data } = await Promise.race([ocrPromise, timeoutPromise]);

      const result: OCRResult = {
        text: data.text,
        confidence: data.confidence,
        isUnclear: data.confidence < this.CONFIDENCE_THRESHOLD
      };

      // Extract amount
      const extractionResult = this.extractAmountFromText(data.text);
      result.amount = extractionResult.topAmount || undefined;
      
      // Store all detected amounts for user selection
      (result as any).detectedAmounts = extractionResult.amounts;
      
      // Extract description
      result.description = this.extractDescriptionFromText(data.text);
      
      // Extract merchant name
      result.merchantName = this.extractMerchantFromText(data.text);

      // Mark as unclear if no amount found or confidence too low
      // But allow processing if we have high-confidence amount detection from reliable patterns
      const hasReliableAmount = result.amount && (
        // Check if amount was found via high-priority patterns
        result.text.toLowerCase().includes('net amount') ||
        result.text.toLowerCase().includes('rupee') && result.text.toLowerCase().includes('only') ||
        result.text.toLowerCase().includes('total')
      );
      
      if (!result.amount || (result.confidence < this.CONFIDENCE_THRESHOLD && !hasReliableAmount)) {
        result.isUnclear = true;
      }

      log(`OCR completed. Confidence: ${result.confidence}%, Amount: ${result.amount}, Unclear: ${result.isUnclear}`, 'ocr');
      
      // Debug: Log the full OCR text for troubleshooting
      if (process.env.NODE_ENV !== 'production') {
        log(`OCR Full Text:\n${data.text}`, 'ocr-debug');
      }
      
      return result;
    } catch (error) {
      if (error instanceof Error && error.message === 'OCR processing timeout') {
        log('OCR processing timed out', 'ocr');
      } else {
        log(`OCR processing failed: ${error}`, 'ocr');
      }
      return {
        text: '',
        confidence: 0,
        isUnclear: true
      };
    }
  }

  static extractAmountFromText(text: string): { amounts: Array<{amount: number, priority: number, context: string}>, topAmount: number | null } {
    const foundAmounts: { amount: number; priority: number; context: string; pattern: string; linePosition: number }[] = [];
    const lines = text.split('\n');
    
    // Special handling for "amount in words" - very reliable in Indian invoices
    const amountInWordsMatch = text.match(/(?:Indian\s+)?Rupees?\s+.*?(\d+(?:,\d{3})*(?:\.\d{2})?)\s*Only/gi);
    if (amountInWordsMatch) {
      amountInWordsMatch.forEach(match => {
        const amountMatch = match.match(/(\d+(?:,\d{3})*(?:\.\d{2})?)/);
        if (amountMatch) {
          const amount = parseFloat(amountMatch[1].replace(/,/g, ''));
          if (!isNaN(amount) && amount > 0) {
            foundAmounts.push({
              amount,
              priority: 30, // Highest priority for amount in words
              context: match,
              pattern: 'amount-in-words',
              linePosition: 0
            });
          }
        }
      });
    }
    
    // Also try to extract from number words (Four Thousand One Hundred Thirty -> 4130)
    const numberWordsMatch = text.match(/(?:Indian\s+)?Rupees?\s+([A-Za-z\s]+)Only/gi);
    if (numberWordsMatch) {
      numberWordsMatch.forEach(match => {
        const wordsText = match.replace(/(?:Indian\s+)?Rupees?\s+/gi, '').replace(/\s*Only/gi, '');
        const amount = this.convertWordsToNumber(wordsText);
        if (amount > 0) {
          foundAmounts.push({
            amount,
            priority: 28, // Very high priority for converted words
            context: match,
            pattern: 'words-to-number',
            linePosition: 0
          });
        }
      });
    }
    
    // Special handling for "Net Amount" patterns (common in sales invoices)
    const netAmountMatch = text.match(/Net\s+Amount[:\s]*(\d+(?:,\d{3})*(?:\.\d{2})?)/gi);
    if (netAmountMatch) {
      netAmountMatch.forEach(match => {
        const amountMatch = match.match(/(\d+(?:,\d{3})*(?:\.\d{2})?)/);
        if (amountMatch) {
          const amount = parseFloat(amountMatch[1].replace(/,/g, ''));
          if (!isNaN(amount) && amount > 0) {
            foundAmounts.push({
              amount,
              priority: 26, // Very high priority for Net Amount
              context: match,
              pattern: 'net-amount',
              linePosition: 0
            });
          }
        }
      });
    }
    
    for (let i = 0; i < this.AMOUNT_PATTERNS.length; i++) {
      const pattern = this.AMOUNT_PATTERNS[i];
      const matches = Array.from(text.matchAll(pattern));
      
      if (matches.length > 0) {
        // Higher priority for patterns that explicitly mention "total" or currency
        let basePriority = 1;
        if (i < 2) basePriority = 25;      // Explicit total patterns
        else if (i < 4) basePriority = 24; // Net Amount patterns
        else if (i < 6) basePriority = 22; // Amount payable patterns  
        else if (i < 8) basePriority = 18; // Amount/total patterns
        else if (i < 10) basePriority = 16; // Amount in words patterns
        else if (i < 11) basePriority = 14; // Garbled OCR patterns
        else if (i < 13) basePriority = 12; // End of line totals
        else if (i < 15) basePriority = 8;  // Currency in context
        else if (i < 18) basePriority = 4;  // Standalone currency
        else basePriority = 2;              // Reverse patterns
        
        matches.forEach(match => {
          const amountStr = match[1].replace(/,/g, '');
          const amount = parseFloat(amountStr);
          
          if (!isNaN(amount) && amount > 0) {
            // Get context around the match for better decision making
            const matchIndex = match.index || 0;
            const contextStart = Math.max(0, matchIndex - 50);
            const contextEnd = Math.min(text.length, matchIndex + match[0].length + 50);
            const context = text.substring(contextStart, contextEnd).toLowerCase();
            
            // Find which line this match is on (for position-based priority)
            let linePosition = 0;
            let charCount = 0;
            for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
              if (charCount + lines[lineIdx].length >= matchIndex) {
                linePosition = lineIdx;
                break;
              }
              charCount += lines[lineIdx].length + 1; // +1 for newline
            }
            
            let adjustedPriority = basePriority;
            
            // Boost priority significantly for total-related keywords
            if (context.includes('total') || context.includes('payable') || context.includes('amount due')) {
              adjustedPriority += 15;
            }
            
            // Boost priority for amount in words context (very reliable in Indian invoices)
            if (context.includes('rupee') || context.includes('only') || context.includes('words')) {
              adjustedPriority += 12;
            }
            
            // Boost priority for invoice/bill related terms
            if (context.includes('invoice') || context.includes('bill')) {
              adjustedPriority += 8;
            }
            
            // Boost priority if it's near the end of the document (totals usually at bottom)
            const relativePosition = linePosition / lines.length;
            if (relativePosition > 0.7) { // Last 30% of document
              adjustedPriority += 10;
            } else if (relativePosition > 0.5) { // Middle-bottom section
              adjustedPriority += 5;
            }
            
            // Significantly reduce priority for known non-total contexts
            if (context.includes('hsn') || context.includes('sac') || context.includes('code') || 
                context.includes('rate') || context.includes('qty') || context.includes('quantity') || 
                context.includes('no.') || context.includes('item') || context.includes('product') ||
                context.includes('cgst') || context.includes('sgst') || context.includes('igst') ||
                context.includes('tax') || context.includes('discount') || context.includes('subtotal')) {
              adjustedPriority -= 15;
            }
            
            // Reduce priority for very small amounts (likely not invoice totals)
            if (amount < 100) {
              adjustedPriority -= 10;
            } else if (amount > 1000) {
              // Boost priority for larger amounts (more likely to be totals)
              adjustedPriority += 5;
            }
            
            // Reduce priority if amount appears multiple times (likely item amounts, not totals)
            const amountOccurrences = (text.match(new RegExp(amountStr.replace(/\./g, '\\.'), 'g')) || []).length;
            if (amountOccurrences > 2) {
              adjustedPriority -= 8;
            }
            
            foundAmounts.push({ 
              amount, 
              priority: adjustedPriority, 
              context,
              pattern: pattern.toString(),
              linePosition
            });
          }
        });
      }
    }
    
    if (foundAmounts.length === 0) return { amounts: [], topAmount: null };
    
    // Sort by priority first, then by amount (larger amounts often more relevant for invoices)
    foundAmounts.sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority;
      return b.amount - a.amount;
    });
    
    // Remove duplicates and get top 3 unique amounts
    const uniqueAmounts = [];
    const seenAmounts = new Set();
    
    for (const item of foundAmounts) {
      if (!seenAmounts.has(item.amount) && uniqueAmounts.length < 3) {
        seenAmounts.add(item.amount);
        uniqueAmounts.push({
          amount: item.amount,
          priority: item.priority,
          context: item.context.trim().substring(0, 80) + (item.context.length > 80 ? '...' : '')
        });
      }
    }
    
    // Log the top candidates for debugging
    console.log('OCR Amount candidates (top 3):', uniqueAmounts);
    
    return { 
      amounts: uniqueAmounts, 
      topAmount: uniqueAmounts.length > 0 ? uniqueAmounts[0].amount : null 
    };
  }

  // Helper function to convert number words to actual numbers
  static convertWordsToNumber(words: string): number {
    const wordMap: { [key: string]: number } = {
      'zero': 0, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9,
      'ten': 10, 'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15, 'sixteen': 16, 'seventeen': 17, 'eighteen': 18, 'nineteen': 19,
      'twenty': 20, 'thirty': 30, 'forty': 40, 'fifty': 50, 'sixty': 60, 'seventy': 70, 'eighty': 80, 'ninety': 90,
      'hundred': 100, 'thousand': 1000, 'lakh': 100000, 'crore': 10000000
    };

    const cleanWords = words.toLowerCase().replace(/[^\w\s]/g, '').trim();
    const wordArray = cleanWords.split(/\s+/);
    
    let total = 0;
    let current = 0;
    
    for (const word of wordArray) {
      if (wordMap[word] !== undefined) {
        const value = wordMap[word];
        if (value === 100) {
          current = current === 0 ? 100 : current * 100;
        } else if (value === 1000) {
          total += current === 0 ? 1000 : current * 1000;
          current = 0;
        } else if (value === 100000) { // lakh
          total += current === 0 ? 100000 : current * 100000;
          current = 0;
        } else if (value === 10000000) { // crore
          total += current === 0 ? 10000000 : current * 10000000;
          current = 0;
        } else {
          current += value;
        }
      }
    }
    
    return total + current;
  }

  static extractDescriptionFromText(text: string): string {
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    // Look for merchant name or description in first few lines
    for (let i = 0; i < Math.min(5, lines.length); i++) {
      const line = lines[i];
      // Skip lines that are just amounts or common invoice terms
      if (!/^\d+[\d,.\s₹INRRs]*$/.test(line) && 
          !/^(invoice|bill|receipt|total|amount|date|time)$/i.test(line) &&
          line.length > 3 && line.length < 50) {
        return line;
      }
    }
    
    return 'Expense from invoice';
  }

  static extractMerchantFromText(text: string): string | undefined {
    const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    
    // First non-empty line is often the merchant name
    if (lines.length > 0) {
      const firstLine = lines[0];
      if (firstLine.length > 2 && firstLine.length < 50 && 
          !/^\d+/.test(firstLine)) {
        return firstLine;
      }
    }
    
    return undefined;
  }

  static shouldTriggerManualEntry(result: OCRResult): boolean {
    return result.isUnclear || !result.amount || result.confidence < this.CONFIDENCE_THRESHOLD;
  }

  static shouldShowAmountOptions(result: OCRResult): boolean {
    // Show amount options if we have multiple detected amounts or confidence is moderate
    return (result.detectedAmounts && result.detectedAmounts.length > 1) || 
           (result.confidence >= 50 && result.confidence < this.CONFIDENCE_THRESHOLD && !!result.amount);
  }

  static validateOCRConfidence(result: OCRResult): boolean {
    return result.confidence >= this.CONFIDENCE_THRESHOLD && !!result.amount;
  }
}

export class ManualEntryHandler {
  static initiateAmountSelection(userId: string, mentions: string[], detectedAmounts: Array<{amount: number, priority: number, context: string}>, eventId?: number): void {
    const state: ConversationState = {
      userId,
      step: 'awaiting_amount_selection',
      mentions,
      detectedAmounts,
      eventId,
      timestamp: Date.now()
    };
    
    conversationStates.set(userId, state);
    log(`Amount selection initiated for user ${userId} with ${detectedAmounts.length} options`, 'manual-entry');
  }

  static initiateExpenseVoting(userId: string, expenseId: number, eventId: number): void {
    const state: ConversationState = {
      userId,
      step: 'awaiting_expense_vote',
      mentions: [],
      expenseId,
      eventId,
      timestamp: Date.now()
    };
    
    conversationStates.set(userId, state);
    log(`Expense voting initiated for user ${userId}, expense ${expenseId}`, 'manual-entry');
  }

  static initiateManualEntry(userId: string, mentions: string[], eventId?: number): void {
    const state: ConversationState = {
      userId,
      step: 'awaiting_amount',
      mentions,
      eventId,
      timestamp: Date.now()
    };
    
    conversationStates.set(userId, state);
    log(`Manual entry initiated for user ${userId}`, 'manual-entry');
  }

  static getConversationState(userId: string): ConversationState | undefined {
    const state = conversationStates.get(userId);
    
    // Clean up expired states (30 minutes)
    if (state && Date.now() - state.timestamp > 30 * 60 * 1000) {
      conversationStates.delete(userId);
      return undefined;
    }
    
    return state;
  }

  static updateConversationState(userId: string, updates: Partial<ConversationState>): void {
    const state = conversationStates.get(userId);
    if (state) {
      Object.assign(state, updates, { timestamp: Date.now() });
      conversationStates.set(userId, state);
    }
  }

  static completeManualEntry(userId: string): ConversationState | undefined {
    const state = conversationStates.get(userId);
    if (state) {
      conversationStates.delete(userId);
      log(`Manual entry completed for user ${userId}`, 'manual-entry');
    }
    return state;
  }

  static cancelManualEntry(userId: string): void {
    conversationStates.delete(userId);
    log(`Manual entry cancelled for user ${userId}`, 'manual-entry');
  }

  static cleanupExpiredStates(): void {
    const now = Date.now();
    const expiredThreshold = 30 * 60 * 1000; // 30 minutes
    
    for (const [userId, state] of Array.from(conversationStates.entries())) {
      if (now - state.timestamp > expiredThreshold) {
        conversationStates.delete(userId);
        log(`Cleaned up expired conversation state for user ${userId}`, 'manual-entry');
      }
    }
  }
}

// Clean up expired states every 10 minutes
setInterval(() => {
  ManualEntryHandler.cleanupExpiredStates();
}, 10 * 60 * 1000);