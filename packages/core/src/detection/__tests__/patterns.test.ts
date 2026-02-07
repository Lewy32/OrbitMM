/**
 * Detection Module Tests
 * Powered by Allium
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { TransactionData } from '../types.js';

// Pattern detectors
import { detectIntervalRegularity, isWalletRegular, getAverageInterval } from '../patterns/intervals.js';
import { detectSizeDistribution, looksNatural, getMode } from '../patterns/sizing.js';
import { detectCoordinatedTiming, detectBurstActivity, getTimingDistribution } from '../patterns/timing.js';
import { analyzeClusteringFromTransactions } from '../patterns/clustering.js';

// Main analyzer
import { analyzeTransactions } from '../analyzer.js';

// ============ Test Helpers ============

/**
 * Generate mock transactions with regular intervals (bot-like)
 */
function generateRegularTransactions(
  count: number,
  intervalMs: number,
  wallet: string = 'wallet1'
): TransactionData[] {
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => ({
    signature: `sig${i}`,
    timestamp: now + i * intervalMs,
    signer: wallet,
    amount: 0.1 + Math.random() * 0.05, // Small variation
    direction: 'buy' as const,
  }));
}

/**
 * Generate mock transactions with random intervals (human-like)
 */
function generateRandomTransactions(
  count: number,
  wallet: string = 'wallet1'
): TransactionData[] {
  const now = Date.now();
  let timestamp = now;
  
  // Use predetermined highly irregular intervals to ensure test determinism
  // These intervals have high variance (CV > 1.0) to simulate human behavior
  const irregularIntervals = [
    2500, 45000, 8000, 120000, 3500, 67000, 15000, 180000, 5500, 92000,
    25000, 4000, 150000, 12000, 78000, 6500, 200000, 9500, 55000, 18000,
    3000, 95000, 7500, 135000, 22000, 48000, 11000, 165000, 8500, 72000,
  ];
  
  return Array.from({ length: count }, (_, i) => {
    timestamp += irregularIntervals[i % irregularIntervals.length];
    return {
      signature: `sig${i}`,
      timestamp,
      signer: wallet,
      amount: Math.pow(Math.random(), 2) * 10, // Power-law-ish distribution
      direction: Math.random() > 0.5 ? 'buy' as const : 'sell' as const,
    };
  });
}

/**
 * Generate coordinated transactions (multiple wallets same time)
 */
function generateCoordinatedTransactions(
  walletCount: number,
  burstCount: number
): TransactionData[] {
  const transactions: TransactionData[] = [];
  const now = Date.now();

  for (let burst = 0; burst < burstCount; burst++) {
    const burstTime = now + burst * 60000; // One burst per minute
    
    for (let w = 0; w < walletCount; w++) {
      transactions.push({
        signature: `sig${burst}_${w}`,
        timestamp: burstTime + Math.random() * 2000, // Within 2 seconds
        signer: `wallet${w}`,
        amount: 1.0, // Uniform amounts
        direction: 'buy',
      });
    }
  }

  return transactions;
}

// ============ Interval Regularity Tests ============

describe('detectIntervalRegularity', () => {
  it('should detect regular intervals (bot behavior)', () => {
    const transactions = generateRegularTransactions(20, 5000); // 5s intervals
    const result = detectIntervalRegularity(transactions);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('interval_regularity');
    expect(result!.confidence).toBeGreaterThan(0.5);
  });

  it('should not flag random intervals (human behavior)', () => {
    const transactions = generateRandomTransactions(20);
    const result = detectIntervalRegularity(transactions);

    // May or may not detect - but if detected, low confidence
    if (result) {
      expect(result.confidence).toBeLessThan(0.5);
    }
  });

  it('should return null for insufficient data', () => {
    const transactions = generateRegularTransactions(3, 5000);
    const result = detectIntervalRegularity(transactions);

    expect(result).toBeNull();
  });

  it('should include interval statistics in evidence', () => {
    const transactions = generateRegularTransactions(15, 10000);
    const result = detectIntervalRegularity(transactions);

    expect(result).not.toBeNull();
    expect(result!.evidence.length).toBeGreaterThan(0);
    
    const overallEvidence = result!.evidence.find(e => e.type === 'interval_overall');
    if (overallEvidence) {
      expect(overallEvidence.data.meanIntervalMs).toBeDefined();
      expect(overallEvidence.data.coefficientOfVariation).toBeDefined();
    }
  });
});

