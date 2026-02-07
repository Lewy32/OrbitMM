/**
 * Meteora DLMM Integration Tests
 * OrbitMM - Trading Module Tests
 */

import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import {
  MeteoraClient,
  getQuote,
  getPools,
  getAllPools,
  NoRouteError,
  APIError,
  SwapTransactionError,
  METEORA_CONSTANTS,
  Quote,
} from '../index.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Test constants
const TEST_RPC = 'https://api.mainnet-beta.solana.com';
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const USDT_MINT = new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB');

// Example Meteora pool
const USDC_USDT_POOL_ADDRESS = 'ARwi1S4DaiTG5DX7S4M4ZsrXqpMD1MrTmbu9ue2tpmEq';

describe('MeteoraClient', () => {
  let client: MeteoraClient;
  let connection: Connection;

  beforeEach(() => {
    connection = {
      getAccountInfo: vi.fn(),
      getLatestBlockhash: vi.fn().mockResolvedValue({
        blockhash: 'test-blockhash',
        lastValidBlockHeight: 12345678,
      }),
      sendRawTransaction: vi.fn(),
      confirmTransaction: vi.fn(),
    } as unknown as Connection;
    
    client = new MeteoraClient(connection);
    mockFetch.mockReset();
  });

  describe('getQuote', () => {
    it('should fetch quote successfully', async () => {
      // Mock Meteora API response
      const mockPoolsResponse = [
        createMockPoolInfo({
          address: USDC_USDT_POOL_ADDRESS,
          mint_x: USDC_MINT.toString(),
          mint_y: USDT_MINT.toString(),
          reserve_x_amount: 1000000000000, // 1M USDC
          reserve_y_amount: 1000000000000, // 1M USDT
          bin_step: 1,
          base_fee_percentage: '0.1',
        }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockPoolsResponse,
      });

      const quote = await client.getQuote({
        inputMint: USDC_MINT,
        outputMint: USDT_MINT,
        amount: 1000000, // 1 USDC
        slippageBps: 50,
      });

      expect(quote).toBeDefined();
      expect(quote.dex).toBe('meteora');
      expect(quote.inputMint).toBe(USDC_MINT.toString());
      expect(quote.outputMint).toBe(USDT_MINT.toString());
      expect(BigInt(quote.outAmount)).toBeGreaterThan(0n);
    });

    it('should throw NoRouteError when no pool found', async () => {
      // Mock empty pool list
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      await expect(
        client.getQuote({
          inputMint: USDC_MINT,
          outputMint: Keypair.generate().publicKey,
          amount: 1000000,
          slippageBps: 50,
        })
      ).rejects.toThrow(NoRouteError);
    });

    it('should throw NoRouteError on HTTP error with no cached pools', async () => {
      // When API fails and cache is empty, NoRouteError is thrown
      // because we can't find a pool
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(
        client.getQuote({
          inputMint: USDC_MINT,
          outputMint: USDT_MINT,
          amount: 1000000,
          slippageBps: 50,
        })
      ).rejects.toThrow(NoRouteError);
    });

    it('should include route information', async () => {
      const mockPoolsResponse = [
        createMockPoolInfo({
          address: USDC_USDT_POOL_ADDRESS,
          mint_x: USDC_MINT.toString(),
          mint_y: USDT_MINT.toString(),
          reserve_x_amount: 1000000000000,
          reserve_y_amount: 1000000000000,
          bin_step: 1,
          base_fee_percentage: '0.1',
        }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockPoolsResponse,
      });

      const quote = await client.getQuote({
        inputMint: USDC_MINT,
        outputMint: USDT_MINT,
        amount: 1000000,
        slippageBps: 50,
      });

      expect(quote.route).toHaveLength(1);
      expect(quote.route[0].dex).toBe('meteora');
      expect(quote.route[0].poolId).toBe(USDC_USDT_POOL_ADDRESS);
      expect(quote.route[0].percent).toBe(100);
    });

    it('should apply slippage correctly', async () => {
      const mockPoolsResponse = [
        createMockPoolInfo({
          address: USDC_USDT_POOL_ADDRESS,
          mint_x: USDC_MINT.toString(),
          mint_y: USDT_MINT.toString(),
          reserve_x_amount: 1000000000000,
          reserve_y_amount: 1000000000000,
          bin_step: 1,
          base_fee_percentage: '0.1',
        }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockPoolsResponse,
      });

      const quote = await client.getQuote({
        inputMint: USDC_MINT,
        outputMint: USDT_MINT,
        amount: 1000000,
        slippageBps: 100, // 1% slippage
      });

      const outAmount = BigInt(quote.outAmount);
      const minOutAmount = BigInt(quote.minOutAmount);
      
      // minOutAmount should be ~99% of outAmount (1% slippage)
      const expectedMin = (outAmount * 99n) / 100n;
      expect(minOutAmount).toBeLessThanOrEqual(outAmount);
      expect(minOutAmount).toBeGreaterThanOrEqual(expectedMin - 1n); // Allow rounding
    });
  });

  describe('getPools', () => {
    it('should return pools for a token', async () => {
      const mockPoolsResponse = [
        createMockPoolInfo({
          address: USDC_USDT_POOL_ADDRESS,
          mint_x: USDC_MINT.toString(),
          mint_y: USDT_MINT.toString(),
          liquidity: '1000000',
          trade_volume_24h: 500000,
        }),
        createMockPoolInfo({
          address: 'pool2-address',
          mint_x: USDC_MINT.toString(),
          mint_y: SOL_MINT.toString(),
          liquidity: '2000000',
          trade_volume_24h: 800000,
        }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockPoolsResponse,
      });

      const pools = await client.getPools(USDC_MINT);

      expect(pools).toHaveLength(2);
      expect(pools.every(p => p.dex === 'meteora')).toBe(true);
      expect(pools[0].tokenA.mint).toBe(USDC_MINT.toString());
    });

    it('should return empty array for tokens with no pools', async () => {
      const mockPoolsResponse = [
        createMockPoolInfo({
          address: USDC_USDT_POOL_ADDRESS,
          mint_x: USDC_MINT.toString(),
          mint_y: USDT_MINT.toString(),
        }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockPoolsResponse,
      });

      const randomToken = Keypair.generate().publicKey;
      const pools = await client.getPools(randomToken);

      expect(pools).toHaveLength(0);
    });

    it('should filter out hidden pools', async () => {
      const mockPoolsResponse = [
        createMockPoolInfo({
          address: USDC_USDT_POOL_ADDRESS,
          mint_x: USDC_MINT.toString(),
          mint_y: USDT_MINT.toString(),
          hide: false,
        }),
        createMockPoolInfo({
          address: 'hidden-pool',
          mint_x: USDC_MINT.toString(),
          mint_y: SOL_MINT.toString(),
          hide: true, // Hidden!
        }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockPoolsResponse,
      });

      const pools = await client.getPools(USDC_MINT);

      // Only non-hidden pool should be returned
      expect(pools).toHaveLength(1);
      expect(pools[0].id).toBe(USDC_USDT_POOL_ADDRESS);
    });
  });

  describe('getAllPools', () => {
    it('should return all pools', async () => {
      const mockPoolsResponse = [
        createMockPoolInfo({ address: 'pool1' }),
        createMockPoolInfo({ address: 'pool2' }),
        createMockPoolInfo({ address: 'pool3' }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockPoolsResponse,
      });

      const pools = await client.getAllPools();

      expect(pools).toHaveLength(3);
    });
  });

  describe('swap direction detection', () => {
    it('should correctly detect X to Y swap', async () => {
      const mockPoolsResponse = [
        createMockPoolInfo({
          address: USDC_USDT_POOL_ADDRESS,
          mint_x: USDC_MINT.toString(),
          mint_y: USDT_MINT.toString(),
          reserve_x_amount: 1000000000000,
          reserve_y_amount: 1000000000000,
          base_fee_percentage: '0.1',
        }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockPoolsResponse,
      });

      // Swap USDC (X) for USDT (Y)
      const quote = await client.getQuote({
        inputMint: USDC_MINT,
        outputMint: USDT_MINT,
        amount: 1000000,
        slippageBps: 50,
      });

      expect(quote.inputMint).toBe(USDC_MINT.toString());
      expect(quote.outputMint).toBe(USDT_MINT.toString());
    });

    it('should correctly detect Y to X swap', async () => {
      const mockPoolsResponse = [
        createMockPoolInfo({
          address: USDC_USDT_POOL_ADDRESS,
          mint_x: USDC_MINT.toString(),
          mint_y: USDT_MINT.toString(),
          reserve_x_amount: 1000000000000,
          reserve_y_amount: 1000000000000,
          base_fee_percentage: '0.1',
        }),
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockPoolsResponse,
      });

      // Swap USDT (Y) for USDC (X)
      const quote = await client.getQuote({
        inputMint: USDT_MINT,
        outputMint: USDC_MINT,
        amount: 1000000,
        slippageBps: 50,
      });

      expect(quote.inputMint).toBe(USDT_MINT.toString());
      expect(quote.outputMint).toBe(USDC_MINT.toString());
    });
  });

  describe('pool cache', () => {
    it('should cache pool data', async () => {
      const mockPoolsResponse = [
        createMockPoolInfo({
          address: USDC_USDT_POOL_ADDRESS,
          mint_x: USDC_MINT.toString(),
          mint_y: USDT_MINT.toString(),
        }),
      ];

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => mockPoolsResponse,
      });

      // First call
      await client.getPools(USDC_MINT);
      
      // Second call should use cache
      await client.getPools(USDC_MINT);

      // Fetch should only be called once due to caching
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});

describe('Meteora quote math', () => {
  let client: MeteoraClient;
  let connection: Connection;

  beforeEach(() => {
    connection = {} as Connection;
    client = new MeteoraClient(connection);
    mockFetch.mockReset();
  });

  it('should calculate correct output with fees', async () => {
    const mockPoolsResponse = [
      createMockPoolInfo({
        address: USDC_USDT_POOL_ADDRESS,
        mint_x: USDC_MINT.toString(),
        mint_y: USDT_MINT.toString(),
        reserve_x_amount: 1000000000000, // 1M USDC
        reserve_y_amount: 1000000000000, // 1M USDT
        base_fee_percentage: '0.25', // 0.25% fee
        bin_step: 1,
      }),
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockPoolsResponse,
    });

    const quote = await client.getQuote({
      inputMint: USDC_MINT,
      outputMint: USDT_MINT,
      amount: 1000000000, // 1000 USDC
      slippageBps: 50,
    });

    // Output should be less than input due to fees and price impact
    expect(BigInt(quote.outAmount)).toBeLessThan(BigInt(quote.inAmount));
    expect(BigInt(quote.outAmount)).toBeGreaterThan(0n);
  });

  it('should have higher price impact for larger trades', async () => {
    const mockPoolsResponse = [
      createMockPoolInfo({
        address: USDC_USDT_POOL_ADDRESS,
        mint_x: USDC_MINT.toString(),
        mint_y: USDT_MINT.toString(),
        reserve_x_amount: 1000000000000,
        reserve_y_amount: 1000000000000,
        base_fee_percentage: '0.1',
        bin_step: 1,
      }),
    ];

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mockPoolsResponse,
    });

    const smallQuote = await client.getQuote({
      inputMint: USDC_MINT,
      outputMint: USDT_MINT,
      amount: 1000000, // 1 USDC
      slippageBps: 50,
    });

    // Reset cache to force fresh quote
    client = new MeteoraClient(connection);
    
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => mockPoolsResponse,
    });

    const largeQuote = await client.getQuote({
      inputMint: USDC_MINT,
      outputMint: USDT_MINT,
      amount: 100000000000, // 100K USDC
      slippageBps: 50,
    });

    expect(largeQuote.priceImpactPct).toBeGreaterThan(smallQuote.priceImpactPct);
  });
});

