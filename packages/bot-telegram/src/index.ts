/**
 * @orbitmm/bot-telegram
 * 
 * Telegram bot interface for OrbitMM
 * 
 * Features:
 * - Wallet management via chat commands
 * - Bot lifecycle control (start, stop, pause)
 * - Trade quote fetching
 * - Real-time stats and alerts
 */

import { Bot, session, GrammyError, HttpError } from 'grammy';
import type { Context, SessionFlavor } from 'grammy';
import { VERSION } from '@orbitmm/core';
import { authMiddleware } from './middleware/auth.js';
import { rateLimitMiddleware } from './middleware/rateLimit.js';
import { registerWalletHandlers } from './handlers/wallet.js';
import { registerBotHandlers } from './handlers/bot.js';
import { registerTradeHandlers } from './handlers/trade.js';
import { registerStatsHandlers } from './handlers/stats.js';
import { formatHelp, formatWelcome } from './utils/format.js';

// ============ Session Type ============

interface SessionData {
  lastCommand?: string;
  pendingConfirmation?: {
    action: string;
    data: Record<string, unknown>;
    expiresAt: number;
  };
}

export type BotContext = Context & SessionFlavor<SessionData>;

// ============ Bot Initialization ============

function createBot(): Bot<BotContext> {
  const token = process.env.BOT_TOKEN;
  
  if (!token) {
    console.error('❌ BOT_TOKEN environment variable is required');
    process.exit(1);
  }

  const bot = new Bot<BotContext>(token);

  // Session middleware
  bot.use(session({
    initial: (): SessionData => ({})
  }));

  // Auth middleware - owner only
  bot.use(authMiddleware);

  // Rate limiting
  bot.use(rateLimitMiddleware);

  // ---- Core Commands ----

  bot.command('start', async (ctx) => {
    await ctx.reply(formatWelcome(), { parse_mode: 'HTML' });
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(formatHelp(), { parse_mode: 'HTML' });
  });

  bot.command('version', async (ctx) => {
    await ctx.reply(`🤖 <b>OrbitMM Bot</b>\n\nVersion: <code>${VERSION}</code>`, {
      parse_mode: 'HTML'
    });
  });

  // ---- Register Handler Groups ----
  
  registerWalletHandlers(bot);
  registerBotHandlers(bot);
  registerTradeHandlers(bot);
  registerStatsHandlers(bot);

  // ---- Callback Query Handler ----

  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    
    // Handle confirmation callbacks
    if (data.startsWith('confirm:')) {
      const action = data.slice(8);
      const pending = ctx.session.pendingConfirmation;
      
      if (!pending || pending.action !== action || Date.now() > pending.expiresAt) {
        await ctx.answerCallbackQuery({ text: '⏱️ Action expired' });
        await ctx.editMessageText('❌ Action expired. Please try again.');
        return;
      }

      // Clear pending confirmation
      ctx.session.pendingConfirmation = undefined;
      await ctx.answerCallbackQuery({ text: '✅ Confirmed' });
    }

    if (data.startsWith('cancel:')) {
      ctx.session.pendingConfirmation = undefined;
      await ctx.answerCallbackQuery({ text: '❌ Cancelled' });
      await ctx.editMessageText('❌ Action cancelled.');
    }
  });

  // ---- Error Handler ----

  bot.catch((err) => {
    const ctx = err.ctx;
    console.error(`Error while handling update ${ctx.update.update_id}:`);
    
    const e = err.error;
    
    if (e instanceof GrammyError) {
      console.error('Error in request:', e.description);
    } else if (e instanceof HttpError) {
      console.error('Could not contact Telegram:', e);
    } else {
      console.error('Unknown error:', e);
    }

    // Try to notify user
    ctx.reply('❌ An error occurred. Please try again.').catch(() => {});
  });

  return bot;
}

// ============ Main Entry Point ============

async function main(): Promise<void> {
  console.log(`
╔═══════════════════════════════════════╗
║        OrbitMM Telegram Bot           ║
║           v${VERSION.padEnd(20)}      ║
╚═══════════════════════════════════════╝
`);

  const bot = createBot();

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n🛑 Shutting down...');
    bot.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start bot
  console.log('🚀 Starting bot...');
  await bot.start({
    onStart: (botInfo) => {
      console.log(`✅ Bot started as @${botInfo.username}`);
      console.log(`📱 Send /start to begin`);
    }
  });
}

// Run if executed directly
main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

export { createBot, VERSION };
export type { BotContext, SessionData };
