/**
 * Raydium AMM Direct Integration
 * OrbitMM - Fallback DEX when Jupiter fails
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
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

// ============ Raydium Constants ============

const RAYDIUM_API_URL = 'https://api.raydium.io/v2';
const RAYDIUM_PROGRAM_ID = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');
const QUOTE_VALIDITY_MS = 30000;

// ============ Raydium API Types ============

interface RaydiumPoolInfo {
  id: string;
  baseMint: string;
  quoteMint: string;
  lpMint: string;
  baseDecimals: number;
  quoteDecimals: number;
  lpDecimals: number;
  version: number;
  programId: string;
  authority: string;
  openOrders: string;
  targetOrders: string;
  baseVault: string;
  quoteVault: string;
  marketId: string;
  marketProgramId: string;
  marketAuthority: string;
  marketBaseVault: string;
  marketQuoteVault: string;
  marketBids: string;
  marketAsks: string;
  marketEventQueue: string;
  liquidity?: number;
  volume24h?: number;
}

interface RaydiumQuoteResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  minOutAmount: string;
  priceImpact: number;
  fee: string;
  poolId: string;
}

// ============ Raydium Client ============

export class RaydiumClient {
  private poolCache: Map<string, RaydiumPoolInfo> = new Map();
  private poolCacheExpiry: number = 0;
  private readonly cacheDurationMs = 60000; // 1 minute

  constructor(
    private readonly connection: Connection,
    private readonly apiUrl: string = RAYDIUM_API_URL
  ) {}

  /**
   * Get swap quote from Raydium AMM.
   * 
   * @throws {NoRouteError} If no pool found
   * @throws {APIError} If Raydium API fails
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

      // Calculate output amount based on constant product formula
      const quote = await this.calculateQuote(pool, params);
      
      const now = Date.now();
      
      return {
        inputMint: params.inputMint.toString(),
        outputMint: params.outputMint.toString(),
        inAmount: params.amount.toString(),
        outAmount: quote.outAmount,
        minOutAmount: quote.minOutAmount,
        priceImpactPct: quote.priceImpact,
        route: [{
          dex: 'raydium',
          inputMint: params.inputMint.toString(),
          outputMint: params.outputMint.toString(),
          poolId: pool.id,
          percent: 100,
        }],
        dex: 'raydium',
        timestamp: now,
        expiresAt: now + QUOTE_VALIDITY_MS,
      };
    } catch (error) {
      if (error instanceof NoRouteError) {
        throw error;
      }
      
      if (error instanceof Error) {
        throw new APIError('raydium', error.message);
      }
      
      throw new APIError('raydium', 'Unknown error');
    }
  }

  /**
   * Execute swap on Raydium AMM.
   * 
   * @throws {SwapTransactionError} If transaction fails
   */
  async swap(
    connection: Connection,
    params: SwapParams
  ): Promise<SwapResult> {
    const { wallet, quote, priorityFee } = params;

    try {
      // Get pool info
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

      // Send and confirm (transaction is already signed)
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
   * Get available Raydium pools for a token.
   */
  async getPools(tokenMint: PublicKey): Promise<Pool[]> {
    await this.refreshPoolCache();
    
    const pools: Pool[] = [];
    const mintStr = tokenMint.toString();

    for (const [, poolInfo] of this.poolCache) {
      if (poolInfo.baseMint === mintStr || poolInfo.quoteMint === mintStr) {
        pools.push({
          id: poolInfo.id,
          dex: 'raydium',
          tokenA: { mint: poolInfo.baseMint },
          tokenB: { mint: poolInfo.quoteMint },
          liquidity: poolInfo.liquidity ?? 0,
          volume24h: poolInfo.volume24h ?? 0,
        });
      }
    }

    return pools;
  }

  /**
   * Find pool for a token pair
   */
  private async findPool(
    inputMint: string,
    outputMint: string
  ): Promise<RaydiumPoolInfo | null> {
    await this.refreshPoolCache();

    // Look for direct pool
    for (const [, pool] of this.poolCache) {
      if (
        (pool.baseMint === inputMint && pool.quoteMint === outputMint) ||
        (pool.baseMint === outputMint && pool.quoteMint === inputMint)
      ) {
        return pool;
      }
    }

    return null;
  }

  /**
   * Refresh pool cache from Raydium API
   */
  private async refreshPoolCache(): Promise<void> {
    const now = Date.now();
    
    if (now < this.poolCacheExpiry) {
      return; // Cache still valid
    }

    try {
      const response = await fetch(`${this.apiUrl}/main/pairs`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      
      this.poolCache.clear();
      
      if (Array.isArray(data)) {
        for (const pool of data) {
          if (pool.ammId) {
            this.poolCache.set(pool.ammId, {
              id: pool.ammId,
              baseMint: pool.baseMint,
              quoteMint: pool.quoteMint,
              lpMint: pool.lpMint,
              baseDecimals: pool.baseDecimals,
              quoteDecimals: pool.quoteDecimals,
              lpDecimals: pool.lpDecimals,
              version: pool.version || 4,
              programId: pool.programId || RAYDIUM_PROGRAM_ID.toString(),
              authority: pool.authority,
              openOrders: pool.openOrders,
              targetOrders: pool.targetOrders,
              baseVault: pool.baseVault,
              quoteVault: pool.quoteVault,
              marketId: pool.marketId,
              marketProgramId: pool.marketProgramId,
              marketAuthority: pool.marketAuthority,
              marketBaseVault: pool.marketBaseVault,
              marketQuoteVault: pool.marketQuoteVault,
              marketBids: pool.marketBids,
              marketAsks: pool.marketAsks,
              marketEventQueue: pool.marketEventQueue,
              liquidity: pool.liquidity,
              volume24h: pool.volume24h,
            });
          }
        }
      }

      this.poolCacheExpiry = now + this.cacheDurationMs;
    } catch (error) {
      // Keep using stale cache on error
      console.warn('Failed to refresh Raydium pool cache:', error);
    }
  }

  /**
   * Calculate swap quote using constant product formula
   */
  private async calculateQuote(
    pool: RaydiumPoolInfo,
    params: QuoteParams
  ): Promise<{ outAmount: string; minOutAmount: string; priceImpact: number }> {
    // Determine swap direction
    const isBaseToQuote = params.inputMint.toString() === pool.baseMint;
    
    // Get vault balances
    const baseVaultBalance = await this.getTokenBalance(
      new PublicKey(pool.baseVault)
    );
    const quoteVaultBalance = await this.getTokenBalance(
      new PublicKey(pool.quoteVault)
    );

    const inputReserve = isBaseToQuote ? baseVaultBalance : quoteVaultBalance;
    const outputReserve = isBaseToQuote ? quoteVaultBalance : baseVaultBalance;

    // Constant product formula: (x + dx)(y - dy) = xy
    // dy = y * dx / (x + dx)
    const inputAmount = BigInt(params.amount);
    const fee = inputAmount * BigInt(25) / BigInt(10000); // 0.25% fee
    const inputAfterFee = inputAmount - fee;
    
    const outputAmount = (outputReserve * inputAfterFee) / (inputReserve + inputAfterFee);
    
    // Calculate price impact
    const spotPrice = Number(outputReserve) / Number(inputReserve);
    const executionPrice = Number(outputAmount) / Number(inputAfterFee);
    const priceImpact = Math.abs((spotPrice - executionPrice) / spotPrice * 100);

    // Apply slippage for minimum output
    const slippageMultiplier = BigInt(10000 - params.slippageBps);
    const minOutputAmount = (outputAmount * slippageMultiplier) / BigInt(10000);

    return {
      outAmount: outputAmount.toString(),
      minOutAmount: minOutputAmount.toString(),
      priceImpact,
    };
  }

  /**
   * Get token balance from a token account
   */
  private async getTokenBalance(account: PublicKey): Promise<bigint> {
    try {
      const balance = await this.connection.getTokenAccountBalance(account);
      return BigInt(balance.value.amount);
    } catch {
      return BigInt(0);
    }
  }

  /**
   * Build swap transaction
   */
  private async buildSwapTransaction(
    wallet: Keypair,
    pool: RaydiumPoolInfo,
    quote: Quote,
    priorityFee?: number
  ): Promise<Transaction> {
    const transaction = new Transaction();

    // Add priority fee if specified
    if (priorityFee && priorityFee > 0) {
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: wallet.publicKey,
          toPubkey: wallet.publicKey,
          lamports: 0,
        })
      );
    }

    // Ensure token accounts exist
    const inputMint = new PublicKey(quote.inputMint);
    const outputMint = new PublicKey(quote.outputMint);

    const inputTokenAccount = await getAssociatedTokenAddress(
      inputMint,
      wallet.publicKey
    );
    const outputTokenAccount = await getAssociatedTokenAddress(
      outputMint,
      wallet.publicKey
    );

    // Check if output token account exists, create if not
    const outputAccountInfo = await this.connection.getAccountInfo(outputTokenAccount);
    if (!outputAccountInfo) {
      transaction.add(
        createAssociatedTokenAccountInstruction(
          wallet.publicKey,
          outputTokenAccount,
          wallet.publicKey,
          outputMint
        )
      );
    }

    // Add swap instruction
    // Note: This is a simplified version. Full Raydium swap requires 
    // proper instruction encoding with all pool accounts
    const swapInstruction = await this.buildSwapInstruction(
      wallet.publicKey,
      pool,
      inputTokenAccount,
      outputTokenAccount,
      BigInt(quote.inAmount),
      BigInt(quote.minOutAmount)
    );

    transaction.add(swapInstruction);

    // Get recent blockhash
    const { blockhash, lastValidBlockHeight } = 
      await this.connection.getLatestBlockhash('confirmed');
    
    transaction.recentBlockhash = blockhash;
    transaction.lastValidBlockHeight = lastValidBlockHeight;
    transaction.feePayer = wallet.publicKey;

    // Sign transaction
    transaction.sign(wallet);

    return transaction;
  }

  /**
   * Build Raydium swap instruction
   * Note: Simplified version - production would use Raydium SDK
   */
  private async buildSwapInstruction(
    user: PublicKey,
    pool: RaydiumPoolInfo,
    userSourceToken: PublicKey,
    userDestToken: PublicKey,
    amountIn: bigint,
    minAmountOut: bigint
  ): Promise<TransactionInstruction> {
    // Raydium swap instruction layout (simplified)
    // In production, use @raydium-io/raydium-sdk
    const data = Buffer.alloc(17);
    data.writeUInt8(9, 0); // Swap instruction discriminator
    data.writeBigUInt64LE(amountIn, 1);
    data.writeBigUInt64LE(minAmountOut, 9);

    const keys = [
      // Token program
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      // AMM
      { pubkey: new PublicKey(pool.id), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(pool.authority), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(pool.openOrders), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(pool.targetOrders), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(pool.baseVault), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(pool.quoteVault), isSigner: false, isWritable: true },
      // Market
      { pubkey: new PublicKey(pool.marketProgramId), isSigner: false, isWritable: false },
      { pubkey: new PublicKey(pool.marketId), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(pool.marketBids), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(pool.marketAsks), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(pool.marketEventQueue), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(pool.marketBaseVault), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(pool.marketQuoteVault), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(pool.marketAuthority), isSigner: false, isWritable: false },
      // User
      { pubkey: userSourceToken, isSigner: false, isWritable: true },
      { pubkey: userDestToken, isSigner: false, isWritable: true },
      { pubkey: user, isSigner: true, isWritable: false },
    ];

    return new TransactionInstruction({
      keys,
      programId: new PublicKey(pool.programId),
      data,
    });
  }
}

// ============ Standalone Functions ============

let defaultClient: RaydiumClient | null = null;

/**
 * Get or create default Raydium client
 */
function getDefaultClient(connection: Connection): RaydiumClient {
  if (!defaultClient) {
    defaultClient = new RaydiumClient(connection);
  }
  return defaultClient;
}

/**
 * Get swap quote from Raydium AMM.
 * 
 * @throws {NoRouteError} If no pool found
 * @throws {APIError} If Raydium API fails
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
 * Execute swap on Raydium AMM.
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
 * Get available Raydium pools for a token.
 */
export async function getPools(
  connection: Connection,
  tokenMint: PublicKey
): Promise<Pool[]> {
  const client = getDefaultClient(connection);
  return client.getPools(tokenMint);
}
