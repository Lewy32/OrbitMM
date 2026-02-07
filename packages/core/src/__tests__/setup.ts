/**
 * Test Setup - Vitest
 * 
 * Mocks for native modules that may not be built in CI/dev environments.
 */

import { vi } from 'vitest';
import * as crypto from 'crypto';

// Mock argon2 native module which may not be compiled
vi.mock('argon2', () => {
  // Use a simple but deterministic key derivation for testing
  const mockHash = async (password: string, options?: { salt?: Buffer; raw?: boolean }) => {
    const salt = options?.salt || crypto.randomBytes(16);
    // Create a deterministic 32-byte key using crypto
    const key = crypto.pbkdf2Sync(password, salt, 1000, 32, 'sha256');
    if (options?.raw) {
      return key;
    }
    return key;
  };

  return {
    default: {
      hash: mockHash,
      verify: vi.fn(async () => true),
      argon2id: 2,
    },
    hash: mockHash,
    verify: vi.fn(async () => true),
    argon2id: 2,
  };
});
