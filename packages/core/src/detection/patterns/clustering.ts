/**
 * Wallet Clustering Detection
 * Detects wallets funded from the same source - indicative of coordinated activity
 * 
 * Powered by Allium
 */

import type { AlliumClient } from '../allium-client.js';
import type { Pattern, Evidence, WalletCluster, ClusteringResult, TransactionData } from '../types.js';

interface FundingSource {
  wallet: string;
  fundingSources: string[];
  firstFundingTimestamp?: number;
}

/**
 * Detect wallet clustering by analyzing funding sources
 * Wallets funded from the same source are likely controlled by the same entity
 */
export async function detectWalletClustering(
  alliumClient: AlliumClient,
  wallets: string[],
  chain: string = 'solana',
  minClusterSize: number = 3
): Promise<Pattern | null> {
  if (wallets.length < minClusterSize) {
    return null;
  }

  // Get funding sources for each wallet
  const fundingSources: FundingSource[] = [];
  
  for (const wallet of wallets) {
    try {
      const history = await alliumClient.getWalletBalanceHistory(chain, wallet);
      const sources = extractFundingSources(history, wallet);
      fundingSources.push(sources);
    } catch (error) {
      // Skip wallets that fail - may be too new or have no history
      console.warn(`Failed to get funding history for ${wallet}:`, error);
    }
  }

  // Find clusters of wallets with common funding sources
  const clusters = findClusters(fundingSources, minClusterSize);

  if (clusters.length === 0) {
    return null;
  }

  // Calculate confidence based on cluster characteristics
  const confidence = calculateClusteringConfidence(clusters, wallets.length);
  
  // Generate evidence
  const evidence = generateClusteringEvidence(clusters);

  return {
    type: 'wallet_clustering',
    confidence,
    severity: confidence > 0.7 ? 'high' : confidence > 0.4 ? 'medium' : 'low',
    evidence,
    detectedAt: Date.now(),
  };
}

/**
 * Analyze clustering from pre-fetched transaction data
 * Used for faster batch analysis
 */
export function analyzeClusteringFromTransactions(
  transactions: TransactionData[],
  fundingData: Map<string, string[]>,
  minClusterSize: number = 3
): Pattern | null {
  // Get unique wallets
  const wallets = [...new Set(transactions.map(tx => tx.signer))];
  
  if (wallets.length < minClusterSize) {
    return null;
  }

  // Build funding sources from provided data
  const fundingSources: FundingSource[] = wallets.map(wallet => ({
    wallet,
    fundingSources: fundingData.get(wallet) ?? [],
  }));

  const clusters = findClusters(fundingSources, minClusterSize);

  if (clusters.length === 0) {
    return null;
  }

  const confidence = calculateClusteringConfidence(clusters, wallets.length);
  const evidence = generateClusteringEvidence(clusters);

  return {
    type: 'wallet_clustering',
    confidence,
    severity: confidence > 0.7 ? 'high' : confidence > 0.4 ? 'medium' : 'low',
    evidence,
    detectedAt: Date.now(),
  };
}

/**
 * Extract funding sources from balance history
 */
function extractFundingSources(
  history: { timestamp: string; balance: string; token_address: string }[],
  wallet: string
): FundingSource {
  // Look for initial funding transactions (balance going from 0 to positive)
  const sources: string[] = [];
  let firstFundingTimestamp: number | undefined;
  
  // Sort by timestamp
  const sorted = [...history].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  for (let i = 1; i < sorted.length; i++) {
    const prev = parseFloat(sorted[i - 1].balance);
    const curr = parseFloat(sorted[i].balance);
    
    // Detect incoming funds
    if (curr > prev) {
      if (!firstFundingTimestamp) {
        firstFundingTimestamp = new Date(sorted[i].timestamp).getTime();
      }
      // Note: The balance history doesn't include sender info directly
      // In a real implementation, we'd cross-reference with transactions
    }
  }

  return {
    wallet,
    fundingSources: sources,
    firstFundingTimestamp,
  };
}

/**
 * Find clusters of wallets with common funding sources
 */
