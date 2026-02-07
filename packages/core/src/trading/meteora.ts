/**
 * Meteora DLMM Integration
 * OrbitMM - Meteora Dynamic Liquidity Market Maker Integration
 * 
 * Meteora uses a DLMM (Dynamic Liquidity Market Maker) model with:
 * - Concentrated liquidity in discrete bins
 * - Variable fees based on volatility
 * - Zero slippage within active bin
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';

import {
  Quote,
  QuoteParams,
  SwapParams,
  SwapResult,
  Pool,
  DEX,
  NoRouteError,
  APIError,
  SwapTransactionError,
  QuoteRequestOptions,
} from './types.js';

// ============ Meteora Constants ============

const METEORA_API_URL = 'https://dlmm-api.meteora.ag';
const METEORA_PROGRAM_ID = new PublicKey('LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo');
const QUOTE_VALIDITY_MS = 30000;

// ============ Meteora API Types ============

interface MeteoraPoolInfo {
  address: string;
  name: string;
  mint_x: string;
  mint_y: string;
  reserve_x: string;
  reserve_y: string;
  reserve_x_amount: number;
  reserve_y_amount: number;
  bin_step: number;
  base_fee_percentage: string;
  max_fee_percentage: string;
  protocol_fee_percentage: string;
  liquidity: string;
  reward_mint_x: string;
  reward_mint_y: string;
  fees_24h: number;
  today_fees: number;
  trade_volume_24h: number;
  cumulative_trade_volume: string;
  cumulative_fee_volume: string;
  current_price: number;
  apr: number;
  apy: number;
  hide: boolean;
}

interface MeteoraQuoteResult {
  inAmount: bigint;
  outAmount: bigint;
  fee: bigint;
  priceImpact: number;
}

// ============ Meteora Client ============

export class MeteoraClient {
  private poolCache: Map<string, MeteoraPoolInfo> = new Map();
  private poolCacheExpiry: number = 0;
  private readonly cacheDurationMs = 60000; // 1 minute

  constructor(
    private readonly connection: Connection,
    private readonly apiUrl: string = METEORA_API_URL
  ) {}

  /**
   * Get swap quote from Meteora DLMM pools.
   * 
   * @throws {NoRouteError} If no pool found
   * @throws {APIError} If Meteora API fails
   */
  async getQuote(
    params: QuoteParams,
    options: QuoteRequestOptions = {}
  ): Promise<Quote> {
    const timeout = options.timeout ?? 5000;

    try {
      // Find pool for token pair
      const pool = await this.findPool(
        params.inputMint.toString(),
        params.outputMint.toString()
      );

      if (!pool) {
        throw new NoRouteError(
          params.inputMint.toString(),
          params.outputMint.toString()
        );
      }

      // Calculate quote using DLMM math
      const quote = await this.calculateQuote(pool, params);

      const now = Date.now();

      return {
        inputMint: params.inputMint.toString(),
        outputMint: params.outputMint.toString(),
        inAmount: params.amount.toString(),
        outAmount: quote.outAmount.toString(),
        minOutAmount: this.applySlippage(quote.outAmount, params.slippageBps).toString(),
        priceImpactPct: quote.priceImpact,
        route: [{
          dex: 'meteora',
          inputMint: params.inputMint.toString(),
          outputMint: params.outputMint.toString(),
          poolId: pool.address,
          percent: 100,
        }],
        dex: 'meteora',
        timestamp: now,
        expiresAt: now + QUOTE_VALIDITY_MS,
      };
    } catch (error) {
      if (error instanceof NoRouteError) {
        throw error;
      }

      if (error instanceof Error) {
        throw new APIError('meteora', error.message);
      }

      throw new APIError('meteora', 'Unknown error');
    }
  }

  /**
   * Execute swap on Meteora DLMM.
   * 
   * Note: Full implementation requires @meteora-ag/dlmm SDK.
   * This is a simplified version that builds the transaction structure.
   * 
   * @throws {SwapTransactionError} If transaction fails
   */
  async swap(
    connection: Connection,
    params: SwapParams
  ): Promise<SwapResult> {
    const { wallet, quote, priorityFee } = params;

    try {
      // Find pool
      const pool = await this.findPool(quote.inputMint, quote.outputMint);

      if (!pool) {
        throw new SwapTransactionError('Pool not found for swap');
      }

      // Build swap transaction
      const transaction = await this.buildSwapTransaction(
        wallet,
        pool,
        quote,
        priorityFee === 'auto' ? undefined : priorityFee
      );

      // Send and confirm
      const signature = await connection.sendRawTransaction(
        transaction.serialize(),
        {
          skipPreflight: false,
          maxRetries: 2,
        }
      );

      const confirmation = await connection.confirmTransaction(signature, 'confirmed');

      if (confirmation.value.err) {
        throw new SwapTransactionError(
          `Transaction failed: ${JSON.stringify(confirmation.value.err)}`,
          signature
        );
      }

      return {
        signature,
        inputAmount: parseInt(quote.inAmount),
        outputAmount: parseInt(quote.outAmount),
        fee: (priorityFee && priorityFee !== 'auto' ? priorityFee : 5000) / 1e9,
        slot: confirmation.context.slot,
        timestamp: Date.now(),
      };
    } catch (error) {
      if (error instanceof SwapTransactionError) {
        throw error;
      }

      if (error instanceof Error) {
        throw new SwapTransactionError(error.message);
      }

      throw new SwapTransactionError('Unknown transaction error');
    }
  }

  /**
   * Get available Meteora pools for a token.
   */
  async getPools(tokenMint: PublicKey): Promise<Pool[]> {
    await this.refreshPoolCache();

    const pools: Pool[] = [];
    const mintStr = tokenMint.toString();

    for (const [, poolInfo] of this.poolCache) {
      if (poolInfo.mint_x === mintStr || poolInfo.mint_y === mintStr) {
        pools.push({
          id: poolInfo.address,
          dex: 'meteora',
          tokenA: { mint: poolInfo.mint_x },
          tokenB: { mint: poolInfo.mint_y },
          liquidity: parseFloat(poolInfo.liquidity) || 0,
          volume24h: poolInfo.trade_volume_24h || 0,
        });
      }
    }

    return pools;
  }

  /**
   * Get all Meteora pools.
   */
  async getAllPools(): Promise<MeteoraPoolInfo[]> {
    await this.refreshPoolCache();
    return Array.from(this.poolCache.values());
  }

  /**
   * Find pool for a token pair.
   */
  private async findPool(
    inputMint: string,
    outputMint: string
  ): Promise<MeteoraPoolInfo | null> {
    await this.refreshPoolCache();

    // Look for direct pool
    for (const [, pool] of this.poolCache) {
      if (
        (pool.mint_x === inputMint && pool.mint_y === outputMint) ||
        (pool.mint_x === outputMint && pool.mint_y === inputMint)
      ) {
        return pool;
      }
    }

    return null;
  }

  /**
   * Refresh pool cache from Meteora API.
   */
  private async refreshPoolCache(): Promise<void> {
    const now = Date.now();

    if (now < this.poolCacheExpiry) {
      return; // Cache still valid
    }

    try {
      const response = await fetch(`${this.apiUrl}/pair/all`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json() as MeteoraPoolInfo[];

      this.poolCache.clear();

      for (const pool of data) {
        if (pool.address && !pool.hide) {
          this.poolCache.set(pool.address, pool);
        }
      }

      this.poolCacheExpiry = now + this.cacheDurationMs;
    } catch (error) {
      // Keep using stale cache on error
      console.warn('Failed to refresh Meteora pool cache:', error);
    }
  }

  /**
   * Calculate swap quote using DLMM math.
   * 
   * Meteora DLMM uses bin-based liquidity with the formula:
   * - Liquidity is concentrated in discrete price bins
   * - Each bin has a fixed price range
   * - Swaps move through bins, consuming liquidity
   */
  private async calculateQuote(
    pool: MeteoraPoolInfo,
    params: QuoteParams
  ): Promise<MeteoraQuoteResult> {
    const isXtoY = params.inputMint.toString() === pool.mint_x;
    const inputAmount = BigInt(params.amount);

    // Get reserves
    const reserveX = BigInt(pool.reserve_x_amount);
    const reserveY = BigInt(pool.reserve_y_amount);

    // Calculate fee (base fee as percentage)
    const feePercentage = parseFloat(pool.base_fee_percentage) || 0.25;
    const feeMultiplier = BigInt(Math.floor(feePercentage * 100));
    const fee = (inputAmount * feeMultiplier) / BigInt(10000);
    const inputAfterFee = inputAmount - fee;

    // Constant product calculation (simplified)
    // Full DLMM would iterate through bins
    let outputAmount: bigint;

    if (isXtoY) {
      // X to Y: output = (reserveY * inputAfterFee) / (reserveX + inputAfterFee)
      outputAmount = (reserveY * inputAfterFee) / (reserveX + inputAfterFee);
    } else {
      // Y to X: output = (reserveX * inputAfterFee) / (reserveY + inputAfterFee)
      outputAmount = (reserveX * inputAfterFee) / (reserveY + inputAfterFee);
    }

    // Calculate price impact
    const spotPrice = isXtoY 
      ? Number(reserveY) / Number(reserveX)
      : Number(reserveX) / Number(reserveY);
    const executionPrice = Number(outputAmount) / Number(inputAfterFee);
    const priceImpact = Math.abs((spotPrice - executionPrice) / spotPrice * 100);

    return {
      inAmount: inputAmount,
      outAmount: outputAmount,
      fee,
      priceImpact,
    };
  }

  /**
   * Apply slippage to output amount.
   */
  private applySlippage(amount: bigint, slippageBps: number): bigint {
    const multiplier = BigInt(10000 - slippageBps);
    return (amount * multiplier) / BigInt(10000);
  }

  /**
   * Build swap transaction.
   * 
   * Note: This is a simplified implementation.
   * Production use should utilize @meteora-ag/dlmm SDK for proper
   * bin array handling and instruction building.
   */
  private async buildSwapTransaction(
    wallet: Keypair,
    pool: MeteoraPoolInfo,
    quote: Quote,
    priorityFee?: number
  ): Promise<Transaction> {
    const transaction = new Transaction();

    // Determine swap direction
    const isXtoY = quote.inputMint === pool.mint_x;
    const inputMint = new PublicKey(quote.inputMint);
    const outputMint = new PublicKey(quote.outputMint);

    // Get/create user token accounts
    const userInputTokenAccount = await getAssociatedTokenAddress(
      inputMint,
      wallet.publicKey
    );
    const userOutputTokenAccount = await getAssociatedTokenAddress(
      outputMint,
      wallet.publicKey
    );

    // Check if output token account exists
    const outputAccountInfo = await this.connection.getAccountInfo(userOutputTokenAccount);
    if (!outputAccountInfo) {
      transaction.add(
        createAssociatedTokenAccountInstruction(
          wallet.publicKey,
          userOutputTokenAccount,
          wallet.publicKey,
          outputMint
        )
      );
    }

    // Note: Full swap instruction would be built using @meteora-ag/dlmm SDK:
    // const dlmmPool = await DLMM.create(connection, new PublicKey(pool.address));
    // const binArrays = await dlmmPool.getBinArrayForSwap(isXtoY);
    // const swapQuote = await dlmmPool.swapQuote(amount, isXtoY, slippage, binArrays);
    // const swapTx = await dlmmPool.swap({ ... });

    // For now, we'll throw an error indicating SDK is required
    throw new SwapTransactionError(
      'Meteora swap requires @meteora-ag/dlmm SDK. ' +
      'This simplified implementation only supports quote fetching. ' +
      'Use Jupiter aggregator for actual swaps, or install the Meteora SDK.'
    );
  }
}

