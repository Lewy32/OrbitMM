/**
 * Wallet Command Handlers
 * 
 * /wallet generate [count] - Generate new wallets
 * /wallet balance - Check wallet balances
 */

import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../index.js';
import {
  formatAddress,
  formatSol,
  formatKeyValue,
  formatSuccess,
  formatError,
  formatLoading,
  formatWarning,
  code,
  bold,
} from '../utils/format.js';

// Mock implementations until core module is connected
// TODO: Replace with actual @orbitmm/core imports

interface WalletData {
  publicKey: string;
  balance?: number;
}

// Temporary in-memory storage (will be replaced with actual wallet storage)
let generatedWallets: WalletData[] = [];

function mockGenerateWallets(count: number): WalletData[] {
  const wallets: WalletData[] = [];
  for (let i = 0; i < count; i++) {
    // Generate mock base58 public key
    const chars = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let pubkey = '';
    for (let j = 0; j < 44; j++) {
      pubkey += chars[Math.floor(Math.random() * chars.length)];
    }
    wallets.push({ publicKey: pubkey });
  }
  return wallets;
}

async function mockGetBalances(wallets: WalletData[]): Promise<Map<string, number>> {
  // Simulate API delay
  await new Promise((r) => setTimeout(r, 500));
  
  const balances = new Map<string, number>();
  for (const wallet of wallets) {
    // Random balance between 0 and 1 SOL for demo
    balances.set(wallet.publicKey, Math.random() * 1_000_000_000);
  }
  return balances;
}

/**
 * Register wallet command handlers.
 */
