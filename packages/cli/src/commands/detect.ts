/**
 * OrbitMM CLI - Detection Commands
 * 
 * detect analyze <token> --hours
 * detect monitor <token> --alert
 */

import { Command } from 'commander';
import { PublicKey, Connection } from '@solana/web3.js';
// NOTE: These imports will work once the detection module is implemented
// import {
//   analyzeToken,
//   startMonitor,
//   type AnalysisResult,
//   type Pattern,
//   type Alert,
// } from '@orbitmm/core';
import {
  colors,
  icons,
  table,
  spinner,
  success,
  error,
  warning,
  info,
  header,
  newline,
  formatAddress,
  formatTime,
  formatDuration,
  keyValue,
  formatPercent,
} from '../utils/display.js';

// ============ Placeholder Types ============

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
  evidence: Evidence[];
  detectedAt: number;
}

interface Evidence {
  type: string;
  description: string;
  data: Record<string, unknown>;
}

interface AnalysisResult {
  tokenMint: string;
  analyzedAt: number;
  transactionCount: number;
  timeRange: { start: number; end: number };
  patterns: Pattern[];
  overallConfidence: number;
  recommendation: string;
}

interface MonitorConfig {
  tokenMint: string;
  alertThreshold: number;
  checkIntervalMs: number;
  lookbackMs: number;
}

interface Alert {
  id: string;
  timestamp: number;
  priority: 'low' | 'medium' | 'high' | 'critical';
  token: { mint: string; symbol?: string };
  patterns: Pattern[];
  confidence: number;
  recommendation: string;
}

// ============ Helpers ============

function getConnection(): Connection {
  const rpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com';
  return new Connection(rpcUrl, 'confirmed');
}

function formatSeverity(severity: 'low' | 'medium' | 'high'): string {
  switch (severity) {
    case 'high':
      return colors.error('HIGH');
    case 'medium':
      return colors.warning('MEDIUM');
    case 'low':
      return colors.muted('LOW');
  }
}

function formatConfidence(confidence: number): string {
  const pct = Math.round(confidence * 100);
  if (confidence >= 0.7) return colors.error(`${pct}%`);
  if (confidence >= 0.5) return colors.warning(`${pct}%`);
  return colors.muted(`${pct}%`);
}

function formatPatternType(type: PatternType): string {
  const labels: Record<PatternType, string> = {
    wallet_clustering: 'Wallet Clustering',
    interval_regularity: 'Interval Regularity',
    size_distribution: 'Size Distribution',
    coordinated_timing: 'Coordinated Timing',
    new_wallet_spam: 'New Wallet Spam',
    circular_trading: 'Circular Trading',
    wash_trading: 'Wash Trading',
  };
  return labels[type] ?? type;
}

// Mock analysis function until detection module is implemented
async function mockAnalyzeToken(
  tokenMint: string,
  hours: number
): Promise<AnalysisResult> {
  // Simulate API delay
  await new Promise((r) => setTimeout(r, 1500));

  const now = Date.now();
  const hoursMs = hours * 60 * 60 * 1000;

  // Generate mock patterns
  const patterns: Pattern[] = [
    {
      type: 'interval_regularity',
      confidence: 0.72,
      severity: 'high',
      evidence: [
        {
          type: 'statistical',
          description: 'Transaction intervals show low variance (CV=0.23)',
          data: { cv: 0.23, mean: 45000, variance: 10350000 },
        },
      ],
      detectedAt: now,
    },
    {
      type: 'coordinated_timing',
      confidence: 0.58,
      severity: 'medium',
      evidence: [
        {
          type: 'temporal',
          description: '4 time windows with 3+ wallets trading within 5 seconds',
          data: { windowCount: 4 },
        },
      ],
      detectedAt: now,
    },
    {
      type: 'wallet_clustering',
      confidence: 0.45,
      severity: 'low',
      evidence: [
        {
          type: 'funding',
          description: '12 wallets share common funding source',
          data: { clusterSize: 12, fundingSource: 'mock-funder-address' },
        },
      ],
      detectedAt: now,
    },
  ];

  const overallConfidence = Math.max(...patterns.map((p) => p.confidence));

  return {
    tokenMint,
    analyzedAt: now,
    transactionCount: 1247,
    timeRange: { start: now - hoursMs, end: now },
    patterns,
    overallConfidence,
    recommendation:
      overallConfidence > 0.7
        ? 'High likelihood of market manipulation. Exercise extreme caution.'
        : overallConfidence > 0.5
          ? 'Some suspicious patterns detected. Proceed with caution.'
          : 'No significant manipulation patterns detected.',
  };
}

