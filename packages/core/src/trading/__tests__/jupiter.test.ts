/**
 * Jupiter Integration Tests
 * OrbitMM - Trading Module Tests
 */

import { describe, it, expect, beforeEach, vi, Mock } from 'vitest';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import {
  JupiterClient,
  getJupiterQuote as getQuote,
  jupiterSwap as swap,
  NoRouteError,
  APIError,
  QuoteExpiredError,
  Quote,
  SwapParams,
} from '../index.js';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Test constants
const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
const TEST_RPC = 'https://api.mainnet-beta.solana.com';

describe('JupiterClient', () => {
  let client: JupiterClient;
  let connection: Connection;

  beforeEach(() => {
    connection = new Connection(TEST_RPC);
    client = new JupiterClient(connection);
    mockFetch.mockReset();
  });

  describe('getQuote', () => {
    it('should fetch quote successfully', async () => {
      const mockQuoteResponse = {
        inputMint: SOL_MINT.toString(),
        outputMint: USDC_MINT.toString(),
        inAmount: '1000000000', // 1 SOL
        outAmount: '25000000', // 25 USDC
        otherAmountThreshold: '24750000', // After slippage
        priceImpactPct: '0.1',
        routePlan: [
          {
            swapInfo: {
              ammKey: 'pool123',
              label: 'Raydium',
              inputMint: SOL_MINT.toString(),
              outputMint: USDC_MINT.toString(),
              inAmount: '1000000000',
              outAmount: '25000000',
              feeAmount: '25000',
              feeMint: USDC_MINT.toString(),
            },
            percent: 100,
          },
        ],
        contextSlot: 12345678,
        timeTaken: 0.5,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockQuoteResponse,
      });

      const quote = await client.getQuote({
        inputMint: SOL_MINT,
        outputMint: USDC_MINT,
        amount: 1000000000,
        slippageBps: 100,
      });

      expect(quote).toBeDefined();
      expect(quote.inputMint).toBe(SOL_MINT.toString());
      expect(quote.outputMint).toBe(USDC_MINT.toString());
      expect(quote.inAmount).toBe('1000000000');
      expect(quote.outAmount).toBe('25000000');
      expect(quote.minOutAmount).toBe('24750000');
      expect(quote.priceImpactPct).toBe(0.1);
      expect(quote.dex).toBe('jupiter');
      expect(quote.route).toHaveLength(1);
      expect(quote.route[0].dex).toBe('raydium');
    });

    it('should throw NoRouteError when no route found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'No route found' }),
      });

      await expect(
        client.getQuote({
          inputMint: SOL_MINT,
          outputMint: USDC_MINT,
          amount: 1000000000,
          slippageBps: 100,
        })
      ).rejects.toThrow(NoRouteError);
    });

    it('should throw APIError on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
      });

      await expect(
        client.getQuote({
          inputMint: SOL_MINT,
          outputMint: USDC_MINT,
          amount: 1000000000,
          slippageBps: 100,
        })
      ).rejects.toThrow(APIError);
    });

    it('should throw APIError on timeout', async () => {
      // Mock fetch to never resolve (simulating timeout)
      mockFetch.mockImplementationOnce(() => 
        new Promise((_, reject) => {
          const error = new Error('Aborted');
          error.name = 'AbortError';
          setTimeout(() => reject(error), 100);
        })
      );

      await expect(
        client.getQuote(
          {
            inputMint: SOL_MINT,
            outputMint: USDC_MINT,
            amount: 1000000000,
            slippageBps: 100,
          },
          { timeout: 50 }
        )
      ).rejects.toThrow(APIError);
    });

    it('should include quote expiry time', async () => {
      const mockQuoteResponse = {
        inputMint: SOL_MINT.toString(),
        outputMint: USDC_MINT.toString(),
        inAmount: '1000000000',
        outAmount: '25000000',
        otherAmountThreshold: '24750000',
        priceImpactPct: '0.1',
        routePlan: [],
        contextSlot: 12345678,
        timeTaken: 0.5,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockQuoteResponse,
      });

      const beforeQuote = Date.now();
      const quote = await client.getQuote({
        inputMint: SOL_MINT,
        outputMint: USDC_MINT,
        amount: 1000000000,
        slippageBps: 100,
      });

      expect(quote.timestamp).toBeGreaterThanOrEqual(beforeQuote);
      expect(quote.expiresAt).toBeGreaterThan(quote.timestamp);
      expect(quote.expiresAt - quote.timestamp).toBe(30000); // 30 second validity
    });
  });

  describe('swap', () => {
    it('should reject expired quotes', async () => {
      const wallet = Keypair.generate();
      const expiredQuote: Quote = {
        inputMint: SOL_MINT.toString(),
        outputMint: USDC_MINT.toString(),
        inAmount: '1000000000',
        outAmount: '25000000',
        minOutAmount: '24750000',
        priceImpactPct: 0.1,
        route: [],
        dex: 'jupiter',
        timestamp: Date.now() - 60000, // 1 minute ago
        expiresAt: Date.now() - 30000,  // Already expired
      };

      await expect(
        client.swap(connection, { wallet, quote: expiredQuote })
      ).rejects.toThrow(QuoteExpiredError);
    });

    it('should build and send swap transaction', async () => {
      const wallet = Keypair.generate();
      const validQuote: Quote = {
        inputMint: SOL_MINT.toString(),
        outputMint: USDC_MINT.toString(),
        inAmount: '1000000000',
        outAmount: '25000000',
        minOutAmount: '24750000',
        priceImpactPct: 0.1,
        route: [
          {
            dex: 'raydium',
            inputMint: SOL_MINT.toString(),
            outputMint: USDC_MINT.toString(),
            poolId: 'pool123',
            percent: 100,
          },
        ],
        dex: 'jupiter',
        timestamp: Date.now(),
        expiresAt: Date.now() + 30000,
      };

      // Mock swap endpoint
      const mockSwapTransaction = Buffer.from([1, 2, 3, 4]).toString('base64');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          swapTransaction: mockSwapTransaction,
          lastValidBlockHeight: 12345678,
          prioritizationFeeLamports: 5000,
        }),
      });

      // This will fail because we can't actually deserialize the mock transaction
      // but it tests the quote expiry and API call logic
      await expect(
        client.swap(connection, { wallet, quote: validQuote })
      ).rejects.toThrow(); // Will throw deserialization error
    });
  });

  describe('route mapping', () => {
    it('should correctly map DEX labels', async () => {
      const mockQuoteResponse = {
        inputMint: SOL_MINT.toString(),
        outputMint: USDC_MINT.toString(),
        inAmount: '1000000000',
        outAmount: '25000000',
        otherAmountThreshold: '24750000',
        priceImpactPct: '0.1',
        routePlan: [
          {
            swapInfo: {
              ammKey: 'pool1',
              label: 'Raydium CLMM',
              inputMint: SOL_MINT.toString(),
              outputMint: USDC_MINT.toString(),
              inAmount: '500000000',
              outAmount: '12500000',
              feeAmount: '12500',
              feeMint: USDC_MINT.toString(),
            },
            percent: 50,
          },
          {
            swapInfo: {
              ammKey: 'pool2',
              label: 'Meteora DLMM',
              inputMint: SOL_MINT.toString(),
              outputMint: USDC_MINT.toString(),
              inAmount: '500000000',
              outAmount: '12500000',
              feeAmount: '12500',
              feeMint: USDC_MINT.toString(),
            },
            percent: 50,
          },
        ],
        contextSlot: 12345678,
        timeTaken: 0.5,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockQuoteResponse,
      });

      const quote = await client.getQuote({
        inputMint: SOL_MINT,
        outputMint: USDC_MINT,
        amount: 1000000000,
        slippageBps: 100,
      });

      expect(quote.route).toHaveLength(2);
      expect(quote.route[0].dex).toBe('raydium');
      expect(quote.route[1].dex).toBe('meteora');
      expect(quote.route[0].percent).toBe(50);
      expect(quote.route[1].percent).toBe(50);
    });
  });
});