export function registerWalletHandlers(bot: Bot<BotContext>): void {
  // ---- /wallet generate [count] ----
  bot.command('wallet', async (ctx) => {
    const args = ctx.match?.split(/\s+/) ?? [];
    const subcommand = args[0]?.toLowerCase();

    if (!subcommand) {
      await ctx.reply(
        `💼 <b>Wallet Commands</b>\n\n` +
        `<code>/wallet generate [count]</code> - Generate new wallets\n` +
        `<code>/wallet balance</code> - Check all wallet balances`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    switch (subcommand) {
      case 'generate':
      case 'gen':
        await handleWalletGenerate(ctx, args.slice(1));
        break;
      case 'balance':
      case 'bal':
        await handleWalletBalance(ctx);
        break;
      default:
        await ctx.reply(formatError(`Unknown subcommand: ${subcommand}`), { parse_mode: 'HTML' });
    }
  });
}

/**
 * Handle /wallet generate [count]
 */
async function handleWalletGenerate(ctx: BotContext, args: string[]): Promise<void> {
  const countStr = args[0] ?? '1';
  const count = parseInt(countStr, 10);

  // Validate count
  if (isNaN(count) || count < 1) {
    await ctx.reply(formatError('Invalid count. Must be a positive number.'), { parse_mode: 'HTML' });
    return;
  }

  if (count > 100) {
    await ctx.reply(formatError('Maximum 100 wallets per generation via Telegram.'), { parse_mode: 'HTML' });
    return;
  }

  // Confirm for large generations
  if (count > 10) {
    const keyboard = new InlineKeyboard()
      .text('✅ Confirm', `wallet:generate:${count}`)
      .text('❌ Cancel', 'wallet:cancel');

    ctx.session.pendingConfirmation = {
      action: `wallet:generate:${count}`,
      data: { count },
      expiresAt: Date.now() + 60_000, // 1 minute expiry
    };

    await ctx.reply(
      formatWarning(`You are about to generate ${bold(String(count))} wallets.\n\nThis will create new random keypairs. Continue?`),
      { parse_mode: 'HTML', reply_markup: keyboard }
    );
    return;
  }

  await doGenerateWallets(ctx, count);
}

/**
 * Actually generate wallets.
 */
async function doGenerateWallets(ctx: BotContext, count: number): Promise<void> {
  const loadingMsg = await ctx.reply(formatLoading(`Generating ${count} wallet${count !== 1 ? 's' : ''}`), {
    parse_mode: 'HTML'
  });

  try {
    // TODO: Replace with actual core module call
    // const keypairs = generate({ count, derivation: 'random' });
    const wallets = mockGenerateWallets(count);
    generatedWallets.push(...wallets);

    // Build response
    let response = formatSuccess(`Generated ${count} wallet${count !== 1 ? 's' : ''}`);
    response += '\n\n';

    // Show first 5 wallets
    const displayCount = Math.min(5, wallets.length);
    for (let i = 0; i < displayCount; i++) {
      response += `${i + 1}. ${formatAddress(wallets[i].publicKey)}\n`;
    }

    if (wallets.length > displayCount) {
      response += `\n<i>... and ${wallets.length - displayCount} more</i>`;
    }

    response += `\n\n💡 <i>Use /wallet balance to check balances</i>`;

    await ctx.api.editMessageText(
      ctx.chat!.id,
      loadingMsg.message_id,
      response,
      { parse_mode: 'HTML' }
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    await ctx.api.editMessageText(
      ctx.chat!.id,
      loadingMsg.message_id,
      formatError('Failed to generate wallets', errorMessage),
      { parse_mode: 'HTML' }
    );
  }
}

/**
 * Handle /wallet balance
 */
async function handleWalletBalance(ctx: BotContext): Promise<void> {
  if (generatedWallets.length === 0) {
    await ctx.reply(
      `💼 <b>No Wallets Found</b>\n\n` +
      `Generate wallets first with:\n` +
      `<code>/wallet generate 10</code>`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  const loadingMsg = await ctx.reply(
    formatLoading(`Fetching balances for ${generatedWallets.length} wallet${generatedWallets.length !== 1 ? 's' : ''}`),
    { parse_mode: 'HTML' }
  );

  try {
    // TODO: Replace with actual core module call
    // const balances = await getBalances(connection, addresses);
    const balances = await mockGetBalances(generatedWallets);

    // Calculate totals
    let totalBalance = 0;
    for (const balance of balances.values()) {
      totalBalance += balance;
    }

    // Build response
    let response = `💼 <b>Wallet Balances</b>\n\n`;

    // Show first 10 wallets
    const walletList = Array.from(balances.entries());
    const displayCount = Math.min(10, walletList.length);

    for (let i = 0; i < displayCount; i++) {
      const [pubkey, balance] = walletList[i];
      response += `${formatAddress(pubkey, 4)} → ${formatSol(balance)}\n`;
    }

    if (walletList.length > displayCount) {
      response += `\n<i>... and ${walletList.length - displayCount} more wallets</i>\n`;
    }

    response += '\n' + formatKeyValue({
      'Total Wallets': walletList.length,
      'Total Balance': formatSol(totalBalance),
      'Average': formatSol(totalBalance / walletList.length),
    });

    await ctx.api.editMessageText(
      ctx.chat!.id,
      loadingMsg.message_id,
      response,
      { parse_mode: 'HTML' }
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    await ctx.api.editMessageText(
      ctx.chat!.id,
      loadingMsg.message_id,
      formatError('Failed to fetch balances', errorMessage),
      { parse_mode: 'HTML' }
    );
  }
}

// Handle callback queries for wallet commands
export function handleWalletCallback(bot: Bot<BotContext>): void {
  bot.callbackQuery(/^wallet:generate:(\d+)$/, async (ctx) => {
    const count = parseInt(ctx.match[1], 10);
    await ctx.answerCallbackQuery({ text: '🔄 Generating...' });
    await ctx.deleteMessage();
    await doGenerateWallets(ctx, count);
  });

  bot.callbackQuery('wallet:cancel', async (ctx) => {
    await ctx.answerCallbackQuery({ text: '❌ Cancelled' });
    await ctx.deleteMessage();
  });
}