describe('isWalletRegular', () => {
  it('should identify regular wallet', () => {
    const transactions = generateRegularTransactions(10, 5000, 'testWallet');
    const result = isWalletRegular(transactions);

    expect(result.isRegular).toBe(true);
    expect(result.stats).not.toBeNull();
    expect(result.stats!.coefficientOfVariation).toBeLessThan(0.5);
  });

  it('should identify irregular wallet', () => {
    // Use deliberately irregular timestamps with high variance
    const now = Date.now();
    const transactions: TransactionData[] = [
      { signature: 'sig0', timestamp: now, signer: 'testWallet', amount: 0.1, direction: 'buy' as const },
      { signature: 'sig1', timestamp: now + 100, signer: 'testWallet', amount: 0.1, direction: 'buy' as const },
      { signature: 'sig2', timestamp: now + 50000, signer: 'testWallet', amount: 0.1, direction: 'buy' as const },
      { signature: 'sig3', timestamp: now + 50500, signer: 'testWallet', amount: 0.1, direction: 'buy' as const },
      { signature: 'sig4', timestamp: now + 200000, signer: 'testWallet', amount: 0.1, direction: 'buy' as const },
      { signature: 'sig5', timestamp: now + 200100, signer: 'testWallet', amount: 0.1, direction: 'buy' as const },
      { signature: 'sig6', timestamp: now + 500000, signer: 'testWallet', amount: 0.1, direction: 'buy' as const },
      { signature: 'sig7', timestamp: now + 505000, signer: 'testWallet', amount: 0.1, direction: 'buy' as const },
      { signature: 'sig8', timestamp: now + 600000, signer: 'testWallet', amount: 0.1, direction: 'buy' as const },
      { signature: 'sig9', timestamp: now + 900000, signer: 'testWallet', amount: 0.1, direction: 'buy' as const },
    ];
    const result = isWalletRegular(transactions);

    expect(result.isRegular).toBe(false);
  });
});

describe('getAverageInterval', () => {
  it('should calculate correct average interval', () => {
    const transactions = generateRegularTransactions(10, 5000);
    const avg = getAverageInterval(transactions);

    expect(avg).not.toBeNull();
    expect(avg).toBeCloseTo(5000, -2); // Within 100ms
  });
});

// ============ Size Distribution Tests ============

