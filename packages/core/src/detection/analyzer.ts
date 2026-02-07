/**
 * Detection Analyzer
 * Combines all pattern detectors and generates comprehensive analysis reports
 * 
 * Powered by Allium
 */

import { AlliumClient } from './allium-client.js';
import type {
  Pattern,
  AnalysisReport,
  TransactionData,
  DetectionEngineConfig,
} from './types.js';

import { detectWalletClustering, analyzeClusteringFromTransactions } from './patterns/clustering.js';
import { detectIntervalRegularity } from './patterns/intervals.js';
import { detectSizeDistribution } from './patterns/sizing.js';
import { detectCoordinatedTiming, detectTimeConcentration } from './patterns/timing.js';

// ============ Configuration Defaults ============

const DEFAULT_THRESHOLDS = {
  intervalCoefficientOfVariation: 0.5,
  coordinatedTimingWindowMs: 5000,
  minClusterSize: 3,
  uniformDistributionThreshold: 0.3,
};

// ============ Main Analyzer ============

export class Analyzer {
  private readonly alliumClient: AlliumClient;
  private readonly thresholds: typeof DEFAULT_THRESHOLDS;

  constructor(config: DetectionEngineConfig) {
    this.alliumClient = new AlliumClient(config.allium);
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...config.thresholds };
  }

  /**
   * Analyze transactions for all manipulation patterns
   */
  analyzeTransactions(transactions: TransactionData[]): AnalysisReport {
    const patterns: Pattern[] = [];
    const analyzedAt = Date.now();

    if (transactions.length === 0) {
      return this.buildReport([], transactions, analyzedAt);
    }

    // Run all pattern detectors
    const intervalPattern = detectIntervalRegularity(
      transactions,
      this.thresholds.intervalCoefficientOfVariation
    );
    if (intervalPattern) patterns.push(intervalPattern);

    const sizePattern = detectSizeDistribution(
      transactions,
      this.thresholds.uniformDistributionThreshold
    );
    if (sizePattern) patterns.push(sizePattern);

    const timingPattern = detectCoordinatedTiming(
      transactions,
      this.thresholds.coordinatedTimingWindowMs,
      this.thresholds.minClusterSize
    );
    if (timingPattern) patterns.push(timingPattern);

    const concentrationPattern = detectTimeConcentration(transactions);
    if (concentrationPattern) patterns.push(concentrationPattern);

    // Clustering requires funding data - skip if not available
    // Will be called separately with fetchAndAnalyzeToken

    return this.buildReport(patterns, transactions, analyzedAt);
  }

  /**
   * Fetch and analyze transactions for a token
   * Includes wallet clustering detection (requires API calls)
   */
  async analyzeToken(
    tokenMint: string,
    chain: string = 'solana',
    options?: { timeRangeMs?: number; limit?: number }
  ): Promise<AnalysisReport> {
    const timeRangeMs = options?.timeRangeMs ?? 24 * 60 * 60 * 1000; // 24 hours
    
    // For now, we'll use a SQL query to get transactions
    // This is a placeholder - actual implementation depends on table schema
    const sql = `
      SELECT 
        signature,
        block_time as timestamp,
        signer,
        amount,
        CASE WHEN buyer = signer THEN 'buy' ELSE 'sell' END as direction
      FROM solana.dex.trades
      WHERE token_mint = '${tokenMint}'
        AND block_time > NOW() - INTERVAL '${Math.floor(timeRangeMs / 1000)} seconds'
      ORDER BY block_time DESC
      LIMIT ${options?.limit ?? 1000}
    `;

    try {
      const result = await this.alliumClient.runQuery(sql);
      
      if (result.status !== 'success' || !result.data) {
        console.warn('Failed to fetch token transactions:', result.error);
        return this.buildReport([], [], Date.now(), tokenMint);
      }

      const transactions = this.parseTransactions(result.data);
      const patterns: Pattern[] = [];

      // Run standard pattern detection
      const baseReport = this.analyzeTransactions(transactions);
      patterns.push(...baseReport.patterns);

      // Run clustering detection if we have enough wallets
      const uniqueWallets = [...new Set(transactions.map(tx => tx.signer))];
      if (uniqueWallets.length >= this.thresholds.minClusterSize) {
        const clusteringPattern = await detectWalletClustering(
          this.alliumClient,
          uniqueWallets.slice(0, 50), // Limit to avoid rate limits
          chain,
          this.thresholds.minClusterSize
        );
        if (clusteringPattern) patterns.push(clusteringPattern);
      }

      return this.buildReport(patterns, transactions, Date.now(), tokenMint);
    } catch (error) {
      console.error('Error analyzing token:', error);
      return this.buildReport([], [], Date.now(), tokenMint);
    }
  }

  /**
   * Analyze with pre-fetched funding data (faster, no additional API calls)
   */
  analyzeWithFundingData(
    transactions: TransactionData[],
    fundingData: Map<string, string[]>
  ): AnalysisReport {
    const patterns: Pattern[] = [];
    const analyzedAt = Date.now();

    // Run standard detectors
    const baseReport = this.analyzeTransactions(transactions);
    patterns.push(...baseReport.patterns);

    // Run clustering with provided funding data
    const clusteringPattern = analyzeClusteringFromTransactions(
      transactions,
      fundingData,
      this.thresholds.minClusterSize
    );
    if (clusteringPattern) patterns.push(clusteringPattern);

    return this.buildReport(patterns, transactions, analyzedAt);
  }

  /**
   * Build analysis report from patterns
   */
  private buildReport(
    patterns: Pattern[],
    transactions: TransactionData[],
    analyzedAt: number,
    tokenMint?: string
  ): AnalysisReport {
    // Calculate overall confidence
    const overallConfidence = patterns.length > 0
      ? patterns.reduce((sum, p) => sum + p.confidence, 0) / patterns.length
      : 0;

    // Calculate manipulation score (0-100)
    const manipulationScore = calculateManipulationScore(patterns);

    // Get time range
    const timestamps = transactions.map(tx => tx.timestamp);
    const timeRange = timestamps.length > 0
      ? { start: Math.min(...timestamps), end: Math.max(...timestamps) }
      : { start: analyzedAt, end: analyzedAt };

    // Generate recommendation
    const recommendation = generateRecommendation(patterns, manipulationScore);

    return {
      tokenMint: tokenMint ?? 'unknown',
      analyzedAt,
      transactionCount: transactions.length,
      timeRange,
      patterns,
      overallConfidence,
      manipulationScore,
      recommendation,
      citation: 'Powered by Allium',
    };
  }

  /**
   * Parse raw query data into TransactionData
   */
  private parseTransactions(data: unknown[]): TransactionData[] {
    return data.map((row: any) => ({
      signature: row.signature ?? row.hash ?? '',
      timestamp: typeof row.timestamp === 'string'
        ? new Date(row.timestamp).getTime()
        : row.timestamp,
      signer: row.signer ?? row.from_address ?? '',
      amount: parseFloat(row.amount) || 0,
      direction: row.direction === 'buy' ? 'buy' : 'sell',
      priceUsd: row.price_usd ? parseFloat(row.price_usd) : undefined,
    }));
  }
}

