/**
 * Wallet Encryptor Tests
 * 
 * Tests for AES-256-GCM encryption with Argon2id key derivation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Keypair } from '@solana/web3.js';
import {
  encrypt,
  decrypt,
  verifyPassword,
  createUnencryptedExport,
} from '../encryptor.js';
import {
  generateRandom,
  keypairToWalletData,
  keypairsToWalletData,
  walletDataToKeypair,
} from '../generator.js';
import {
  WalletData,
  WalletExport,
  InvalidPasswordError,
  DecryptionError,
  InvalidFormatError,
  ARGON2_CONFIG,
} from '../types.js';

describe('Encryptor', () => {
  let testWallets: WalletData[];
  const testPassword = 'secure-test-password-123!';

  beforeEach(() => {
    // Generate fresh test wallets for each test
    const keypairs = generateRandom(5);
    testWallets = keypairsToWalletData(keypairs);
  });

  describe('encrypt()', () => {
    it('should encrypt wallet data successfully', async () => {
      const exported = await encrypt(testWallets, testPassword);

      expect(exported.version).toBe(1);
      expect(exported.encrypted).toBe(true);
      expect(typeof exported.wallets).toBe('string');
      expect(exported.kdf).toBe('argon2id');
      expect(exported.kdfParams).toBeDefined();
      expect(exported.iv).toBeDefined();
      expect(exported.tag).toBeDefined();
      expect(exported.created).toBeDefined();
    });

    it('should include correct KDF parameters', async () => {
      const exported = await encrypt(testWallets, testPassword);

      expect(exported.kdfParams?.memoryCost).toBe(ARGON2_CONFIG.memoryCost);
      expect(exported.kdfParams?.timeCost).toBe(ARGON2_CONFIG.timeCost);
      expect(exported.kdfParams?.parallelism).toBe(ARGON2_CONFIG.parallelism);
    });

    it('should produce different ciphertext each time (random IV)', async () => {
      const export1 = await encrypt(testWallets, testPassword);
      const export2 = await encrypt(testWallets, testPassword);

      // Same password, same data, but different ciphertext
      expect(export1.wallets).not.toBe(export2.wallets);
      expect(export1.iv).not.toBe(export2.iv);
    });

    it('should encrypt empty wallet array', async () => {
      const exported = await encrypt([], testPassword);

      expect(exported.encrypted).toBe(true);
      expect(typeof exported.wallets).toBe('string');
    });

    it('should throw InvalidPasswordError for empty password', async () => {
      await expect(encrypt(testWallets, '')).rejects.toThrow(InvalidPasswordError);
    });

    it('should throw InvalidPasswordError for short password', async () => {
      await expect(encrypt(testWallets, 'short')).rejects.toThrow(InvalidPasswordError);
    });

    it('should handle unicode passwords', async () => {
      const unicodePassword = '密码安全🔐测试!';
      const exported = await encrypt(testWallets, unicodePassword);

      expect(exported.encrypted).toBe(true);

      // Should decrypt correctly
      const decrypted = await decrypt(exported, unicodePassword);
      expect(decrypted).toHaveLength(testWallets.length);
    });

    it('should truncate very long passwords (>1000 chars)', async () => {
      const longPassword = 'a'.repeat(1500);
      const truncatedPassword = 'a'.repeat(1000);

      const exported = await encrypt(testWallets, longPassword);

      // Both should decrypt the same way
      const decrypted = await decrypt(exported, truncatedPassword);
      expect(decrypted).toHaveLength(testWallets.length);
    });
  });

  describe('decrypt()', () => {
    it('should decrypt encrypted data correctly', async () => {
      const exported = await encrypt(testWallets, testPassword);
      const decrypted = await decrypt(exported, testPassword);

      expect(decrypted).toHaveLength(testWallets.length);

      for (let i = 0; i < testWallets.length; i++) {
        expect(decrypted[i].publicKey).toBe(testWallets[i].publicKey);
        expect(Array.from(decrypted[i].secretKey)).toEqual(
          Array.from(testWallets[i].secretKey)
        );
      }
    });

    it('should preserve wallet metadata after decrypt', async () => {
      // Add derivation path metadata
      testWallets[0].derivationPath = "m/44'/501'/0'/0'";
      
      const exported = await encrypt(testWallets, testPassword);
      const decrypted = await decrypt(exported, testPassword);

      expect(decrypted[0].derivationPath).toBe(testWallets[0].derivationPath);
    });

    it('should throw DecryptionError for wrong password', async () => {
      const exported = await encrypt(testWallets, testPassword);

      await expect(decrypt(exported, 'wrong-password!!')).rejects.toThrow(
        DecryptionError
      );
    });

    it('should throw DecryptionError for tampered ciphertext', async () => {
      const exported = await encrypt(testWallets, testPassword);

      // Tamper with the encrypted data
      const tampered = { ...exported };
      const walletBytes = Buffer.from(tampered.wallets as string, 'base64');
      walletBytes[20] = walletBytes[20] ^ 0xff; // Flip some bits
      tampered.wallets = walletBytes.toString('base64');

      await expect(decrypt(tampered, testPassword)).rejects.toThrow(DecryptionError);
    });

    it('should throw DecryptionError for tampered auth tag', async () => {
      const exported = await encrypt(testWallets, testPassword);

      // Tamper with auth tag
      const tampered = { ...exported };
      const tagBytes = Buffer.from(tampered.tag!, 'base64');
      tagBytes[0] = tagBytes[0] ^ 0xff;
      tampered.tag = tagBytes.toString('base64');

      await expect(decrypt(tampered, testPassword)).rejects.toThrow(DecryptionError);
    });

    it('should handle unencrypted exports', async () => {
      const unencrypted: WalletExport = {
        version: 1,
        created: new Date().toISOString(),
        encrypted: false,
        wallets: testWallets,
      };

      const decrypted = await decrypt(unencrypted, 'any-password');
      expect(decrypted).toEqual(testWallets);
    });

    it('should throw InvalidFormatError for unsupported version', async () => {
      const badExport = {
        version: 99,
        created: new Date().toISOString(),
        encrypted: true,
        wallets: 'encrypted-data',
        iv: 'abc',
        tag: 'def',
      } as unknown as WalletExport;

      await expect(decrypt(badExport, testPassword)).rejects.toThrow(
        InvalidFormatError
      );
    });

    it('should throw InvalidFormatError for missing encryption metadata', async () => {
      const badExport: WalletExport = {
        version: 1,
        created: new Date().toISOString(),
        encrypted: true,
        wallets: 'encrypted-data',
        // Missing iv and tag
      };

      await expect(decrypt(badExport, testPassword)).rejects.toThrow(
        InvalidFormatError
      );
    });
  });

  describe('verifyPassword()', () => {
    it('should return true for correct password', async () => {
      const exported = await encrypt(testWallets, testPassword);
      const isValid = await verifyPassword(exported, testPassword);

      expect(isValid).toBe(true);
    });

    it('should return false for incorrect password', async () => {
      const exported = await encrypt(testWallets, testPassword);
      const isValid = await verifyPassword(exported, 'wrong-password!!');

      expect(isValid).toBe(false);
    });

    it('should work with empty wallet array', async () => {
      const exported = await encrypt([], testPassword);

      expect(await verifyPassword(exported, testPassword)).toBe(true);
      expect(await verifyPassword(exported, 'wrong')).toBe(false);
    });
  });

  describe('createUnencryptedExport()', () => {
    it('should create unencrypted export', () => {
      const exported = createUnencryptedExport(testWallets);

      expect(exported.version).toBe(1);
      expect(exported.encrypted).toBe(false);
      expect(exported.created).toBeDefined();
      expect(Array.isArray(exported.wallets)).toBe(true);
    });

    it('should not include encryption metadata', () => {
      const exported = createUnencryptedExport(testWallets);

      expect(exported.kdf).toBeUndefined();
      expect(exported.kdfParams).toBeUndefined();
      expect(exported.iv).toBeUndefined();
      expect(exported.tag).toBeUndefined();
    });
  });

  describe('Round-trip encryption', () => {
    it('should preserve keypairs through encrypt/decrypt cycle', async () => {
      const keypairs = generateRandom(10);
      const walletData = keypairsToWalletData(keypairs);

      const exported = await encrypt(walletData, testPassword);
      const decrypted = await decrypt(exported, testPassword);

      // Convert back to keypairs and verify
      for (let i = 0; i < keypairs.length; i++) {
        const restored = walletDataToKeypair(decrypted[i]);
        expect(restored.publicKey.toBase58()).toBe(
          keypairs[i].publicKey.toBase58()
        );
        expect(restored.secretKey).toEqual(keypairs[i].secretKey);
      }
    });

    it('should work with large wallet count', async () => {
      const keypairs = generateRandom(100);
      const walletData = keypairsToWalletData(keypairs);

      const exported = await encrypt(walletData, testPassword);
      const decrypted = await decrypt(exported, testPassword);

      expect(decrypted).toHaveLength(100);

      // Spot check a few
      for (const idx of [0, 49, 99]) {
        expect(decrypted[idx].publicKey).toBe(walletData[idx].publicKey);
      }
    });
  });

  describe('Edge cases', () => {
    it('should handle wallets with null derivationPath', async () => {
      testWallets[0].derivationPath = undefined;

      const exported = await encrypt(testWallets, testPassword);
      const decrypted = await decrypt(exported, testPassword);

      expect(decrypted[0].derivationPath).toBeUndefined();
    });

    it('should handle wallet with special characters in derivation path', async () => {
      testWallets[0].derivationPath = "m/44'/501'/999'/0'";

      const exported = await encrypt(testWallets, testPassword);
      const decrypted = await decrypt(exported, testPassword);

      expect(decrypted[0].derivationPath).toBe("m/44'/501'/999'/0'");
    });

    it('should handle password with special characters', async () => {
      const specialPassword = 'p@$$w0rd!#$%^&*()_+-=[]{}|;:,.<>?';

      const exported = await encrypt(testWallets, specialPassword);
      const decrypted = await decrypt(exported, specialPassword);

      expect(decrypted).toHaveLength(testWallets.length);
    });
  });
});
