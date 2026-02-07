/**
 * Stats Command Handlers
 * 
 * /stats - View overall statistics
 */

import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../index.js';
import {
  formatSol,
  formatDuration,
  formatRelativeTime,
  formatPercent,
  formatNumber,
  bold,
  code,
} from '../utils/format.js';

// ============ Types ============

interface OverallStats {
  uptime: number;
  wallets: {
    total: number;
    funded: number;
    totalBalance: number;
  };
  bots: {
    total: number;
    running: number;
    paused: number;
    stopped: number;
  };
  trading: {
    totalSwaps: number;
    successfulSwaps: number;
    failedSwaps: number;
    totalVolume: number;
    feesSpent: number;
  };
  lastUpdate: number;
}

// Mock stats (replace with actual orchestrator/core data)
const startTime = Date.now();

function getMockStats(): OverallStats {
  return {
    uptime: Date.now() - startTime,
    wallets: {
      total: Math.floor(Math.random() * 100) + 10,
      funded: Math.floor(Math.random() * 50) + 5,
      totalBalance: Math.random() * 50,
    },
    bots: {
      total: Math.floor(Math.random() * 20) + 1,
      running: Math.floor(Math.random() * 10),
      paused: Math.floor(Math.random() * 5),
      stopped: Math.floor(Math.random() * 5),
    },
    trading: {
      totalSwaps: Math.floor(Math.random() * 1000),
      successfulSwaps: Math.floor(Math.random() * 900),
      failedSwaps: Math.floor(Math.random() * 100),
      totalVolume: Math.random() * 100,
      feesSpent: Math.random() * 0.5,
    },
    lastUpdate: Date.now(),
  };
}

/**
 * Register stats command handlers.
 */
export function registerStatsHandlers(bot: Bot<BotContext>): void {
  bot.command('stats', async (ctx) => {
    await handleStats(ctx);
  });
}

/**
 * Handle /stats command.
 */
async function handleStats(ctx: BotContext): Promise<void> {
  const stats = getMockStats();

  // Calculate success rate
  const successRate = stats.trading.totalSwaps > 0
    ? (stats.trading.successfulSwaps / stats.trading.totalSwaps) * 100
    : 0;

  let response = `📈 <b>OrbitMM Statistics</b>\n\n`;

  // Uptime
  response += `⏱️ <b>Uptime:</b> ${formatDuration(stats.uptime)}\n\n`;

  // Wallet stats
  response += `💼 <b>Wallets</b>\n`;
  response += `├ Total: ${stats.wallets.total}\n`;
  response += `├ Funded: ${stats.wallets.funded}\n`;
  response += `└ Balance: ${formatSol(stats.wallets.totalBalance * 1_000_000_000)}\n\n`;

  // Bot stats
  response += `🤖 <b>Bots</b>\n`;
  response += `├ Total: ${stats.bots.total}\n`;
  response += `├ 🟢 Running: ${stats.bots.running}\n`;
  response += `├ ⏸️ Paused: ${stats.bots.paused}\n`;
  response += `└ 🔴 Stopped: ${stats.bots.stopped}\n\n`;

  // Trading stats
  response += `📊 <b>Trading</b>\n`;
  response += `├ Total swaps: ${formatNumber(stats.trading.totalSwaps)}\n`;
  response += `├ ✅ Successful: ${formatNumber(stats.trading.successfulSwaps)}\n`;
  response += `├ ❌ Failed: ${formatNumber(stats.trading.failedSwaps)}\n`;
  response += `├ Success rate: ${successRate.toFixed(1)}%\n`;
  response += `├ Volume: ${formatSol(stats.trading.totalVolume * 1_000_000_000)}\n`;
  response += `└ Fees spent: ${formatSol(stats.trading.feesSpent * 1_000_000_000)}\n\n`;

  // Last update
  response += `<i>Last updated: ${formatRelativeTime(stats.lastUpdate)}</i>`;

  // Action buttons
  const keyboard = new InlineKeyboard()
    .text('🔄 Refresh', 'stats:refresh')
    .text('📊 Details', 'stats:details');

  await ctx.reply(response, { parse_mode: 'HTML', reply_markup: keyboard });
}

/**
 * Detailed stats view.
 */
async function handleStatsDetails(ctx: BotContext): Promise<void> {
  const stats = getMockStats();

  let response = `📊 <b>Detailed Statistics</b>\n\n`;

  // Performance metrics
  response += `<b>Performance</b>\n`;
  response += `├ Avg swap time: ~2.5s\n`;
  response += `├ Avg slippage: 0.12%\n`;
  response += `└ Avg gas: 0.000005 SOL\n\n`;

  // Volume breakdown
  response += `<b>Volume (24h)</b>\n`;
  response += `├ Buy volume: ${formatSol(stats.trading.totalVolume * 0.55 * 1_000_000_000)}\n`;
  response += `├ Sell volume: ${formatSol(stats.trading.totalVolume * 0.45 * 1_000_000_000)}\n`;
  response += `└ Net: ${formatSol(stats.trading.totalVolume * 0.1 * 1_000_000_000)}\n\n`;

  // Error breakdown
  if (stats.trading.failedSwaps > 0) {
    response += `<b>Error Breakdown</b>\n`;
    response += `├ Slippage exceeded: ${Math.floor(stats.trading.failedSwaps * 0.4)}\n`;
    response += `├ Insufficient funds: ${Math.floor(stats.trading.failedSwaps * 0.3)}\n`;
    response += `├ Network timeout: ${Math.floor(stats.trading.failedSwaps * 0.2)}\n`;
    response += `└ Other: ${Math.floor(stats.trading.failedSwaps * 0.1)}\n\n`;
  }

  response += `<i>Note: Detailed metrics require orchestrator service.</i>`;

  const keyboard = new InlineKeyboard()
    .text('← Back', 'stats:back')
    .text('🔄 Refresh', 'stats:details:refresh');

  await ctx.editMessageText(response, { parse_mode: 'HTML', reply_markup: keyboard });
}

// ============ Callback Query Handlers ============

export function handleStatsCallbacks(bot: Bot<BotContext>): void {
  bot.callbackQuery('stats:refresh', async (ctx) => {
    await ctx.answerCallbackQuery({ text: '🔄 Refreshing...' });
    await handleStats(ctx);
  });

  bot.callbackQuery('stats:details', async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleStatsDetails(ctx);
  });

  bot.callbackQuery('stats:details:refresh', async (ctx) => {
    await ctx.answerCallbackQuery({ text: '🔄 Refreshing...' });
    await handleStatsDetails(ctx);
  });

  bot.callbackQuery('stats:back', async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleStats(ctx);
  });
}
