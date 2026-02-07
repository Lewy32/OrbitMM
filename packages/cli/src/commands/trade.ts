/**
 * OrbitMM CLI - Trade Commands
 * 
 * trade quote <token> <amount> --direction
 * trade buy <token> <amount> --wallet
 * trade sell <token> <amount> --wallet
 */

import { Command } from 'commander';
import { PublicKey, Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import * as fs from 'fs/promises';
// NOTE: These imports will work once the trading module is implemented
// import {
//   getBestQuote,
//   executeSwap,
//   type Quote,
//   type SwapResult,
// } from '@orbitmm/core';
import {
  colors,
  icons,
  spinner,
  success,
  error,
  warning,
  info,
  header,
  newline,
  formatAddress,
  formatSol,
  formatPercent,
  formatTime,
  keyValue,
} from '../utils/display.js';

// ============ Constants ============

const SOL_MINT = 'So11111111111111111111111111111111111111112';
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// Placeholder types until trading module is implemented
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

interface SwapResult {
  signature: string;
  inputAmount: number;
  outputAmount: number;
  fee: number;
  slot: number;
  timestamp: number;
}

// ============ Helpers ============

function getConnection(): Connection {
  const rpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com';
  return new Connection(rpcUrl, 'confirmed');
}

async function loadWallet(path: string): Promise<Keypair> {
  try {
    const data = JSON.parse(await fs.readFile(path, 'utf-8'));
    return Keypair.fromSecretKey(new Uint8Array(data));
  } catch {
    throw new Error(`Could not load wallet from: ${path}`);
  }
}

function isValidMint(address: string): boolean {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

function resolveTokenMint(token: string): string {
  // Common token shortcuts
  const shortcuts: Record<string, string> = {
    sol: SOL_MINT,
    wsol: SOL_MINT,
    usdc: USDC_MINT,
  };

  const lower = token.toLowerCase();
  if (shortcuts[lower]) {
    return shortcuts[lower];
  }

  if (!isValidMint(token)) {
    throw new Error(`Invalid token address: ${token}`);
  }

  return token;
}

// Mock quote function until trading module is implemented
async function mockGetQuote(
  inputMint: string,
  outputMint: string,
  amount: number,
  slippageBps: number
): Promise<Quote> {
  // Simulate API delay
  await new Promise((r) => setTimeout(r, 500));

  // Mock price impact based on amount
  const priceImpact = Math.min(5, amount / 100);

  return {
    inputMint,
    outputMint,
    inAmount: amount.toString(),
    outAmount: (amount * 1.5).toString(), // Mock conversion
    minOutAmount: (amount * 1.5 * (1 - slippageBps / 10000)).toString(),
    priceImpactPct: priceImpact,
    route: [
      {
        dex: 'jupiter',
        inputMint,
        outputMint,
        poolId: 'mock-pool-123',
        percent: 100,
      },
    ],
    dex: 'jupiter',
    timestamp: Date.now(),
    expiresAt: Date.now() + 30000,
  };
}

// Mock swap function until trading module is implemented
async function mockExecuteSwap(
  wallet: Keypair,
  quote: Quote
): Promise<SwapResult> {
  // Simulate transaction delay
  await new Promise((r) => setTimeout(r, 1500));

  return {
    signature: 'mock' + Math.random().toString(36).slice(2, 15),
    inputAmount: parseFloat(quote.inAmount),
    outputAmount: parseFloat(quote.outAmount),
    fee: 0.000005,
    slot: 123456789,
    timestamp: Date.now(),
  };
}

// ============ Commands ============

export function registerTradeCommands(program: Command): void {
  const trade = program
    .command('trade')
    .description('Trading operations');

  // ---- trade quote ----
  trade
    .command('quote <token> <amount>')
    .description('Get a swap quote')
    .option('-d, --direction <dir>', 'buy or sell', 'buy')
    .option('--base <mint>', 'Base token (default: SOL)', SOL_MINT)
    .option('-s, --slippage <bps>', 'Slippage tolerance in basis points', '50')
    .option('--json', 'Output as JSON')
    .action(async (token: string, amountStr: string, options) => {
      try {
        const amount = parseFloat(amountStr);

        if (isNaN(amount) || amount <= 0) {
          error('Invalid amount. Must be a positive number.');
          process.exit(1);
        }

        header(`${icons.trade} Get Quote`);

        const tokenMint = resolveTokenMint(token);
        const baseMint = resolveTokenMint(options.base);
        const slippageBps = parseInt(options.slippage, 10);
        const isBuy = options.direction.toLowerCase() === 'buy';

        const inputMint = isBuy ? baseMint : tokenMint;
        const outputMint = isBuy ? tokenMint : baseMint;

        console.log();
        console.log(keyValue({
          'Direction': isBuy ? colors.success('BUY') : colors.error('SELL'),
          'Input': formatAddress(inputMint),
          'Output': formatAddress(outputMint),
          'Amount': inputMint === SOL_MINT ? formatSol(amount * LAMPORTS_PER_SOL) : amount.toLocaleString(),
          'Slippage': `${slippageBps / 100}%`,
        }));

        const spin = spinner('Fetching quote...');
        spin.start();

        // TODO: Replace with actual trading module call
        // const quote = await getBestQuote(connection, {
        //   inputMint: new PublicKey(inputMint),
        //   outputMint: new PublicKey(outputMint),
        //   amount: amount * (inputMint === SOL_MINT ? LAMPORTS_PER_SOL : 1),
        //   slippageBps,
        // });
        const quote = await mockGetQuote(inputMint, outputMint, amount, slippageBps);

        spin.succeed('Quote received');

        if (options.json) {
          console.log(JSON.stringify(quote, null, 2));
          return;
        }

        newline();
        header('Quote Details');
        console.log();
        console.log(keyValue({
          'Input amount': parseFloat(quote.inAmount).toLocaleString(),
          'Output amount': parseFloat(quote.outAmount).toLocaleString(),
          'Min output': parseFloat(quote.minOutAmount).toLocaleString(),
          'Price impact': formatPercent(-quote.priceImpactPct),
          'Route': quote.route.map((r) => `${r.dex} (${r.percent}%)`).join(' → '),
          'Valid for': `${Math.round((quote.expiresAt - Date.now()) / 1000)}s`,
        }));

        if (quote.priceImpactPct > 1) {
          newline();
          warning(`High price impact (${quote.priceImpactPct.toFixed(2)}%). Consider smaller trade size.`);
        }

      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to get quote');
        process.exit(1);
      }
    });

  // ---- trade buy ----
  trade
    .command('buy <token> <amount>')
    .description('Buy tokens with SOL')
    .option('-w, --wallet <path>', 'Path to wallet keypair file')
    .option('-s, --slippage <bps>', 'Slippage tolerance in basis points', '50')
    .option('--priority-fee <lamports>', 'Priority fee in lamports', '1000')
    .option('--dry-run', 'Simulate without executing')
    .action(async (token: string, amountStr: string, options) => {
      try {
        const amount = parseFloat(amountStr);

        if (isNaN(amount) || amount <= 0) {
          error('Invalid amount. Must be a positive number.');
          process.exit(1);
        }

        if (!options.wallet) {
          error('Wallet path is required. Use --wallet <path>');
          process.exit(1);
        }

        header(`${icons.trade} Buy Tokens`);

        const tokenMint = resolveTokenMint(token);
        const slippageBps = parseInt(options.slippage, 10);

        console.log();
        console.log(keyValue({
          'Token': formatAddress(tokenMint),
          'Amount': formatSol(amount * LAMPORTS_PER_SOL),
          'Slippage': `${slippageBps / 100}%`,
        }));

        // Load wallet
        const spin1 = spinner('Loading wallet...');
        spin1.start();
        const wallet = await loadWallet(options.wallet);
        spin1.succeed(`Wallet: ${formatAddress(wallet.publicKey.toString())}`);

        // Get quote
        const spin2 = spinner('Getting quote...');
        spin2.start();
        const quote = await mockGetQuote(SOL_MINT, tokenMint, amount, slippageBps);
        spin2.succeed('Quote received');

        console.log();
        console.log(keyValue({
          'Expected output': parseFloat(quote.outAmount).toLocaleString(),
          'Min output': parseFloat(quote.minOutAmount).toLocaleString(),
          'Price impact': formatPercent(-quote.priceImpactPct),
        }));

        if (options.dryRun) {
          newline();
          warning('Dry run mode - transaction not executed.');
          return;
        }

        // Execute swap
        newline();
        const spin3 = spinner('Executing swap...');
        spin3.start();

        // TODO: Replace with actual trading module call
        // const result = await executeSwap(connection, { wallet, quote, priorityFee: parseInt(options.priorityFee) });
        const result = await mockExecuteSwap(wallet, quote);

        spin3.succeed('Swap executed!');

        newline();
        header('Transaction Result');
        console.log();
        console.log(keyValue({
          'Signature': formatAddress(result.signature, 16),
          'Input': result.inputAmount.toLocaleString(),
          'Output': result.outputAmount.toLocaleString(),
          'Fee': formatSol(result.fee * LAMPORTS_PER_SOL),
          'Slot': result.slot.toLocaleString(),
          'Time': formatTime(result.timestamp),
        }));

        newline();
        success('Buy completed successfully!');
        info(`View on Solscan: https://solscan.io/tx/${result.signature}`);

      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to execute buy');
        process.exit(1);
      }
    });

  // ---- trade sell ----
  trade
    .command('sell <token> <amount>')
    .description('Sell tokens for SOL')
    .option('-w, --wallet <path>', 'Path to wallet keypair file')
    .option('-s, --slippage <bps>', 'Slippage tolerance in basis points', '50')
    .option('--priority-fee <lamports>', 'Priority fee in lamports', '1000')
    .option('--dry-run', 'Simulate without executing')
    .action(async (token: string, amountStr: string, options) => {
      try {
        const amount = parseFloat(amountStr);

        if (isNaN(amount) || amount <= 0) {
          error('Invalid amount. Must be a positive number.');
          process.exit(1);
        }

        if (!options.wallet) {
          error('Wallet path is required. Use --wallet <path>');
          process.exit(1);
        }

        header(`${icons.trade} Sell Tokens`);

        const tokenMint = resolveTokenMint(token);
        const slippageBps = parseInt(options.slippage, 10);

        console.log();
        console.log(keyValue({
          'Token': formatAddress(tokenMint),
          'Amount': amount.toLocaleString(),
          'Slippage': `${slippageBps / 100}%`,
        }));

        // Load wallet
        const spin1 = spinner('Loading wallet...');
        spin1.start();
        const wallet = await loadWallet(options.wallet);
        spin1.succeed(`Wallet: ${formatAddress(wallet.publicKey.toString())}`);

        // Get quote
        const spin2 = spinner('Getting quote...');
        spin2.start();
        const quote = await mockGetQuote(tokenMint, SOL_MINT, amount, slippageBps);
        spin2.succeed('Quote received');

        console.log();
        console.log(keyValue({
          'Expected SOL': formatSol(parseFloat(quote.outAmount) * LAMPORTS_PER_SOL),
          'Min SOL': formatSol(parseFloat(quote.minOutAmount) * LAMPORTS_PER_SOL),
          'Price impact': formatPercent(-quote.priceImpactPct),
        }));

        if (options.dryRun) {
          newline();
          warning('Dry run mode - transaction not executed.');
          return;
        }

        // Execute swap
        newline();
        const spin3 = spinner('Executing swap...');
        spin3.start();

        // TODO: Replace with actual trading module call
        const result = await mockExecuteSwap(wallet, quote);

        spin3.succeed('Swap executed!');

        newline();
        header('Transaction Result');
        console.log();
        console.log(keyValue({
          'Signature': formatAddress(result.signature, 16),
          'Input': result.inputAmount.toLocaleString(),
          'Output': formatSol(result.outputAmount * LAMPORTS_PER_SOL),
          'Fee': formatSol(result.fee * LAMPORTS_PER_SOL),
          'Slot': result.slot.toLocaleString(),
          'Time': formatTime(result.timestamp),
        }));

        newline();
        success('Sell completed successfully!');
        info(`View on Solscan: https://solscan.io/tx/${result.signature}`);

      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to execute sell');
        process.exit(1);
      }
    });
}
