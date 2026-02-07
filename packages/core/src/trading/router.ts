/**
 * Trading Router
 * OrbitMM - Smart routing across DEXs with fallback logic
 */

import { Connection, PublicKey, Keypair } from '@solana/web3.js';

import {
  Quote,
  QuoteParams,
  SwapParams,
  SwapResult,
  Pool,
  DEX,
  PoolMigrationResult,
  NoRouteError,
  APIError,
  SwapTransactionError,
  QuoteRequestOptions,
  ValidationResult,
  ValidationCheck,
  TradeValidationConfig,
  DEFAULT_VALIDATION_CONFIG,
  DEFAULT_RETRY_CONFIG,
  RetryConfig,
} from './types.js';

import * as jupiter from './jupiter.js';
import * as raydium from './raydium.js';

// ============ Router Configuration ============

export interface RouterConfig {
  jupiterTimeoutMs: number;
  fallbackEnabled: boolean;
  parallelQuotes: boolean;
  validation: TradeValidationConfig;
  retry: RetryConfig;
}

export const DEFAULT_ROUTER_CONFIG: RouterConfig = {
  jupiterTimeoutMs: 3000,
  fallbackEnabled: true,
  parallelQuotes: true,
  validation: DEFAULT_VALIDATION_CONFIG,
  retry: DEFAULT_RETRY_CONFIG,
};

// ============ Router Class ============

export class TradingRouter {
  private config: RouterConfig;

  constructor(
    private readonly connection: Connection,
    config: Partial<RouterConfig> = {}
  ) {
    this.config = { ...DEFAULT_ROUTER_CONFIG, ...config };
  }

  /**
   * Get best quote across all available DEXs.
   * Jupiter first, then parallel query to direct DEXs on fallback.
   */
  async getBestQuote(params: QuoteParams): Promise<Quote> {
    // 1. Try Jupiter first (aggregator = best price)
    try {
      const jupiterQuote = await jupiter.getQuote(
        params.inputMint,
        params.outputMint,
        params.amount,
        params.slippageBps,
        { 
          timeout: this.config.jupiterTimeoutMs,
          connection: this.connection,
        }
      );
      
      if (jupiterQuote) {
        return jupiterQuote;
      }
    } catch (error) {
      // Log and continue to fallback
      console.warn('Jupiter quote failed, falling back to direct DEXs:', 
        error instanceof Error ? error.message : 'Unknown error'
      );
    }

    // 2. If fallback is disabled, throw
    if (!this.config.fallbackEnabled) {
      throw new NoRouteError(
        params.inputMint.toString(),
        params.outputMint.toString()
      );
    }

    // 3. Parallel query direct DEXs
    const quotes = await this.getDirectDexQuotes(params);

    if (quotes.length === 0) {
      throw new NoRouteError(
        params.inputMint.toString(),
        params.outputMint.toString()
      );
    }

    // 4. Return best available (highest output amount)
    return this.selectBestQuote(quotes);
  }

  /**
   * Execute swap with automatic DEX selection and retry logic.
   */
  async executeSwap(
    wallet: Keypair,
    quoteParams: QuoteParams,
    priorityFee?: number | 'auto'
  ): Promise<SwapResult> {
    // Get fresh quote
    const quote = await this.getBestQuote(quoteParams);

    // Validate trade
    const validation = this.validateTrade(quote, quoteParams);
    if (!validation.valid) {
      const failedChecks = validation.checks.filter(c => !c.pass);
      throw new SwapTransactionError(
        `Trade validation failed: ${failedChecks.map(c => c.message).join(', ')}`
      );
    }

    // Execute with retry logic
    return this.executeWithRetry(
      () => this.performSwap(wallet, quote, priorityFee)
    );
  }

