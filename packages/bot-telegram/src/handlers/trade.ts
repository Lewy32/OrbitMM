/**
 * Trade Command Handlers
 * 
 * /trade quote <token> [amount] - Get swap quote
 */

import { Bot, InlineKeyboard } from 'grammy';
import type { BotContext } from '../index.js';
import {
  formatAddress,
  formatAddressLink,
  formatSol,
  formatPercent,
  formatDuration,
  formatSuccess,
  formatError,
  formatLoading,
  formatWarning,
  formatKeyValue,
  bold,
  code,
  link,
} from '../utils/format.js';

// ============ Types ============

interface Quote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  minOutAmount: string;
  priceImpactPct: number;
  route: RouteStep[];
  dex: string;
  timestamp: number;
  expiresAt: number;
}

interface RouteStep {
  dex: string;
  inputMint: string;
  outputMint: string;
  poolId: string;
  percent: number;
}

// ============ Constants ============

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// Common token shortcuts
const TOKEN_SHORTCUTS: Record<string, string> = {
  sol: SOL_MINT,
  wsol: SOL_MINT,
  usdc: USDC_MINT,
};

// ============ Mock Functions ============

async function mockGetQuote(
  inputMint: string,
  outputMint: string,
  amount: number,
  slippageBps: number
): Promise<Quote> {
  // Simulate API delay
  await new Promise((r) => setTimeout(r, 800));

  // Mock price impact based on amount
  const priceImpact = Math.min(5, amount / 100);

  // Mock output amount (random multiplier for demo)
  const multiplier = 0.8 + Math.random() * 0.4;
  const outAmount = amount * multiplier * 1_000_000; // Mock token decimals

  return {
    inputMint,
    outputMint,
    inAmount: (amount * 1_000_000_000).toString(), // lamports
    outAmount: outAmount.toString(),
    minOutAmount: (outAmount * (1 - slippageBps / 10000)).toString(),
    priceImpactPct: priceImpact,
    route: [
      {
        dex: 'jupiter',
        inputMint,
        outputMint,
        poolId: 'pool-' + Math.random().toString(36).slice(2, 8),
        percent: 100,
      },
    ],
    dex: 'jupiter',
    timestamp: Date.now(),
    expiresAt: Date.now() + 30000,
  };
}

// ============ Helpers ============

function resolveTokenMint(token: string): string | null {
  const lower = token.toLowerCase();
  
  // Check shortcuts
  if (TOKEN_SHORTCUTS[lower]) {
    return TOKEN_SHORTCUTS[lower];
  }

  // Validate as base58 address (32-44 chars)
  if (token.length >= 32 && token.length <= 44) {
    return token;
  }

  return null;
}

/**
 * Register trade command handlers.
 */