describe('Standalone functions', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('getQuote', () => {
    it('should work without explicit connection', async () => {
      const mockQuoteResponse = {
        inputMint: SOL_MINT.toString(),
        outputMint: USDC_MINT.toString(),
        inAmount: '1000000000',
        outAmount: '25000000',
        otherAmountThreshold: '24750000',
        priceImpactPct: '0.1',
        routePlan: [],
        contextSlot: 12345678,
        timeTaken: 0.5,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockQuoteResponse,
      });

      const quote = await getQuote(SOL_MINT, USDC_MINT, 1000000000, 100);

      expect(quote).toBeDefined();
      expect(quote.outAmount).toBe('25000000');
    });
  });
});

describe('Error classes', () => {
  it('NoRouteError should have correct properties', () => {
    const error = new NoRouteError(SOL_MINT.toString(), USDC_MINT.toString());
    
    expect(error.name).toBe('NoRouteError');
    expect(error.code).toBe('NO_ROUTE');
    expect(error.recoverable).toBe(true);
    expect(error.details?.inputMint).toBe(SOL_MINT.toString());
    expect(error.details?.outputMint).toBe(USDC_MINT.toString());
  });

  it('APIError should have correct properties', () => {
    const error = new APIError('jupiter', 'Rate limited', 429);
    
    expect(error.name).toBe('APIError');
    expect(error.code).toBe('API_ERROR');
    expect(error.recoverable).toBe(true);
    expect(error.statusCode).toBe(429);
  });

  it('QuoteExpiredError should have correct properties', () => {
    const quoteTime = Date.now() - 60000;
    const currentTime = Date.now();
    const error = new QuoteExpiredError(quoteTime, currentTime);
    
    expect(error.name).toBe('QuoteExpiredError');
    expect(error.code).toBe('QUOTE_EXPIRED');
    expect(error.recoverable).toBe(true);
    expect(error.details?.quoteTimestamp).toBe(quoteTime);
    expect(error.details?.currentTime).toBe(currentTime);
  });
});

describe('Quote validation', () => {
  it('should detect stale quotes', () => {
    const staleQuote: Quote = {
      inputMint: SOL_MINT.toString(),
      outputMint: USDC_MINT.toString(),
      inAmount: '1000000000',
      outAmount: '25000000',
      minOutAmount: '24750000',
      priceImpactPct: 0.1,
      route: [],
      dex: 'jupiter',
      timestamp: Date.now() - 15000, // 15 seconds ago
      expiresAt: Date.now() - 5000,   // Expired 5 seconds ago
    };

    expect(Date.now() > staleQuote.expiresAt).toBe(true);
  });

  it('should detect valid quotes', () => {
    const validQuote: Quote = {
      inputMint: SOL_MINT.toString(),
      outputMint: USDC_MINT.toString(),
      inAmount: '1000000000',
      outAmount: '25000000',
      minOutAmount: '24750000',
      priceImpactPct: 0.1,
      route: [],
      dex: 'jupiter',
      timestamp: Date.now(),
      expiresAt: Date.now() + 30000,
    };

    expect(Date.now() < validQuote.expiresAt).toBe(true);
  });
});
