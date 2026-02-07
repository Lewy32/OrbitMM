/**
 * Bot Command Handlers
 * 
 * /bot create [count] <token> - Create trading bots
 * /bot start - Start all idle bots
 * /bot pause - Pause running bots
 * /bot stop - Stop all bots
 * /bot status - View bot status
 */

import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../index.js';
import {
  formatAddress,
  formatSol,
  formatStatus,
  formatDuration,
  formatRelativeTime,
  formatSuccess,
  formatError,
  formatLoading,
  formatWarning,
  formatTable,
  bold,
  code,
} from '../utils/format.js';

// ============ Types ============

interface BotConfig {
  targetToken: string;
  direction: 'buy' | 'sell' | 'both';
  minSwapSol: number;
  maxSwapSol: number;
  minIntervalMs: number;
  maxIntervalMs: number;
}

interface BotSnapshot {
  id: string;
  walletPublicKey: string;
  state: 'idle' | 'running' | 'paused' | 'stopped' | 'error';
  config: BotConfig;
  stats: {
    swapsAttempted: number;
    swapsSuccessful: number;
    swapsFailed: number;
    totalVolumeSol: number;
    startedAt: number | null;
    lastSwapAt: number | null;
  };
  createdAt: number;
}

// Mock storage (replace with actual orchestrator connection)
let tradingBots: BotSnapshot[] = [];