// ============ Commands ============

export function registerDetectCommands(program: Command): void {
  const detect = program
    .command('detect')
    .description('Market manipulation detection');

  // ---- detect analyze ----
  detect
    .command('analyze <token>')
    .description('Analyze token for manipulation patterns')
    .option('-h, --hours <n>', 'Hours of history to analyze', '24')
    .option('--limit <n>', 'Maximum transactions to analyze', '10000')
    .option('--json', 'Output as JSON')
    .option('-v, --verbose', 'Show detailed evidence')
    .action(async (token: string, options) => {
      try {
        const hours = parseInt(options.hours, 10);

        if (isNaN(hours) || hours <= 0) {
          error('Invalid hours. Must be a positive integer.');
          process.exit(1);
        }

        header(`${icons.chart} Analyze Token`);

        let tokenMint: string;
        try {
          new PublicKey(token);
          tokenMint = token;
        } catch {
          error('Invalid token mint address.');
          process.exit(1);
        }

        console.log();
        console.log(keyValue({
          'Token': formatAddress(tokenMint),
          'Time range': `Last ${hours} hour${hours !== 1 ? 's' : ''}`,
          'Max transactions': parseInt(options.limit, 10).toLocaleString(),
        }));

        const spin = spinner('Fetching and analyzing transactions...');
        spin.start();

        // TODO: Replace with actual detection module call
        // const result = await analyzeToken(connection, new PublicKey(tokenMint), {
        //   timeRangeMs: hours * 60 * 60 * 1000,
        //   limit: parseInt(options.limit, 10),
        // });
        const result = await mockAnalyzeToken(tokenMint, hours);

        spin.succeed(`Analyzed ${result.transactionCount.toLocaleString()} transactions`);

        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        // Summary
        newline();
        header('Analysis Results');
        console.log();
        console.log(keyValue({
          'Transactions analyzed': result.transactionCount.toLocaleString(),
          'Time range': `${formatTime(result.timeRange.start)} — ${formatTime(result.timeRange.end)}`,
          'Patterns detected': result.patterns.length,
          'Overall confidence': formatConfidence(result.overallConfidence),
        }));

        // Patterns table
        if (result.patterns.length > 0) {
          newline();
          header('Detected Patterns');
          console.log();
          console.log(
            table(
              result.patterns.map((p) => ({
                type: p.type,
                confidence: p.confidence,
                severity: p.severity,
              })),
              {
                columns: [
                  { key: 'type', header: 'Pattern', format: (v) => formatPatternType(v as PatternType) },
                  { key: 'confidence', header: 'Confidence', align: 'right', format: (v) => formatConfidence(v as number) },
                  { key: 'severity', header: 'Severity', format: (v) => formatSeverity(v as 'low' | 'medium' | 'high') },
                ],
              }
            )
          );

          // Verbose mode: show evidence
          if (options.verbose) {
            for (const pattern of result.patterns) {
              newline();
              console.log(colors.highlight(formatPatternType(pattern.type)));
              for (const evidence of pattern.evidence) {
                console.log(`  ${icons.bullet} ${evidence.description}`);
                if (Object.keys(evidence.data).length > 0) {
                  console.log(
                    colors.muted(
                      `    Data: ${JSON.stringify(evidence.data)}`
                    )
                  );
                }
              }
            }
          }
        }

        // Recommendation
        newline();
        const recIcon = result.overallConfidence > 0.7 ? icons.alert : result.overallConfidence > 0.5 ? icons.warning : icons.info;
        const recColor = result.overallConfidence > 0.7 ? colors.error : result.overallConfidence > 0.5 ? colors.warning : colors.info;
        console.log(`${recIcon} ${recColor(result.recommendation)}`);

      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to analyze token');
        process.exit(1);
      }
    });

  // ---- detect monitor ----
  detect
    .command('monitor <token>')
    .description('Monitor token for manipulation in real-time')
    .option('-a, --alert <threshold>', 'Alert threshold (0.0-1.0)', '0.7')
    .option('-i, --interval <seconds>', 'Check interval in seconds', '60')
    .option('--lookback <minutes>', 'Lookback window in minutes', '30')
    .option('--webhook <url>', 'Webhook URL for alerts')
    .option('--quiet', 'Only output alerts')
    .action(async (token: string, options) => {
      try {
        const alertThreshold = parseFloat(options.alert);
        const intervalSeconds = parseInt(options.interval, 10);
        const lookbackMinutes = parseInt(options.lookback, 10);

        if (isNaN(alertThreshold) || alertThreshold < 0 || alertThreshold > 1) {
          error('Invalid alert threshold. Must be between 0.0 and 1.0.');
          process.exit(1);
        }

        let tokenMint: string;
        try {
          new PublicKey(token);
          tokenMint = token;
        } catch {
          error('Invalid token mint address.');
          process.exit(1);
        }

        header(`${icons.alert} Real-time Monitor`);

        console.log();
        console.log(keyValue({
          'Token': formatAddress(tokenMint),
          'Alert threshold': formatConfidence(alertThreshold),
          'Check interval': formatDuration(intervalSeconds * 1000),
          'Lookback window': formatDuration(lookbackMinutes * 60 * 1000),
        }));

        if (options.webhook) {
          info(`Alerts will be sent to: ${options.webhook}`);
        }

        newline();
        info('Starting monitor... Press Ctrl+C to stop.');
        newline();

        // Monitor loop
        let checkCount = 0;
        let alertCount = 0;

        const runCheck = async () => {
          checkCount++;

          if (!options.quiet) {
            process.stdout.write(
              `${colors.muted(`[${new Date().toLocaleTimeString()}]`)} Checking... `
            );
          }

          try {
            // TODO: Replace with actual detection module call
            const result = await mockAnalyzeToken(tokenMint, lookbackMinutes / 60);

            if (!options.quiet) {
              console.log(
                `${result.transactionCount} txs, confidence: ${formatConfidence(result.overallConfidence)}`
              );
            }

            // Check for alert
            if (result.overallConfidence >= alertThreshold) {
              alertCount++;

              const alert: Alert = {
                id: `alert-${Date.now()}`,
                timestamp: Date.now(),
                priority: result.overallConfidence > 0.85 ? 'critical' : result.overallConfidence > 0.7 ? 'high' : 'medium',
                token: { mint: tokenMint },
                patterns: result.patterns,
                confidence: result.overallConfidence,
                recommendation: result.recommendation,
              };

              newline();
              console.log(colors.error('═'.repeat(60)));
              console.log(`${icons.alert} ${colors.error.bold('ALERT')} — Manipulation Detected`);
              console.log(colors.error('═'.repeat(60)));
              console.log();
              console.log(keyValue({
                'Time': formatTime(alert.timestamp),
                'Priority': colors.error(alert.priority.toUpperCase()),
                'Confidence': formatConfidence(alert.confidence),
                'Patterns': alert.patterns.map((p) => formatPatternType(p.type)).join(', '),
              }));
              console.log();
              console.log(`${icons.warning} ${colors.warning(alert.recommendation)}`);
              console.log(colors.error('═'.repeat(60)));
              newline();

              // Send webhook if configured
              if (options.webhook) {
                try {
                  await fetch(options.webhook, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(alert),
                  });
                  info('Alert sent to webhook');
                } catch (err) {
                  warning('Failed to send webhook alert');
                }
              }
            }
          } catch (err) {
            if (!options.quiet) {
              console.log(colors.error('Error during check'));
            }
          }
        };

        // Run first check immediately
        await runCheck();

        // Set up interval
        const intervalId = setInterval(runCheck, intervalSeconds * 1000);

        // Handle graceful shutdown
        process.on('SIGINT', () => {
          clearInterval(intervalId);
          newline();
          header('Monitor Summary');
          console.log();
          console.log(keyValue({
            'Total checks': checkCount,
            'Alerts triggered': alertCount,
            'Runtime': formatDuration(checkCount * intervalSeconds * 1000),
          }));
          newline();
          info('Monitor stopped.');
          process.exit(0);
        });

        // Keep process alive
        await new Promise(() => {}); // Never resolves

      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to start monitor');
        process.exit(1);
      }
    });
}