  /**
   * Detect if token has migrated pools (PumpFun → Raydium).
   */
  async detectPoolMigration(tokenMint: PublicKey): Promise<PoolMigrationResult> {
    try {
      // Get pools from different DEXs
      const [jupiterPools, raydiumPools] = await Promise.allSettled([
        jupiter.getPools(this.connection, tokenMint),
        raydium.getPools(this.connection, tokenMint),
      ]);

      const allPools: Pool[] = [];

      if (jupiterPools.status === 'fulfilled') {
        allPools.push(...jupiterPools.value);
      }
      if (raydiumPools.status === 'fulfilled') {
        allPools.push(...raydiumPools.value);
      }

      // Check for migration patterns
      const hasPumpfun = allPools.some(p => p.dex === 'pumpfun');
      const hasRaydium = allPools.some(p => p.dex === 'raydium');
      const hasMeteora = allPools.some(p => p.dex === 'meteora');

      // Common migration: PumpFun → Raydium
      if (hasPumpfun && hasRaydium) {
        // Check which has more liquidity
        const pumpfunPool = allPools.find(p => p.dex === 'pumpfun');
        const raydiumPool = allPools.find(p => p.dex === 'raydium');

        if (raydiumPool && (!pumpfunPool || raydiumPool.liquidity > (pumpfunPool.liquidity || 0))) {
          return {
            migrated: true,
            from: 'pumpfun',
            to: 'raydium',
            oldPoolId: pumpfunPool?.id,
            newPoolId: raydiumPool.id,
          };
        }
      }

      // Another common migration: Raydium → Meteora
      if (hasRaydium && hasMeteora) {
        const raydiumPool = allPools.find(p => p.dex === 'raydium');
        const meteoraPool = allPools.find(p => p.dex === 'meteora');

        if (meteoraPool && (!raydiumPool || meteoraPool.liquidity > (raydiumPool.liquidity || 0))) {
          return {
            migrated: true,
            from: 'raydium',
            to: 'meteora',
            oldPoolId: raydiumPool?.id,
            newPoolId: meteoraPool.id,
          };
        }
      }

      return { migrated: false };
    } catch (error) {
      console.warn('Pool migration detection failed:', error);
      return { migrated: false };
    }
  }

  /**
   * Get quotes from direct DEXs (non-aggregator)
   */
  private async getDirectDexQuotes(params: QuoteParams): Promise<Quote[]> {
    const quotes: Quote[] = [];
    
    if (this.config.parallelQuotes) {
      // Parallel queries
      const results = await Promise.allSettled([
        raydium.getQuote(this.connection, params),
        // Add more DEXs here as they're implemented:
        // pumpfun.getQuote(this.connection, params),
        // meteora.getQuote(this.connection, params),
      ]);

      for (const result of results) {
        if (result.status === 'fulfilled') {
          quotes.push(result.value);
        }
      }
    } else {
      // Sequential queries (stop on first success)
      try {
        const quote = await raydium.getQuote(this.connection, params);
        quotes.push(quote);
      } catch {
        // Continue to next DEX
      }
    }

    return quotes;
  }

  /**
   * Select the best quote from multiple options
   */
  private selectBestQuote(quotes: Quote[]): Quote {
    if (quotes.length === 0) {
      throw new Error('No quotes available');
    }

    if (quotes.length === 1) {
      return quotes[0];
    }

    // Sort by output amount (descending) and select best
    return quotes.sort((a, b) => {
      const aOut = BigInt(a.outAmount);
      const bOut = BigInt(b.outAmount);
      if (aOut > bOut) return -1;
      if (aOut < bOut) return 1;
      
      // If same output, prefer lower price impact
      return a.priceImpactPct - b.priceImpactPct;
    })[0];
  }

  /**
   * Validate trade before execution
   */
  private validateTrade(quote: Quote, params: QuoteParams): ValidationResult {
    const checks: ValidationCheck[] = [];
    const config = this.config.validation;

    // Price impact check
    checks.push({
      name: 'priceImpact',
      pass: quote.priceImpactPct < config.maxPriceImpactPct,
      message: `Price impact ${quote.priceImpactPct.toFixed(2)}% exceeds max ${config.maxPriceImpactPct}%`,
    });

    // Quote age check
    const quoteAge = Date.now() - quote.timestamp;
    checks.push({
      name: 'quoteAge',
      pass: quoteAge < config.maxQuoteAgeMs,
      message: `Quote is stale (${quoteAge}ms old), max ${config.maxQuoteAgeMs}ms`,
    });

    // Minimum output check
    const expectedOutput = BigInt(quote.outAmount);
    const minOutput = (expectedOutput * BigInt(Math.floor(config.minOutputRatio * 100))) / BigInt(100);
    checks.push({
      name: 'minimumOutput',
      pass: BigInt(quote.minOutAmount) >= minOutput,
      message: 'Output suspiciously low, possible scam token or liquidity issue',
    });

    // Quote expiry check
    checks.push({
      name: 'quoteExpiry',
      pass: Date.now() < quote.expiresAt,
      message: 'Quote has expired',
    });

    return {
      valid: checks.every(c => c.pass),
      checks,
    };
  }