describe('detectSizeDistribution', () => {
  it('should detect uniform distribution (bot-like)', () => {
    // Generate transactions with very uniform sizes
    const transactions: TransactionData[] = Array.from({ length: 30 }, (_, i) => ({
      signature: `sig${i}`,
      timestamp: Date.now() + i * 1000,
      signer: `wallet${i % 5}`,
      amount: 1.0 + Math.random() * 0.01, // Very uniform: 1.00 to 1.01
      direction: 'buy' as const,
    }));

    const result = detectSizeDistribution(transactions, 0.3);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('size_distribution');
    expect(result!.confidence).toBeGreaterThan(0);
  });

  it('should not flag natural distribution', () => {
    // Generate power-law like distribution (natural trading)
    const transactions: TransactionData[] = Array.from({ length: 30 }, (_, i) => ({
      signature: `sig${i}`,
      timestamp: Date.now() + i * 1000,
      signer: `wallet${i % 5}`,
      amount: Math.pow(Math.random(), 3) * 100, // Heavy right skew
      direction: 'buy' as const,
    }));

    const result = detectSizeDistribution(transactions);
    
    // May detect some patterns, but should have low confidence
    if (result) {
      expect(result.confidence).toBeLessThan(0.7);
    }
  });

  it('should detect repeating amounts', () => {
    // Same amount repeated many times
    const transactions: TransactionData[] = Array.from({ length: 30 }, (_, i) => ({
      signature: `sig${i}`,
      timestamp: Date.now() + i * 1000,
      signer: `wallet${i % 10}`,
      amount: i % 3 === 0 ? 1.0 : i % 3 === 1 ? 0.5 : 2.0, // Only 3 distinct values
      direction: 'buy' as const,
    }));

    const result = detectSizeDistribution(transactions);

    expect(result).not.toBeNull();
    expect(result!.evidence.some(e => 
      e.type === 'size_anomaly' && 
      (e.data.issue === 'modal_sizing' || e.data.issue === 'repeating_amounts')
    )).toBe(true);
  });

  it('should return null for insufficient data', () => {
    const transactions: TransactionData[] = Array.from({ length: 5 }, (_, i) => ({
      signature: `sig${i}`,
      timestamp: Date.now() + i * 1000,
      signer: 'wallet1',
      amount: 1.0,
      direction: 'buy' as const,
    }));

    const result = detectSizeDistribution(transactions);
    expect(result).toBeNull();
  });
});

describe('looksNatural', () => {
  it('should return true for natural distribution', () => {
    // Deterministic power-law-like distribution (many small, few large)
    const amounts = [
      0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09, 0.1,
      0.12, 0.15, 0.18, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.6,
      0.8, 1.0, 1.2, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 6.0,
      8.0, 10.0, 15.0, 20.0, 30.0, 40.0, 50.0, 60.0, 80.0, 100.0,
      0.05, 0.1, 0.15, 0.2, 0.3, 0.5, 0.8, 1.5, 3.0, 5.0,
    ];
    expect(looksNatural(amounts)).toBe(true);
  });

  it('should return false for uniform distribution', () => {
    // Very uniform amounts
    const amounts = Array.from({ length: 50 }, () => 1.0 + Math.random() * 0.01);
    expect(looksNatural(amounts)).toBe(false);
  });

  it('should return true for insufficient data', () => {
    const amounts = [1.0, 1.0, 1.0];
    expect(looksNatural(amounts)).toBe(true);
  });
});

describe('getMode', () => {
  it('should find the most common value', () => {
    const amounts = [1.0, 1.0, 1.0, 2.0, 3.0, 1.0, 4.0];
    const mode = getMode(amounts);

    expect(mode).not.toBeNull();
    expect(mode!.value).toBe(1.0);
    expect(mode!.count).toBe(4);
  });

  it('should return null for empty array', () => {
    const mode = getMode([]);
    expect(mode).toBeNull();
  });
});

// ============ Coordinated Timing Tests ============

describe('detectCoordinatedTiming', () => {
  it('should detect coordinated activity', () => {
    const transactions = generateCoordinatedTransactions(5, 3); // 5 wallets, 3 bursts
    const result = detectCoordinatedTiming(transactions, 5000, 3);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('coordinated_timing');
    expect(result!.confidence).toBeGreaterThan(0.3);
  });

  it('should not flag spread out activity', () => {
    // Generate transactions spread across time
    const transactions: TransactionData[] = Array.from({ length: 20 }, (_, i) => ({
      signature: `sig${i}`,
      timestamp: Date.now() + i * 30000, // 30 seconds apart
      signer: `wallet${i}`,
      amount: 1.0,
      direction: 'buy' as const,
    }));

    const result = detectCoordinatedTiming(transactions, 5000, 3);
    expect(result).toBeNull();
  });

  it('should include timing window details in evidence', () => {
    const transactions = generateCoordinatedTransactions(6, 2);
    const result = detectCoordinatedTiming(transactions, 5000, 3);

    expect(result).not.toBeNull();
    
    const eventEvidence = result!.evidence.find(e => e.type === 'timing_event');
    if (eventEvidence) {
      expect(eventEvidence.data.walletCount).toBeDefined();
      expect(eventEvidence.data.transactionCount).toBeDefined();
    }
  });
});