describe('Meteora constants', () => {
  it('should have correct program ID', () => {
    expect(METEORA_CONSTANTS.PROGRAM_ID.toString()).toBe(
      'LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo'
    );
  });

  it('should have correct API URL', () => {
    expect(METEORA_CONSTANTS.API_URL).toBe('https://dlmm-api.meteora.ag');
  });
});

describe('Error handling', () => {
  let client: MeteoraClient;
  let connection: Connection;

  beforeEach(() => {
    connection = {} as Connection;
    client = new MeteoraClient(connection);
    mockFetch.mockReset();
  });

  it('should handle network errors gracefully', async () => {
    // When network fails and cache is empty, NoRouteError is thrown
    // because the client uses stale cache (empty) and can't find a pool
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    await expect(
      client.getQuote({
        inputMint: USDC_MINT,
        outputMint: USDT_MINT,
        amount: 1000000,
        slippageBps: 50,
      })
    ).rejects.toThrow(NoRouteError);
  });

  it('should handle malformed API responses', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => 'not an array',
    });

    await expect(
      client.getQuote({
        inputMint: USDC_MINT,
        outputMint: USDT_MINT,
        amount: 1000000,
        slippageBps: 50,
      })
    ).rejects.toThrow();
  });
});

// ============ Helper Functions ============

