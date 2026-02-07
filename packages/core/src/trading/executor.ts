/**
 * Transaction Executor
 * OrbitMM - Transaction building with priority fees, retries, and replacement
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
  TransactionMessage,
  TransactionInstruction,
  ComputeBudgetProgram,
  SendTransactionError,
  TransactionExpiredBlockheightExceededError,
} from '@solana/web3.js';

import {
  SwapResult,
  PriorityFeeConfig,
  DEFAULT_PRIORITY_FEE_CONFIG,
  RetryConfig,
  DEFAULT_RETRY_CONFIG,
  SwapTransactionError,
  SimulationError,
} from './types.js';

// ============ Executor Configuration ============

export interface ExecutorConfig {
  priorityFee: PriorityFeeConfig;
  retry: RetryConfig;
  confirmationTimeout: number;  // Default: 60000 (60s)
  skipPreflight: boolean;       // Default: false
  maxRetries: number;           // Default: 2 (per send attempt)
  stuckTxThresholdMs: number;   // Default: 30000 (30s)
  useVersionedTx: boolean;      // Default: true
}

export const DEFAULT_EXECUTOR_CONFIG: ExecutorConfig = {
  priorityFee: DEFAULT_PRIORITY_FEE_CONFIG,
  retry: DEFAULT_RETRY_CONFIG,
  confirmationTimeout: 60000,
  skipPreflight: false,
  maxRetries: 2,
  stuckTxThresholdMs: 30000,
  useVersionedTx: true,
};

// ============ Priority Fee Cache ============

interface PriorityFeeCache {
  fee: number;
  timestamp: number;
}

// ============ Transaction Executor ============

export class TransactionExecutor {
  private config: ExecutorConfig;
  private priorityFeeCache: PriorityFeeCache | null = null;

  constructor(
    private readonly connection: Connection,
    config: Partial<ExecutorConfig> = {}
  ) {
    this.config = { ...DEFAULT_EXECUTOR_CONFIG, ...config };
  }

  /**
   * Build transaction with priority fee and compute budget
   */
  async buildTransaction(
    wallet: Keypair,
    instructions: TransactionInstruction[],
    urgency: 'normal' | 'high' | 'critical' = 'normal'
  ): Promise<Transaction | VersionedTransaction> {
    // Get priority fee
    const priorityFee = await this.getPriorityFee(urgency);

    // Build compute budget instructions
    const computeBudgetInstructions = this.buildComputeBudgetInstructions(priorityFee);

    // Combine all instructions
    const allInstructions = [...computeBudgetInstructions, ...instructions];

    // Get recent blockhash
    const { blockhash, lastValidBlockHeight } = 
      await this.connection.getLatestBlockhash('confirmed');

    if (this.config.useVersionedTx) {
      // Build versioned transaction
      const messageV0 = new TransactionMessage({
        payerKey: wallet.publicKey,
        recentBlockhash: blockhash,
        instructions: allInstructions,
      }).compileToV0Message();

      const versionedTx = new VersionedTransaction(messageV0);
      versionedTx.sign([wallet]);

      return versionedTx;
    } else {
      // Build legacy transaction
      const transaction = new Transaction();
      transaction.add(...allInstructions);
      transaction.recentBlockhash = blockhash;
      transaction.lastValidBlockHeight = lastValidBlockHeight;
      transaction.feePayer = wallet.publicKey;
      transaction.sign(wallet);

      return transaction;
    }
  }

  /**
   * Simulate transaction before sending
   */
  async simulateTransaction(
    transaction: Transaction | VersionedTransaction
  ): Promise<{ success: boolean; logs: string[]; unitsConsumed?: number }> {
    try {
      const result = await this.connection.simulateTransaction(
        transaction as VersionedTransaction,
        { sigVerify: false }
      );

      if (result.value.err) {
        throw new SimulationError(
          `Simulation failed: ${JSON.stringify(result.value.err)}`,
          result.value.logs ?? undefined
        );
      }

      return {
        success: true,
        logs: result.value.logs ?? [],
        unitsConsumed: result.value.unitsConsumed ?? undefined,
      };
    } catch (error) {
      if (error instanceof SimulationError) {
        throw error;
      }
      throw new SimulationError(
        error instanceof Error ? error.message : 'Unknown simulation error'
      );
    }
  }

  /**
   * Send and confirm transaction with retry logic
   */
  async sendAndConfirm(
    transaction: Transaction | VersionedTransaction,
    wallet: Keypair
  ): Promise<{ signature: string; slot: number }> {
    const config = this.config.retry;
    let lastError: Error | null = null;
    let delay = config.initialDelayMs;

    for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
      try {
        // Rebuild with fresh blockhash on retry
        if (attempt > 1) {
          const { blockhash, lastValidBlockHeight } = 
            await this.connection.getLatestBlockhash('confirmed');
          
          if (transaction instanceof VersionedTransaction) {
            // For versioned tx, we need to rebuild the whole thing
            // This is a limitation - in production, store instructions separately
            console.warn('Retrying versioned transaction with same blockhash');
          } else {
            transaction.recentBlockhash = blockhash;
            transaction.lastValidBlockHeight = lastValidBlockHeight;
            transaction.sign(wallet);
          }
        }

        // Send transaction
        const signature = await this.connection.sendTransaction(
          transaction as VersionedTransaction,
          {
            skipPreflight: this.config.skipPreflight,
            maxRetries: this.config.maxRetries,
          }
        );

        // Confirm with timeout
        const confirmation = await this.confirmWithTimeout(signature);

        return {
          signature,
          slot: confirmation.slot,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if error is non-retryable
        if (this.isNonRetryable(lastError)) {
          throw new SwapTransactionError(lastError.message);
        }

        console.warn(
          `Attempt ${attempt}/${config.maxRetries} failed: ${lastError.message}. ` +
          `Retrying in ${delay}ms...`
        );

        await this.sleep(delay);
        delay = Math.min(delay * config.backoffMultiplier, config.maxDelayMs);
      }
    }

    throw new SwapTransactionError(
      `Failed after ${config.maxRetries} attempts: ${lastError?.message || 'Unknown error'}`
    );
  }

  /**
   * Execute transaction with full retry and replacement logic
   */
  async execute(
    wallet: Keypair,
    instructions: TransactionInstruction[],
    options: {
      urgency?: 'normal' | 'high' | 'critical';
      simulate?: boolean;
    } = {}
  ): Promise<{ signature: string; slot: number }> {
    const urgency = options.urgency ?? 'normal';
    const simulate = options.simulate ?? true;

    // Build transaction
    const transaction = await this.buildTransaction(wallet, instructions, urgency);

    // Simulate if requested
    if (simulate) {
      await this.simulateTransaction(transaction);
    }

    // Send and confirm
    return this.sendAndConfirm(transaction, wallet);
  }

  /**
   * Replace stuck transaction with higher priority fee
   */
  async replaceStuckTransaction(
    wallet: Keypair,
    instructions: TransactionInstruction[],
    originalSignature: string
  ): Promise<{ signature: string; slot: number; replaced: boolean }> {
    // Check if original transaction is still pending
    const status = await this.connection.getSignatureStatus(originalSignature);
    
    if (status.value?.confirmationStatus === 'confirmed' || 
        status.value?.confirmationStatus === 'finalized') {
      return {
        signature: originalSignature,
        slot: status.context.slot,
        replaced: false,
      };
    }

    // Build replacement with higher priority
    console.log('Replacing stuck transaction with higher priority fee...');
    
    const result = await this.execute(wallet, instructions, { urgency: 'critical' });
    
    return {
      ...result,
      replaced: true,
    };
  }

  /**
   * Get current priority fee based on network conditions
   */
  async getPriorityFee(
    urgency: 'normal' | 'high' | 'critical' = 'normal'
  ): Promise<number> {
    const config = this.config.priorityFee;

    if (config.mode === 'fixed' && config.fixedLamports !== undefined) {
      return this.applyUrgencyMultiplier(config.fixedLamports, urgency);
    }

    // Check cache
    const now = Date.now();
    if (
      this.priorityFeeCache && 
      now - this.priorityFeeCache.timestamp < config.refreshIntervalMs
    ) {
      return this.applyUrgencyMultiplier(this.priorityFeeCache.fee, urgency);
    }

    // Fetch recent priority fees
    try {
      const recentFees = await this.connection.getRecentPrioritizationFees({});
      
      if (recentFees.length === 0) {
        return this.applyUrgencyMultiplier(config.minLamports, urgency);
      }

      // Sort and get percentile
      const sorted = recentFees
        .map(f => f.prioritizationFee)
        .sort((a, b) => a - b);
      
      const index = Math.floor(sorted.length * (config.percentile / 100));
      const fee = sorted[index] || config.minLamports;

      // Apply bounds
      const boundedFee = Math.max(
        config.minLamports,
        Math.min(config.maxLamports, fee)
      );

      // Update cache
      this.priorityFeeCache = {
        fee: boundedFee,
        timestamp: now,
      };

      return this.applyUrgencyMultiplier(boundedFee, urgency);
    } catch (error) {
      console.warn('Failed to fetch priority fees, using minimum:', error);
      return this.applyUrgencyMultiplier(config.minLamports, urgency);
    }
  }

  /**
   * Apply urgency multiplier to base fee
   */
  private applyUrgencyMultiplier(
    baseFee: number,
    urgency: 'normal' | 'high' | 'critical'
  ): number {
    const multipliers = {
      normal: 1.0,
      high: 1.5,
      critical: 2.0,
    };

    const multipliedFee = Math.floor(baseFee * multipliers[urgency]);
    return Math.min(multipliedFee, this.config.priorityFee.maxLamports);
  }

  /**
   * Build compute budget instructions
   */
  private buildComputeBudgetInstructions(
    priorityFee: number
  ): TransactionInstruction[] {
    return [
      ComputeBudgetProgram.setComputeUnitLimit({
        units: 200000, // Default compute units
      }),
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: priorityFee,
      }),
    ];
  }

  /**
   * Confirm transaction with timeout
   */
  private async confirmWithTimeout(
    signature: string
  ): Promise<{ slot: number }> {
    const startTime = Date.now();

    return new Promise(async (resolve, reject) => {
      // Set timeout
      const timeoutId = setTimeout(() => {
        reject(new SwapTransactionError(
          `Transaction confirmation timeout after ${this.config.confirmationTimeout}ms`,
          signature
        ));
      }, this.config.confirmationTimeout);

      try {
        // Poll for confirmation
        while (Date.now() - startTime < this.config.confirmationTimeout) {
          const status = await this.connection.getSignatureStatus(signature);

          if (status.value?.confirmationStatus === 'confirmed' ||
              status.value?.confirmationStatus === 'finalized') {
            clearTimeout(timeoutId);
            resolve({ slot: status.context.slot });
            return;
          }

          if (status.value?.err) {
            clearTimeout(timeoutId);
            reject(new SwapTransactionError(
              `Transaction failed: ${JSON.stringify(status.value.err)}`,
              signature
            ));
            return;
          }

          // Check if stuck (might need replacement)
          if (Date.now() - startTime > this.config.stuckTxThresholdMs) {
            clearTimeout(timeoutId);
            reject(new SwapTransactionError(
              'Transaction appears stuck, consider replacement',
              signature
            ));
            return;
          }

          // Wait before next poll
          await this.sleep(1000);
        }

        clearTimeout(timeoutId);
        reject(new SwapTransactionError('Transaction confirmation timeout', signature));
      } catch (error) {
        clearTimeout(timeoutId);
        reject(error);
      }
    });
  }

  /**
   * Check if error should not be retried
   */
  private isNonRetryable(error: Error): boolean {
    const message = error.message.toLowerCase();
    const nonRetryable = this.config.retry.nonRetryableErrors;
    
    return nonRetryable.some(pattern => message.includes(pattern.toLowerCase()));
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============ Standalone Functions ============

let defaultExecutor: TransactionExecutor | null = null;

/**
 * Get or create default executor
 */
function getDefaultExecutor(connection: Connection): TransactionExecutor {
  if (!defaultExecutor) {
    defaultExecutor = new TransactionExecutor(connection);
  }
  return defaultExecutor;
}

/**
 * Build transaction with priority fee
 */
export async function buildTransaction(
  connection: Connection,
  wallet: Keypair,
  instructions: TransactionInstruction[],
  urgency: 'normal' | 'high' | 'critical' = 'normal'
): Promise<Transaction | VersionedTransaction> {
  const executor = getDefaultExecutor(connection);
  return executor.buildTransaction(wallet, instructions, urgency);
}

/**
 * Simulate transaction before sending
 */
export async function simulateTransaction(
  connection: Connection,
  transaction: Transaction | VersionedTransaction
): Promise<{ success: boolean; logs: string[]; unitsConsumed?: number }> {
  const executor = getDefaultExecutor(connection);
  return executor.simulateTransaction(transaction);
}

/**
 * Send and confirm transaction with retry logic
 */
export async function sendAndConfirm(
  connection: Connection,
  transaction: Transaction | VersionedTransaction,
  wallet: Keypair
): Promise<{ signature: string; slot: number }> {
  const executor = getDefaultExecutor(connection);
  return executor.sendAndConfirm(transaction, wallet);
}

/**
 * Execute transaction with full retry logic
 */
export async function execute(
  connection: Connection,
  wallet: Keypair,
  instructions: TransactionInstruction[],
  options: {
    urgency?: 'normal' | 'high' | 'critical';
    simulate?: boolean;
  } = {}
): Promise<{ signature: string; slot: number }> {
  const executor = getDefaultExecutor(connection);
  return executor.execute(wallet, instructions, options);
}

/**
 * Get current priority fee based on network conditions
 */
export async function getPriorityFee(
  connection: Connection,
  urgency: 'normal' | 'high' | 'critical' = 'normal'
): Promise<number> {
  const executor = getDefaultExecutor(connection);
  return executor.getPriorityFee(urgency);
}

/**
 * Replace stuck transaction with higher priority fee
 */
export async function replaceStuckTransaction(
  connection: Connection,
  wallet: Keypair,
  instructions: TransactionInstruction[],
  originalSignature: string
): Promise<{ signature: string; slot: number; replaced: boolean }> {
  const executor = getDefaultExecutor(connection);
  return executor.replaceStuckTransaction(wallet, instructions, originalSignature);
}
