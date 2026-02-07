#!/usr/bin/env npx ts-node
/**
 * Detection Monitor Example
 * 
 * This example demonstrates how to monitor a token for market manipulation
 * patterns using OrbitMM's detection engine. It continuously analyzes
 * trading activity and alerts when suspicious patterns are detected.
 * 
 * Usage:
 *   npx ts-node examples/detection-monitor.ts
 * 
 * Environment Variables:
 *   TARGET_TOKEN     - Token mint address to monitor
 *   ALERT_THRESHOLD  - Confidence threshold for alerts (0.0-1.0, default: 0.7)
 *   CHECK_INTERVAL   - Seconds between checks (default: 60)
 *   WEBHOOK_URL      - Optional webhook URL for alerts
 */

import { Connection, PublicKey } from '@solana/web3.js';

// ============ Configuration ============

const CONFIG = {
  // Token to monitor
  targetToken: process.env.TARGET_TOKEN || 'YOUR_TOKEN_MINT_ADDRESS',
  
  // RPC endpoint
  rpcUrl: process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
  
  // Detection parameters
  alertThreshold: parseFloat(process.env.ALERT_THRESHOLD || '0.7'),
  checkIntervalSeconds: parseInt(process.env.CHECK_INTERVAL || '60'),
  lookbackMinutes: parseInt(process.env.LOOKBACK_MINUTES || '30'),
  
  // Alerts
  webhookUrl: process.env.WEBHOOK_URL || null,
  
  // Output
  verbose: process.env.VERBOSE === 'true',
};

// ============ Types ============

type PatternType =
  | 'wallet_clustering'
  | 'interval_regularity'
  | 'size_distribution'
  | 'coordinated_timing'
  | 'new_wallet_spam'
  | 'circular_trading'
  | 'wash_trading';

interface Pattern {
  type: PatternType;
  confidence: number;
  severity: 'low' | 'medium' | 'high';
  description: string;
  evidence: {
    metric: string;
    value: number;
    threshold: number;
    deviation: string;
  }[];
}

interface AnalysisResult {
  tokenMint: string;
  timestamp: number;
  transactionCount: number;
  uniqueWallets: number;
  totalVolume: number;
  patterns: Pattern[];
  overallConfidence: number;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}

interface Alert {
  id: string;
  timestamp: number;
  token: string;
  riskLevel: string;
  confidence: number;
  patterns: string[];
  recommendation: string;
}

// ============ Pattern Detection (Mock) ============
// Replace with actual @orbitmm/core detection engine

async function analyzeToken(
  connection: Connection,
  tokenMint: PublicKey,
  lookbackMinutes: number
): Promise<AnalysisResult> {
  // Simulate analysis time
  await new Promise((r) => setTimeout(r, 1500));
  
  // Generate realistic mock data
  const now = Date.now();
  const transactionCount = Math.floor(Math.random() * 500) + 100;
  const uniqueWallets = Math.floor(transactionCount * (0.3 + Math.random() * 0.4));
  
  // Randomly generate patterns
  const patterns: Pattern[] = [];
  
  // Interval regularity check
  const intervalCV = Math.random() * 0.5; // Coefficient of variation
  if (intervalCV < 0.25) {
    patterns.push({
      type: 'interval_regularity',
      confidence: 0.9 - intervalCV * 2,
      severity: intervalCV < 0.15 ? 'high' : 'medium',
      description: 'Transaction intervals show abnormally low variance',
      evidence: [
        {
          metric: 'Coefficient of Variation',
          value: intervalCV,
          threshold: 0.3,
          deviation: `${Math.round((0.3 - intervalCV) / 0.3 * 100)}% below threshold`,
        },
      ],
    });
  }
  
  // Wallet clustering check
  const clusterRatio = Math.random();
  if (clusterRatio > 0.6 && Math.random() > 0.5) {
    patterns.push({
      type: 'wallet_clustering',
      confidence: clusterRatio * 0.9,
      severity: clusterRatio > 0.8 ? 'high' : 'medium',
      description: 'Multiple wallets share common funding sources',
      evidence: [
        {
          metric: 'Cluster Size',
          value: Math.floor(uniqueWallets * clusterRatio),
          threshold: 5,
          deviation: `${Math.floor(uniqueWallets * clusterRatio)} wallets in primary cluster`,
        },
      ],
    });
  }
  
  // Coordinated timing check
  if (Math.random() > 0.7) {
    const windowCount = Math.floor(Math.random() * 8) + 2;
    patterns.push({
      type: 'coordinated_timing',
      confidence: Math.min(0.95, windowCount * 0.1 + 0.3),
      severity: windowCount > 5 ? 'high' : windowCount > 3 ? 'medium' : 'low',
      description: 'Multiple wallets trading within short time windows',
      evidence: [
        {
          metric: 'Suspicious Windows',
          value: windowCount,
          threshold: 3,
          deviation: `${windowCount} windows with 3+ simultaneous trades`,
        },
      ],
    });
  }
  
  // Size distribution anomaly
  if (Math.random() > 0.6) {
    const giniCoeff = 0.2 + Math.random() * 0.3;
    patterns.push({
      type: 'size_distribution',
      confidence: 1 - giniCoeff,
      severity: giniCoeff < 0.25 ? 'high' : 'medium',
      description: 'Trade sizes show suspiciously uniform distribution',
      evidence: [
        {
          metric: 'Gini Coefficient',
          value: giniCoeff,
          threshold: 0.4,
          deviation: `Distribution ${Math.round((0.4 - giniCoeff) / 0.4 * 100)}% more uniform than expected`,
        },
      ],
    });
  }
  
  // Calculate overall confidence
  const overallConfidence = patterns.length > 0
    ? patterns.reduce((max, p) => Math.max(max, p.confidence), 0)
    : Math.random() * 0.3;
  
  // Determine risk level
  let riskLevel: 'low' | 'medium' | 'high' | 'critical';
  if (overallConfidence >= 0.85) {
    riskLevel = 'critical';
  } else if (overallConfidence >= 0.7) {
    riskLevel = 'high';
  } else if (overallConfidence >= 0.5) {
    riskLevel = 'medium';
  } else {
    riskLevel = 'low';
  }
  
  return {
    tokenMint: tokenMint.toString(),
    timestamp: now,
    transactionCount,
    uniqueWallets,
    totalVolume: Math.random() * 10000,
    patterns,
    overallConfidence,
    riskLevel,
  };
}