describe('detectBurstActivity', () => {
  it('should detect high transaction bursts', () => {
    // 15 transactions in 1 second
    const now = Date.now();
    const transactions: TransactionData[] = Array.from({ length: 15 }, (_, i) => ({
      signature: `sig${i}`,
      timestamp: now + i * 50, // 50ms apart = 20 TPS
      signer: `wallet${i}`,
      amount: 1.0,
      direction: 'buy' as const,
    }));

    const result = detectBurstActivity(transactions, 10);

    expect(result.hasBurst).toBe(true);
    expect(result.maxTps).toBeGreaterThanOrEqual(10);
  });

  it('should not flag normal activity', () => {
    const transactions = generateRandomTransactions(20);
    const result = detectBurstActivity(transactions, 10);

    expect(result.hasBurst).toBe(false);
  });
});

describe('getTimingDistribution', () => {
  it('should calculate hour and day distribution', () => {
    const transactions = generateRandomTransactions(50);
    const result = getTimingDistribution(transactions);

    expect(result.byHour.length).toBe(24);
    expect(result.byDayOfWeek.length).toBe(7);
    expect(result.peakHour).toBeGreaterThanOrEqual(0);
    expect(result.peakHour).toBeLessThan(24);
    expect(result.peakDay).toBeGreaterThanOrEqual(0);
    expect(result.peakDay).toBeLessThan(7);
  });
});

// ============ Clustering Tests ============

describe('analyzeClusteringFromTransactions', () => {
  it('should detect clustering with funding data', () => {
    const transactions: TransactionData[] = Array.from({ length: 15 }, (_, i) => ({
      signature: `sig${i}`,
      timestamp: Date.now() + i * 1000,
      signer: `wallet${i % 5}`, // 5 wallets
      amount: 1.0,
      direction: 'buy' as const,
    }));

    // Simulate common funding source
    const fundingData = new Map<string, string[]>([
      ['wallet0', ['funder1']],
      ['wallet1', ['funder1']],
      ['wallet2', ['funder1']],
      ['wallet3', ['funder2']],
      ['wallet4', ['funder2']],
    ]);

    const result = analyzeClusteringFromTransactions(transactions, fundingData, 3);

    expect(result).not.toBeNull();
    expect(result!.type).toBe('wallet_clustering');
    expect(result!.confidence).toBeGreaterThan(0);
  });

  it('should return null when no clusters found', () => {
    const transactions: TransactionData[] = Array.from({ length: 10 }, (_, i) => ({
      signature: `sig${i}`,
      timestamp: Date.now() + i * 1000,
      signer: `wallet${i}`, // All different wallets
      amount: 1.0,
      direction: 'buy' as const,
    }));

    // Each wallet has unique funding source
    const fundingData = new Map<string, string[]>(
      Array.from({ length: 10 }, (_, i) => [`wallet${i}`, [`funder${i}`]])
    );

    const result = analyzeClusteringFromTransactions(transactions, fundingData, 3);

    expect(result).toBeNull();
  });
});

// ============ Main Analyzer Tests ============

