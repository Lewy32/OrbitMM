#!/usr/bin/env npx ts-node
/**
 * Basic Volume Boost Example
 * 
 * This example demonstrates how to set up a simple volume boosting operation
 * for a token using OrbitMM. It creates bots that perform buy/sell operations
 * to increase trading volume.
 * 
 * Usage:
 *   npx ts-node examples/basic-volume-boost.ts
 * 
 * Prerequisites:
 *   - Generate wallets: orbitmm wallet generate 5
 *   - Fund wallets with SOL
 *   - Set environment variables (see .env.example)
 */

import { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import * as fs from 'fs/promises';
import * as path from 'path';

// ============ Configuration ============

const CONFIG = {
  // Target token to boost volume for
  targetToken: process.env.TARGET_TOKEN || 'YOUR_TOKEN_MINT_ADDRESS',
  
  // RPC endpoint
  rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  
  // Trading parameters
  minSwapSol: 0.01,      // Minimum SOL per swap
  maxSwapSol: 0.05,      // Maximum SOL per swap
  minIntervalMs: 30_000, // Minimum 30 seconds between trades
  maxIntervalMs: 90_000, // Maximum 90 seconds between trades
  
  // Limits
  maxSwapsPerWallet: 20, // Stop after this many swaps per wallet
  maxTotalVolumeSol: 1,  // Stop after this much volume per wallet
  
  // Wallets file path
  walletsPath: process.env.WALLETS_PATH || path.join(__dirname, '../wallets.json'),
};

// ============ Types ============

interface WalletData {
  publicKey: string;
  secretKey: number[];
}

interface BotState {
  wallet: Keypair;
  swapCount: number;
  totalVolume: number;
  lastSwapAt: number | null;
  isRunning: boolean;
}

// ============ Utility Functions ============

async function loadWallets(filePath: string): Promise<Keypair[]> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    
    // Handle both encrypted and unencrypted formats
    const wallets: WalletData[] = data.wallets || data;
    
    return wallets.map((w) => 
      Keypair.fromSecretKey(new Uint8Array(w.secretKey))
    );
  } catch (err) {
    throw new Error(`Failed to load wallets: ${err}`);
  }
}

