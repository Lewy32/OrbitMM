/**
 * Trading Module Types
 * OrbitMM - Trading Engine Type Definitions
 */

import { Keypair, PublicKey, Connection } from '@solana/web3.js';

// ============ DEX Enumeration ============

export type DEX = 'jupiter' | 'raydium' | 'pumpfun' | 'meteora';

// ============ Quote Types ============

export interface QuoteParams {
  inputMint: PublicKey;
  outputMint: PublicKey;
  amount: number;           // In input token's smallest unit
  slippageBps: number;      // Basis points (100 = 1%)
  dex?: DEX;                // Specific DEX, or undefined for aggregator
}

export interface Quote {
  inputMint: string;
  outputMint: string;
  inAmount: string;         // String for precision
  outAmount: string;
  minOutAmount: string;     // After slippage
  priceImpactPct: number;
  route: RouteStep[];
  dex: DEX;
  timestamp: number;
  expiresAt: number;        // Quote validity
}

export interface RouteStep {
  dex: DEX;
  inputMint: string;
  outputMint: string;
  poolId: string;
  percent: number;          // Percentage of total if split route
}

// ============ Swap Types ============

export interface SwapParams {
  wallet: Keypair;
  quote: Quote;             // Pre-fetched quote
  priorityFee?: number | 'auto';
}

export interface SwapResult {
  signature: string;
  inputAmount: number;
  outputAmount: number;
  fee: number;              // SOL paid for transaction
  slot: number;
  timestamp: number;
}

// ============ Pool Types ============

export interface Pool {
  id: string;
  dex: DEX;
  tokenA: { mint: string; symbol?: string };
  tokenB: { mint: string; symbol?: string };
  liquidity: number;        // In USD
  volume24h: number;        // In USD
}

// ============ Priority Fee Types ============

export interface PriorityFeeConfig {
  mode: 'auto' | 'fixed';
  fixedLamports?: number;
  
  // Auto mode settings
  percentile: number;        // Default: 50 (median)
  minLamports: number;       // Default: 1000 (0.000001 SOL)
  maxLamports: number;       // Default: 1000000 (0.001 SOL)
  refreshIntervalMs: number; // Default: 10000 (10s)
}

export const DEFAULT_PRIORITY_FEE_CONFIG: PriorityFeeConfig = {
  mode: 'auto',
  percentile: 50,
  minLamports: 1000,
  maxLamports: 1_000_000,
  refreshIntervalMs: 10000,
};

// ============ Retry Configuration ============

export interface RetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  nonRetryableErrors: string[];
  retryableErrors: string[];
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  nonRetryableErrors: [
    'insufficient funds',
    'slippage tolerance exceeded',
    'token account not found',
    'invalid signature',
  ],
  retryableErrors: [
    'block height exceeded',
    'transaction simulation failed',
    'node behind',
    'timeout',
  ],
};

// ============ Validation Types ============

export interface ValidationCheck {
  name: string;
  pass: boolean;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  checks: ValidationCheck[];
}

export interface TradeValidationConfig {
  maxPriceImpactPct: number;  // Default: 5
  maxQuoteAgeMs: number;      // Default: 10000 (10s)
  minOutputRatio: number;     // Default: 0.5 (50% of expected)
}

export const DEFAULT_VALIDATION_CONFIG: TradeValidationConfig = {
  maxPriceImpactPct: 5,
  maxQuoteAgeMs: 10000,
  minOutputRatio: 0.5,
};

// ============ Pool Migration Types ============

export interface PoolMigrationResult {
  migrated: boolean;
  from?: DEX;
  to?: DEX;
  oldPoolId?: string;
  newPoolId?: string;
}

// ============ Error Types ============

export class TradingError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly recoverable: boolean = true,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'TradingError';
  }
}

export class NoRouteError extends TradingError {
  constructor(inputMint: string, outputMint: string) {
    super(
      `No route found from ${inputMint} to ${outputMint}`,
      'NO_ROUTE',
      true,
      { inputMint, outputMint }
    );
    this.name = 'NoRouteError';
  }
}

export class APIError extends TradingError {
  constructor(
    dex: DEX,
    message: string,
    public readonly statusCode?: number
  ) {
    super(
      `${dex} API error: ${message}`,
      'API_ERROR',
      true,
      { dex, statusCode }
    );
    this.name = 'APIError';
  }
}

export class QuoteExpiredError extends TradingError {
  constructor(quoteTimestamp: number, currentTime: number) {
    super(
      `Quote expired: was valid until ${new Date(quoteTimestamp).toISOString()}`,
      'QUOTE_EXPIRED',
      true,
      { quoteTimestamp, currentTime }
    );
    this.name = 'QuoteExpiredError';
  }
}

export class SlippageExceededError extends TradingError {
  constructor(expectedOutput: string, actualOutput: string, slippageBps: number) {
    super(
      `Slippage exceeded: expected ${expectedOutput}, got ${actualOutput} (max ${slippageBps}bps)`,
      'SLIPPAGE_EXCEEDED',
      false,
      { expectedOutput, actualOutput, slippageBps }
    );
    this.name = 'SlippageExceededError';
  }
}

export class InsufficientBalanceError extends TradingError {
  constructor(required: number, available: number, token: string) {
    super(
      `Insufficient ${token} balance: required ${required}, available ${available}`,
      'INSUFFICIENT_BALANCE',
      false,
      { required, available, token }
    );
    this.name = 'InsufficientBalanceError';
  }
}

export class SwapTransactionError extends TradingError {
  constructor(
    message: string,
    public readonly signature?: string,
    public readonly logs?: string[]
  ) {
    super(message, 'TRANSACTION_ERROR', true, { signature, logs });
    this.name = 'SwapTransactionError';
  }
}

export class SimulationError extends TradingError {
  constructor(message: string, logs?: string[]) {
    super(message, 'SIMULATION_ERROR', true, { logs });
    this.name = 'SimulationError';
  }
}

export class PriceImpactTooHighError extends TradingError {
  constructor(priceImpactPct: number, maxAllowed: number) {
    super(
      `Price impact too high: ${priceImpactPct}% exceeds maximum ${maxAllowed}%`,
      'PRICE_IMPACT_TOO_HIGH',
      false,
      { priceImpactPct, maxAllowed }
    );
    this.name = 'PriceImpactTooHighError';
  }
}

// ============ Utility Types ============

export interface TokenAccountInfo {
  mint: PublicKey;
  owner: PublicKey;
  amount: bigint;
  decimals: number;
}

export interface QuoteRequestOptions {
  timeout?: number;
  excludeDexes?: DEX[];
}
