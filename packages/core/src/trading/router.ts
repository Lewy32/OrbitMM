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
import * as pumpfun from './pumpfun.js';
import * as meteora from './meteora.js';

// ============ Router Configuration ============

export interface RouterConfig {
  jupiterTimeoutMs: number;
  fallbackEnabled: boolean;
  parallelQuotes: boolean;
  validation: TradeValidationConfig;
  retry: RetryConfig;
  
  // DEX-specific settings
  pumpfunEnabled: boolean;
  meteoraEnabled: boolean;
  
  // Fallback order (priority)
  fallbackOrder: DEX[];
}

export const DEFAULT_ROUTER_CONFIG: RouterConfig = {
  jupiterTimeoutMs: 3000,
  fallbackEnabled: true,
  parallelQuotes: true,
  validation: DEFAULT_VALIDATION_CONFIG,
  retry: DEFAULT_RETRY_CONFIG,
  pumpfunEnabled: true,
  meteoraEnabled: true,
  fallbackOrder: ['jupiter', 'raydium', 'pumpfun', 'meteora'],
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
   * Get quote from a specific DEX.
   */
  async getQuoteFromDex(params: QuoteParams, dex: DEX): Promise<Quote> {
    switch (dex) {
      case 'jupiter':
        return jupiter.getQuote(
          params.inputMint,
          params.outputMint,
          params.amount,
          params.slippageBps,
          { connection: this.connection }
        );
      
      case 'raydium':
        return raydium.getQuote(this.connection, params);
      
      case 'pumpfun':
        if (!this.config.pumpfunEnabled) {
          throw new APIError('pumpfun', 'PumpFun is disabled in router config');
        }
        return pumpfun.getQuote(this.connection, params);
      
      case 'meteora':
        if (!this.config.meteoraEnabled) {
          throw new APIError('meteora', 'Meteora is disabled in router config');
        }
        return meteora.getQuote(this.connection, params);
      
      default:
        throw new APIError(dex, `Unknown DEX: ${dex}`);
    }
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
   * Detect if token has migrated pools.
   * Checks: PumpFun → Raydium, Raydium → Meteora, etc.
   */
  async detectPoolMigration(tokenMint: PublicKey): Promise<PoolMigrationResult> {
    try {
      // Get pools from all DEXs in parallel
      const [jupiterPools, raydiumPools, pumpfunPools, meteoraPools] = await Promise.allSettled([
        jupiter.getPools(this.connection, tokenMint),
        raydium.getPools(this.connection, tokenMint),
        this.config.pumpfunEnabled 
          ? pumpfun.getPools(this.connection, tokenMint) 
          : Promise.resolve([]),
        this.config.meteoraEnabled 
          ? meteora.getPools(this.connection, tokenMint) 
          : Promise.resolve([]),
      ]);

      const allPools: Pool[] = [];

      if (jupiterPools.status === 'fulfilled') {
        allPools.push(...jupiterPools.value);
      }
      if (raydiumPools.status === 'fulfilled') {
        allPools.push(...raydiumPools.value);
      }
      if (pumpfunPools.status === 'fulfilled') {
        allPools.push(...pumpfunPools.value);
      }
      if (meteoraPools.status === 'fulfilled') {
        allPools.push(...meteoraPools.value);
      }

      // Check for PumpFun migration status
      if (this.config.pumpfunEnabled) {
        const isStillOnPumpfun = await pumpfun.isOnPumpFun(this.connection, tokenMint);
        const hasMigratedFromPumpfun = await pumpfun.hasMigrated(this.connection, tokenMint);
        
        if (hasMigratedFromPumpfun) {
          // Find the Raydium pool (PumpFun migrates to Raydium)
          const raydiumPool = allPools.find(p => p.dex === 'raydium');
          const pumpfunPool = allPools.find(p => p.dex === 'pumpfun');
          
          return {
            migrated: true,
            from: 'pumpfun',
            to: 'raydium',
            oldPoolId: pumpfunPool?.id,
            newPoolId: raydiumPool?.id,
          };
        }
      }

      // Check for migration patterns by liquidity
      const hasPumpfun = allPools.some(p => p.dex === 'pumpfun');
      const hasRaydium = allPools.some(p => p.dex === 'raydium');
      const hasMeteora = allPools.some(p => p.dex === 'meteora');

      // PumpFun → Raydium migration (by liquidity)
      if (hasPumpfun && hasRaydium) {
        const pumpfunPool = allPools.find(p => p.dex === 'pumpfun');
        const raydiumPool = allPools.find(p => p.dex === 'raydium');

        if (raydiumPool && (!pumpfunPool || raydiumPool.liquidity > (pumpfunPool.liquidity || 0) * 2)) {
          return {
            migrated: true,
            from: 'pumpfun',
            to: 'raydium',
            oldPoolId: pumpfunPool?.id,
            newPoolId: raydiumPool.id,
          };
        }
      }

      // Raydium → Meteora migration
      if (hasRaydium && hasMeteora) {
        const raydiumPool = allPools.find(p => p.dex === 'raydium');
        const meteoraPool = allPools.find(p => p.dex === 'meteora');

        if (meteoraPool && (!raydiumPool || meteoraPool.liquidity > (raydiumPool.liquidity || 0) * 2)) {
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
   * Check if a token is tradeable and on which DEXs.
   */
  async findAvailableDexes(tokenMint: PublicKey): Promise<DEX[]> {
    const available: DEX[] = [];
    
    const checks = await Promise.allSettled([
      // Check PumpFun
      this.config.pumpfunEnabled 
        ? pumpfun.isOnPumpFun(this.connection, tokenMint)
        : Promise.resolve(false),
      
      // Check Raydium
      raydium.getPools(this.connection, tokenMint),
      
      // Check Meteora
      this.config.meteoraEnabled
        ? meteora.getPools(this.connection, tokenMint)
        : Promise.resolve([]),
    ]);

    // PumpFun check
    if (checks[0].status === 'fulfilled' && checks[0].value === true) {
      available.push('pumpfun');
    }

    // Raydium check
    if (checks[1].status === 'fulfilled' && (checks[1].value as Pool[]).length > 0) {
      available.push('raydium');
    }

    // Meteora check
    if (checks[2].status === 'fulfilled' && (checks[2].value as Pool[]).length > 0) {
      available.push('meteora');
    }

    // Jupiter is always available as aggregator
    available.push('jupiter');

    return available;
  }

  /**
   * Get quotes from direct DEXs (non-aggregator)
   */
  private async getDirectDexQuotes(params: QuoteParams): Promise<Quote[]> {
    const quotes: Quote[] = [];
    
    if (this.config.parallelQuotes) {
      // Build quote promises based on enabled DEXs
      const quotePromises: Promise<Quote>[] = [];
      
      // Follow fallback order (skip jupiter as it's already tried)
      for (const dex of this.config.fallbackOrder) {
        if (dex === 'jupiter') continue;
        
        switch (dex) {
          case 'raydium':
            quotePromises.push(raydium.getQuote(this.connection, params));
            break;
          case 'pumpfun':
            if (this.config.pumpfunEnabled) {
              quotePromises.push(pumpfun.getQuote(this.connection, params));
            }
            break;
          case 'meteora':
            if (this.config.meteoraEnabled) {
              quotePromises.push(meteora.getQuote(this.connection, params));
            }
            break;
        }
      }

      // Parallel queries
      const results = await Promise.allSettled(quotePromises);

      for (const result of results) {
        if (result.status === 'fulfilled') {
          quotes.push(result.value);
        }
      }
    } else {
      // Sequential queries (stop on first success) following fallback order
      for (const dex of this.config.fallbackOrder) {
        if (dex === 'jupiter') continue;
        
        try {
          let quote: Quote | null = null;
          
          switch (dex) {
            case 'raydium':
              quote = await raydium.getQuote(this.connection, params);
              break;
            case 'pumpfun':
              if (this.config.pumpfunEnabled) {
                quote = await pumpfun.getQuote(this.connection, params);
              }
              break;
            case 'meteora':
              if (this.config.meteoraEnabled) {
                quote = await meteora.getQuote(this.connection, params);
              }
              break;
          }
          
          if (quote) {
            quotes.push(quote);
            break; // Stop on first success in sequential mode
          }
        } catch {
          // Continue to next DEX
        }
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
      
      case 'pumpfun':
        if (!this.config.pumpfunEnabled) {
          throw new SwapTransactionError('PumpFun is disabled');
        }
        return pumpfun.swap(this.connection, swapParams);
      
      case 'meteora':
        if (!this.config.meteoraEnabled) {
          throw new SwapTransactionError('Meteora is disabled');
        }
        return meteora.swap(this.connection, swapParams);
      
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
 * Get quote from a specific DEX.
 */
export async function getQuoteFromDex(
  connection: Connection,
  params: QuoteParams,
  dex: DEX
): Promise<Quote> {
  const router = getDefaultRouter(connection);
  return router.getQuoteFromDex(params, dex);
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
 * Detect if token has migrated pools (PumpFun → Raydium, etc.).
 */
export async function detectPoolMigration(
  connection: Connection,
  tokenMint: PublicKey
): Promise<PoolMigrationResult> {
  const router = getDefaultRouter(connection);
  return router.detectPoolMigration(tokenMint);
}

/**
 * Find which DEXs have liquidity for a token.
 */
export async function findAvailableDexes(
  connection: Connection,
  tokenMint: PublicKey
): Promise<DEX[]> {
  const router = getDefaultRouter(connection);
  return router.findAvailableDexes(tokenMint);
}