export function registerTradeHandlers(bot: Bot<BotContext>): void {
  bot.command('trade', async (ctx) => {
    const args = ctx.match?.split(/\s+/) ?? [];
    const subcommand = args[0]?.toLowerCase();

    if (!subcommand) {
      await ctx.reply(
        `📊 <b>Trade Commands</b>\n\n` +
        `<code>/trade quote &lt;token&gt; [amount]</code> - Get swap quote\n\n` +
        `<b>Examples:</b>\n` +
        `<code>/trade quote ABC123... 0.1</code> - Quote 0.1 SOL → token\n` +
        `<code>/trade quote sol 100</code> - Quote 100 tokens → SOL`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    switch (subcommand) {
      case 'quote':
        await handleTradeQuote(ctx, args.slice(1));
        break;
      default:
        await ctx.reply(formatError(`Unknown subcommand: ${subcommand}`), { parse_mode: 'HTML' });
    }
  });
}

/**
 * Handle /trade quote <token> [amount]
 */
async function handleTradeQuote(ctx: BotContext, args: string[]): Promise<void> {
  if (args.length === 0) {
    await ctx.reply(
      formatError('Token address is required.\n\nUsage: /trade quote <token> [amount]'),
      { parse_mode: 'HTML' }
    );
    return;
  }

  const tokenArg = args[0];
  const amountStr = args[1] ?? '0.1';
  const amount = parseFloat(amountStr);

  // Resolve token
  const tokenMint = resolveTokenMint(tokenArg);
  if (!tokenMint) {
    await ctx.reply(
      formatError('Invalid token address or shortcut.\n\nSupported shortcuts: sol, usdc'),
      { parse_mode: 'HTML' }
    );
    return;
  }

  // Validate amount
  if (isNaN(amount) || amount <= 0) {
    await ctx.reply(formatError('Invalid amount. Must be a positive number.'), { parse_mode: 'HTML' });
    return;
  }

  if (amount > 1000) {
    await ctx.reply(formatError('Maximum 1000 SOL per quote.'), { parse_mode: 'HTML' });
    return;
  }

  // Determine swap direction
  const isBuying = tokenMint !== SOL_MINT;
  const inputMint = isBuying ? SOL_MINT : tokenMint;
  const outputMint = isBuying ? tokenMint : SOL_MINT;

  const loadingMsg = await ctx.reply(
    formatLoading(`Fetching quote for ${amount} ${isBuying ? 'SOL' : 'tokens'}`),
    { parse_mode: 'HTML' }
  );

  try {
    const quote = await mockGetQuote(inputMint, outputMint, amount, 50);

    const expiresIn = Math.max(0, Math.round((quote.expiresAt - Date.now()) / 1000));

    let response = `📊 <b>Swap Quote</b>\n\n`;

    // Direction
    response += `<b>Direction:</b> ${isBuying ? '🟢 BUY' : '🔴 SELL'}\n\n`;

    // Amounts
    response += `<b>Input:</b>\n`;
    response += `${formatSol(parseInt(quote.inAmount))} ${isBuying ? '' : '→'}\n`;
    response += `${formatAddress(inputMint)}\n\n`;

    response += `<b>Output:</b>\n`;
    const outputAmount = parseFloat(quote.outAmount);
    if (isBuying) {
      response += `${outputAmount.toLocaleString(undefined, { maximumFractionDigits: 6 })} tokens\n`;
    } else {
      response += `${formatSol(outputAmount)}\n`;
    }
    response += `${formatAddress(outputMint)}\n\n`;

    // Quote details
    response += `<b>Min Output:</b> ${parseFloat(quote.minOutAmount).toLocaleString(undefined, { maximumFractionDigits: 6 })}\n`;
    response += `<b>Price Impact:</b> ${formatPercent(-quote.priceImpactPct)}\n`;
    response += `<b>Route:</b> ${quote.route.map((r) => r.dex).join(' → ')}\n`;
    response += `<b>Valid for:</b> ${expiresIn}s\n`;

    // Warning for high price impact
    if (quote.priceImpactPct > 1) {
      response += `\n${formatWarning(`High price impact! Consider a smaller amount.`)}`;
    }

    // Action buttons
    const keyboard = new InlineKeyboard()
      .text('🔄 Refresh', `trade:quote:${tokenArg}:${amount}`)
      .row()
      .url('View on Jupiter', `https://jup.ag/swap/${inputMint}-${outputMint}`);

    await ctx.api.editMessageText(
      ctx.chat!.id,
      loadingMsg.message_id,
      response,
      { parse_mode: 'HTML', reply_markup: keyboard }
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    await ctx.api.editMessageText(
      ctx.chat!.id,
      loadingMsg.message_id,
      formatError('Failed to get quote', errorMessage),
      { parse_mode: 'HTML' }
    );
  }
}

// ============ Callback Query Handlers ============

export function handleTradeCallbacks(bot: Bot<BotContext>): void {
  // Refresh quote
  bot.callbackQuery(/^trade:quote:(.+):(.+)$/, async (ctx) => {
    const token = ctx.match[1];
    const amount = ctx.match[2];

    await ctx.answerCallbackQuery({ text: '🔄 Refreshing...' });

    // Re-run quote with same parameters
    const args = [token, amount];
    await handleTradeQuote(ctx, args);
  });
}