function randomBetween(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatSol(lamports: number): string {
  return (lamports / LAMPORTS_PER_SOL).toFixed(4) + ' SOL';
}

// ============ Mock Trading Functions ============
// Replace these with actual @orbitmm/core imports when available

async function getQuote(
  connection: Connection,
  inputMint: PublicKey,
  outputMint: PublicKey,
  amount: number
): Promise<{ outAmount: number; priceImpact: number }> {
  // TODO: Replace with actual Jupiter/Raydium quote
  console.log(`  [Quote] ${formatSol(amount)} -> Token...`);
  await sleep(500);
  return {
    outAmount: amount * 1.5, // Mock conversion rate
    priceImpact: 0.5,
  };
}

async function executeSwap(
  connection: Connection,
  wallet: Keypair,
  inputMint: PublicKey,
  outputMint: PublicKey,
  amount: number
): Promise<{ signature: string; success: boolean }> {
  // TODO: Replace with actual swap execution
  console.log(`  [Swap] Executing ${formatSol(amount)} swap...`);
  await sleep(1000);
  
  // Mock 90% success rate
  const success = Math.random() > 0.1;
  return {
    signature: success ? `mock-sig-${Date.now().toString(36)}` : '',
    success,
  };
}

// ============ Bot Logic ============

async function runBot(
  connection: Connection,
  state: BotState,
  targetToken: PublicKey
): Promise<void> {
  const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
  const walletAddress = state.wallet.publicKey.toString().slice(0, 8) + '...';
  
  while (state.isRunning) {
    // Check limits
    if (state.swapCount >= CONFIG.maxSwapsPerWallet) {
      console.log(`[${walletAddress}] Max swaps reached (${state.swapCount}). Stopping.`);
      break;
    }
    
    if (state.totalVolume >= CONFIG.maxTotalVolumeSol * LAMPORTS_PER_SOL) {
      console.log(`[${walletAddress}] Max volume reached (${formatSol(state.totalVolume)}). Stopping.`);
      break;
    }
    
    // Random delay between trades
    const interval = randomBetween(CONFIG.minIntervalMs, CONFIG.maxIntervalMs);
    console.log(`[${walletAddress}] Waiting ${Math.round(interval / 1000)}s before next trade...`);
    await sleep(interval);
    
    // Random trade amount
    const amount = randomBetween(CONFIG.minSwapSol, CONFIG.maxSwapSol) * LAMPORTS_PER_SOL;
    
    // Alternate between buy and sell
    const isBuy = state.swapCount % 2 === 0;
    const inputMint = isBuy ? SOL_MINT : targetToken;
    const outputMint = isBuy ? targetToken : SOL_MINT;
    const direction = isBuy ? 'BUY' : 'SELL';
    
    console.log(`[${walletAddress}] ${direction} - ${formatSol(amount)}`);
    
    try {
      // Get quote
      const quote = await getQuote(connection, inputMint, outputMint, amount);
      
      // Check price impact
      if (quote.priceImpact > 5) {
        console.log(`  [Skip] Price impact too high: ${quote.priceImpact}%`);
        continue;
      }
      
      // Execute swap
      const result = await executeSwap(connection, state.wallet, inputMint, outputMint, amount);
      
      if (result.success) {
        state.swapCount++;
        state.totalVolume += amount;
        state.lastSwapAt = Date.now();
        console.log(`  [Success] Swap #${state.swapCount} - Total volume: ${formatSol(state.totalVolume)}`);
      } else {
        console.log(`  [Failed] Transaction failed, will retry...`);
      }
    } catch (err) {
      console.error(`  [Error] ${err}`);
    }
  }
  
  state.isRunning = false;
}

// ============ Main ============

async function main() {
  console.log('═'.repeat(60));
  console.log(' OrbitMM - Basic Volume Boost');
  console.log('═'.repeat(60));
  console.log();
  
  // Validate configuration
  if (CONFIG.targetToken === 'YOUR_TOKEN_MINT_ADDRESS') {
    console.error('Error: Please set TARGET_TOKEN environment variable');
    console.log('\nExample:');
    console.log('  TARGET_TOKEN=TokenMintAddress npx ts-node examples/basic-volume-boost.ts');
    process.exit(1);
  }
  
  const targetToken = new PublicKey(CONFIG.targetToken);
  const connection = new Connection(CONFIG.rpcUrl, 'confirmed');
  
  console.log('Configuration:');
  console.log(`  Target Token: ${CONFIG.targetToken}`);
  console.log(`  RPC URL: ${CONFIG.rpcUrl}`);
  console.log(`  Swap Range: ${CONFIG.minSwapSol} - ${CONFIG.maxSwapSol} SOL`);
  console.log(`  Interval: ${CONFIG.minIntervalMs / 1000}s - ${CONFIG.maxIntervalMs / 1000}s`);
  console.log(`  Max Swaps/Wallet: ${CONFIG.maxSwapsPerWallet}`);
  console.log(`  Max Volume/Wallet: ${CONFIG.maxTotalVolumeSol} SOL`);
  console.log();
  
  // Load wallets
  console.log('Loading wallets...');
  let wallets: Keypair[];
  try {
    wallets = await loadWallets(CONFIG.walletsPath);
    console.log(`  Loaded ${wallets.length} wallet(s)`);
  } catch (err) {
    console.error(`Failed to load wallets: ${err}`);
    console.log('\nGenerate wallets first:');
    console.log('  orbitmm wallet generate 5 --output wallets.json --no-encrypt');
    process.exit(1);
  }
  
  // Check balances
  console.log('\nChecking balances...');
  for (const wallet of wallets) {
    const balance = await connection.getBalance(wallet.publicKey);
    const address = wallet.publicKey.toString().slice(0, 8) + '...';
    console.log(`  ${address}: ${formatSol(balance)}`);
    
    if (balance < CONFIG.minSwapSol * LAMPORTS_PER_SOL) {
      console.log(`    ⚠ Low balance - needs at least ${CONFIG.minSwapSol} SOL`);
    }
  }
  
  // Create bot states
  const botStates: BotState[] = wallets.map((wallet) => ({
    wallet,
    swapCount: 0,
    totalVolume: 0,
    lastSwapAt: null,
    isRunning: true,
  }));
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\nShutting down gracefully...');
    botStates.forEach((state) => (state.isRunning = false));
  });
  
  // Start all bots
  console.log('\n' + '─'.repeat(60));
  console.log('Starting volume boost bots...');
  console.log('Press Ctrl+C to stop');
  console.log('─'.repeat(60) + '\n');
  
  const botPromises = botStates.map((state) => 
    runBot(connection, state, targetToken)
  );
  
  await Promise.all(botPromises);
  
  // Print summary
  console.log('\n' + '═'.repeat(60));
  console.log(' Session Summary');
  console.log('═'.repeat(60));
  
  let totalSwaps = 0;
  let totalVolume = 0;
  
  for (const state of botStates) {
    const address = state.wallet.publicKey.toString().slice(0, 8) + '...';
    console.log(`  ${address}: ${state.swapCount} swaps, ${formatSol(state.totalVolume)}`);
    totalSwaps += state.swapCount;
    totalVolume += state.totalVolume;
  }
  
  console.log('─'.repeat(60));
  console.log(`  Total: ${totalSwaps} swaps, ${formatSol(totalVolume)}`);
  console.log('═'.repeat(60));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
