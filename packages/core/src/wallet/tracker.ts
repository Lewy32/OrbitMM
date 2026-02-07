/**
 * OrbitMM Wallet Tracker
 * 
 * Efficient balance tracking with batching and caching.
 * Following ARCHITECT_SPEC.md exactly.
 */

import {
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  AccountInfo,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddress,
  getAccount,
  TokenAccountNotFoundError,
} from '@solana/spl-token';
import { Balance, RPCError } from './types.js';

// Cache configuration
const CACHE_TTL_MS = 5000; // 5 seconds
const BATCH_SIZE = 100; // Max accounts per getMultipleAccountsInfo call

// Simple in-memory cache
interface CacheEntry {
  balance: number;
  timestamp: number;
}

const balanceCache = new Map<string, CacheEntry>();

/**
 * Get SOL balances for multiple wallets efficiently.
 * Uses getMultipleAccountsInfo for batching and caching.
 * 
 * @param connection - Solana RPC connection
 * @param wallets - Array of wallet public keys
 * @returns Map of pubkey string to SOL balance
 */
export async function getBalances(
  connection: Connection,
  wallets: PublicKey[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  const now = Date.now();

  // Separate cached and uncached wallets
  const uncached: PublicKey[] = [];
  const uncachedIndices: number[] = [];

  for (let i = 0; i < wallets.length; i++) {
    const key = wallets[i].toBase58();
    const cached = balanceCache.get(key);

    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      result.set(key, cached.balance);
    } else {
      uncached.push(wallets[i]);
      uncachedIndices.push(i);
    }
  }

  // Fetch uncached balances in batches
  if (uncached.length > 0) {
    const batches = chunk(uncached, BATCH_SIZE);

    for (const batch of batches) {
      try {
        const accounts = await connection.getMultipleAccountsInfo(batch);

        for (let i = 0; i < batch.length; i++) {
          const pubkey = batch[i].toBase58();
          const account = accounts[i];
          const balance = account ? account.lamports / LAMPORTS_PER_SOL : 0;

          // Update cache
          balanceCache.set(pubkey, {
            balance,
            timestamp: now,
          });

          result.set(pubkey, balance);
        }
      } catch (error) {
        throw new RPCError(
          'Failed to fetch wallet balances',
          error as Error
        );
      }
    }
  }

  return result;
}

/**
 * Get SOL balance for a single wallet.
 * 
 * @param connection - Solana RPC connection
 * @param wallet - Wallet public key
 * @returns SOL balance
 */
export async function getBalance(
  connection: Connection,
  wallet: PublicKey
): Promise<number> {
  const now = Date.now();
  const key = wallet.toBase58();
  const cached = balanceCache.get(key);

  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return cached.balance;
  }

  try {
    const lamports = await connection.getBalance(wallet);
    const balance = lamports / LAMPORTS_PER_SOL;

    // Update cache
    balanceCache.set(key, {
      balance,
      timestamp: now,
    });

    return balance;
  } catch (error) {
    throw new RPCError(
      'Failed to fetch wallet balance',
      error as Error
    );
  }
}

/**
 * Get token balance for a specific SPL token.
 * Returns 0 if token account doesn't exist.
 * 
 * @param connection - Solana RPC connection
 * @param wallet - Wallet public key
 * @param tokenMint - Token mint address
 * @returns Token amount in UI units (not raw)
 */
export async function getTokenBalance(
  connection: Connection,
  wallet: PublicKey,
  tokenMint: PublicKey
): Promise<number> {
  try {
    // Get associated token account address
    const ata = await getAssociatedTokenAddress(tokenMint, wallet);

    // Get token account info
    const account = await getAccount(connection, ata);

    // Get token decimals for conversion
    const mintInfo = await connection.getParsedAccountInfo(tokenMint);
    const decimals = (mintInfo.value?.data as { parsed: { info: { decimals: number } } })
      ?.parsed?.info?.decimals ?? 9;

    // Convert to UI amount
    return Number(account.amount) / Math.pow(10, decimals);
  } catch (error) {
    // Return 0 if token account doesn't exist
    if (error instanceof TokenAccountNotFoundError) {
      return 0;
    }
    // Check for account not found error
    if (
      error instanceof Error &&
      (error.message.includes('could not find account') ||
        error.message.includes('Account does not exist'))
    ) {
      return 0;
    }
    throw new RPCError(
      'Failed to fetch token balance',
      error as Error
    );
  }
}

/**
 * Get all token balances for a wallet.
 * 
 * @param connection - Solana RPC connection
 * @param wallet - Wallet public key
 * @returns Map of token mint to balance
 */
export async function getAllTokenBalances(
  connection: Connection,
  wallet: PublicKey
): Promise<Map<string, { mint: string; balance: number; decimals: number }>> {
  try {
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(wallet, {
      programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
    });

    const result = new Map<string, { mint: string; balance: number; decimals: number }>();

    for (const { account } of tokenAccounts.value) {
      const parsed = account.data as {
        parsed: {
          info: {
            mint: string;
            tokenAmount: {
              uiAmount: number;
              decimals: number;
            };
          };
        };
      };

      const info = parsed.parsed.info;
      result.set(info.mint, {
        mint: info.mint,
        balance: info.tokenAmount.uiAmount,
        decimals: info.tokenAmount.decimals,
      });
    }

    return result;
  } catch (error) {
    throw new RPCError(
      'Failed to fetch token accounts',
      error as Error
    );
  }
}

/**
 * Watch wallet for balance changes.
 * Returns unsubscribe function.
 * 
 * @param connection - Solana RPC connection
 * @param wallet - Wallet public key
 * @param callback - Called when balance changes
 * @returns Unsubscribe function
 */
export function watchBalance(
  connection: Connection,
  wallet: PublicKey,
  callback: (balance: number) => void
): () => void {
  let lastBalance: number | null = null;

  const subscriptionId = connection.onAccountChange(
    wallet,
    (accountInfo: AccountInfo<Buffer>) => {
      const balance = accountInfo.lamports / LAMPORTS_PER_SOL;

      // Only call callback if balance actually changed
      if (lastBalance === null || balance !== lastBalance) {
        lastBalance = balance;

        // Update cache
        balanceCache.set(wallet.toBase58(), {
          balance,
          timestamp: Date.now(),
        });

        callback(balance);
      }
    },
    'confirmed'
  );

  // Return unsubscribe function
  return () => {
    connection.removeAccountChangeListener(subscriptionId);
  };
}

/**
 * Clear the balance cache.
 * Useful for testing or forcing fresh fetches.
 */
export function clearCache(): void {
  balanceCache.clear();
}

/**
 * Get cache statistics.
 */
export function getCacheStats(): { size: number; entries: string[] } {
  return {
    size: balanceCache.size,
    entries: Array.from(balanceCache.keys()),
  };
}

// ============ Helper Functions ============

/**
 * Split array into chunks of specified size.
 */
function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