// ============ Scoring Functions ============

/**
 * Calculate overall manipulation score (0-100)
 */
function calculateManipulationScore(patterns: Pattern[]): number {
  if (patterns.length === 0) return 0;

  // Weight patterns by type and confidence
  const weights: Record<string, number> = {
    'wallet_clustering': 25,
    'interval_regularity': 20,
    'size_distribution': 15,
    'coordinated_timing': 25,
    'new_wallet_spam': 20,
    'circular_trading': 30,
    'wash_trading': 35,
  };

  let totalScore = 0;
  let maxPossible = 0;

  for (const pattern of patterns) {
    const weight = weights[pattern.type] ?? 15;
    totalScore += pattern.confidence * weight;
    maxPossible += weight;
  }

  // Bonus for multiple pattern types detected
  const uniqueTypes = new Set(patterns.map(p => p.type)).size;
  const diversityBonus = Math.min(20, uniqueTypes * 5);

  const rawScore = (totalScore / maxPossible) * 80 + diversityBonus;
  return Math.min(100, Math.round(rawScore));
}

/**
 * Generate human-readable recommendation
 */
function generateRecommendation(patterns: Pattern[], score: number): string {
  if (patterns.length === 0) {
    return 'No manipulation patterns detected. Trading activity appears organic.';
  }

  if (score >= 80) {
    return 'HIGH RISK: Multiple strong indicators of manipulation detected. Exercise extreme caution.';
  }

  if (score >= 60) {
    return 'ELEVATED RISK: Significant manipulation indicators present. Consider reducing exposure.';
  }

  if (score >= 40) {
    return 'MODERATE RISK: Some suspicious patterns detected. Monitor closely.';
  }

  if (score >= 20) {
    return 'LOW RISK: Minor irregularities found. Likely within normal variance.';
  }

  return 'MINIMAL RISK: Only weak indicators detected. Activity appears mostly organic.';
}

// ============ Convenience Functions ============

/**
 * Quick analysis without creating an Analyzer instance
 */
export function analyzeTransactions(transactions: TransactionData[]): AnalysisReport {
  const patterns: Pattern[] = [];
  const analyzedAt = Date.now();

  if (transactions.length === 0) {
    return {
      tokenMint: 'unknown',
      analyzedAt,
      transactionCount: 0,
      timeRange: { start: analyzedAt, end: analyzedAt },
      patterns: [],
      overallConfidence: 0,
      manipulationScore: 0,
      recommendation: 'No transactions to analyze.',
      citation: 'Powered by Allium',
    };
  }

  // Run all detectors with defaults
  const intervalPattern = detectIntervalRegularity(transactions);
  if (intervalPattern) patterns.push(intervalPattern);

  const sizePattern = detectSizeDistribution(transactions);
  if (sizePattern) patterns.push(sizePattern);

  const timingPattern = detectCoordinatedTiming(transactions);
  if (timingPattern) patterns.push(timingPattern);

  const concentrationPattern = detectTimeConcentration(transactions);
  if (concentrationPattern) patterns.push(concentrationPattern);

  const overallConfidence = patterns.length > 0
    ? patterns.reduce((sum, p) => sum + p.confidence, 0) / patterns.length
    : 0;

  const manipulationScore = calculateManipulationScore(patterns);
  const timestamps = transactions.map(tx => tx.timestamp);

  return {
    tokenMint: 'unknown',
    analyzedAt,
    transactionCount: transactions.length,
    timeRange: { start: Math.min(...timestamps), end: Math.max(...timestamps) },
    patterns,
    overallConfidence,
    manipulationScore,
    recommendation: generateRecommendation(patterns, manipulationScore),
    citation: 'Powered by Allium',
  };
}

/**
 * Export individual pattern detectors for direct use
 */
export {
  detectIntervalRegularity,
  detectSizeDistribution,
  detectCoordinatedTiming,
  detectWalletClustering,
  analyzeClusteringFromTransactions,
  detectTimeConcentration,
};