function generateBotId(): string {
  return `bot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function mockCreateBots(count: number, token: string): BotSnapshot[] {
  const bots: BotSnapshot[] = [];
  for (let i = 0; i < count; i++) {
    bots.push({
      id: generateBotId(),
      walletPublicKey: '',
      state: 'idle',
      config: {
        targetToken: token,
        direction: 'both',
        minSwapSol: 0.01,
        maxSwapSol: 0.1,
        minIntervalMs: 30000,
        maxIntervalMs: 120000,
      },
      stats: {
        swapsAttempted: 0,
        swapsSuccessful: 0,
        swapsFailed: 0,
        totalVolumeSol: 0,
        startedAt: null,
        lastSwapAt: null,
      },
      createdAt: Date.now(),
    });
  }
  return bots;
}

/**
 * Register bot command handlers.
 */
export function registerBotHandlers(bot: Bot<BotContext>): void {
  bot.command('bot', async (ctx) => {
    const args = ctx.match?.split(/\s+/) ?? [];
    const subcommand = args[0]?.toLowerCase();

    if (!subcommand) {
      await ctx.reply(
        `🤖 <b>Bot Commands</b>\n\n` +
        `<code>/bot create [count] &lt;token&gt;</code> - Create trading bots\n` +
        `<code>/bot start</code> - Start all idle/paused bots\n` +
        `<code>/bot pause</code> - Pause running bots\n` +
        `<code>/bot stop</code> - Stop all bots\n` +
        `<code>/bot status</code> - View bot status`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    switch (subcommand) {
      case 'create':
        await handleBotCreate(ctx, args.slice(1));
        break;
      case 'start':
        await handleBotStart(ctx);
        break;
      case 'pause':
        await handleBotPause(ctx);
        break;
      case 'stop':
        await handleBotStop(ctx);
        break;
      case 'status':
        await handleBotStatus(ctx);
        break;
      default:
        await ctx.reply(formatError(`Unknown subcommand: ${subcommand}`), { parse_mode: 'HTML' });
    }
  });
}

/**
 * Handle /bot create [count] <token>
 */
async function handleBotCreate(ctx: BotContext, args: string[]): Promise<void> {
  // Parse arguments: either "create <token>" or "create <count> <token>"
  let count = 1;
  let token: string;

  if (args.length === 0) {
    await ctx.reply(formatError('Token address is required.\n\nUsage: /bot create [count] <token>'), { parse_mode: 'HTML' });
    return;
  }

  if (args.length === 1) {
    token = args[0];
  } else {
    const parsed = parseInt(args[0], 10);
    if (!isNaN(parsed) && parsed > 0) {
      count = parsed;
      token = args[1];
    } else {
      token = args[0];
    }
  }

  if (!token) {
    await ctx.reply(formatError('Token address is required.'), { parse_mode: 'HTML' });
    return;
  }

  // Validate count
  if (count > 50) {
    await ctx.reply(formatError('Maximum 50 bots per creation via Telegram.'), { parse_mode: 'HTML' });
    return;
  }

  // Validate token (basic check - 32-44 char base58)
  if (token.length < 32 || token.length > 44) {
    await ctx.reply(formatError('Invalid token address format.'), { parse_mode: 'HTML' });
    return;
  }

  // Confirm creation
  const keyboard = new InlineKeyboard()
    .text('✅ Create', `bot:create:${count}:${token}`)
    .text('❌ Cancel', 'bot:cancel');

  await ctx.reply(
    `🤖 <b>Create Trading Bots</b>\n\n` +
    `<b>Count:</b> ${count}\n` +
    `<b>Token:</b> ${formatAddress(token)}\n` +
    `<b>Direction:</b> both (buy & sell)\n` +
    `<b>Swap range:</b> 0.01 - 0.1 SOL\n` +
    `<b>Interval:</b> 30s - 2m\n\n` +
    `Continue?`,
    { parse_mode: 'HTML', reply_markup: keyboard }
  );
}

/**
 * Handle /bot start
 */
async function handleBotStart(ctx: BotContext): Promise<void> {
  const eligibleBots = tradingBots.filter((b) => b.state === 'idle' || b.state === 'paused');

  if (eligibleBots.length === 0) {
    if (tradingBots.length === 0) {
      await ctx.reply(
        `🤖 <b>No Bots Found</b>\n\n` +
        `Create bots first with:\n` +
        `<code>/bot create 5 &lt;token-address&gt;</code>`,
        { parse_mode: 'HTML' }
      );
    } else {
      await ctx.reply(
        `🤖 <b>No Bots to Start</b>\n\n` +
        `All bots are already running or stopped.`,
        { parse_mode: 'HTML' }
      );
    }
    return;
  }

  const keyboard = new InlineKeyboard()
    .text(`✅ Start ${eligibleBots.length} bots`, 'bot:start:confirm')
    .text('❌ Cancel', 'bot:cancel');

  await ctx.reply(
    `🚀 <b>Start Bots</b>\n\n` +
    `Found ${bold(String(eligibleBots.length))} bot${eligibleBots.length !== 1 ? 's' : ''} ready to start.\n\n` +
    `⚠️ <i>Note: Actual trading requires the orchestrator service running.</i>\n\n` +
    `Continue?`,
    { parse_mode: 'HTML', reply_markup: keyboard }
  );
}

/**
 * Handle /bot pause
 */
async function handleBotPause(ctx: BotContext): Promise<void> {
  const runningBots = tradingBots.filter((b) => b.state === 'running');

  if (runningBots.length === 0) {
    await ctx.reply(`⏸️ No running bots to pause.`, { parse_mode: 'HTML' });
    return;
  }

  const keyboard = new InlineKeyboard()
    .text(`⏸️ Pause ${runningBots.length} bots`, 'bot:pause:confirm')
    .text('❌ Cancel', 'bot:cancel');

  await ctx.reply(
    `⏸️ <b>Pause Bots</b>\n\n` +
    `This will pause ${bold(String(runningBots.length))} running bot${runningBots.length !== 1 ? 's' : ''}.\n\n` +
    `Continue?`,
    { parse_mode: 'HTML', reply_markup: keyboard }
  );
}

/**
 * Handle /bot stop
 */
async function handleBotStop(ctx: BotContext): Promise<void> {
  const activeBots = tradingBots.filter((b) => b.state !== 'stopped');

  if (activeBots.length === 0) {
    await ctx.reply(`🛑 No active bots to stop.`, { parse_mode: 'HTML' });
    return;
  }

  const keyboard = new InlineKeyboard()
    .text(`🛑 Stop ${activeBots.length} bots`, 'bot:stop:confirm')
    .text('❌ Cancel', 'bot:cancel');

  await ctx.reply(
    `🛑 <b>Stop Bots</b>\n\n` +
    `⚠️ ${formatWarning('Stopped bots cannot be restarted!')}\n\n` +
    `This will permanently stop ${bold(String(activeBots.length))} bot${activeBots.length !== 1 ? 's' : ''}.\n\n` +
    `Continue?`,
    { parse_mode: 'HTML', reply_markup: keyboard }
  );
}

/**
 * Handle /bot status
 */
async function handleBotStatus(ctx: BotContext): Promise<void> {
  if (tradingBots.length === 0) {
    await ctx.reply(
      `🤖 <b>No Bots</b>\n\n` +
      `Create bots with:\n` +
      `<code>/bot create 5 &lt;token-address&gt;</code>`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  // Summary stats
  const summary = {
    total: tradingBots.length,
    running: tradingBots.filter((b) => b.state === 'running').length,
    paused: tradingBots.filter((b) => b.state === 'paused').length,
    idle: tradingBots.filter((b) => b.state === 'idle').length,
    stopped: tradingBots.filter((b) => b.state === 'stopped').length,
    error: tradingBots.filter((b) => b.state === 'error').length,
  };

  const totalSwaps = tradingBots.reduce((sum, b) => sum + b.stats.swapsSuccessful, 0);
  const totalVolume = tradingBots.reduce((sum, b) => sum + b.stats.totalVolumeSol, 0);

  let response = `🤖 <b>Bot Status</b>\n\n`;

  // Status breakdown
  response += `<b>Status:</b>\n`;
  response += `🟢 Running: ${summary.running}\n`;
  response += `⏸️ Paused: ${summary.paused}\n`;
  response += `⏹️ Idle: ${summary.idle}\n`;
  response += `🔴 Stopped: ${summary.stopped}\n`;
  if (summary.error > 0) {
    response += `❌ Error: ${summary.error}\n`;
  }

  response += `\n<b>Performance:</b>\n`;
  response += `Total swaps: ${totalSwaps}\n`;
  response += `Total volume: ${formatSol(totalVolume * 1_000_000_000)}\n`;

  // Show first 5 bots
  if (tradingBots.length > 0) {
    response += `\n<b>Bots:</b>\n`;
    const displayBots = tradingBots.slice(0, 5);
    for (const bot of displayBots) {
      response += `${formatStatus(bot.state)} ${code(bot.id.slice(0, 12))}...\n`;
    }
    if (tradingBots.length > 5) {
      response += `<i>... and ${tradingBots.length - 5} more</i>\n`;
    }
  }

  // Action buttons
  const keyboard = new InlineKeyboard();
  if (summary.idle > 0 || summary.paused > 0) {
    keyboard.text('🚀 Start', 'bot:start:quick');
  }
  if (summary.running > 0) {
    keyboard.text('⏸️ Pause', 'bot:pause:quick');
  }
  keyboard.row().text('🔄 Refresh', 'bot:status:refresh');

  await ctx.reply(response, { parse_mode: 'HTML', reply_markup: keyboard });
}

// ============ Callback Query Handlers ============

export function handleBotCallbacks(bot: Bot<BotContext>): void {
  // Create bots
  bot.callbackQuery(/^bot:create:(\d+):(.+)$/, async (ctx) => {
    const count = parseInt(ctx.match[1], 10);
    const token = ctx.match[2];

    await ctx.answerCallbackQuery({ text: '🔄 Creating...' });

    const loadingMsg = await ctx.editMessageText(formatLoading(`Creating ${count} bot${count !== 1 ? 's' : ''}`), {
      parse_mode: 'HTML'
    });

    try {
      const newBots = mockCreateBots(count, token);
      tradingBots.push(...newBots);

      let response = formatSuccess(`Created ${count} bot${count !== 1 ? 's' : ''}`);
      response += `\n\n<b>Token:</b> ${formatAddress(token)}\n`;
      response += `<b>Bot IDs:</b>\n`;
      
      for (const bot of newBots.slice(0, 5)) {
        response += `• ${code(bot.id)}\n`;
      }
      if (newBots.length > 5) {
        response += `<i>... and ${newBots.length - 5} more</i>\n`;
      }

      response += `\n💡 Use /bot start to begin trading`;

      await ctx.editMessageText(response, { parse_mode: 'HTML' });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      await ctx.editMessageText(formatError('Failed to create bots', errorMessage), { parse_mode: 'HTML' });
    }
  });

  // Start bots
  bot.callbackQuery(/^bot:start:(confirm|quick)$/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: '🚀 Starting...' });

    for (const bot of tradingBots) {
      if (bot.state === 'idle' || bot.state === 'paused') {
        bot.state = 'running';
        bot.stats.startedAt = Date.now();
      }
    }

    const running = tradingBots.filter((b) => b.state === 'running').length;
    await ctx.editMessageText(
      formatSuccess(`Started ${running} bot${running !== 1 ? 's' : ''}`),
      { parse_mode: 'HTML' }
    );
  });

  // Pause bots
  bot.callbackQuery(/^bot:pause:(confirm|quick)$/, async (ctx) => {
    await ctx.answerCallbackQuery({ text: '⏸️ Pausing...' });

    let paused = 0;
    for (const bot of tradingBots) {
      if (bot.state === 'running') {
        bot.state = 'paused';
        paused++;
      }
    }

    await ctx.editMessageText(
      formatSuccess(`Paused ${paused} bot${paused !== 1 ? 's' : ''}`),
      { parse_mode: 'HTML' }
    );
  });

  // Stop bots
  bot.callbackQuery('bot:stop:confirm', async (ctx) => {
    await ctx.answerCallbackQuery({ text: '🛑 Stopping...' });

    let stopped = 0;
    for (const bot of tradingBots) {
      if (bot.state !== 'stopped') {
        bot.state = 'stopped';
        stopped++;
      }
    }

    await ctx.editMessageText(
      formatSuccess(`Stopped ${stopped} bot${stopped !== 1 ? 's' : ''}`),
      { parse_mode: 'HTML' }
    );
  });

  // Refresh status
  bot.callbackQuery('bot:status:refresh', async (ctx) => {
    await ctx.answerCallbackQuery({ text: '🔄 Refreshing...' });
    // Re-run status handler
    // Note: In production, you'd want to refactor to share the status rendering logic
    await handleBotStatus(ctx);
  });

  // Cancel
  bot.callbackQuery('bot:cancel', async (ctx) => {
    await ctx.answerCallbackQuery({ text: '❌ Cancelled' });
    await ctx.deleteMessage();
  });
}
