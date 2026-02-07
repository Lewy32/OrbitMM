#!/usr/bin/env npx ts-node
/**
 * Multi-Wallet Coordinated Trading Example
 * 
 * This example demonstrates how to execute coordinated trades across
 * multiple wallets with customizable timing and amounts. Useful for
 * market making operations that require distribution across wallets.
 * 
 * Usage:
 *   npx ts-node examples/multi-wallet-trade.ts
 * 
 * Prerequisites:
 *   - Generate wallets: orbitmm wallet generate 10
 *   - Fund wallets with SOL
 *   - Set environment variables (see .env.example)
 * 
 * WARNING: This example is for educational purposes. Ensure you understand
 * the implications of coordinated trading in your jurisdiction.
 */

import { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import * as fs from 'fs/promises';
import * as path from 'path';

// ============ Configuration ============

interface TradeConfig {
  targetToken: string;
  rpcUrl: string;
  walletsPath: string;
  
  // Trading mode
  mode: 'sequential' | 'parallel' | 'wave';
  
  // Trade parameters
  direction: 'buy' | 'sell' | 'both';
  fixedAmount: number | null;      // Fixed amount per trade (null = random)
  minAmount: number;               // Min amount if random
  maxAmount: number;               // Max amount if random
  
  // Timing
  delayBetweenWallets: number;     // Delay between wallet trades (ms)
  waveSize: number;                // Wallets per wave (for 'wave' mode)
  wavePause: number;               // Pause between waves (ms)
  
  // Limits
  maxSlippageBps: number;
  priorityFeeLamports: number;
  
  // Safety
  dryRun: boolean;
  stopOnError: boolean;
}

const CONFIG: TradeConfig = {
  targetToken: process.env.TARGET_TOKEN || 'YOUR_TOKEN_MINT_ADDRESS',
  rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  walletsPath: process.env.WALLETS_PATH || path.join(__dirname, '../wallets.json'),
  
  mode: (process.env.TRADE_MODE as TradeConfig['mode']) || 'sequential',
  
  direction: (process.env.DIRECTION as TradeConfig['direction']) || 'buy',
  fixedAmount: process.env.FIXED_AMOUNT ? parseFloat(process.env.FIXED_AMOUNT) : null,
  minAmount: parseFloat(process.env.MIN_AMOUNT || '0.01'),
  maxAmount: parseFloat(process.env.MAX_AMOUNT || '0.05'),
  
  delayBetweenWallets: parseInt(process.env.DELAY_MS || '2000'),
  waveSize: parseInt(process.env.WAVE_SIZE || '3'),
  wavePause: parseInt(process.env.WAVE_PAUSE_MS || '10000'),
  
  maxSlippageBps: parseInt(process.env.MAX_SLIPPAGE_BPS || '100'),
  priorityFeeLamports: parseInt(process.env.PRIORITY_FEE || '5000'),
  
  dryRun: process.env.DRY_RUN === 'true',
  stopOnError: process.env.STOP_ON_ERROR === 'true',
};

// ============ Types ============

interface WalletData {
  publicKey: string;
  secretKey: number[];
}

interface TradeResult {
  wallet: string;
  success: boolean;
  signature?: string;
  error?: string;
  inputAmount: number;
  outputAmount?: number;
  executionTime: number;
}

interface Quote {
  inputMint: string;
  outputMint: string;
  inAmount: number;
  outAmount: number;
  priceImpactBps: number;
}

// ============ Utility Functions ============

async function loadWallets(filePath: string): Promise<Keypair[]> {
  const content = await fs.readFile(filePath, 'utf-8');
  const data = JSON.parse(content);
  const wallets: WalletData[] = data.wallets || data;
  return wallets.map((w) => Keypair.fromSecretKey(new Uint8Array(w.secretKey)));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatSol(lamports: number): string {
  return (lamports / LAMPORTS_PER_SOL).toFixed(6) + ' SOL';
}

function shortAddress(address: string): string {
  return address.slice(0, 4) + '...' + address.slice(-4);
}

function randomBetween(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function getTradeAmount(): number {
  if (CONFIG.fixedAmount !== null) {
    return CONFIG.fixedAmount * LAMPORTS_PER_SOL;
  }
  return randomBetween(CONFIG.minAmount, CONFIG.maxAmount) * LAMPORTS_PER_SOL;
}

// ============ Mock Trading (Replace with @orbitmm/core) ============

const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

async function getQuote(
  connection: Connection,
  inputMint: PublicKey,
  outputMint: PublicKey,
  amount: number
): Promise<Quote> {
  await sleep(300);
  const priceImpact = Math.floor(Math.random() * 50);
  return {
    inputMint: inputMint.toString(),
    outputMint: outputMint.toString(),
    inAmount: amount,
    outAmount: amount * (1.5 + Math.random() * 0.2), // Mock rate
    priceImpactBps: priceImpact,
  };
}

async function executeSwap(
  connection: Connection,
  wallet: Keypair,
  quote: Quote
): Promise<{ signature: string; outputAmount: number }> {
  // Simulate execution time
  await sleep(500 + Math.random() * 1000);
  
  // Mock 95% success rate
  if (Math.random() > 0.95) {
    throw new Error('Transaction simulation failed');
  }
  
  return {
    signature: `mock-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    outputAmount: quote.outAmount * (0.99 + Math.random() * 0.02),
  };
}

// ============ Trade Execution ============

async function executeTrade(
  connection: Connection,
  wallet: Keypair,
  targetToken: PublicKey,
  direction: 'buy' | 'sell',
  amount: number
): Promise<TradeResult> {
  const startTime = Date.now();
  const walletAddress = wallet.publicKey.toString();
  
  const inputMint = direction === 'buy' ? SOL_MINT : targetToken;
  const outputMint = direction === 'buy' ? targetToken : SOL_MINT;
  
  try {
    // Get quote
    const quote = await getQuote(connection, inputMint, outputMint, amount);
    
    // Check slippage
    if (quote.priceImpactBps > CONFIG.maxSlippageBps) {
      return {
        wallet: walletAddress,
        success: false,
        error: `Price impact too high: ${quote.priceImpactBps}bps`,
        inputAmount: amount,
        executionTime: Date.now() - startTime,
      };
    }
    
    // Execute swap (or simulate if dry run)
    if (CONFIG.dryRun) {
      return {
        wallet: walletAddress,
        success: true,
        signature: 'DRY_RUN',
        inputAmount: amount,
        outputAmount: quote.outAmount,
        executionTime: Date.now() - startTime,
      };
    }
    
    const result = await executeSwap(connection, wallet, quote);
    
    return {
      wallet: walletAddress,
      success: true,
      signature: result.signature,
      inputAmount: amount,
      outputAmount: result.outputAmount,
      executionTime: Date.now() - startTime,
    };
  } catch (err) {
    return {
      wallet: walletAddress,
      success: false,
      error: err instanceof Error ? err.message : String(err),
      inputAmount: amount,
      executionTime: Date.now() - startTime,
    };
  }
}

// ============ Execution Modes ============

async function executeSequential(
  connection: Connection,
  wallets: Keypair[],
  targetToken: PublicKey
): Promise<TradeResult[]> {
  const results: TradeResult[] = [];
  
  for (let i = 0; i < wallets.length; i++) {
    const wallet = wallets[i];
    const amount = getTradeAmount();
    const direction = CONFIG.direction === 'both'
      ? (i % 2 === 0 ? 'buy' : 'sell')
      : CONFIG.direction;
    
    console.log(`[${i + 1}/${wallets.length}] ${shortAddress(wallet.publicKey.toString())} - ${direction.toUpperCase()} ${formatSol(amount)}`);
    
    const result = await executeTrade(connection, wallet, targetToken, direction, amount);
    results.push(result);
    
    if (result.success) {
      console.log(`  ✓ ${result.signature?.slice(0, 12)}... (${result.executionTime}ms)`);
    } else {
      console.log(`  ✗ ${result.error}`);
      if (CONFIG.stopOnError) {
        console.log('  Stopping due to error (STOP_ON_ERROR=true)');
        break;
      }
    }
    
    // Delay before next wallet
    if (i < wallets.length - 1) {
      await sleep(CONFIG.delayBetweenWallets);
    }
  }
  
  return results;
}

async function executeParallel(
  connection: Connection,
  wallets: Keypair[],
  targetToken: PublicKey
): Promise<TradeResult[]> {
  console.log(`Executing ${wallets.length} trades in parallel...`);
  
  const promises = wallets.map((wallet, i) => {
    const amount = getTradeAmount();
    const direction = CONFIG.direction === 'both'
      ? (i % 2 === 0 ? 'buy' : 'sell')
      : CONFIG.direction;
    
    return executeTrade(connection, wallet, targetToken, direction, amount);
  });
  
  const results = await Promise.all(promises);
  
  // Print results
  for (const result of results) {
    const status = result.success ? '✓' : '✗';
    const message = result.success 
      ? result.signature?.slice(0, 12) + '...'
      : result.error;
    console.log(`  ${status} ${shortAddress(result.wallet)} - ${message}`);
  }
  
  return results;
}

async function executeWave(
  connection: Connection,
  wallets: Keypair[],
  targetToken: PublicKey
): Promise<TradeResult[]> {
  const results: TradeResult[] = [];
  const waves = Math.ceil(wallets.length / CONFIG.waveSize);
  
  for (let wave = 0; wave < waves; wave++) {
    const start = wave * CONFIG.waveSize;
    const end = Math.min(start + CONFIG.waveSize, wallets.length);
    const waveWallets = wallets.slice(start, end);
    
    console.log(`\nWave ${wave + 1}/${waves} (${waveWallets.length} wallets)`);
    console.log('─'.repeat(40));
    
    // Execute wave in parallel
    const wavePromises = waveWallets.map((wallet, i) => {
      const globalIndex = start + i;
      const amount = getTradeAmount();
      const direction = CONFIG.direction === 'both'
        ? (globalIndex % 2 === 0 ? 'buy' : 'sell')
        : CONFIG.direction;
      
      return executeTrade(connection, wallet, targetToken, direction, amount);
    });
    
    const waveResults = await Promise.all(wavePromises);
    results.push(...waveResults);
    
    // Print wave results
    for (const result of waveResults) {
      const status = result.success ? '✓' : '✗';
      const message = result.success
        ? `${result.signature?.slice(0, 8)}... (${result.executionTime}ms)`
        : result.error;
      console.log(`  ${status} ${shortAddress(result.wallet)} - ${message}`);
    }
    
    // Pause between waves
    if (wave < waves - 1) {
      console.log(`\nPausing ${CONFIG.wavePause / 1000}s before next wave...`);
      await sleep(CONFIG.wavePause);
    }
  }
  
  return results;
}

// ============ Main ============

async function main() {
  console.log('═'.repeat(60));
  console.log(' OrbitMM - Multi-Wallet Coordinated Trading');
  console.log('═'.repeat(60));
  console.log();
  
  // Validate configuration
  if (CONFIG.targetToken === 'YOUR_TOKEN_MINT_ADDRESS') {
    console.error('❌ Error: Please set TARGET_TOKEN environment variable');
    console.log('\nExample:');
    console.log('  TARGET_TOKEN=<mint> npx ts-node examples/multi-wallet-trade.ts');
    process.exit(1);
  }
  
  if (CONFIG.dryRun) {
    console.log('⚠️  DRY RUN MODE - No actual transactions will be executed\n');
  }
  
  // Print configuration
  console.log('Configuration:');
  console.log(`  Token:      ${shortAddress(CONFIG.targetToken)}`);
  console.log(`  Mode:       ${CONFIG.mode.toUpperCase()}`);
  console.log(`  Direction:  ${CONFIG.direction.toUpperCase()}`);
  if (CONFIG.fixedAmount) {
    console.log(`  Amount:     ${CONFIG.fixedAmount} SOL (fixed)`);
  } else {
    console.log(`  Amount:     ${CONFIG.minAmount} - ${CONFIG.maxAmount} SOL (random)`);
  }
  console.log(`  Slippage:   ${CONFIG.maxSlippageBps / 100}% max`);
  console.log(`  Priority:   ${CONFIG.priorityFeeLamports} lamports`);
  console.log();
  
  // Load wallets
  console.log('Loading wallets...');
  let wallets: Keypair[];
  try {
    wallets = await loadWallets(CONFIG.walletsPath);
    console.log(`  Loaded ${wallets.length} wallet(s)\n`);
  } catch (err) {
    console.error(`Failed to load wallets: ${err}`);
    process.exit(1);
  }
  
  // Initialize connection
  const connection = new Connection(CONFIG.rpcUrl, 'confirmed');
  const targetToken = new PublicKey(CONFIG.targetToken);
  
  // Check balances
  console.log('Checking balances...');
  let lowBalanceCount = 0;
  for (const wallet of wallets.slice(0, 5)) {
    const balance = await connection.getBalance(wallet.publicKey);
    console.log(`  ${shortAddress(wallet.publicKey.toString())}: ${formatSol(balance)}`);
    if (balance < CONFIG.minAmount * LAMPORTS_PER_SOL) {
      lowBalanceCount++;
    }
  }
  if (wallets.length > 5) {
    console.log(`  ... and ${wallets.length - 5} more`);
  }
  if (lowBalanceCount > 0) {
    console.log(`\n⚠️  ${lowBalanceCount} wallet(s) have low balance\n`);
  }
  
  // Execute trades
  console.log('─'.repeat(60));
  console.log(`Starting ${CONFIG.mode} execution...`);
  console.log('─'.repeat(60));
  
  let results: TradeResult[];
  const startTime = Date.now();
  
  switch (CONFIG.mode) {
    case 'parallel':
      results = await executeParallel(connection, wallets, targetToken);
      break;
    case 'wave':
      results = await executeWave(connection, wallets, targetToken);
      break;
    case 'sequential':
    default:
      results = await executeSequential(connection, wallets, targetToken);
  }
  
  const totalTime = Date.now() - startTime;
  
  // Print summary
  const successful = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);
  const totalInput = results.reduce((sum, r) => sum + r.inputAmount, 0);
  const totalOutput = successful.reduce((sum, r) => sum + (r.outputAmount || 0), 0);
  
  console.log('\n' + '═'.repeat(60));
  console.log(' Execution Summary');
  console.log('═'.repeat(60));
  console.log(`  Total trades:     ${results.length}`);
  console.log(`  Successful:       ${successful.length} (${Math.round(successful.length / results.length * 100)}%)`);
  console.log(`  Failed:           ${failed.length}`);
  console.log(`  Total input:      ${formatSol(totalInput)}`);
  console.log(`  Total output:     ${formatSol(totalOutput)}`);
  console.log(`  Execution time:   ${(totalTime / 1000).toFixed(1)}s`);
  console.log(`  Avg time/trade:   ${Math.round(totalTime / results.length)}ms`);
  console.log('═'.repeat(60));
  
  if (failed.length > 0) {
    console.log('\nFailed trades:');
    for (const result of failed.slice(0, 5)) {
      console.log(`  ${shortAddress(result.wallet)}: ${result.error}`);
    }
    if (failed.length > 5) {
      console.log(`  ... and ${failed.length - 5} more`);
    }
  }
  
  // Save results to file
  const resultsPath = path.join(__dirname, `trade-results-${Date.now()}.json`);
  await fs.writeFile(resultsPath, JSON.stringify({
    config: CONFIG,
    startTime,
    endTime: Date.now(),
    totalTime,
    results,
    summary: {
      total: results.length,
      successful: successful.length,
      failed: failed.length,
      totalInput,
      totalOutput,
    },
  }, null, 2));
  console.log(`\n📁 Results saved to: ${resultsPath}`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
