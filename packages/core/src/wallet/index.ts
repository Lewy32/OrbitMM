/**
 * OrbitMM Wallet Module
 * 
 * Public API exports for wallet management functionality.
 * 
 * Features:
 * - Random and HD wallet generation
 * - AES-256-GCM encryption with Argon2id key derivation
 * - Batch funding with transaction optimization
 * - Efficient balance tracking with caching
 */

// ============ Types ============
export type {
  WalletData,
  WalletExport,
  GenerateOptions,
  FundOptions,
  FundResult,
  ConsolidateOptions,
  ConsolidateResult,
  Balance,
} from './types.js';

// Error types
export {
  WalletError,
  InvalidMnemonicError,
  InvalidCountError,
  DerivationError,
  InvalidPasswordError,
  DecryptionError,
  InvalidFormatError,
  EncryptionError,
  InsufficientFundsError,
  TransactionError,
  InvalidAmountError,
  RPCError,
} from './types.js';

// Constants
export {
  ARGON2_CONFIG,
  AES_CONFIG,
  BATCH_CONFIG,
  MAX_WALLET_COUNT,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  SOLANA_DERIVATION_PATH,
} from './types.js';

// ============ Generator ============
export {
  generate,
  generateRandom,
  generateHD,
  validateMnemonic,
  generateMnemonic,
  keypairToWalletData,
  walletDataToKeypair,
  keypairsToWalletData,
} from './generator.js';

// ============ Encryptor ============
export {
  encrypt,
  decrypt,
  verifyPassword,
  createUnencryptedExport,
} from './encryptor.js';

// ============ Funder ============
export {
  fundAll,
  estimateFundingCost,
} from './funder.js';

// ============ Tracker ============
export {
  getBalances,
  getBalance,
  getTokenBalance,
  getAllTokenBalances,
  watchBalance,
  clearCache,
  getCacheStats,
} from './tracker.js';
