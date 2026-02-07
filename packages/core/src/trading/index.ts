/**
 * Trading Module - Public API
 * OrbitMM - DEX Trading Engine
 */

// ============ Types ============

export type {
  // DEX Types
  DEX,
  
  // Quote Types
  QuoteParams,
  Quote,
  RouteStep,
  
  // Swap Types
  SwapParams,
  SwapResult,
  
  // Pool Types
  Pool,
  PoolMigrationResult,
  
  // Configuration Types
  PriorityFeeConfig,
  RetryConfig,
  TradeValidationConfig,
  ValidationResult,
  ValidationCheck,
  
  // PumpFun Types
  BondingCurveInfo,
  PumpFunTokenInfo,
  
  // Meteora Types
  MeteoraPoolState,
  
  // Utility Types
  TokenAccountInfo,
  QuoteRequestOptions,
} from './types.js';

// Runtime exports (constants, classes, errors)
export {
  DEFAULT_PRIORITY_FEE_CONFIG,
  DEFAULT_RETRY_CONFIG,
  DEFAULT_VALIDATION_CONFIG,
  
  // Error Types
  TradingError,
  NoRouteError,
  APIError,
  QuoteExpiredError,
  SlippageExceededError,
  InsufficientBalanceError,
  SwapTransactionError,
  SimulationError,
  PriceImpactTooHighError,
} from './types.js';

// ============ Jupiter Integration ============

export {
  JupiterClient,
  getQuote as getJupiterQuote,
  swap as jupiterSwap,
  getPools as getJupiterPools,
} from './jupiter.js';

// ============ Raydium Integration ============

export {
  RaydiumClient,
  getQuote as getRaydiumQuote,
  swap as raydiumSwap,
  getPools as getRaydiumPools,
} from './raydium.js';

// ============ PumpFun Integration ============

export {
  PumpFunClient,
  getQuote as getPumpFunQuote,
  swap as pumpfunSwap,
  getPools as getPumpFunPools,
  isOnPumpFun,
  hasMigrated as hasPumpFunMigrated,
  getBondingCurveAddress,
  PUMPFUN_CONSTANTS,
} from './pumpfun.js';

// ============ Meteora Integration ============

export {
  MeteoraClient,
  getQuote as getMeteoraQuote,
  swap as meteoraSwap,
  getPools as getMeteoraPools,
  getAllPools as getAllMeteoraPools,
  createDLMMPool,
  swapWithSDK as meteoraSwapWithSDK,
  METEORA_CONSTANTS,
} from './meteora.js';

// ============ Smart Router ============

export type { RouterConfig } from './router.js';

export {
  TradingRouter,
  DEFAULT_ROUTER_CONFIG,
  getBestQuote,
  getQuoteFromDex,
  executeSwap,
  detectPoolMigration,
  findAvailableDexes,
} from './router.js';

// ============ Transaction Executor ============

export type { ExecutorConfig } from './executor.js';

export {
  TransactionExecutor,
  DEFAULT_EXECUTOR_CONFIG,
  buildTransaction,
  simulateTransaction,
  sendAndConfirm,
  execute,
  getPriorityFee,
  replaceStuckTransaction,
} from './executor.js';