// ============ DLMM SDK Integration (Optional) ============

// Type definitions for optional @meteora-ag/dlmm SDK
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DLMMPool = any;

/**
 * Create Meteora DLMM pool instance using the SDK.
 * 
 * Requires: npm install @meteora-ag/dlmm
 * 
 * Usage:
 * ```
 * import DLMM from '@meteora-ag/dlmm';
 * const dlmmPool = await createDLMMPool(connection, poolAddress);
 * ```
 */
export async function createDLMMPool(
  connection: Connection,
  poolAddress: PublicKey
): Promise<DLMMPool> {
  try {
    // Dynamic import to avoid hard dependency
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const DLMM = await import('@meteora-ag/dlmm' as string);
    return await DLMM.default.create(connection, poolAddress);
  } catch {
    throw new APIError(
      'meteora',
      'Failed to load @meteora-ag/dlmm SDK. Install with: npm install @meteora-ag/dlmm'
    );
  }
}

/**
 * Execute swap using Meteora SDK directly.
 * 
 * Requires: npm install @meteora-ag/dlmm bn.js
 * 
 * This provides full DLMM functionality including proper bin array handling.
 */
export async function swapWithSDK(
  connection: Connection,
  wallet: Keypair,
  poolAddress: PublicKey,
  inputAmount: bigint,
  swapYtoX: boolean,
  slippageBps: number
): Promise<SwapResult> {
  try {
    // Dynamic imports to avoid hard dependencies
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const DLMM = await import('@meteora-ag/dlmm' as string);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const BNModule = await import('bn.js' as string);
    const BN = BNModule.default || BNModule;

    // Create pool instance
    const dlmmPool = await DLMM.default.create(connection, poolAddress);

    // Get bin arrays for swap
    const binArrays = await dlmmPool.getBinArrayForSwap(swapYtoX);

    // Get swap quote
    const swapQuote = await dlmmPool.swapQuote(
      new BN(inputAmount.toString()),
      swapYtoX,
      new BN(slippageBps),
      binArrays
    );

    // Build and send swap transaction
    const swapTx = await dlmmPool.swap({
      inToken: swapYtoX ? dlmmPool.tokenY.publicKey : dlmmPool.tokenX.publicKey,
      outToken: swapYtoX ? dlmmPool.tokenX.publicKey : dlmmPool.tokenY.publicKey,
      inAmount: new BN(inputAmount.toString()),
      minOutAmount: swapQuote.minOutAmount,
      lbPair: poolAddress,
      user: wallet.publicKey,
      binArraysPubkey: swapQuote.binArraysPubkey,
    });

    const signature = await sendAndConfirmTransaction(
      connection,
      swapTx,
      [wallet],
      { skipPreflight: false, commitment: 'confirmed' }
    );

    return {
      signature,
      inputAmount: Number(inputAmount),
      outputAmount: Number(swapQuote.outAmount.toString()),
      fee: 0,
      slot: 0,
      timestamp: Date.now(),
    };
  } catch (error) {
    if (error instanceof Error) {
      throw new SwapTransactionError(error.message);
    }
    throw new SwapTransactionError('Unknown Meteora SDK error');
  }
}

