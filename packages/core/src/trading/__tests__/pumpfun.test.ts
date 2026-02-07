/**
 * PumpFun Integration Tests
 * OrbitMM - Trading Module Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import {
  PumpFunClient,
  getQuote,
  getPools,
  isOnPumpFun,
  hasMigrated,
  getBondingCurveAddress,
  NoRouteError,
  APIError,
  SwapTransactionError,
  PUMPFUN_CONSTANTS,
  Quote,
} from '../index.js';

// Test constants
const TEST_RPC = 'https://api.mainnet-beta.solana.com';
const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

// Example PumpFun token (use a known one for testing)
const EXAMPLE_PUMPFUN_TOKEN = new PublicKey('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263'); // Bonk

describe('PumpFunClient', () => {
  let client: PumpFunClient;
  let connection: Connection;

  beforeEach(() => {
    connection = {
      getAccountInfo: vi.fn(),
      getTokenAccountBalance: vi.fn(),
      getLatestBlockhash: vi.fn().mockResolvedValue({
        blockhash: 'test-blockhash',
        lastValidBlockHeight: 12345678,
      }),
      sendRawTransaction: vi.fn(),
      confirmTransaction: vi.fn(),
    } as unknown as Connection;
    
    client = new PumpFunClient(connection);
  });

  describe('getBondingCurveAddress', () => {
    it('should derive consistent bonding curve address', () => {
      const tokenMint = Keypair.generate().publicKey;
      const address1 = getBondingCurveAddress(tokenMint);
      const address2 = getBondingCurveAddress(tokenMint);
      
      expect(address1.equals(address2)).toBe(true);
    });

    it('should derive different addresses for different tokens', () => {
      const token1 = Keypair.generate().publicKey;
      const token2 = Keypair.generate().publicKey;
      
      const address1 = getBondingCurveAddress(token1);
      const address2 = getBondingCurveAddress(token2);
      
      expect(address1.equals(address2)).toBe(false);
    });

    it('should use correct program ID', () => {
      expect(PUMPFUN_CONSTANTS.PROGRAM_ID.toString()).toBe(
        '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'
      );
    });
  });

  describe('getQuote', () => {
    it('should throw NoRouteError for non-PumpFun tokens', async () => {
      // Mock getAccountInfo to return null (no bonding curve exists)
      vi.mocked(connection.getAccountInfo).mockResolvedValue(null);

      await expect(
        client.getQuote({
          inputMint: SOL_MINT,
          outputMint: Keypair.generate().publicKey,
          amount: 1_000_000_000,
          slippageBps: 100,
        })
      ).rejects.toThrow(NoRouteError);
    });

    it('should calculate buy quote correctly', async () => {
      // Mock bonding curve account data
      const mockBondingCurveData = createMockBondingCurveData({
        virtualTokenReserves: BigInt('1073000000000000'),  // ~1.073B tokens
        virtualSolReserves: BigInt('30000000000'),         // 30 SOL
        realTokenReserves: BigInt('793100000000000'),      // ~793B tokens
        realSolReserves: BigInt('0'),                      // 0 SOL
        complete: false,
      });

      vi.mocked(connection.getAccountInfo).mockResolvedValue({
        data: mockBondingCurveData,
        executable: false,
        lamports: 1000000,
        owner: PUMPFUN_CONSTANTS.PROGRAM_ID,
        rentEpoch: 0,
      });

      const quote = await client.getQuote({
        inputMint: SOL_MINT,
        outputMint: Keypair.generate().publicKey,
        amount: 1_000_000_000, // 1 SOL
        slippageBps: 100,
      });

      expect(quote).toBeDefined();
      expect(quote.dex).toBe('pumpfun');
      expect(quote.inputMint).toBe(SOL_MINT.toString());
      expect(BigInt(quote.outAmount)).toBeGreaterThan(0n);
      expect(quote.priceImpactPct).toBeGreaterThan(0);
    });

    it('should throw NoRouteError for migrated tokens', async () => {
      // Mock migrated bonding curve (complete = true)
      const mockBondingCurveData = createMockBondingCurveData({
        virtualTokenReserves: BigInt(0),
        virtualSolReserves: BigInt(0),
        realTokenReserves: BigInt(0),
        realSolReserves: BigInt(0),
        complete: true, // Migrated!
      });

      vi.mocked(connection.getAccountInfo).mockResolvedValue({
        data: mockBondingCurveData,
        executable: false,
        lamports: 1000000,
        owner: PUMPFUN_CONSTANTS.PROGRAM_ID,
        rentEpoch: 0,
      });

      await expect(
        client.getQuote({
          inputMint: SOL_MINT,
          outputMint: Keypair.generate().publicKey,
          amount: 1_000_000_000,
          slippageBps: 100,
        })
      ).rejects.toThrow(NoRouteError);
    });

    it('should include route information', async () => {
      const tokenMint = Keypair.generate().publicKey;
      
      const mockBondingCurveData = createMockBondingCurveData({
        virtualTokenReserves: BigInt('1073000000000000'),
        virtualSolReserves: BigInt('30000000000'),
        realTokenReserves: BigInt('793100000000000'),
        realSolReserves: BigInt('0'),
        complete: false,
      });

      vi.mocked(connection.getAccountInfo).mockResolvedValue({
        data: mockBondingCurveData,
        executable: false,
        lamports: 1000000,
        owner: PUMPFUN_CONSTANTS.PROGRAM_ID,
        rentEpoch: 0,
      });

      const quote = await client.getQuote({
        inputMint: SOL_MINT,
        outputMint: tokenMint,
        amount: 1_000_000_000,
        slippageBps: 100,
      });

      expect(quote.route).toHaveLength(1);
      expect(quote.route[0].dex).toBe('pumpfun');
      expect(quote.route[0].percent).toBe(100);
    });
  });

  describe('isOnPumpFun', () => {
    it('should return true for active bonding curves', async () => {
      const mockBondingCurveData = createMockBondingCurveData({
        virtualTokenReserves: BigInt('1073000000000000'),
        virtualSolReserves: BigInt('30000000000'),
        realTokenReserves: BigInt('793100000000000'),
        realSolReserves: BigInt('5000000000'),
        complete: false,
      });

      vi.mocked(connection.getAccountInfo).mockResolvedValue({
        data: mockBondingCurveData,
        executable: false,
        lamports: 1000000,
        owner: PUMPFUN_CONSTANTS.PROGRAM_ID,
        rentEpoch: 0,
      });

      const result = await client.isOnPumpFun(Keypair.generate().publicKey);
      expect(result).toBe(true);
    });

    it('should return false for migrated tokens', async () => {
      const mockBondingCurveData = createMockBondingCurveData({
        virtualTokenReserves: BigInt(0),
        virtualSolReserves: BigInt(0),
        realTokenReserves: BigInt(0),
        realSolReserves: BigInt(0),
        complete: true,
      });

      vi.mocked(connection.getAccountInfo).mockResolvedValue({
        data: mockBondingCurveData,
        executable: false,
        lamports: 1000000,
        owner: PUMPFUN_CONSTANTS.PROGRAM_ID,
        rentEpoch: 0,
      });

      const result = await client.isOnPumpFun(Keypair.generate().publicKey);
      expect(result).toBe(false);
    });

    it('should return false for non-existent tokens', async () => {
      vi.mocked(connection.getAccountInfo).mockResolvedValue(null);

      const result = await client.isOnPumpFun(Keypair.generate().publicKey);
      expect(result).toBe(false);
    });
  });

  describe('hasMigrated', () => {
    it('should return true for completed bonding curves', async () => {
      const mockBondingCurveData = createMockBondingCurveData({
        virtualTokenReserves: BigInt(0),
        virtualSolReserves: BigInt(0),
        realTokenReserves: BigInt(0),
        realSolReserves: BigInt(0),
        complete: true,
      });

      vi.mocked(connection.getAccountInfo).mockResolvedValue({
        data: mockBondingCurveData,
        executable: false,
        lamports: 1000000,
        owner: PUMPFUN_CONSTANTS.PROGRAM_ID,
        rentEpoch: 0,
      });

      const result = await client.hasMigrated(Keypair.generate().publicKey);
      expect(result).toBe(true);
    });

    it('should return false for active bonding curves', async () => {
      const mockBondingCurveData = createMockBondingCurveData({
        virtualTokenReserves: BigInt('1073000000000000'),
        virtualSolReserves: BigInt('30000000000'),
        realTokenReserves: BigInt('793100000000000'),
        realSolReserves: BigInt('5000000000'),
        complete: false,
      });

      vi.mocked(connection.getAccountInfo).mockResolvedValue({
        data: mockBondingCurveData,
        executable: false,
        lamports: 1000000,
        owner: PUMPFUN_CONSTANTS.PROGRAM_ID,
        rentEpoch: 0,
      });

      const result = await client.hasMigrated(Keypair.generate().publicKey);
      expect(result).toBe(false);
    });
  });

  describe('getPools', () => {
    it('should return pool info for PumpFun tokens', async () => {
      const mockBondingCurveData = createMockBondingCurveData({
        virtualTokenReserves: BigInt('1073000000000000'),
        virtualSolReserves: BigInt('30000000000'),
        realTokenReserves: BigInt('793100000000000'),
        realSolReserves: BigInt('10000000000'), // 10 SOL
        complete: false,
      });

      vi.mocked(connection.getAccountInfo).mockResolvedValue({
        data: mockBondingCurveData,
        executable: false,
        lamports: 1000000,
        owner: PUMPFUN_CONSTANTS.PROGRAM_ID,
        rentEpoch: 0,
      });

      const tokenMint = Keypair.generate().publicKey;
      const pools = await client.getPools(tokenMint);

      expect(pools).toHaveLength(1);
      expect(pools[0].dex).toBe('pumpfun');
      expect(pools[0].tokenA.mint).toBe(SOL_MINT.toString());
      expect(pools[0].tokenB.mint).toBe(tokenMint.toString());
    });

    it('should return empty array for non-PumpFun tokens', async () => {
      vi.mocked(connection.getAccountInfo).mockResolvedValue(null);

      const pools = await client.getPools(Keypair.generate().publicKey);
      expect(pools).toHaveLength(0);
    });
  });
});

describe('Bonding curve math', () => {
  it('should calculate higher output for larger buys', async () => {
    const connection = {
      getAccountInfo: vi.fn(),
    } as unknown as Connection;
    
    const client = new PumpFunClient(connection);
    
    const mockBondingCurveData = createMockBondingCurveData({
      virtualTokenReserves: BigInt('1073000000000000'),
      virtualSolReserves: BigInt('30000000000'),
      realTokenReserves: BigInt('793100000000000'),
      realSolReserves: BigInt('5000000000'),
      complete: false,
    });

    vi.mocked(connection.getAccountInfo).mockResolvedValue({
      data: mockBondingCurveData,
      executable: false,
      lamports: 1000000,
      owner: PUMPFUN_CONSTANTS.PROGRAM_ID,
      rentEpoch: 0,
    });

    const tokenMint = Keypair.generate().publicKey;
    
    const smallQuote = await client.getQuote({
      inputMint: SOL_MINT,
      outputMint: tokenMint,
      amount: 100_000_000, // 0.1 SOL
      slippageBps: 100,
    });

    const largeQuote = await client.getQuote({
      inputMint: SOL_MINT,
      outputMint: tokenMint,
      amount: 1_000_000_000, // 1 SOL
      slippageBps: 100,
    });

    expect(BigInt(largeQuote.outAmount)).toBeGreaterThan(BigInt(smallQuote.outAmount));
  });

  it('should have higher price impact for larger trades', async () => {
    const connection = {
      getAccountInfo: vi.fn(),
    } as unknown as Connection;
    
    const client = new PumpFunClient(connection);
    
    const mockBondingCurveData = createMockBondingCurveData({
      virtualTokenReserves: BigInt('1073000000000000'),
      virtualSolReserves: BigInt('30000000000'),
      realTokenReserves: BigInt('793100000000000'),
      realSolReserves: BigInt('5000000000'),
      complete: false,
    });

    vi.mocked(connection.getAccountInfo).mockResolvedValue({
      data: mockBondingCurveData,
      executable: false,
      lamports: 1000000,
      owner: PUMPFUN_CONSTANTS.PROGRAM_ID,
      rentEpoch: 0,
    });

    const tokenMint = Keypair.generate().publicKey;
    
    const smallQuote = await client.getQuote({
      inputMint: SOL_MINT,
      outputMint: tokenMint,
      amount: 100_000_000, // 0.1 SOL
      slippageBps: 100,
    });

    const largeQuote = await client.getQuote({
      inputMint: SOL_MINT,
      outputMint: tokenMint,
      amount: 10_000_000_000, // 10 SOL
      slippageBps: 100,
    });

    expect(largeQuote.priceImpactPct).toBeGreaterThan(smallQuote.priceImpactPct);
  });
});

describe('PumpFun constants', () => {
  it('should have correct program ID', () => {
    expect(PUMPFUN_CONSTANTS.PROGRAM_ID.toString()).toBe(
      '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'
    );
  });

  it('should have 6 decimals for tokens', () => {
    expect(PUMPFUN_CONSTANTS.TOKEN_DECIMALS).toBe(6);
  });
});

// ============ Helper Functions ============

/**
 * Create mock bonding curve account data
 */
function createMockBondingCurveData(params: {
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  complete: boolean;
}): Buffer {
  // Anchor account layout:
  // 8 bytes discriminator
  // 8 bytes virtual_token_reserves
  // 8 bytes virtual_sol_reserves
  // 8 bytes real_token_reserves
  // 8 bytes real_sol_reserves
  // 8 bytes token_total_supply (we'll set to virtual_token_reserves)
  // 1 byte complete flag
  
  const buffer = Buffer.alloc(8 + 8 + 8 + 8 + 8 + 8 + 1);
  
  // Skip discriminator (first 8 bytes)
  buffer.writeBigUInt64LE(params.virtualTokenReserves, 8);
  buffer.writeBigUInt64LE(params.virtualSolReserves, 16);
  buffer.writeBigUInt64LE(params.realTokenReserves, 24);
  buffer.writeBigUInt64LE(params.realSolReserves, 32);
  buffer.writeBigUInt64LE(params.virtualTokenReserves, 40); // tokenTotalSupply
  buffer.writeUInt8(params.complete ? 1 : 0, 48);
  
  return buffer;
}
