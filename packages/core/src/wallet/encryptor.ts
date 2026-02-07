/**
 * OrbitMM Wallet Encryptor
 * 
 * Encrypts and decrypts wallet data using AES-256-GCM with Argon2id key derivation.
 * Following ARCHITECT_SPEC.md exactly.
 */

import * as crypto from 'crypto';
import argon2 from 'argon2';
import {
  WalletData,
  WalletExport,
  InvalidPasswordError,
  DecryptionError,
  InvalidFormatError,
  EncryptionError,
  ARGON2_CONFIG,
  AES_CONFIG,
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
} from './types.js';

/**
 * Encrypt wallet data with password.
 * Uses AES-256-GCM with Argon2id key derivation.
 * 
 * @param wallets - Array of WalletData to encrypt
 * @param password - Encryption password (min 8 chars)
 * @returns Encrypted WalletExport object
 * @throws {InvalidPasswordError} If password is empty or too weak
 * @throws {EncryptionError} If encryption fails
 */
export async function encrypt(
  wallets: WalletData[],
  password: string
): Promise<WalletExport> {
  // Validate password
  validatePassword(password);

  try {
    // Truncate very long passwords to prevent DoS
    const safePassword = password.slice(0, MAX_PASSWORD_LENGTH);

    // Derive key using Argon2id
    const salt = crypto.randomBytes(16);
    const key = await argon2.hash(safePassword, {
      type: argon2.argon2id,
      memoryCost: ARGON2_CONFIG.memoryCost,
      timeCost: ARGON2_CONFIG.timeCost,
      parallelism: ARGON2_CONFIG.parallelism,
      hashLength: ARGON2_CONFIG.hashLength,
      salt,
      raw: true,
    });

    // Serialize wallet data
    const plaintext = JSON.stringify(wallets.map(serializeWalletData));

    // Generate random IV
    const iv = crypto.randomBytes(AES_CONFIG.ivLength);

    // Encrypt with AES-256-GCM
    const cipher = crypto.createCipheriv(AES_CONFIG.algorithm, key, iv, {
      authTagLength: AES_CONFIG.tagLength,
    });

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    const tag = cipher.getAuthTag();

    // Combine salt and encrypted data
    const combined = Buffer.concat([salt, encrypted]);

    return {
      version: 1,
      created: new Date().toISOString(),
      encrypted: true,
      wallets: combined.toString('base64'),
      kdf: 'argon2id',
      kdfParams: {
        memoryCost: ARGON2_CONFIG.memoryCost,
        timeCost: ARGON2_CONFIG.timeCost,
        parallelism: ARGON2_CONFIG.parallelism,
      },
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
    };
  } catch (error) {
    if (error instanceof InvalidPasswordError) {
      throw error;
    }
    throw new EncryptionError(
      `Encryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Decrypt wallet export with password.
 * 
 * @param exported - Encrypted WalletExport object
 * @param password - Decryption password
 * @returns Array of decrypted WalletData
 * @throws {DecryptionError} If password is wrong or data is corrupted
 * @throws {InvalidFormatError} If export format is invalid
 */
export async function decrypt(
  exported: WalletExport,
  password: string
): Promise<WalletData[]> {
  // Validate export format
  validateExportFormat(exported);

  // Handle unencrypted exports
  if (!exported.encrypted) {
    if (typeof exported.wallets === 'string') {
      throw new InvalidFormatError('Unencrypted export should have wallets as array');
    }
    return exported.wallets;
  }

  // Validate encrypted export has required fields
  if (!exported.iv || !exported.tag || typeof exported.wallets !== 'string') {
    throw new InvalidFormatError('Missing encryption metadata (iv, tag, or encrypted data)');
  }

  try {
    // Truncate password to match encryption
    const safePassword = password.slice(0, MAX_PASSWORD_LENGTH);

    // Decode encrypted data
    const combined = Buffer.from(exported.wallets, 'base64');
    const salt = combined.subarray(0, 16);
    const encrypted = combined.subarray(16);

    // Derive key using same parameters
    const kdfParams = exported.kdfParams || ARGON2_CONFIG;
    const key = await argon2.hash(safePassword, {
      type: argon2.argon2id,
      memoryCost: kdfParams.memoryCost,
      timeCost: kdfParams.timeCost,
      parallelism: kdfParams.parallelism,
      hashLength: ARGON2_CONFIG.hashLength,
      salt,
      raw: true,
    });

    // Decode IV and tag
    const iv = Buffer.from(exported.iv, 'base64');
    const tag = Buffer.from(exported.tag, 'base64');

    // Decrypt with AES-256-GCM
    const decipher = crypto.createDecipheriv(AES_CONFIG.algorithm, key, iv, {
      authTagLength: AES_CONFIG.tagLength,
    });
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]);

    // Parse and deserialize
    const parsed = JSON.parse(decrypted.toString('utf8'));
    return parsed.map(deserializeWalletData);
  } catch (error) {
    // Catch auth tag mismatch (wrong password) or other decryption errors
    if (
      error instanceof Error &&
      (error.message.includes('Unsupported state') ||
        error.message.includes('auth tag') ||
        error.message.includes('bad decrypt'))
    ) {
      throw new DecryptionError('Wrong password or corrupted data');
    }
    if (error instanceof InvalidFormatError) {
      throw error;
    }
    throw new DecryptionError(
      `Decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Verify password without full decryption.
 * Uses first portion of ciphertext as verification.
 * 
 * @param exported - Encrypted WalletExport object
 * @param password - Password to verify
 * @returns true if password is correct
 */
export async function verifyPassword(
  exported: WalletExport,
  password: string
): Promise<boolean> {
  try {
    // Attempt decryption - if it succeeds, password is correct
    await decrypt(exported, password);
    return true;
  } catch (error) {
    if (error instanceof DecryptionError) {
      return false;
    }
    throw error;
  }
}

/**
 * Create an unencrypted export (for backup purposes only).
 * 
 * @param wallets - Array of WalletData
 * @returns Unencrypted WalletExport
 */
export function createUnencryptedExport(wallets: WalletData[]): WalletExport {
  return {
    version: 1,
    created: new Date().toISOString(),
    encrypted: false,
    wallets: wallets.map(serializeWalletData) as unknown as WalletData[],
  };
}

// ============ Helper Functions ============

/**
 * Validate password meets requirements.
 */
function validatePassword(password: string): void {
  if (!password || typeof password !== 'string') {
    throw new InvalidPasswordError('Password is required');
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new InvalidPasswordError(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
    );
  }
}

/**
 * Validate export format structure.
 */
function validateExportFormat(exported: WalletExport): void {
  if (!exported || typeof exported !== 'object') {
    throw new InvalidFormatError('Export must be an object');
  }
  if (exported.version !== 1) {
    throw new InvalidFormatError(
      `Unsupported export version: ${exported.version}. ` +
        'This may require a newer version of OrbitMM.'
    );
  }
  if (typeof exported.encrypted !== 'boolean') {
    throw new InvalidFormatError('Export must have encrypted flag');
  }
  if (!exported.wallets) {
    throw new InvalidFormatError('Export must have wallets data');
  }
}

/**
 * Serialize WalletData for JSON storage.
 * Converts Uint8Array to regular array for JSON compatibility.
 */
function serializeWalletData(wallet: WalletData): Record<string, unknown> {
  return {
    publicKey: wallet.publicKey,
    secretKey: Array.from(wallet.secretKey),
    createdAt: wallet.createdAt,
    derivationPath: wallet.derivationPath,
  };
}

/**
 * Deserialize WalletData from JSON storage.
 */
function deserializeWalletData(data: Record<string, unknown>): WalletData {
  return {
    publicKey: data.publicKey as string,
    secretKey: new Uint8Array(data.secretKey as number[]),
    createdAt: data.createdAt as number,
    derivationPath: data.derivationPath as string | undefined,
  };
}
