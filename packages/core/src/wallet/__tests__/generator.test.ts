/**
 * Wallet Generator Tests
 * 
 * Tests for random and HD wallet generation following spec requirements.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Keypair } from '@solana/web3.js';
import {
  generate,
  generateRandom,
  generateHD,
  validateMnemonic,
  generateMnemonic,
  keypairToWalletData,
  walletDataToKeypair,
  keypairsToWalletData,
} from '../generator.js';
import {
  InvalidMnemonicError,
  InvalidCountError,
  SOLANA_DERIVATION_PATH,
} from '../types.js';

// Known test mnemonic for deterministic testing
const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

// Expected public keys for test mnemonic (first 3 derivation paths)
// These match Phantom wallet's derivation
const EXPECTED_PUBKEYS = [
  '5YNmS1R9nNSCDzb5a7mMJ1dwK9uHeAAF4CertLq1XP2a',  // m/44'/501'/0'/0'
  'CzAHrrrHKx9DJyGS5zj4rQT21qkqjQsCpaA8qCRfHFJQ',  // m/44'/501'/1'/0'
  'FUqJNFv9LXNG7DnNFxQX7KKWX3SALnZfKJuTG4E4W26M',  // m/44'/501'/2'/0'
];

describe('Generator', () => {
  describe('generate()', () => {
    it('should use random generation by default', () => {
      const wallets = generate({ count: 5 });
      expect(wallets).toHaveLength(5);
      
      // Verify all are unique
      const pubkeys = new Set(wallets.map((w) => w.publicKey.toBase58()));
      expect(pubkeys.size).toBe(5);
    });

    it('should use HD generation when specified', () => {
      const wallets = generate({
        count: 3,
        derivation: 'hd',
        hdSeed: TEST_MNEMONIC,
      });
      
      expect(wallets).toHaveLength(3);
      expect(wallets[0].publicKey.toBase58()).toBe(EXPECTED_PUBKEYS[0]);
    });

    it('should return empty array for count 0', () => {
      const wallets = generate({ count: 0 });
      expect(wallets).toHaveLength(0);
    });

    it('should throw InvalidCountError for negative count', () => {
      expect(() => generate({ count: -1 })).toThrow(InvalidCountError);
    });

    it('should throw InvalidCountError for count > 10000', () => {
      expect(() => generate({ count: 10001 })).toThrow(InvalidCountError);
    });

    it('should throw InvalidMnemonicError for HD without seed', () => {
      expect(() => generate({ count: 5, derivation: 'hd' })).toThrow(
        InvalidMnemonicError
      );
    });
  });

  describe('generateRandom()', () => {
    it('should generate specified number of unique wallets', () => {
      const wallets = generateRandom(100);
      expect(wallets).toHaveLength(100);

      // All wallets should be unique
      const pubkeys = new Set(wallets.map((w) => w.publicKey.toBase58()));
      expect(pubkeys.size).toBe(100);
    });

    it('should generate valid Keypairs', () => {
      const wallets = generateRandom(5);
      
      for (const wallet of wallets) {
        expect(wallet).toBeInstanceOf(Keypair);
        expect(wallet.publicKey.toBytes()).toHaveLength(32);
        expect(wallet.secretKey).toHaveLength(64);
      }
    });

    it('should handle count = 0', () => {
      const wallets = generateRandom(0);
      expect(wallets).toHaveLength(0);
    });

    it('should throw for invalid counts', () => {
      expect(() => generateRandom(-1)).toThrow(InvalidCountError);
      expect(() => generateRandom(10001)).toThrow(InvalidCountError);
    });
  });

  describe('generateHD()', () => {
    it('should generate deterministic wallets from mnemonic', () => {
      const wallets1 = generateHD(3, TEST_MNEMONIC);
      const wallets2 = generateHD(3, TEST_MNEMONIC);

      // Same mnemonic should produce same keys
      for (let i = 0; i < 3; i++) {
        expect(wallets1[i].publicKey.toBase58()).toBe(
          wallets2[i].publicKey.toBase58()
        );
        expect(wallets1[i].secretKey).toEqual(wallets2[i].secretKey);
      }
    });

    it('should match Phantom derivation paths', () => {
      const wallets = generateHD(3, TEST_MNEMONIC);

      // These should match Phantom wallet's derived addresses
      expect(wallets[0].publicKey.toBase58()).toBe(EXPECTED_PUBKEYS[0]);
      expect(wallets[1].publicKey.toBase58()).toBe(EXPECTED_PUBKEYS[1]);
      expect(wallets[2].publicKey.toBase58()).toBe(EXPECTED_PUBKEYS[2]);
    });

    it('should support custom start index', () => {
      const wallets = generateHD(2, TEST_MNEMONIC, 1);

      // Starting at index 1 should give us pubkeys[1] and pubkeys[2]
      expect(wallets[0].publicKey.toBase58()).toBe(EXPECTED_PUBKEYS[1]);
      expect(wallets[1].publicKey.toBase58()).toBe(EXPECTED_PUBKEYS[2]);
    });

    it('should throw InvalidMnemonicError for invalid mnemonic', () => {
      expect(() => generateHD(5, 'invalid mnemonic words')).toThrow(
        InvalidMnemonicError
      );
    });

    it('should throw InvalidMnemonicError for empty mnemonic', () => {
      expect(() => generateHD(5, '')).toThrow(InvalidMnemonicError);
    });

    it('should handle 24-word mnemonic', () => {
      const mnemonic24 = generateMnemonic(256);
      const words = mnemonic24.split(' ');
      expect(words).toHaveLength(24);

      const wallets = generateHD(3, mnemonic24);
      expect(wallets).toHaveLength(3);
    });
  });

  describe('validateMnemonic()', () => {
    it('should return true for valid 12-word mnemonic', () => {
      expect(validateMnemonic(TEST_MNEMONIC)).toBe(true);
    });

    it('should return true for valid 24-word mnemonic', () => {
      const mnemonic24 = generateMnemonic(256);
      expect(validateMnemonic(mnemonic24)).toBe(true);
    });

    it('should return false for invalid mnemonic', () => {
      expect(validateMnemonic('invalid words here')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(validateMnemonic('')).toBe(false);
    });

    it('should return false for null/undefined', () => {
      expect(validateMnemonic(null as unknown as string)).toBe(false);
      expect(validateMnemonic(undefined as unknown as string)).toBe(false);
    });

    it('should handle whitespace in mnemonic', () => {
      const mnemonicWithSpaces = `  ${TEST_MNEMONIC}  `;
      expect(validateMnemonic(mnemonicWithSpaces)).toBe(true);
    });
  });

  describe('generateMnemonic()', () => {
    it('should generate valid 12-word mnemonic by default', () => {
      const mnemonic = generateMnemonic();
      const words = mnemonic.split(' ');
      
      expect(words).toHaveLength(12);
      expect(validateMnemonic(mnemonic)).toBe(true);
    });

    it('should generate valid 12-word mnemonic with strength 128', () => {
      const mnemonic = generateMnemonic(128);
      const words = mnemonic.split(' ');
      
      expect(words).toHaveLength(12);
      expect(validateMnemonic(mnemonic)).toBe(true);
    });

    it('should generate valid 24-word mnemonic with strength 256', () => {
      const mnemonic = generateMnemonic(256);
      const words = mnemonic.split(' ');
      
      expect(words).toHaveLength(24);
      expect(validateMnemonic(mnemonic)).toBe(true);
    });

    it('should generate unique mnemonics', () => {
      const mnemonics = new Set<string>();
      
      for (let i = 0; i < 100; i++) {
        mnemonics.add(generateMnemonic());
      }
      
      expect(mnemonics.size).toBe(100);
    });
  });

  describe('keypairToWalletData()', () => {
    it('should convert Keypair to WalletData', () => {
      const keypair = Keypair.generate();
      const data = keypairToWalletData(keypair);

      expect(data.publicKey).toBe(keypair.publicKey.toBase58());
      expect(data.secretKey).toEqual(keypair.secretKey);
      expect(typeof data.createdAt).toBe('number');
      expect(data.derivationPath).toBeUndefined();
    });

    it('should include derivation path when provided', () => {
      const keypair = Keypair.generate();
      const path = SOLANA_DERIVATION_PATH(5);
      const data = keypairToWalletData(keypair, path);

      expect(data.derivationPath).toBe(path);
    });
  });

  describe('walletDataToKeypair()', () => {
    it('should convert WalletData back to Keypair', () => {
      const original = Keypair.generate();
      const data = keypairToWalletData(original);
      const restored = walletDataToKeypair(data);

      expect(restored.publicKey.toBase58()).toBe(original.publicKey.toBase58());
      expect(restored.secretKey).toEqual(original.secretKey);
    });

    it('should handle Uint8Array secretKey', () => {
      const original = Keypair.generate();
      const data = {
        publicKey: original.publicKey.toBase58(),
        secretKey: original.secretKey,
        createdAt: Date.now(),
      };
      
      const restored = walletDataToKeypair(data);
      expect(restored.publicKey.toBase58()).toBe(original.publicKey.toBase58());
    });

    it('should handle object-form secretKey (from JSON parse)', () => {
      const original = Keypair.generate();
      const data = {
        publicKey: original.publicKey.toBase58(),
        secretKey: Object.assign({}, original.secretKey) as unknown as Uint8Array,
        createdAt: Date.now(),
      };
      
      const restored = walletDataToKeypair(data);
      expect(restored.publicKey.toBase58()).toBe(original.publicKey.toBase58());
    });
  });

  describe('keypairsToWalletData()', () => {
    it('should convert array of Keypairs to WalletData array', () => {
      const keypairs = generateRandom(5);
      const data = keypairsToWalletData(keypairs);

      expect(data).toHaveLength(5);
      for (let i = 0; i < 5; i++) {
        expect(data[i].publicKey).toBe(keypairs[i].publicKey.toBase58());
        expect(data[i].derivationPath).toBeUndefined();
      }
    });

    it('should include HD derivation paths when startIndex provided', () => {
      const keypairs = generateHD(3, TEST_MNEMONIC);
      const data = keypairsToWalletData(keypairs, 0);

      expect(data[0].derivationPath).toBe(SOLANA_DERIVATION_PATH(0));
      expect(data[1].derivationPath).toBe(SOLANA_DERIVATION_PATH(1));
      expect(data[2].derivationPath).toBe(SOLANA_DERIVATION_PATH(2));
    });
  });

  describe('Performance', () => {
    it('should generate 1000 random wallets in < 500ms', () => {
      const start = performance.now();
      const wallets = generateRandom(1000);
      const elapsed = performance.now() - start;

      expect(wallets).toHaveLength(1000);
      expect(elapsed).toBeLessThan(500);
    });

    it('should generate 1000 HD wallets in < 2000ms', () => {
      const start = performance.now();
      const wallets = generateHD(1000, TEST_MNEMONIC);
      const elapsed = performance.now() - start;

      expect(wallets).toHaveLength(1000);
      expect(elapsed).toBeLessThan(2000);
    });
  });
});
