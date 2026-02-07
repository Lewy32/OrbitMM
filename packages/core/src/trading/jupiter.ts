/**
 * Jupiter V6 API Integration
 * OrbitMM - Jupiter DEX Aggregator Client
 */

import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
  TransactionMessage,
  AddressLookupTableAccount,
} from '@solana/web3.js';

import {
  Quote,
  QuoteParams,
  SwapParams,
  SwapResult,
  Pool,
  DEX,
  RouteStep,
  NoRouteError,
  APIError,
  QuoteExpiredError,
  SwapTransactionError,
  QuoteRequestOptions,
} from './types.js';

// ============ Jupiter API Types ============

interface JupiterQuoteResponse {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: string;
  routePlan: JupiterRoutePlan[];
  contextSlot: number;
  timeTaken: number;
}

interface JupiterRoutePlan {
  swapInfo: {
    ammKey: string;
    label: string;
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    feeAmount: string;
    feeMint: string;
  };
  percent: number;
}

interface JupiterSwapResponse {
  swapTransaction: string;
  lastValidBlockHeight: number;
  prioritizationFeeLamports: number;
}

// ============ Constants ============

const JUPITER_API_URL = 'https://quote-api.jup.ag/v6';
const DEFAULT_QUOTE_TIMEOUT = 3000;
const QUOTE_VALIDITY_MS = 30000; // 30 seconds

// ============ Jupiter Client ============

export class JupiterClient {
  private readonly apiUrl: string;
  
  constructor(
    private readonly connection: Connection,
    apiUrl: string = JUPITER_API_URL
  ) {
    this.apiUrl = apiUrl;
  }

  /**
   * Get swap quote from Jupiter aggregator.
   * 
   * @throws {NoRouteError} If no route found
   * @throws {APIError} If Jupiter API fails
   */
  async getQuote(
    params: QuoteParams,
    options: QuoteRequestOptions = {}
  ): Promise<Quote> {
    const timeout = options.timeout ?? DEFAULT_QUOTE_TIMEOUT;
    
    const url = new URL(`${this.apiUrl}/quote`);
    url.searchParams.set('inputMint', params.inputMint.toString());
    url.searchParams.set('outputMint', params.outputMint.toString());
    url.searchParams.set('amount', params.amount.toString());
    url.searchParams.set('slippageBps', params.slippageBps.toString());
    url.searchParams.set('onlyDirectRoutes', 'false');
    
    if (options.excludeDexes && options.excludeDexes.length > 0) {
      url.searchParams.set('excludeDexes', options.excludeDexes.join(','));
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 400) {
          const error = await response.json().catch(() => ({})) as { error?: string };
          if (error.error?.includes('No route')) {
            throw new NoRouteError(
              params.inputMint.toString(),
              params.outputMint.toString()
            );
          }
        }
        throw new APIError('jupiter', `HTTP ${response.status}`, response.status);
      }

      const data = await response.json() as JupiterQuoteResponse;
      
      if (!data.outAmount || data.outAmount === '0') {
        throw new NoRouteError(
          params.inputMint.toString(),
          params.outputMint.toString()
        );
      }

      const now = Date.now();
      