/**
 * Create mock Meteora pool info
 */
function createMockPoolInfo(
  overrides: Partial<{
    address: string;
    name: string;
    mint_x: string;
    mint_y: string;
    reserve_x: string;
    reserve_y: string;
    reserve_x_amount: number;
    reserve_y_amount: number;
    bin_step: number;
    base_fee_percentage: string;
    max_fee_percentage: string;
    protocol_fee_percentage: string;
    liquidity: string;
    reward_mint_x: string;
    reward_mint_y: string;
    fees_24h: number;
    today_fees: number;
    trade_volume_24h: number;
    cumulative_trade_volume: string;
    cumulative_fee_volume: string;
    current_price: number;
    apr: number;
    apy: number;
    hide: boolean;
  }> = {}
) {
  return {
    address: overrides.address ?? 'test-pool-address',
    name: overrides.name ?? 'Test Pool',
    mint_x: overrides.mint_x ?? USDC_MINT.toString(),
    mint_y: overrides.mint_y ?? USDT_MINT.toString(),
    reserve_x: overrides.reserve_x ?? '1000000000000',
    reserve_y: overrides.reserve_y ?? '1000000000000',
    reserve_x_amount: overrides.reserve_x_amount ?? 1000000000000,
    reserve_y_amount: overrides.reserve_y_amount ?? 1000000000000,
    bin_step: overrides.bin_step ?? 1,
    base_fee_percentage: overrides.base_fee_percentage ?? '0.1',
    max_fee_percentage: overrides.max_fee_percentage ?? '1.0',
    protocol_fee_percentage: overrides.protocol_fee_percentage ?? '0.05',
    liquidity: overrides.liquidity ?? '1000000',
    reward_mint_x: overrides.reward_mint_x ?? '',
    reward_mint_y: overrides.reward_mint_y ?? '',
    fees_24h: overrides.fees_24h ?? 1000,
    today_fees: overrides.today_fees ?? 500,
    trade_volume_24h: overrides.trade_volume_24h ?? 100000,
    cumulative_trade_volume: overrides.cumulative_trade_volume ?? '10000000',
    cumulative_fee_volume: overrides.cumulative_fee_volume ?? '50000',
    current_price: overrides.current_price ?? 1.0,
    apr: overrides.apr ?? 10.5,
    apy: overrides.apy ?? 11.0,
    hide: overrides.hide ?? false,
  };
}