describe('analyzeTransactions', () => {
  it('should return report with citation', () => {
    const transactions = generateRandomTransactions(20);
    const report = analyzeTransactions(transactions);

    expect(report.citation).toBe('Powered by Allium');
    expect(report.transactionCount).toBe(20);
    expect(report.manipulationScore).toBeGreaterThanOrEqual(0);
    expect(report.manipulationScore).toBeLessThanOrEqual(100);
  });

  it('should detect multiple patterns in suspicious activity', () => {
    // Combine multiple suspicious patterns
    const coordinated = generateCoordinatedTransactions(5, 3);
    
    // Add uniform sizing
    for (const tx of coordinated) {
      tx.amount = 1.0; // All same amount
    }

    const report = analyzeTransactions(coordinated);

    // Should detect at least timing patterns
    expect(report.patterns.length).toBeGreaterThan(0);
    expect(report.manipulationScore).toBeGreaterThan(0);
  });

  it('should return low score for organic activity', () => {
    const transactions = generateRandomTransactions(50);
    const report = analyzeTransactions(transactions);

    // Organic activity should have low manipulation score
    expect(report.manipulationScore).toBeLessThan(50);
  });

  it('should handle empty transactions', () => {
    const report = analyzeTransactions([]);

    expect(report.patterns).toEqual([]);
    expect(report.manipulationScore).toBe(0);
    expect(report.recommendation).toContain('No transactions');
  });

  it('should include time range in report', () => {
    const transactions = generateRandomTransactions(10);
    const report = analyzeTransactions(transactions);

    expect(report.timeRange.start).toBeLessThan(report.timeRange.end);
    expect(report.timeRange.start).toBeGreaterThan(0);
  });

  it('should generate appropriate recommendations', () => {
    // High manipulation activity
    const suspicious = generateCoordinatedTransactions(10, 5);
    for (const tx of suspicious) {
      tx.amount = 1.0;
    }
    
    const report = analyzeTransactions(suspicious);

    expect(report.recommendation).toBeDefined();
    expect(report.recommendation.length).toBeGreaterThan(0);
  });
});

// ============ Edge Cases ============

describe('Edge Cases', () => {
  it('should handle single transaction', () => {
    const transactions: TransactionData[] = [{
      signature: 'single',
      timestamp: Date.now(),
      signer: 'wallet1',
      amount: 1.0,
      direction: 'buy',
    }];

    const report = analyzeTransactions(transactions);
    expect(report.patterns).toEqual([]);
    expect(report.manipulationScore).toBe(0);
  });

  it('should handle transactions with same timestamp', () => {
    const now = Date.now();
    const transactions: TransactionData[] = Array.from({ length: 10 }, (_, i) => ({
      signature: `sig${i}`,
      timestamp: now, // All same timestamp
      signer: `wallet${i}`,
      amount: 1.0,
      direction: 'buy' as const,
    }));

    // Should not crash
    const report = analyzeTransactions(transactions);
    expect(report).toBeDefined();
  });

  it('should handle very large amounts', () => {
    const transactions: TransactionData[] = Array.from({ length: 15 }, (_, i) => ({
      signature: `sig${i}`,
      timestamp: Date.now() + i * 1000,
      signer: 'whale',
      amount: 1e15 * Math.random(), // Very large amounts
      direction: 'buy' as const,
    }));

    const report = analyzeTransactions(transactions);
    expect(report).toBeDefined();
    expect(isNaN(report.manipulationScore)).toBe(false);
  });

  it('should handle zero amounts', () => {
    const transactions: TransactionData[] = Array.from({ length: 15 }, (_, i) => ({
      signature: `sig${i}`,
      timestamp: Date.now() + i * 1000,
      signer: 'wallet',
      amount: 0,
      direction: 'buy' as const,
    }));

    const report = analyzeTransactions(transactions);
    expect(report).toBeDefined();
  });

  it('should handle negative amounts gracefully', () => {
    const transactions: TransactionData[] = Array.from({ length: 15 }, (_, i) => ({
      signature: `sig${i}`,
      timestamp: Date.now() + i * 1000,
      signer: 'wallet',
      amount: -1.0, // Invalid but shouldn't crash
      direction: 'sell' as const,
    }));

    const report = analyzeTransactions(transactions);
    expect(report).toBeDefined();
  });
});