  /**
   * Perform the actual swap
   */
  private async performSwap(
    wallet: Keypair,
    quote: Quote,
    priorityFee?: number | 'auto'
  ): Promise<SwapResult> {
    const swapParams: SwapParams = {
      wallet,
      quote,
      priorityFee,
    };

    // Route to appropriate DEX
    switch (quote.dex) {
      case 'jupiter':
        return jupiter.swap(this.connection, swapParams);
      
      case 'raydium':
        return raydium.swap(this.connection, swapParams);
      
      // Add more DEXs as implemented
      default:
        // Fallback to Jupiter for aggregate routes
        return jupiter.swap(this.connection, swapParams);
    }
  }

  /**
   * Execute with exponential backoff retry
   */
  private async executeWithRetry(
    operation: () => Promise<SwapResult>
  ): Promise<SwapResult> {
    const config = this.config.retry;
    let lastError: Error | null = null;
    let delay = config.initialDelayMs;

    for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if error is non-retryable
        if (this.isNonRetryable(lastError, config.nonRetryableErrors)) {
          throw lastError;
        }

        // Check if we should retry
        if (!this.isRetryable(lastError, config.retryableErrors)) {
          throw lastError;
        }

        console.warn(
          `Attempt ${attempt}/${config.maxRetries} failed: ${lastError.message}. ` +
          `Retrying in ${delay}ms...`
        );

        // Wait before retry
        await this.sleep(delay);
        
        // Increase delay for next attempt
        delay = Math.min(delay * config.backoffMultiplier, config.maxDelayMs);
      }
    }

    throw new SwapTransactionError(
      `Failed after ${config.maxRetries} attempts: ${lastError?.message || 'Unknown error'}`
    );
  }

  /**
   * Check if error should not be retried
   */
  private isNonRetryable(error: Error, patterns: string[]): boolean {
    const message = error.message.toLowerCase();
    return patterns.some(pattern => message.includes(pattern.toLowerCase()));
  }

  /**
   * Check if error should be retried
   */
  private isRetryable(error: Error, patterns: string[]): boolean {
    const message = error.message.toLowerCase();
    return patterns.some(pattern => message.includes(pattern.toLowerCase()));
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============ Standalone Functions ============

let defaultRouter: TradingRouter | null = null;

/**
 * Get or create default router
 */
function getDefaultRouter(connection: Connection): TradingRouter {
  if (!defaultRouter) {
    defaultRouter = new TradingRouter(connection);
  }
  return defaultRouter;
}

/**
 * Get best quote across all available DEXs.
 * Jupiter first, then parallel query to direct DEXs on fallback.
 */
export async function getBestQuote(
  connection: Connection,
  params: QuoteParams
): Promise<Quote> {
  const router = getDefaultRouter(connection);
  return router.getBestQuote(params);
}

/**
 * Execute swap with automatic DEX selection.
 */
export async function executeSwap(
  connection: Connection,
  wallet: Keypair,
  quoteParams: QuoteParams,
  priorityFee?: number | 'auto'
): Promise<SwapResult> {
  const router = getDefaultRouter(connection);
  return router.executeSwap(wallet, quoteParams, priorityFee);
}

/**
 * Detect if token has migrated pools (PumpFun → Raydium).
 */
export async function detectPoolMigration(
  connection: Connection,
  tokenMint: PublicKey
): Promise<PoolMigrationResult> {
  const router = getDefaultRouter(connection);
  return router.detectPoolMigration(tokenMint);
}