// ============ Alert Handling ============

async function sendWebhookAlert(alert: Alert): Promise<boolean> {
  if (!CONFIG.webhookUrl) return false;
  
  try {
    const response = await fetch(CONFIG.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        embeds: [{
          title: `🚨 Manipulation Alert: ${alert.riskLevel.toUpperCase()}`,
          description: alert.recommendation,
          color: alert.riskLevel === 'critical' ? 0xFF0000 
               : alert.riskLevel === 'high' ? 0xFF8800 
               : 0xFFFF00,
          fields: [
            { name: 'Token', value: alert.token, inline: true },
            { name: 'Confidence', value: `${Math.round(alert.confidence * 100)}%`, inline: true },
            { name: 'Patterns', value: alert.patterns.join(', ') },
          ],
          timestamp: new Date(alert.timestamp).toISOString(),
        }],
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function formatPatternType(type: PatternType): string {
  const labels: Record<PatternType, string> = {
    wallet_clustering: '👛 Wallet Clustering',
    interval_regularity: '⏱️ Interval Regularity',
    size_distribution: '📊 Size Distribution',
    coordinated_timing: '🎯 Coordinated Timing',
    new_wallet_spam: '🆕 New Wallet Spam',
    circular_trading: '🔄 Circular Trading',
    wash_trading: '🧼 Wash Trading',
  };
  return labels[type];
}

function formatConfidence(confidence: number): string {
  const pct = Math.round(confidence * 100);
  if (confidence >= 0.8) return `\x1b[31m${pct}%\x1b[0m`;  // Red
  if (confidence >= 0.6) return `\x1b[33m${pct}%\x1b[0m`;  // Yellow
  return `\x1b[32m${pct}%\x1b[0m`;  // Green
}

function formatRiskLevel(level: string): string {
  const colors: Record<string, string> = {
    critical: '\x1b[41m\x1b[37m CRITICAL \x1b[0m',
    high: '\x1b[31m HIGH \x1b[0m',
    medium: '\x1b[33m MEDIUM \x1b[0m',
    low: '\x1b[32m LOW \x1b[0m',
  };
  return colors[level] || level;
}

// ============ Monitor Loop ============

async function runMonitor(): Promise<void> {
  const connection = new Connection(CONFIG.rpcUrl, 'confirmed');
  const tokenMint = new PublicKey(CONFIG.targetToken);
  
  let checkCount = 0;
  let alertCount = 0;
  let isRunning = true;
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n\n🛑 Stopping monitor...');
    isRunning = false;
  });
  
  while (isRunning) {
    checkCount++;
    const checkTime = new Date().toLocaleTimeString();
    
    process.stdout.write(`\x1b[90m[${checkTime}]\x1b[0m Check #${checkCount}... `);
    
    try {
      const result = await analyzeToken(connection, tokenMint, CONFIG.lookbackMinutes);
      
      // Regular status line
      console.log(
        `${result.transactionCount} txs, ` +
        `${result.uniqueWallets} wallets, ` +
        `confidence: ${formatConfidence(result.overallConfidence)}`
      );
      
      // Verbose pattern output
      if (CONFIG.verbose && result.patterns.length > 0) {
        for (const pattern of result.patterns) {
          console.log(
            `    ${formatPatternType(pattern.type)} - ` +
            `confidence: ${formatConfidence(pattern.confidence)}`
          );
        }
      }
      
      // Check if we should alert
      if (result.overallConfidence >= CONFIG.alertThreshold) {
        alertCount++;
        
        const alert: Alert = {
          id: `alert-${Date.now()}`,
          timestamp: Date.now(),
          token: CONFIG.targetToken,
          riskLevel: result.riskLevel,
          confidence: result.overallConfidence,
          patterns: result.patterns.map((p) => formatPatternType(p.type)),
          recommendation: getRecommendation(result),
        };
        
        // Print alert box
        console.log('\n' + '═'.repeat(70));
        console.log(`  🚨 ALERT #${alertCount} - ${formatRiskLevel(result.riskLevel)}`);
        console.log('═'.repeat(70));
        console.log(`  Token:      ${CONFIG.targetToken}`);
        console.log(`  Confidence: ${formatConfidence(result.overallConfidence)}`);
        console.log(`  Patterns:`);
        for (const pattern of result.patterns) {
          console.log(`    • ${formatPatternType(pattern.type)} (${formatConfidence(pattern.confidence)})`);
          if (CONFIG.verbose) {
            for (const evidence of pattern.evidence) {
              console.log(`      └─ ${evidence.metric}: ${evidence.deviation}`);
            }
          }
        }
        console.log();
        console.log(`  ⚠️  ${alert.recommendation}`);
        console.log('═'.repeat(70) + '\n');
        
        // Send webhook if configured
        if (CONFIG.webhookUrl) {
          const sent = await sendWebhookAlert(alert);
          if (sent) {
            console.log('  📤 Alert sent to webhook\n');
          } else {
            console.log('  ⚠️  Failed to send webhook alert\n');
          }
        }
      }
    } catch (err) {
      console.log(`\x1b[31mError: ${err}\x1b[0m`);
    }
    
    // Wait for next check
    if (isRunning) {
      await new Promise((r) => setTimeout(r, CONFIG.checkIntervalSeconds * 1000));
    }
  }
  
  // Print summary
  console.log('\n' + '═'.repeat(50));
  console.log(' Monitor Summary');
  console.log('═'.repeat(50));
  console.log(`  Checks performed: ${checkCount}`);
  console.log(`  Alerts triggered: ${alertCount}`);
  console.log(`  Runtime: ${Math.round(checkCount * CONFIG.checkIntervalSeconds / 60)} minutes`);
  console.log('═'.repeat(50));
}

function getRecommendation(result: AnalysisResult): string {
  if (result.riskLevel === 'critical') {
    return 'CRITICAL: Strong evidence of market manipulation. Avoid trading this token.';
  }
  if (result.riskLevel === 'high') {
    return 'High likelihood of coordinated trading activity. Exercise extreme caution.';
  }
  if (result.riskLevel === 'medium') {
    return 'Suspicious patterns detected. Monitor closely before trading.';
  }
  return 'Low risk detected. Normal market activity observed.';
}

// ============ Main ============

async function main() {
  console.log('═'.repeat(60));
  console.log(' OrbitMM - Detection Monitor');
  console.log('═'.repeat(60));
  console.log();
  
  // Validate configuration
  if (CONFIG.targetToken === 'YOUR_TOKEN_MINT_ADDRESS') {
    console.error('❌ Error: Please set TARGET_TOKEN environment variable');
    console.log('\nExample:');
    console.log('  TARGET_TOKEN=TokenMintAddress npx ts-node examples/detection-monitor.ts');
    process.exit(1);
  }
  
  console.log('Configuration:');
  console.log(`  Token:          ${CONFIG.targetToken}`);
  console.log(`  RPC URL:        ${CONFIG.rpcUrl}`);
  console.log(`  Alert Threshold: ${Math.round(CONFIG.alertThreshold * 100)}%`);
  console.log(`  Check Interval: ${CONFIG.checkIntervalSeconds}s`);
  console.log(`  Lookback:       ${CONFIG.lookbackMinutes} minutes`);
  console.log(`  Webhook:        ${CONFIG.webhookUrl || '(not configured)'}`);
  console.log(`  Verbose:        ${CONFIG.verbose}`);
  console.log();
  console.log('─'.repeat(60));
  console.log('Starting monitor... Press Ctrl+C to stop');
  console.log('─'.repeat(60));
  console.log();
  
  await runMonitor();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