// ============ Standalone Functions ============

let defaultClient: MeteoraClient | null = null;

/**
 * Get or create default Meteora client.
 */
function getDefaultClient(connection: Connection): MeteoraClient {
  if (!defaultClient) {
    defaultClient = new MeteoraClient(connection);
  }
  return defaultClient;
}

/**
 * Get swap quote from Meteora DLMM.
 * 
 * @throws {NoRouteError} If no pool found
 * @throws {APIError} If Meteora API fails
 */
export async function getQuote(
  connection: Connection,
  params: QuoteParams,
  options: QuoteRequestOptions = {}
): Promise<Quote> {
  const client = getDefaultClient(connection);
  return client.getQuote(params, options);
}

/**
 * Execute swap on Meteora DLMM.
 * 
 * Note: Requires @meteora-ag/dlmm SDK for full functionality.
 * Consider using Jupiter aggregator for actual swaps.
 * 
 * @throws {SwapTransactionError} If transaction fails
 */
export async function swap(
  connection: Connection,
  params: SwapParams
): Promise<SwapResult> {
  const client = getDefaultClient(connection);
  return client.swap(connection, params);
}

/**
 * Get available Meteora pools for a token.
 */
export async function getPools(
  connection: Connection,
  tokenMint: PublicKey
): Promise<Pool[]> {
  const client = getDefaultClient(connection);
  return client.getPools(tokenMint);
}

/**
 * Get all Meteora DLMM pools.
 */
export async function getAllPools(
  connection: Connection
): Promise<MeteoraPoolInfo[]> {
  const client = getDefaultClient(connection);
  return client.getAllPools();
}

// Export constants
export const METEORA_CONSTANTS = {
  PROGRAM_ID: METEORA_PROGRAM_ID,
  API_URL: METEORA_API_URL,
};
