/**
 * OrbitMM Wallet Module Types
 * 
 * All TypeScript interfaces and error types for the wallet module.
 * Following ARCHITECT_SPEC.md exactly.
 */

import { Keypair, PublicKey } from '@solana/web3.js';

// ============ Core Types ============

export interface WalletData {
  publicKey: string;
  secretKey: Uint8Array;  // 64 bytes
  createdAt: number;
  derivationPath?: string; // Only for HD wallets
}

export interface WalletExport {
  version: 1;
  created: string;         // ISO 8601
  encrypted: boolean;
  wallets: WalletData[] | string;  // string if encrypted (base64)
  
  // Encryption metadata (only if encrypted: true)
  kdf?: 'argon2id';
  kdfParams?: {
    memoryCost: number;
    timeCost: number;
    parallelism: number;
  };
  iv?: string;             // base64
  tag?: string;            // base64
}

export interface GenerateOptions {
  count: number;
  derivation?: 'random' | 'hd';
  hdSeed?: string;         // BIP39 mnemonic
  startIndex?: number;     // For HD, start at this derivation index
}

export interface FundOptions {
  source: Keypair;
  destinations: PublicKey[];
  amountPerWallet: number; // SOL
  priorityFee?: number;    // lamports, or 'auto'
}

export interface FundResult {
  successful: PublicKey[];
  failed: Array<{ wallet: PublicKey; error: string }>;
  signatures: string[];
  totalFunded: number;     // SOL
  feePaid: number;         // SOL
}

export interface ConsolidateOptions {
  wallets: Keypair[];
  destination: PublicKey;
  leaveRentExempt?: boolean; // Keep minimum for rent (default: false)
}

export interface ConsolidateResult {
  totalCollected: number;  // SOL
  signatures: string[];
  walletsProcessed: number;
}

export interface Balance {
  sol: number;
  lamports: bigint;
}

// ============ Error Types ============

/**
 * Base error class for all wallet-related errors
 */
export class WalletError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'WalletError';
    Error.captureStackTrace?.(this, this.constructor);
  }
}

/**
 * Thrown when an invalid BIP39 mnemonic is provided for HD derivation
 */
export class InvalidMnemonicError extends WalletError {
  constructor(message = 'Invalid BIP39 mnemonic provided') {
    super(message, 'INVALID_MNEMONIC');
    this.name = 'InvalidMnemonicError';
  }
}

/**
 * Thrown when an invalid count is provided for wallet generation
 */
export class InvalidCountError extends WalletError {
  constructor(count: number) {
    super(
      `Invalid wallet count: ${count}. Count must be between 0 and 10000.`,
      'INVALID_COUNT'
    );
    this.name = 'InvalidCountError';
  }
}

/**
 * Thrown when HD path derivation fails
 */
export class DerivationError extends WalletError {
  constructor(path: string, cause?: Error) {
    super(
      `Failed to derive key at path: ${path}${cause ? `: ${cause.message}` : ''}`,
      'DERIVATION_ERROR'
    );
    this.name = 'DerivationError';
  }
}

/**
 * Thrown when password validation fails
 */
export class InvalidPasswordError extends WalletError {
  constructor(message = 'Invalid password. Password must be at least 8 characters.') {
    super(message, 'INVALID_PASSWORD');
    this.name = 'InvalidPasswordError';
  }
}

/**
 * Thrown when decryption fails (wrong password or corrupted data)
 */
export class DecryptionError extends WalletError {
  constructor(message = 'Decryption failed. Wrong password or corrupted data.') {
    super(message, 'DECRYPTION_ERROR');
    this.name = 'DecryptionError';
  }
}

/**
 * Thrown when wallet export format is invalid
 */
export class InvalidFormatError extends WalletError {
  constructor(message = 'Invalid wallet export format.') {
    super(message, 'INVALID_FORMAT');
    this.name = 'InvalidFormatError';
  }
}

/**
 * Thrown when encryption fails
 */
export class EncryptionError extends WalletError {
  constructor(message = 'Encryption failed.') {
    super(message, 'ENCRYPTION_ERROR');
    this.name = 'EncryptionError';
  }
}

/**
 * Thrown when source wallet has insufficient funds
 */
export class InsufficientFundsError extends WalletError {
  constructor(required: number, available: number) {
    super(
      `Insufficient funds. Required: ${required} SOL, Available: ${available} SOL`,
      'INSUFFICIENT_FUNDS'
    );
    this.name = 'InsufficientFundsError';
  }
}

/**
 * Thrown when a transaction fails
 */
export class TransactionError extends WalletError {
  constructor(message: string, public readonly signature?: string) {
    super(message, 'TRANSACTION_ERROR');
    this.name = 'TransactionError';
  }
}

/**
 * Thrown when an invalid amount is provided
 */
export class InvalidAmountError extends WalletError {
  constructor(amount: number) {
    super(`Invalid amount: ${amount}. Amount must be greater than 0.`, 'INVALID_AMOUNT');
    this.name = 'InvalidAmountError';
  }
}

/**
 * Thrown when RPC operations fail
 */
export class RPCError extends WalletError {
  constructor(message: string, public readonly cause?: Error) {
    super(message, 'RPC_ERROR');
    this.name = 'RPCError';
  }
}

// ============ Constants ============

export const ARGON2_CONFIG = {
  memoryCost: 65536,    // 64 MB
  timeCost: 3,          // 3 iterations
  parallelism: 4,       // 4 threads
  hashLength: 32,       // 256 bits for AES-256
} as const;

export const AES_CONFIG = {
  algorithm: 'aes-256-gcm' as const,
  ivLength: 12,         // 96 bits (GCM standard)
  tagLength: 16,        // 128 bits auth tag
} as const;

export const BATCH_CONFIG = {
  default: 20,
  withPriorityFee: 18,
  withMemo: 15,
  minimum: 10,
  maximum: 22,
} as const;

export const MAX_WALLET_COUNT = 10000;
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 1000;

// Solana derivation path format: m/44'/501'/{index}'/0'
export const SOLANA_DERIVATION_PATH = (index: number) => `m/44'/501'/${index}'/0'`;
