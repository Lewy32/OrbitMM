/**
 * Coordinated Timing Detection
 * Detects multiple wallets transacting in the same time window
 * 
 * Coordinated activity suggests bot networks or wash trading
 * 
 * Powered by Allium
 */

import type { Pattern, Evidence, TransactionData } from '../types.js';

interface TimingWindow {
  startTime: number;
  endTime: number;
  transactions: TransactionData[];
  uniqueWallets: Set<string>;
}

interface CoordinatedEvent {
  window: TimingWindow;
  wallets: string[];
  transactionCount: number;
  totalVolume: number;
}

/**
 * Detect coordinated timing across multiple wallets
 * 
 * @param transactions - Array of transactions to analyze
 * @param windowMs - Time window in milliseconds (default 5 seconds)
 * @param minWallets - Minimum wallets in window to be suspicious (default 3)
 */
export function detectCoordinatedTiming(
  transactions: TransactionData[],
  windowMs: number = 5000,
  minWallets: number = 3
): Pattern | null {
  if (transactions.length < minWallets) {
    return null;
  }

  // Sort by timestamp
  const sorted = [...transactions].sort((a, b) => a.timestamp - b.timestamp);

  // Find windows with multiple distinct wallets
  const coordinatedEvents = findCoordinatedEvents(sorted, windowMs, minWallets);

  if (coordinatedEvents.length === 0) {
    return null;
  }

  const confidence = calculateTimingConfidence(coordinatedEvents, transactions);
  const evidence = generateTimingEvidence(coordinatedEvents);

  return {
    type: 'coordinated_timing',
    confidence,
    severity: confidence > 0.7 ? 'high' : confidence > 0.4 ? 'medium' : 'low',
    evidence,
    detectedAt: Date.now(),
  };
}

/**
 * Find events where multiple wallets transact in same time window
 */
function findCoordinatedEvents(
  transactions: TransactionData[],
  windowMs: number,
  minWallets: number
): CoordinatedEvent[] {
  const events: CoordinatedEvent[] = [];
  const usedIndices = new Set<number>();

  for (let i = 0; i < transactions.length; i++) {
    if (usedIndices.has(i)) continue;

    const windowStart = transactions[i].timestamp;
    const windowEnd = windowStart + windowMs;

    // Collect all transactions in this window
    const windowTxs: TransactionData[] = [];
    const wallets = new Set<string>();

    for (let j = i; j < transactions.length; j++) {
      if (transactions[j].timestamp > windowEnd) break;
      
      windowTxs.push(transactions[j]);
      wallets.add(transactions[j].signer);
    }

    // Check if this window has enough distinct wallets
    if (wallets.size >= minWallets) {
      // Mark these transactions as used
      for (let j = i; j < i + windowTxs.length; j++) {
        usedIndices.add(j);
      }

      const totalVolume = windowTxs.reduce((sum, tx) => sum + tx.amount, 0);

      events.push({
        window: {
          startTime: windowStart,
          endTime: windowEnd,
          transactions: windowTxs,
          uniqueWallets: wallets,
        },
        wallets: [...wallets],
        transactionCount: windowTxs.length,
        totalVolume,
      });
    }
  }

  return events;
}

/**
 * Calculate confidence score for coordinated timing
 */
function calculateTimingConfidence(
  events: CoordinatedEvent[],
  allTransactions: TransactionData[]
): number {
  if (events.length === 0) return 0;

  // Factor 1: How many transactions are in coordinated windows?
  const coordinatedTxCount = events.reduce((sum, e) => sum + e.transactionCount, 0);
  const coverageScore = coordinatedTxCount / allTransactions.length;

  // Factor 2: Average number of wallets per coordinated event
  const avgWallets = events.reduce((sum, e) => sum + e.wallets.length, 0) / events.length;
  const walletScore = Math.min(1, avgWallets / 10); // Normalize: 10+ wallets = max

  // Factor 3: Number of coordinated events
  const eventScore = Math.min(1, events.length / 5);

  // Factor 4: Are the same wallets appearing in multiple events?
  const walletOverlap = calculateWalletOverlap(events);

  // Weighted combination
  const confidence = (
    coverageScore * 0.3 +
    walletScore * 0.3 +
    eventScore * 0.2 +
    walletOverlap * 0.2
  );

  return Math.min(1, Math.max(0, confidence));
}

/**
 * Calculate overlap of wallets across events
 */
function calculateWalletOverlap(events: CoordinatedEvent[]): number {
  if (events.length < 2) return 0;

  const allWallets = new Set<string>();
  const walletsPerEvent: string[][] = [];

  for (const event of events) {
    walletsPerEvent.push(event.wallets);
    for (const wallet of event.wallets) {
      allWallets.add(wallet);
    }
  }

  // Count wallets appearing in multiple events
  let overlapCount = 0;
  for (const wallet of allWallets) {
    let appearances = 0;
    for (const eventWallets of walletsPerEvent) {
      if (eventWallets.includes(wallet)) appearances++;
    }
    if (appearances > 1) overlapCount++;
  }

  return overlapCount / allWallets.size;
}

