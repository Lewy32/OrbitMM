/**
 * OrbitMM Wallet Funder
 * 
 * Batch funding of multiple wallets with proper transaction batching.
 * Following ARCHITECT_SPEC.md exactly.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  FundOptions,
  FundResult,
  InsufficientFundsError,
  TransactionError,
  InvalidAmountError,
  RPCError,
  BATCH_CONFIG,
} from './types.js';

// Retry configuration per spec
const RETRY_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
};

// Base fee estimate (5000 lamports per signature + compute)
const BASE_FEE_PER_TX = 5000;
const COMPUTE_BUDGET_PER_TRANSFER = 200; // Approximate CU per transfer

/**
 * Fund multiple wallets in batched transactions.
 * Uses 20 transfers per batch by default to stay within Solana TX size limits.
 * 
 * @param connection - Solana RPC connection
 * @param options - Funding options
 * @returns Fund result with successful/failed wallets and signatures
 * @throws {InsufficientFundsError} If source doesn't have enough SOL
 * @throws {InvalidAmountError} If amountPerWallet <= 0
 */
export async function fundAll(
  connection: Connection,
  options: FundOptions
): Promise<FundResult> {
  const { source, destinations, amountPerWallet, priorityFee } = options;

  // Validate amount
  if (amountPerWallet <= 0) {
    throw new InvalidAmountError(amountPerWallet);
  }

  // Handle empty destinations
  if (destinations.length === 0) {
    return {
      successful: [],
      failed: [],
      signatures: [],
      totalFunded: 0,
      feePaid: 0,
    };
  }

  // Filter out source from destinations (can't send to self)
  const validDestinations = destinations.filter(
    (dest) => !dest.equals(source.publicKey)
  );

  // Calculate total required
  const lamportsPerWallet = Math.floor(amountPerWallet * LAMPORTS_PER_SOL);
  const batchSize = priorityFee ? BATCH_CONFIG.withPriorityFee : BATCH_CONFIG.default;
  const numBatches = Math.ceil(validDestinations.length / batchSize);
  const estimatedFees = numBatches * BASE_FEE_PER_TX + (priorityFee || 0) * numBatches;
  const totalRequired = lamportsPerWallet * validDestinations.length + estimatedFees;

  // Check source balance
  let sourceBalance: number;
  try {
    sourceBalance = await connection.getBalance(source.publicKey);
  } catch (error) {
    throw new RPCError(
      'Failed to fetch source balance',
      error as Error
    );
  }

  if (sourceBalance < totalRequired) {
    throw new InsufficientFundsError(
      totalRequired / LAMPORTS_PER_SOL,
      sourceBalance / LAMPORTS_PER_SOL
    );
  }

  // Split into batches
  const batches = chunk(validDestinations, batchSize);
  const result: FundResult = {
    successful: [],
    failed: [],
    signatures: [],
    totalFunded: 0,
    feePaid: 0,
  };

  // Process batches
  for (const batch of batches) {
    try {
      const signature = await executeBatchWithRetry(
        connection,
        source,
        batch,
        lamportsPerWallet,
        priorityFee
      );

      result.signatures.push(signature);
      result.successful.push(...batch);
      result.totalFunded += batch.length * amountPerWallet;
    } catch (error) {
      // Mark all wallets in failed batch
      for (const wallet of batch) {
        result.failed.push({
          wallet,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  }

  // Estimate fees paid (actual may vary)
  result.feePaid = result.signatures.length * BASE_FEE_PER_TX / LAMPORTS_PER_SOL;

  return result;
}

/**
 * Execute a batch of transfers with retry logic.
 */
async function executeBatchWithRetry(
  connection: Connection,
  source: Keypair,
  destinations: PublicKey[],
  lamportsPerWallet: number,
  priorityFee?: number
): Promise<string> {
  let lastError: Error | null = null;
  let delay = RETRY_CONFIG.initialDelayMs;
  let currentBatchSize = destinations.length;

  for (let attempt = 1; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    try {
      // Build fresh transaction each attempt (fresh blockhash)
      const tx = await buildFundingTransaction(
        connection,
        source,
        destinations.slice(0, currentBatchSize),
        lamportsPerWallet,
        priorityFee
      );

      const signature = await sendAndConfirmTransaction(
        connection,
        tx,
        [source],
        { commitment: 'confirmed' }
      );

      return signature;
    } catch (error) {
      lastError = error as Error;
      const errorMsg = lastError.message.toLowerCase();

      // Check for non-retryable errors
      if (
        errorMsg.includes('insufficient funds') ||
        errorMsg.includes('invalid signature')
      ) {
        throw new TransactionError(lastError.message);
      }

      // Check if transaction too large - halve batch size
      if (errorMsg.includes('too large') || errorMsg.includes('packet data size')) {
        currentBatchSize = Math.max(
          Math.floor(currentBatchSize / 2),
          BATCH_CONFIG.minimum
        );
        console.warn(`Batch too large, reducing to ${currentBatchSize}`);
      }

      // Retryable error - wait and retry
      console.warn(
        `Attempt ${attempt} failed: ${lastError.message}. Retrying in ${delay}ms`
      );
      await sleep(delay);
      delay = Math.min(delay * RETRY_CONFIG.backoffMultiplier, RETRY_CONFIG.maxDelayMs);
    }
  }

  throw new TransactionError(
    `Failed after ${RETRY_CONFIG.maxRetries} attempts: ${lastError?.message}`
  );
}

/**
 * Build a funding transaction for a batch of destinations.
 */
async function buildFundingTransaction(
  connection: Connection,
  source: Keypair,
  destinations: PublicKey[],
  lamportsPerWallet: number,
  priorityFee?: number
): Promise<Transaction> {
  const tx = new Transaction();

  // Add priority fee if specified
  if (priorityFee && priorityFee > 0) {
    const computeUnits = destinations.length * COMPUTE_BUDGET_PER_TRANSFER + 200;
    tx.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityFee })
    );
  }

  // Add transfer instructions
  for (const dest of destinations) {
    tx.add(
      SystemProgram.transfer({
        fromPubkey: source.publicKey,
        toPubkey: dest,
        lamports: lamportsPerWallet,
      })
    );
  }

  // Get fresh blockhash
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = source.publicKey;

  return tx;
}

/**
 * Calculate total cost to fund wallets (including fees).
 * 
 * @param count - Number of wallets to fund
 * @param amountPerWallet - SOL per wallet
 * @param priorityFee - Optional priority fee in microLamports
 * @returns Cost breakdown
 */
export function estimateFundingCost(
  count: number,
  amountPerWallet: number,
  priorityFee?: number
): { total: number; fees: number; principal: number } {
  if (count <= 0) {
    return { total: 0, fees: 0, principal: 0 };
  }

  const batchSize = priorityFee ? BATCH_CONFIG.withPriorityFee : BATCH_CONFIG.default;
  const numBatches = Math.ceil(count / batchSize);
  
  // Base transaction fee
  let feesLamports = numBatches * BASE_FEE_PER_TX;
  
  // Add priority fees if specified
  if (priorityFee) {
    const computeUnitsPerBatch = batchSize * COMPUTE_BUDGET_PER_TRANSFER + 200;
    feesLamports += numBatches * (priorityFee * computeUnitsPerBatch / 1_000_000);
  }

  const fees = feesLamports / LAMPORTS_PER_SOL;
  const principal = count * amountPerWallet;
  const total = principal + fees;

  return { total, fees, principal };
}

// ============ Helper Functions ============

/**
 * Split array into chunks of specified size.
 */
function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Sleep for specified milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
