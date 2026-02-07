/**
 * PumpFun Bonding Curve Integration
 * OrbitMM - Direct PumpFun DEX Integration
 * 
 * PumpFun uses a bonding curve model where:
 * - Tokens start on PumpFun's bonding curve
 * - When market cap reaches ~$69k, liquidity migrates to Raydium
 * - Price is determined by the bonding curve formula
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js';
import {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';

import {
  Quote,
  QuoteParams,
  SwapParams,
  SwapResult,
  Pool,
  DEX,
  NoRouteError,
  APIError,
  SwapTransactionError,
  QuoteRequestOptions,
} from './types.js';

// ============ PumpFun Constants ============

const PUMPFUN_PROGRAM_ID = new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
const PUMPFUN_FEE_ACCOUNT = new PublicKey('CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM');
const QUOTE_VALIDITY_MS = 30000;

// PumpFun tokens use 6 decimals
const PUMPFUN_TOKEN_DECIMALS = 6;

// Migration threshold in SOL (approximately $69k market cap)
const MIGRATION_THRESHOLD_SOL = 85_000_000_000n; // ~85 SOL in bonding curve

// Bonding curve constants (approximated from PumpFun's model)
const INITIAL_VIRTUAL_TOKEN_RESERVES = BigInt(1_073_000_000_000_000); // ~1.073B tokens
const INITIAL_VIRTUAL_SOL_RESERVES = BigInt(30_000_000_000); // 30 SOL

// Instruction discriminators (Anchor framework)
const BUY_DISCRIMINATOR = Buffer.from([102, 6, 61, 18, 1, 218, 235, 234]); // "buy"
const SELL_DISCRIMINATOR = Buffer.from([51, 230, 133, 164, 1, 127, 131, 173]); // "sell"

// ============ PumpFun Types ============

interface BondingCurveState {
  virtualTokenReserves: bigint;
  virtualSolReserves: bigint;
  realTokenReserves: bigint;
  realSolReserves: bigint;
  tokenTotalSupply: bigint;
  complete: boolean; // True if migrated to Raydium
}

interface PumpFunQuoteResult {
  outAmount: string;
  minOutAmount: string;
  priceImpact: number;
  bondingCurveAddress: string;
}

// ============ PumpFun Client ============

export class PumpFunClient {
  constructor(
    private readonly connection: Connection
  ) {}

  /**
   * Get swap quote from PumpFun bonding curve.
   * 
   * @throws {NoRouteError} If token not found on PumpFun or already migrated
   * @throws {APIError} If bonding curve fetch fails
   */
  async getQuote(
    params: QuoteParams,
    options: QuoteRequestOptions = {}
  ): Promise<Quote> {
    try {
      // Determine which token is the PumpFun token (not SOL)
      const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
      const isBuying = params.inputMint.equals(SOL_MINT);
      const tokenMint = isBuying ? params.outputMint : params.inputMint;

      // Get bonding curve address
      const bondingCurve = this.getBondingCurveAddress(tokenMint);
      const associatedBondingCurve = await getAssociatedTokenAddress(
        tokenMint,
        bondingCurve,
        true
      );

      // Fetch bonding curve state
      const curveState = await this.getBondingCurveState(bondingCurve);

      if (!curveState) {
        throw new NoRouteError(
          params.inputMint.toString(),
          params.outputMint.toString()
        );
      }

      // Check if already migrated
      if (curveState.complete) {
        throw new NoRouteError(
          params.inputMint.toString(),
          params.outputMint.toString()
        );
      }

      // Calculate quote based on bonding curve math
      const quote = this.calculateBondingCurveQuote(
        params.amount,
        isBuying,
        curveState,
        params.slippageBps
      );

      const now = Date.now();

      return {
        inputMint: params.inputMint.toString(),
        outputMint: params.outputMint.toString(),
        inAmount: params.amount.toString(),
        outAmount: quote.outAmount,
        minOutAmount: quote.minOutAmount,
        priceImpactPct: quote.priceImpact,
        route: [{
          dex: 'pumpfun',
          inputMint: params.inputMint.toString(),
          outputMint: params.outputMint.toString(),
          poolId: bondingCurve.toString(),
          percent: 100,
        }],
        dex: 'pumpfun',
        timestamp: now,
        expiresAt: now + QUOTE_VALIDITY_MS,
      };
    } catch (error) {
      if (error instanceof NoRouteError) {
        throw error;
      }

      if (error instanceof Error) {
        throw new APIError('pumpfun', error.message);
      }

      throw new APIError('pumpfun', 'Unknown error');
    }
  }

  /**
   * Execute swap on PumpFun bonding curve.
   * 
   * @throws {SwapTransactionError} If transaction fails
   */
  async swap(
    connection: Connection,
    params: SwapParams
  ): Promise<SwapResult> {
    const { wallet, quote, priorityFee } = params;

    try {
      const SOL_MINT = 'So11111111111111111111111111111111111111112';
      const isBuying = quote.inputMint === SOL_MINT;
      const tokenMint = new PublicKey(isBuying ? quote.outputMint : quote.inputMint);

      // Get bonding curve addresses
      const bondingCurve = this.getBondingCurveAddress(tokenMint);
      const associatedBondingCurve = await getAssociatedTokenAddress(
        tokenMint,
        bondingCurve,
        true
      );

      // Build swap transaction
      const transaction = await this.buildSwapTransaction(
        wallet,
        tokenMint,
        bondingCurve,
        associatedBondingCurve,
        BigInt(quote.inAmount),
        BigInt(quote.minOutAmount),
        isBuying,
        priorityFee === 'auto' ? undefined : priorityFee
      );

      // Send and confirm
      const signature = await connection.sendRawTransaction(
        transaction.serialize(),
        {
          skipPreflight: false,
          maxRetries: 2,
        }
      );

      const confirmation = await connection.confirmTransaction(signature, 'confirmed');

      if (confirmation.value.err) {
        throw new SwapTransactionError(
          `Transaction failed: ${JSON.stringify(confirmation.value.err)}`,
          signature
        );
      }

      return {
        signature,
        inputAmount: parseInt(quote.inAmount),
        outputAmount: parseInt(quote.outAmount),
        fee: (priorityFee && priorityFee !== 'auto' ? priorityFee : 5000) / 1e9,
        slot: confirmation.context.slot,
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
   * Get available PumpFun pools for a token.
   */
  async getPools(tokenMint: PublicKey): Promise<Pool[]> {
    try {
      const bondingCurve = this.getBondingCurveAddress(tokenMint);
      const curveState = await this.getBondingCurveState(bondingCurve);

      if (!curveState || curveState.complete) {
        return []; // Token not on PumpFun or already migrated
      }

      // Calculate approximate liquidity in USD
      // Using rough SOL price estimation (would use oracle in production)
      const liquiditySol = Number(curveState.realSolReserves) / 1e9;
      const approximateSolPrice = 25; // Would fetch from oracle
      const liquidity = liquiditySol * approximateSolPrice;

      return [{
        id: bondingCurve.toString(),
        dex: 'pumpfun',
        tokenA: { mint: 'So11111111111111111111111111111111111111112', symbol: 'SOL' },
        tokenB: { mint: tokenMint.toString() },
        liquidity,
        volume24h: 0, // Would need to track separately
      }];
    } catch {
      return [];
    }
  }

  /**
   * Check if a token is still on PumpFun (not migrated).
   */
  async isOnPumpFun(tokenMint: PublicKey): Promise<boolean> {
    try {
      const bondingCurve = this.getBondingCurveAddress(tokenMint);
      const curveState = await this.getBondingCurveState(bondingCurve);

      return curveState !== null && !curveState.complete;
    } catch {
      return false;
    }
  }

  /**
   * Check if a token has migrated from PumpFun to Raydium.
   */
  async hasMigrated(tokenMint: PublicKey): Promise<boolean> {
    try {
      const bondingCurve = this.getBondingCurveAddress(tokenMint);
      const curveState = await this.getBondingCurveState(bondingCurve);

      if (!curveState) {
        return false; // Never was on PumpFun
      }

      return curveState.complete;
    } catch {
      return false;
    }
  }

  /**
   * Derive bonding curve address from token mint.
   */
  getBondingCurveAddress(mintAddress: PublicKey): PublicKey {
    const [bondingCurve] = PublicKey.findProgramAddressSync(
      [Buffer.from('bonding-curve'), mintAddress.toBytes()],
      PUMPFUN_PROGRAM_ID
    );
    return bondingCurve;
  }

  /**
   * Fetch bonding curve state from chain.
   */
  private async getBondingCurveState(
    bondingCurve: PublicKey
  ): Promise<BondingCurveState | null> {
    try {
      const accountInfo = await this.connection.getAccountInfo(bondingCurve);

      if (!accountInfo || !accountInfo.data) {
        return null;
      }

      // Parse bonding curve account data
      // Layout: 8 byte discriminator + fields
      const data = accountInfo.data;

      if (data.length < 49) {
        return null;
      }

      // Skip 8-byte anchor discriminator
      const offset = 8;

      return {
        virtualTokenReserves: data.readBigUInt64LE(offset),
        virtualSolReserves: data.readBigUInt64LE(offset + 8),
        realTokenReserves: data.readBigUInt64LE(offset + 16),
        realSolReserves: data.readBigUInt64LE(offset + 24),
        tokenTotalSupply: data.readBigUInt64LE(offset + 32),
        complete: data.readUInt8(offset + 40) === 1,
      };
    } catch {
      return null;
    }
  }

  /**
   * Calculate swap output using bonding curve math.
   * PumpFun uses constant product formula with virtual reserves.
   */
  private calculateBondingCurveQuote(
    inputAmount: number,
    isBuying: boolean,
    state: BondingCurveState,
    slippageBps: number
  ): { outAmount: string; minOutAmount: string; priceImpact: number } {
    const input = BigInt(inputAmount);
    
    // 1% fee on all trades
    const feeRate = BigInt(100);
    const feeDenominator = BigInt(10000);
    const inputAfterFee = input - (input * feeRate / feeDenominator);

    let outputAmount: bigint;
    let priceImpact: number;

    if (isBuying) {
      // Buying tokens with SOL
      // Formula: tokens_out = (virtual_token * sol_in) / (virtual_sol + sol_in)
      const numerator = state.virtualTokenReserves * inputAfterFee;
      const denominator = state.virtualSolReserves + inputAfterFee;
      outputAmount = numerator / denominator;

      // Calculate price impact
      const spotPrice = Number(state.virtualTokenReserves) / Number(state.virtualSolReserves);
      const executionPrice = Number(outputAmount) / Number(inputAfterFee);
      priceImpact = Math.abs((spotPrice - executionPrice) / spotPrice * 100);
    } else {
      // Selling tokens for SOL
      // Formula: sol_out = (virtual_sol * token_in) / (virtual_token + token_in)
      const numerator = state.virtualSolReserves * inputAfterFee;
      const denominator = state.virtualTokenReserves + inputAfterFee;
      outputAmount = numerator / denominator;

      // Calculate price impact
      const spotPrice = Number(state.virtualSolReserves) / Number(state.virtualTokenReserves);
      const executionPrice = Number(outputAmount) / Number(inputAfterFee);
      priceImpact = Math.abs((spotPrice - executionPrice) / spotPrice * 100);
    }

    // Apply slippage for minimum output
    const slippageMultiplier = BigInt(10000 - slippageBps);
    const minOutputAmount = (outputAmount * slippageMultiplier) / BigInt(10000);

    return {
      outAmount: outputAmount.toString(),
      minOutAmount: minOutputAmount.toString(),
      priceImpact,
    };
  }

  /**
   * Build swap transaction for PumpFun.
   */
  private async buildSwapTransaction(
    wallet: Keypair,
    tokenMint: PublicKey,
    bondingCurve: PublicKey,
    associatedBondingCurve: PublicKey,
    amountIn: bigint,
    minAmountOut: bigint,
    isBuying: boolean,
    priorityFee?: number
  ): Promise<Transaction> {
    const transaction = new Transaction();

    // Get user's token account
    const userTokenAccount = await getAssociatedTokenAddress(
      tokenMint,
      wallet.publicKey
    );

    // Check if user token account exists (needed for buying)
    if (isBuying) {
      const tokenAccountInfo = await this.connection.getAccountInfo(userTokenAccount);
      if (!tokenAccountInfo) {
        transaction.add(
          createAssociatedTokenAccountInstruction(
            wallet.publicKey,
            userTokenAccount,
            wallet.publicKey,
            tokenMint
          )
        );
      }
    }

    // Build swap instruction
    const swapInstruction = isBuying
      ? this.buildBuyInstruction(
          wallet.publicKey,
          tokenMint,
          bondingCurve,
          associatedBondingCurve,
          userTokenAccount,
          amountIn,
          minAmountOut
        )
      : this.buildSellInstruction(
          wallet.publicKey,
          tokenMint,
          bondingCurve,
          associatedBondingCurve,
          userTokenAccount,
          amountIn,
          minAmountOut
        );

    transaction.add(swapInstruction);

    // Get recent blockhash
    const { blockhash, lastValidBlockHeight } = 
      await this.connection.getLatestBlockhash('confirmed');

    transaction.recentBlockhash = blockhash;
    transaction.lastValidBlockHeight = lastValidBlockHeight;
    transaction.feePayer = wallet.publicKey;

    // Sign transaction
    transaction.sign(wallet);

    return transaction;
  }

  /**
   * Build PumpFun buy instruction.
   */
  private buildBuyInstruction(
    user: PublicKey,
    tokenMint: PublicKey,
    bondingCurve: PublicKey,
    associatedBondingCurve: PublicKey,
    userTokenAccount: PublicKey,
    solAmount: bigint,
    minTokensOut: bigint
  ): TransactionInstruction {
    // Instruction data: discriminator + token_amount + max_sol_cost
    const data = Buffer.alloc(8 + 8 + 8);
    BUY_DISCRIMINATOR.copy(data, 0);
    data.writeBigUInt64LE(minTokensOut, 8);
    data.writeBigUInt64LE(solAmount, 16);

    const keys = [
      // Global config (PDA)
      { pubkey: this.getGlobalConfigAddress(), isSigner: false, isWritable: false },
      // Fee recipient
      { pubkey: PUMPFUN_FEE_ACCOUNT, isSigner: false, isWritable: true },
      // Token mint
      { pubkey: tokenMint, isSigner: false, isWritable: false },
      // Bonding curve
      { pubkey: bondingCurve, isSigner: false, isWritable: true },
      // Associated bonding curve (token account)
      { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
      // User token account
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      // User (payer)
      { pubkey: user, isSigner: true, isWritable: true },
      // System program
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      // Token program
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      // Rent
      { pubkey: new PublicKey('SysvarRent111111111111111111111111111111111'), isSigner: false, isWritable: false },
      // Event authority (PDA)
      { pubkey: this.getEventAuthorityAddress(), isSigner: false, isWritable: false },
      // Program
      { pubkey: PUMPFUN_PROGRAM_ID, isSigner: false, isWritable: false },
    ];

    return new TransactionInstruction({
      keys,
      programId: PUMPFUN_PROGRAM_ID,
      data,
    });
  }

  /**
   * Build PumpFun sell instruction.
   */
  private buildSellInstruction(
    user: PublicKey,
    tokenMint: PublicKey,
    bondingCurve: PublicKey,
    associatedBondingCurve: PublicKey,
    userTokenAccount: PublicKey,
    tokenAmount: bigint,
    minSolOut: bigint
  ): TransactionInstruction {
    // Instruction data: discriminator + token_amount + min_sol_out
    const data = Buffer.alloc(8 + 8 + 8);
    SELL_DISCRIMINATOR.copy(data, 0);
    data.writeBigUInt64LE(tokenAmount, 8);
    data.writeBigUInt64LE(minSolOut, 16);

    const keys = [
      // Global config (PDA)
      { pubkey: this.getGlobalConfigAddress(), isSigner: false, isWritable: false },
      // Fee recipient
      { pubkey: PUMPFUN_FEE_ACCOUNT, isSigner: false, isWritable: true },
      // Token mint
      { pubkey: tokenMint, isSigner: false, isWritable: false },
      // Bonding curve
      { pubkey: bondingCurve, isSigner: false, isWritable: true },
      // Associated bonding curve (token account)
      { pubkey: associatedBondingCurve, isSigner: false, isWritable: true },
      // User token account
      { pubkey: userTokenAccount, isSigner: false, isWritable: true },
      // User (payer)
      { pubkey: user, isSigner: true, isWritable: true },
      // System program
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      // Associated token program
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      // Token program
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      // Event authority (PDA)
      { pubkey: this.getEventAuthorityAddress(), isSigner: false, isWritable: false },
      // Program
      { pubkey: PUMPFUN_PROGRAM_ID, isSigner: false, isWritable: false },
    ];

    return new TransactionInstruction({
      keys,
      programId: PUMPFUN_PROGRAM_ID,
      data,
    });
  }

  /**
   * Get global config PDA.
   */
  private getGlobalConfigAddress(): PublicKey {
    const [globalConfig] = PublicKey.findProgramAddressSync(
      [Buffer.from('global')],
      PUMPFUN_PROGRAM_ID
    );
    return globalConfig;
  }

  /**
   * Get event authority PDA.
   */
  private getEventAuthorityAddress(): PublicKey {
    const [eventAuthority] = PublicKey.findProgramAddressSync(
      [Buffer.from('__event_authority')],
      PUMPFUN_PROGRAM_ID
    );
    return eventAuthority;
  }
}

// ============ Standalone Functions ============

let defaultClient: PumpFunClient | null = null;

/**
 * Get or create default PumpFun client.
 */
function getDefaultClient(connection: Connection): PumpFunClient {
  if (!defaultClient) {
    defaultClient = new PumpFunClient(connection);
  }
  return defaultClient;
}

/**
 * Get swap quote from PumpFun bonding curve.
 * 
 * @throws {NoRouteError} If token not on PumpFun or migrated
 * @throws {APIError} If bonding curve fetch fails
 */
export async function getQuote(
  connection: Connection,
  params: QuoteParams,
  options: QuoteRequestOptions = {}
): Promise<Quote> {
  const client = getDefaultClient(connection);
  return client.getQuote(params, options);
}

/**
 * Execute swap on PumpFun bonding curve.
 * 
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
 * Get available PumpFun pools for a token.
 */
export async function getPools(
  connection: Connection,
  tokenMint: PublicKey
): Promise<Pool[]> {
  const client = getDefaultClient(connection);
  return client.getPools(tokenMint);
}

/**
 * Check if a token is still on PumpFun's bonding curve.
 */
export async function isOnPumpFun(
  connection: Connection,
  tokenMint: PublicKey
): Promise<boolean> {
  const client = getDefaultClient(connection);
  return client.isOnPumpFun(tokenMint);
}

/**
 * Check if a token has migrated from PumpFun to Raydium.
 */
export async function hasMigrated(
  connection: Connection,
  tokenMint: PublicKey
): Promise<boolean> {
  const client = getDefaultClient(connection);
  return client.hasMigrated(tokenMint);
}

/**
 * Get the bonding curve address for a token mint.
 */
export function getBondingCurveAddress(tokenMint: PublicKey): PublicKey {
  const [bondingCurve] = PublicKey.findProgramAddressSync(
    [Buffer.from('bonding-curve'), tokenMint.toBytes()],
    PUMPFUN_PROGRAM_ID
  );
  return bondingCurve;
}

// Export constants for external use
export const PUMPFUN_CONSTANTS = {
  PROGRAM_ID: PUMPFUN_PROGRAM_ID,
  FEE_ACCOUNT: PUMPFUN_FEE_ACCOUNT,
  TOKEN_DECIMALS: PUMPFUN_TOKEN_DECIMALS,
  MIGRATION_THRESHOLD_SOL,
};