/**
 * Generate evidence for coordinated timing
 */
function generateTimingEvidence(events: CoordinatedEvent[]): Evidence[] {
  const evidence: Evidence[] = [];

  // Summary evidence
  const totalWallets = new Set(events.flatMap(e => e.wallets)).size;
  const totalTxs = events.reduce((sum, e) => sum + e.transactionCount, 0);

  evidence.push({
    type: 'timing_summary',
    description: `${events.length} coordinated timing events detected involving ${totalWallets} wallets`,
    data: {
      eventCount: events.length,
      totalWallets,
      totalTransactions: totalTxs,
      avgWalletsPerEvent: (totalWallets / events.length).toFixed(1),
    },
  });

  // Individual events (top 5 by wallet count)
  const topEvents = events
    .sort((a, b) => b.wallets.length - a.wallets.length)
    .slice(0, 5);

  for (const event of topEvents) {
    evidence.push({
      type: 'timing_event',
      description: `${event.wallets.length} wallets transacted within ${(event.window.endTime - event.window.startTime) / 1000}s`,
      data: {
        windowStart: new Date(event.window.startTime).toISOString(),
        windowEnd: new Date(event.window.endTime).toISOString(),
        windowDurationMs: event.window.endTime - event.window.startTime,
        walletCount: event.wallets.length,
        transactionCount: event.transactionCount,
        totalVolume: event.totalVolume,
        wallets: event.wallets.slice(0, 10), // Limit for brevity
        moreWallets: event.wallets.length > 10 ? event.wallets.length - 10 : 0,
      },
    });
  }

  return evidence;
}

/**
 * Quick check for burst activity (simplified coordinated timing check)
 */
export function detectBurstActivity(
  transactions: TransactionData[],
  burstThreshold: number = 10, // Transactions per second
): { hasBurst: boolean; maxTps: number; burstTimestamp: number | null } {
  if (transactions.length < 2) {
    return { hasBurst: false, maxTps: 0, burstTimestamp: null };
  }

  const sorted = [...transactions].sort((a, b) => a.timestamp - b.timestamp);
  
  let maxTps = 0;
  let burstTimestamp: number | null = null;

  // Sliding window of 1 second
  for (let i = 0; i < sorted.length; i++) {
    const windowStart = sorted[i].timestamp;
    const windowEnd = windowStart + 1000;

    let count = 0;
    for (let j = i; j < sorted.length && sorted[j].timestamp < windowEnd; j++) {
      count++;
    }

    if (count > maxTps) {
      maxTps = count;
      burstTimestamp = windowStart;
    }
  }

  return {
    hasBurst: maxTps >= burstThreshold,
    maxTps,
    burstTimestamp,
  };
}

/**
 * Analyze transaction timing distribution
 */
export function getTimingDistribution(
  transactions: TransactionData[]
): { byHour: number[]; byDayOfWeek: number[]; peakHour: number; peakDay: number } {
  const byHour = new Array(24).fill(0);
  const byDayOfWeek = new Array(7).fill(0);

  for (const tx of transactions) {
    const date = new Date(tx.timestamp);
    byHour[date.getUTCHours()]++;
    byDayOfWeek[date.getUTCDay()]++;
  }

  const peakHour = byHour.indexOf(Math.max(...byHour));
  const peakDay = byDayOfWeek.indexOf(Math.max(...byDayOfWeek));

  return { byHour, byDayOfWeek, peakHour, peakDay };
}

/**
 * Detect if activity is concentrated in suspicious time periods
 * (e.g., all trading happens at exactly the same minute each hour)
 */
export function detectTimeConcentration(
  transactions: TransactionData[]
): Pattern | null {
  if (transactions.length < 20) return null;

  // Check minute-of-hour distribution
  const byMinute = new Array(60).fill(0);
  for (const tx of transactions) {
    const minute = new Date(tx.timestamp).getMinutes();
    byMinute[minute]++;
  }

  // Check if any minute has disproportionate activity
  const avgPerMinute = transactions.length / 60;
  const maxMinuteCount = Math.max(...byMinute);
  const peakMinute = byMinute.indexOf(maxMinuteCount);

  // If one minute has 5x the average, it's suspicious
  if (maxMinuteCount > avgPerMinute * 5 && maxMinuteCount >= 10) {
    return {
      type: 'coordinated_timing',
      confidence: Math.min(1, (maxMinuteCount / (avgPerMinute * 5)) * 0.7),
      severity: 'medium',
      evidence: [{
        type: 'minute_concentration',
        description: `Activity concentrated at minute ${peakMinute} of each hour`,
        data: {
          peakMinute,
          peakCount: maxMinuteCount,
          averagePerMinute: avgPerMinute.toFixed(1),
          concentration: (maxMinuteCount / avgPerMinute).toFixed(1) + 'x average',
        },
      }],
      detectedAt: Date.now(),
    };
  }

  return null;
}