function findClusters(
  fundingSources: FundingSource[],
  minClusterSize: number
): WalletCluster[] {
  // Build a map of funding source -> wallets funded by it
  const sourceToWallets: Map<string, string[]> = new Map();

  for (const fs of fundingSources) {
    for (const source of fs.fundingSources) {
      const existing = sourceToWallets.get(source) ?? [];
      existing.push(fs.wallet);
      sourceToWallets.set(source, existing);
    }
  }

  // Filter to clusters meeting minimum size
  const clusters: WalletCluster[] = [];

  for (const [source, wallets] of sourceToWallets) {
    if (wallets.length >= minClusterSize) {
      clusters.push({
        fundingSource: source,
        wallets,
        totalVolume: 0, // Would be calculated from transaction data
      });
    }
  }

  // Also detect clusters by timing - wallets funded within a short window
  const timingClusters = detectTimingClusters(fundingSources, minClusterSize);
  clusters.push(...timingClusters);

  return clusters;
}

/**
 * Detect clusters of wallets funded within a short time window
 */
function detectTimingClusters(
  fundingSources: FundingSource[],
  minClusterSize: number,
  windowMs: number = 300_000 // 5 minutes
): WalletCluster[] {
  // Sort by first funding timestamp
  const withTimestamp = fundingSources.filter(fs => fs.firstFundingTimestamp);
  withTimestamp.sort((a, b) => (a.firstFundingTimestamp ?? 0) - (b.firstFundingTimestamp ?? 0));

  const clusters: WalletCluster[] = [];
  let currentCluster: string[] = [];
  let windowStart = 0;

  for (const fs of withTimestamp) {
    const timestamp = fs.firstFundingTimestamp ?? 0;
    
    if (currentCluster.length === 0) {
      currentCluster.push(fs.wallet);
      windowStart = timestamp;
    } else if (timestamp - windowStart <= windowMs) {
      currentCluster.push(fs.wallet);
    } else {
      // Window ended - save cluster if large enough
      if (currentCluster.length >= minClusterSize) {
        clusters.push({
          fundingSource: 'timing_cluster',
          wallets: [...currentCluster],
          totalVolume: 0,
        });
      }
      // Start new window
      currentCluster = [fs.wallet];
      windowStart = timestamp;
    }
  }

  // Don't forget the last cluster
  if (currentCluster.length >= minClusterSize) {
    clusters.push({
      fundingSource: 'timing_cluster',
      wallets: [...currentCluster],
      totalVolume: 0,
    });
  }

  return clusters;
}

/**
 * Calculate confidence score for clustering
 */
function calculateClusteringConfidence(
  clusters: WalletCluster[],
  totalWallets: number
): number {
  if (clusters.length === 0) return 0;

  // Factors:
  // 1. What percentage of wallets are in clusters?
  const walletsInClusters = new Set(clusters.flatMap(c => c.wallets)).size;
  const clusterCoverage = walletsInClusters / totalWallets;

  // 2. How large are the clusters?
  const maxClusterSize = Math.max(...clusters.map(c => c.wallets.length));
  const clusterSizeScore = Math.min(1, maxClusterSize / 10);

  // 3. How many clusters are there?
  const clusterCountScore = Math.min(1, clusters.length / 5);

  // Weighted average
  const confidence = (
    clusterCoverage * 0.4 +
    clusterSizeScore * 0.4 +
    clusterCountScore * 0.2
  );

  return Math.min(1, confidence);
}

/**
 * Generate evidence for clustering pattern
 */
function generateClusteringEvidence(clusters: WalletCluster[]): Evidence[] {
  return clusters.map((cluster, index) => ({
    type: 'wallet_cluster',
    description: `Cluster of ${cluster.wallets.length} wallets with common funding source`,
    data: {
      clusterId: index,
      fundingSource: cluster.fundingSource,
      walletCount: cluster.wallets.length,
      wallets: cluster.wallets.slice(0, 10), // Limit to first 10 for brevity
      moreWallets: cluster.wallets.length > 10 ? cluster.wallets.length - 10 : 0,
    },
  }));
}

/**
 * Get clustering result with full details
 */
export async function getClusteringResult(
  alliumClient: AlliumClient,
  wallets: string[],
  chain: string = 'solana',
  minClusterSize: number = 3
): Promise<ClusteringResult> {
  const pattern = await detectWalletClustering(alliumClient, wallets, chain, minClusterSize);
  
  if (!pattern) {
    return {
      clustered: false,
      clusters: [],
      confidence: 0,
    };
  }

  const clusters = pattern.evidence
    .filter(e => e.type === 'wallet_cluster')
    .map(e => ({
      fundingSource: e.data.fundingSource as string,
      wallets: e.data.wallets as string[],
      totalVolume: 0,
    }));

  return {
    clustered: true,
    clusters,
    confidence: pattern.confidence,
  };
}