      return {
        inputMint: data.inputMint,
        outputMint: data.outputMint,
        inAmount: data.inAmount,
        outAmount: data.outAmount,
        minOutAmount: data.otherAmountThreshold,
        priceImpactPct: parseFloat(data.priceImpactPct),
        route: this.mapRoutePlan(data.routePlan),
        dex: 'jupiter',
        timestamp: now,
        expiresAt: now + QUOTE_VALIDITY_MS,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof NoRouteError || error instanceof APIError) {
        throw error;
      }
      
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new APIError('jupiter', 'Request timeout');
        }
        throw new APIError('jupiter', error.message);
      }
      
      throw new APIError('jupiter', 'Unknown error');
    }
  }

  /**
   * Execute swap from quote.
   * 
   * @throws {QuoteExpiredError} If quote is stale
   * @throws {SwapTransactionError} If transaction fails
   */
  async swap(
    connection: Connection,
    params: SwapParams
  ): Promise<SwapResult> {
    const { wallet, quote, priorityFee } = params;
    const now = Date.now();

    // Check quote validity
    if (now > quote.expiresAt) {
      throw new QuoteExpiredError(quote.expiresAt, now);
    }

    // Build swap request
    const swapRequestBody = {
      quoteResponse: {
        inputMint: quote.inputMint,
        outputMint: quote.outputMint,
        inAmount: quote.inAmount,
        outAmount: quote.outAmount,
        otherAmountThreshold: quote.minOutAmount,
        priceImpactPct: quote.priceImpactPct.toString(),
        routePlan: this.unmapRoutePlan(quote.route),
      },
      userPublicKey: wallet.publicKey.toString(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: priorityFee === 'auto' ? 'auto' : (priorityFee ?? 'auto'),
    };

    // Get swap transaction
    const swapResponse = await fetch(`${this.apiUrl}/swap`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(swapRequestBody),
    });

    if (!swapResponse.ok) {
      const error = await swapResponse.json().catch(() => ({})) as { error?: string };
      throw new SwapTransactionError(
        `Failed to get swap transaction: ${error.error || swapResponse.statusText}`
      );
    }

    const swapData = await swapResponse.json() as JupiterSwapResponse;

    // Deserialize transaction
    const swapTransactionBuf = Buffer.from(swapData.swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(swapTransactionBuf);

    // Sign transaction
    transaction.sign([wallet]);

    // Send and confirm transaction
    const startTime = Date.now();
    
    try {
      const signature = await connection.sendTransaction(transaction, {
        skipPreflight: false,
        maxRetries: 2,
      });

      // Wait for confirmation
      const confirmation = await connection.confirmTransaction(
        {
          signature,
          lastValidBlockHeight: swapData.lastValidBlockHeight,
          blockhash: transaction.message.recentBlockhash,
        },
        'confirmed'
      );

      if (confirmation.value.err) {
        throw new SwapTransactionError(
          `Transaction failed: ${JSON.stringify(confirmation.value.err)}`,
          signature
        );
      }

      // Get transaction details for accurate amounts
      const txDetails = await connection.getTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });

      return {
        signature,
        inputAmount: parseInt(quote.inAmount),
        outputAmount: parseInt(quote.outAmount),
        fee: swapData.prioritizationFeeLamports / 1e9,
        slot: txDetails?.slot ?? 0,
        timestamp: Date.now(),
      };
    } catch (error) {
      if (error instanceof SwapTransactionError) {
        throw error;
      }
      
      if (error instanceof Error) {
        throw new SwapTransactionError(error.message);
      }
      
      throw new SwapTransactionError('Unknown transaction error');
    }
  }

  /**
   * Get available pools for a token via Jupiter.
   */
  async getPools(tokenMint: PublicKey): Promise<Pool[]> {
    try {
      const url = new URL(`${this.apiUrl}/tokens`);
      
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
      });

      if (!response.ok) {
        throw new APIError('jupiter', `HTTP ${response.status}`, response.status);
      }

      // Jupiter returns token list - we'd need to fetch pool data separately
      // For now, return empty array as pool discovery is secondary
      // In production, integrate with Jupiter's route info
      return [];
    } catch (error) {
      if (error instanceof APIError) {
        throw error;
      }
      throw new APIError('jupiter', error instanceof Error ? error.message : 'Unknown error');
    }
  }

  /**
   * Map Jupiter route plan to our RouteStep format
   */
  private mapRoutePlan(routePlan: JupiterRoutePlan[]): RouteStep[] {
    return routePlan.map(step => ({
      dex: this.mapDexLabel(step.swapInfo.label),
      inputMint: step.swapInfo.inputMint,
      outputMint: step.swapInfo.outputMint,
      poolId: step.swapInfo.ammKey,
      percent: step.percent,
    }));
  }

  /**
   * Convert our RouteStep format back to Jupiter format for swap request
   */
  private unmapRoutePlan(route: RouteStep[]): JupiterRoutePlan[] {
    return route.map(step => ({
      swapInfo: {
        ammKey: step.poolId,
        label: step.dex,
        inputMint: step.inputMint,
        outputMint: step.outputMint,
        inAmount: '0',
        outAmount: '0',
        feeAmount: '0',
        feeMint: step.inputMint,
      },
      percent: step.percent,
    }));
  }

  /**
   * Map Jupiter DEX labels to our DEX type
   */
  private mapDexLabel(label: string): DEX {
    const lowerLabel = label.toLowerCase();
    
    if (lowerLabel.includes('raydium')) return 'raydium';
    if (lowerLabel.includes('meteora')) return 'meteora';
    if (lowerLabel.includes('pump')) return 'pumpfun';
    
    // Default to jupiter for unknown/aggregate routes
    return 'jupiter';
  }
}

// ============ Standalone Functions ============

let defaultClient: JupiterClient | null = null;

/**
 * Get or create default Jupiter client
 */
function getDefaultClient(connection: Connection): JupiterClient {
  if (!defaultClient) {
    defaultClient = new JupiterClient(connection);
  }
  return defaultClient;
}

/**
 * Get swap quote from Jupiter aggregator.
 * 
 * @throws {NoRouteError} If no route found
 * @throws {APIError} If Jupiter API fails
 */
export async function getQuote(
  inputMint: PublicKey,
  outputMint: PublicKey,
  amount: number,
  slippageBps: number,
  options: QuoteRequestOptions & { connection?: Connection } = {}
): Promise<Quote> {
  const connection = options.connection ?? new Connection('https://api.mainnet-beta.solana.com');
  const client = getDefaultClient(connection);
  
  return client.getQuote(
    { inputMint, outputMint, amount, slippageBps },
    options
  );
}

/**
 * Execute swap from quote.
 * 
 * @throws {QuoteExpiredError} If quote is stale
 * @throws {SwapTransactionError} If transaction fails
 */
export async function swap(
  connection: Connection,
  params: SwapParams
): Promise<SwapResult> {
  const client = getDefaultClient(connection);
  return client.swap(connection, params);
}

/**
 * Get available pools for a token.
 */
export async function getPools(
  connection: Connection,
  tokenMint: PublicKey
): Promise<Pool[]> {
  const client = getDefaultClient(connection);
  return client.getPools(tokenMint);
}
