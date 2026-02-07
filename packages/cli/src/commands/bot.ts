/**
 * OrbitMM CLI - Bot Commands
 * 
 * bot create [count] --token --config
 * bot start [ids...] --all
 * bot pause [ids...] --all
 * bot stop [ids...] --all
 * bot status [ids...]
 * bot merge <ids...>
 * bot split <id>
 */

import { Command } from 'commander';
import * as fs from 'fs/promises';
import * as path from 'path';
// NOTE: These imports will work once the orchestrator module is implemented
// import {
//   createOrchestrator,
//   type BotConfig,
//   type BotSnapshot,
//   type OrchestratorConfig,
// } from '@orbitmm/core';
import {
  colors,
  icons,
  table,
  spinner,
  ProgressBar,
  success,
  error,
  warning,
  info,
  header,
  newline,
  formatAddress,
  formatStatus,
  formatTime,
  formatDuration,
  formatSol,
  keyValue,
} from '../utils/display.js';

// Placeholder types until orchestrator is implemented
interface BotConfig {
  targetToken: string;
  direction: 'buy' | 'sell' | 'both';
  minSwapSol: number;
  maxSwapSol: number;
  minIntervalMs: number;
  maxIntervalMs: number;
  maxSwapsPerHour?: number;
  maxTotalVolumeSol?: number;
  stopAfterSwaps?: number;
}

interface BotSnapshot {
  id: string;
  walletPublicKey: string;
  state: 'idle' | 'running' | 'paused' | 'stopped' | 'error';
  config: BotConfig;
  stats: {
    swapsAttempted: number;
    swapsSuccessful: number;
    swapsFailed: number;
    totalVolumeSol: number;
    totalTokensBought: number;
    totalTokensSold: number;
    errors: string[];
    startedAt: number | null;
    lastSwapAt: number | null;
  };
  createdAt: number;
  updatedAt: number;
}

// ============ Helpers ============

function getConfigPath(): string {
  return process.env.ORBITMM_CONFIG_PATH ?? path.join(process.env.HOME ?? '.', '.orbitmm', 'bots.json');
}

async function loadBots(): Promise<BotSnapshot[]> {
  const configPath = getConfigPath();
  try {
    const content = await fs.readFile(configPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return [];
  }
}

async function saveBots(bots: BotSnapshot[]): Promise<void> {
  const configPath = getConfigPath();
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(bots, null, 2));
}

function parseConfig(configStr: string): Partial<BotConfig> {
  try {
    return JSON.parse(configStr);
  } catch {
    error(`Invalid config JSON: ${configStr}`);
    process.exit(1);
  }
}

function generateBotId(): string {
  return `bot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// ============ Commands ============

export function registerBotCommands(program: Command): void {
  const bot = program
    .command('bot')
    .description('Bot lifecycle management');

  // ---- bot create ----
  bot
    .command('create [count]')
    .description('Create new trading bots')
    .option('-t, --token <mint>', 'Target token mint address (required)')
    .option('-c, --config <json>', 'Bot configuration as JSON')
    .option('--min-swap <sol>', 'Minimum swap size in SOL', '0.01')
    .option('--max-swap <sol>', 'Maximum swap size in SOL', '0.1')
    .option('--min-interval <ms>', 'Minimum interval between swaps (ms)', '30000')
    .option('--max-interval <ms>', 'Maximum interval between swaps (ms)', '120000')
    .option('-d, --direction <dir>', 'Trading direction: buy, sell, or both', 'both')
    .option('--max-swaps-per-hour <n>', 'Maximum swaps per hour')
    .option('--max-volume <sol>', 'Maximum total volume in SOL')
    .option('--stop-after <n>', 'Stop after N swaps')
    .action(async (countArg: string | undefined, options) => {
      try {
        const count = parseInt(countArg ?? '1', 10);

        if (!options.token) {
          error('Token mint address is required. Use --token <mint>');
          process.exit(1);
        }

        if (isNaN(count) || count < 1) {
          error('Invalid count. Must be a positive integer.');
          process.exit(1);
        }

        header(`${icons.bot} Create ${count} Bot${count > 1 ? 's' : ''}`);

        // Build config
        let config: BotConfig;

        if (options.config) {
          const parsed = parseConfig(options.config);
          config = {
            targetToken: options.token,
            direction: parsed.direction ?? options.direction,
            minSwapSol: parsed.minSwapSol ?? parseFloat(options.minSwap),
            maxSwapSol: parsed.maxSwapSol ?? parseFloat(options.maxSwap),
            minIntervalMs: parsed.minIntervalMs ?? parseInt(options.minInterval, 10),
            maxIntervalMs: parsed.maxIntervalMs ?? parseInt(options.maxInterval, 10),
            maxSwapsPerHour: parsed.maxSwapsPerHour ?? options.maxSwapsPerHour ? parseInt(options.maxSwapsPerHour, 10) : undefined,
            maxTotalVolumeSol: parsed.maxTotalVolumeSol ?? options.maxVolume ? parseFloat(options.maxVolume) : undefined,
            stopAfterSwaps: parsed.stopAfterSwaps ?? options.stopAfter ? parseInt(options.stopAfter, 10) : undefined,
          };
        } else {
          config = {
            targetToken: options.token,
            direction: options.direction,
            minSwapSol: parseFloat(options.minSwap),
            maxSwapSol: parseFloat(options.maxSwap),
            minIntervalMs: parseInt(options.minInterval, 10),
            maxIntervalMs: parseInt(options.maxInterval, 10),
            maxSwapsPerHour: options.maxSwapsPerHour ? parseInt(options.maxSwapsPerHour, 10) : undefined,
            maxTotalVolumeSol: options.maxVolume ? parseFloat(options.maxVolume) : undefined,
            stopAfterSwaps: options.stopAfter ? parseInt(options.stopAfter, 10) : undefined,
          };
        }

        console.log();
        console.log(keyValue({
          'Target token': formatAddress(config.targetToken),
          'Direction': colors.highlight(config.direction),
          'Swap range': `${config.minSwapSol} - ${config.maxSwapSol} SOL`,
          'Interval range': `${formatDuration(config.minIntervalMs)} - ${formatDuration(config.maxIntervalMs)}`,
        }));

        const spin = spinner(`Creating ${count} bot${count > 1 ? 's' : ''}...`);
        spin.start();

        const bots = await loadBots();
        const newBots: BotSnapshot[] = [];

        for (let i = 0; i < count; i++) {
          const bot: BotSnapshot = {
            id: generateBotId(),
            walletPublicKey: '', // Will be assigned when orchestrator is running
            state: 'idle',
            config,
            stats: {
              swapsAttempted: 0,
              swapsSuccessful: 0,
              swapsFailed: 0,
              totalVolumeSol: 0,
              totalTokensBought: 0,
              totalTokensSold: 0,
              errors: [],
              startedAt: null,
              lastSwapAt: null,
            },
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          newBots.push(bot);
        }

        bots.push(...newBots);
        await saveBots(bots);

        spin.succeed(`Created ${count} bot${count > 1 ? 's' : ''}`);

        // Display created bots
        console.log();
        console.log(table(
          newBots.slice(0, 10).map((b) => ({
            id: b.id,
            state: b.state,
            created: b.createdAt,
          })),
          {
            columns: [
              { key: 'id', header: 'Bot ID' },
              { key: 'state', header: 'Status', format: (v) => formatStatus(String(v)) },
              { key: 'created', header: 'Created', format: (v) => formatTime(Number(v)) },
            ],
          }
        ));

        if (newBots.length > 10) {
          console.log(colors.muted(`  ... and ${newBots.length - 10} more`));
        }

        newline();
        success(`Created ${count} bot${count > 1 ? 's' : ''}. Use "bot start" to begin trading.`);

      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to create bots');
        process.exit(1);
      }
    });

  // ---- bot start ----
  bot
    .command('start [ids...]')
    .description('Start trading bots')
    .option('-a, --all', 'Start all idle bots')
    .action(async (ids: string[], options) => {
      try {
        header(`${icons.rocket} Start Bots`);

        const bots = await loadBots();

        if (bots.length === 0) {
          error('No bots found. Create bots first with "bot create".');
          process.exit(1);
        }

        let targetBots: BotSnapshot[];

        if (options.all) {
          targetBots = bots.filter((b) => b.state === 'idle' || b.state === 'paused');
        } else if (ids.length > 0) {
          targetBots = bots.filter((b) => ids.includes(b.id));
          const notFound = ids.filter((id) => !bots.find((b) => b.id === id));
          if (notFound.length > 0) {
            warning(`Bots not found: ${notFound.join(', ')}`);
          }
        } else {
          error('Specify bot IDs or use --all to start all bots.');
          process.exit(1);
        }

        if (targetBots.length === 0) {
          info('No eligible bots to start.');
          return;
        }

        const progress = new ProgressBar(targetBots.length, 'Starting');

        for (const bot of targetBots) {
          bot.state = 'running';
          bot.stats.startedAt = Date.now();
          bot.updatedAt = Date.now();
          progress.increment(bot.id);
        }

        await saveBots(bots);
        progress.succeed(`Started ${targetBots.length} bot${targetBots.length !== 1 ? 's' : ''}`);

        // NOTE: In production, this would connect to the orchestrator
        // to actually start the bot execution loops
        newline();
        warning('Note: Bot execution requires the orchestrator service to be running.');
        info('Run "orbitmm serve" to start the orchestrator daemon.');

      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to start bots');
        process.exit(1);
      }
    });

  // ---- bot pause ----
  bot
    .command('pause [ids...]')
    .description('Pause running bots')
    .option('-a, --all', 'Pause all running bots')
    .action(async (ids: string[], options) => {
      try {
        header(`${icons.clock} Pause Bots`);

        const bots = await loadBots();

        let targetBots: BotSnapshot[];

        if (options.all) {
          targetBots = bots.filter((b) => b.state === 'running');
        } else if (ids.length > 0) {
          targetBots = bots.filter((b) => ids.includes(b.id) && b.state === 'running');
        } else {
          error('Specify bot IDs or use --all to pause all bots.');
          process.exit(1);
        }

        if (targetBots.length === 0) {
          info('No running bots to pause.');
          return;
        }

        const progress = new ProgressBar(targetBots.length, 'Pausing');

        for (const bot of targetBots) {
          bot.state = 'paused';
          bot.updatedAt = Date.now();
          progress.increment(bot.id);
        }

        await saveBots(bots);
        progress.succeed(`Paused ${targetBots.length} bot${targetBots.length !== 1 ? 's' : ''}`);

      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to pause bots');
        process.exit(1);
      }
    });

  // ---- bot stop ----
  bot
    .command('stop [ids...]')
    .description('Stop bots (cannot be restarted)')
    .option('-a, --all', 'Stop all bots')
    .option('-f, --force', 'Force stop without confirmation')
    .action(async (ids: string[], options) => {
      try {
        header(`${icons.error} Stop Bots`);

        const bots = await loadBots();

        let targetBots: BotSnapshot[];

        if (options.all) {
          targetBots = bots.filter((b) => b.state !== 'stopped');
        } else if (ids.length > 0) {
          targetBots = bots.filter((b) => ids.includes(b.id) && b.state !== 'stopped');
        } else {
          error('Specify bot IDs or use --all to stop all bots.');
          process.exit(1);
        }

        if (targetBots.length === 0) {
          info('No bots to stop.');
          return;
        }

        if (!options.force && targetBots.length > 0) {
          warning(`This will permanently stop ${targetBots.length} bot${targetBots.length !== 1 ? 's' : ''}. Stopped bots cannot be restarted.`);
          info('Use --force to skip this confirmation.');
          // In a real CLI, we'd prompt for confirmation here
        }

        const progress = new ProgressBar(targetBots.length, 'Stopping');

        for (const bot of targetBots) {
          bot.state = 'stopped';
          bot.updatedAt = Date.now();
          progress.increment(bot.id);
        }

        await saveBots(bots);
        progress.succeed(`Stopped ${targetBots.length} bot${targetBots.length !== 1 ? 's' : ''}`);

      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to stop bots');
        process.exit(1);
      }
    });

  // ---- bot status ----
  bot
    .command('status [ids...]')
    .description('Show bot status')
    .option('-a, --all', 'Show all bots')
    .option('--json', 'Output as JSON')
    .option('-v, --verbose', 'Show detailed stats')
    .action(async (ids: string[], options) => {
      try {
        header(`${icons.chart} Bot Status`);

        const bots = await loadBots();

        if (bots.length === 0) {
          info('No bots found. Create bots with "bot create".');
          return;
        }

        let targetBots: BotSnapshot[];

        if (ids.length > 0) {
          targetBots = bots.filter((b) => ids.includes(b.id));
        } else if (options.all) {
          targetBots = bots;
        } else {
          // Show running/paused by default
          targetBots = bots.filter((b) => b.state === 'running' || b.state === 'paused');
          if (targetBots.length === 0) {
            targetBots = bots.slice(0, 10);
          }
        }

        if (options.json) {
          console.log(JSON.stringify(targetBots, null, 2));
          return;
        }

        // Summary
        const summary = {
          total: bots.length,
          running: bots.filter((b) => b.state === 'running').length,
          paused: bots.filter((b) => b.state === 'paused').length,
          idle: bots.filter((b) => b.state === 'idle').length,
          stopped: bots.filter((b) => b.state === 'stopped').length,
          error: bots.filter((b) => b.state === 'error').length,
        };

        console.log();
        console.log(keyValue({
          'Total bots': summary.total,
          'Running': colors.success(String(summary.running)),
          'Paused': colors.warning(String(summary.paused)),
          'Idle': colors.muted(String(summary.idle)),
          'Stopped': colors.muted(String(summary.stopped)),
          'Error': summary.error > 0 ? colors.error(String(summary.error)) : colors.muted('0'),
        }));

        // Bot table
        console.log();
        console.log(table(
          targetBots.map((b) => ({
            id: b.id,
            state: b.state,
            swaps: `${b.stats.swapsSuccessful}/${b.stats.swapsAttempted}`,
            volume: b.stats.totalVolumeSol,
            lastSwap: b.stats.lastSwapAt,
          })),
          {
            columns: [
              { key: 'id', header: 'Bot ID' },
              { key: 'state', header: 'Status', format: (v) => formatStatus(String(v)) },
              { key: 'swaps', header: 'Swaps' },
              { key: 'volume', header: 'Volume', align: 'right', format: (v) => formatSol(Number(v) * 1e9) },
              { key: 'lastSwap', header: 'Last Swap', format: (v) => v ? formatTime(Number(v)) : colors.muted('—') },
            ],
          }
        ));

        if (bots.length > targetBots.length) {
          console.log(colors.muted(`\n  Showing ${targetBots.length} of ${bots.length} bots. Use --all to show all.`));
        }

        // Verbose mode
        if (options.verbose && targetBots.length === 1) {
          const bot = targetBots[0];
          newline();
          header('Detailed Stats');
          console.log();
          console.log(keyValue({
            'Created': formatTime(bot.createdAt),
            'Updated': formatTime(bot.updatedAt),
            'Started': bot.stats.startedAt ? formatTime(bot.stats.startedAt) : '—',
            'Target token': formatAddress(bot.config.targetToken),
            'Direction': bot.config.direction,
            'Swap range': `${bot.config.minSwapSol} - ${bot.config.maxSwapSol} SOL`,
            'Interval': `${formatDuration(bot.config.minIntervalMs)} - ${formatDuration(bot.config.maxIntervalMs)}`,
            'Success rate': bot.stats.swapsAttempted > 0
              ? `${((bot.stats.swapsSuccessful / bot.stats.swapsAttempted) * 100).toFixed(1)}%`
              : '—',
            'Tokens bought': bot.stats.totalTokensBought.toLocaleString(),
            'Tokens sold': bot.stats.totalTokensSold.toLocaleString(),
          }));

          if (bot.stats.errors.length > 0) {
            newline();
            warning('Recent errors:');
            for (const err of bot.stats.errors.slice(-5)) {
              console.log(`  ${icons.error} ${err}`);
            }
          }
        }

      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to get status');
        process.exit(1);
      }
    });

  // ---- bot merge ----
  bot
    .command('merge <ids...>')
    .description('Merge multiple bots into one')
    .action(async (ids: string[]) => {
      try {
        if (ids.length < 2) {
          error('Need at least 2 bot IDs to merge.');
          process.exit(1);
        }

        header(`${icons.bot} Merge Bots`);

        const bots = await loadBots();
        const toMerge = bots.filter((b) => ids.includes(b.id));
        const notFound = ids.filter((id) => !bots.find((b) => b.id === id));

        if (notFound.length > 0) {
          error(`Bots not found: ${notFound.join(', ')}`);
          process.exit(1);
        }

        // Check all bots are stopped or idle
        const running = toMerge.filter((b) => b.state === 'running' || b.state === 'paused');
        if (running.length > 0) {
          error('Cannot merge running or paused bots. Stop them first.');
          process.exit(1);
        }

        info(`Merging ${toMerge.length} bots...`);

        // Create merged bot
        const primary = toMerge[0];
        const merged: BotSnapshot = {
          id: generateBotId(),
          walletPublicKey: primary.walletPublicKey,
          state: 'idle',
          config: primary.config,
          stats: {
            swapsAttempted: toMerge.reduce((sum, b) => sum + b.stats.swapsAttempted, 0),
            swapsSuccessful: toMerge.reduce((sum, b) => sum + b.stats.swapsSuccessful, 0),
            swapsFailed: toMerge.reduce((sum, b) => sum + b.stats.swapsFailed, 0),
            totalVolumeSol: toMerge.reduce((sum, b) => sum + b.stats.totalVolumeSol, 0),
            totalTokensBought: toMerge.reduce((sum, b) => sum + b.stats.totalTokensBought, 0),
            totalTokensSold: toMerge.reduce((sum, b) => sum + b.stats.totalTokensSold, 0),
            errors: toMerge.flatMap((b) => b.stats.errors).slice(-10),
            startedAt: null,
            lastSwapAt: Math.max(...toMerge.map((b) => b.stats.lastSwapAt ?? 0)) || null,
          },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        // Remove old bots, add merged
        const remaining = bots.filter((b) => !ids.includes(b.id));
        remaining.push(merged);
        await saveBots(remaining);

        success(`Merged ${toMerge.length} bots into ${merged.id}`);

        console.log();
        console.log(keyValue({
          'New bot ID': merged.id,
          'Combined swaps': merged.stats.swapsAttempted,
          'Combined volume': formatSol(merged.stats.totalVolumeSol * 1e9),
        }));

      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to merge bots');
        process.exit(1);
      }
    });

  // ---- bot split ----
  bot
    .command('split <id>')
    .description('Split a bot into two')
    .action(async (id: string) => {
      try {
        header(`${icons.bot} Split Bot`);

        const bots = await loadBots();
        const botIndex = bots.findIndex((b) => b.id === id);

        if (botIndex === -1) {
          error(`Bot not found: ${id}`);
          process.exit(1);
        }

        const original = bots[botIndex];

        if (original.state === 'running' || original.state === 'paused') {
          error('Cannot split a running or paused bot. Stop it first.');
          process.exit(1);
        }

        info(`Splitting bot ${id}...`);

        // Create two new bots with same config
        const bot1: BotSnapshot = {
          id: generateBotId(),
          walletPublicKey: '',
          state: 'idle',
          config: { ...original.config },
          stats: {
            swapsAttempted: 0,
            swapsSuccessful: 0,
            swapsFailed: 0,
            totalVolumeSol: 0,
            totalTokensBought: 0,
            totalTokensSold: 0,
            errors: [],
            startedAt: null,
            lastSwapAt: null,
          },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        const bot2: BotSnapshot = {
          id: generateBotId(),
          walletPublicKey: '',
          state: 'idle',
          config: { ...original.config },
          stats: {
            swapsAttempted: 0,
            swapsSuccessful: 0,
            swapsFailed: 0,
            totalVolumeSol: 0,
            totalTokensBought: 0,
            totalTokensSold: 0,
            errors: [],
            startedAt: null,
            lastSwapAt: null,
          },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };

        // Remove original, add two new
        bots.splice(botIndex, 1, bot1, bot2);
        await saveBots(bots);

        success(`Split into ${bot1.id} and ${bot2.id}`);

        console.log();
        console.log(table(
          [bot1, bot2].map((b) => ({
            id: b.id,
            state: b.state,
          })),
          {
            columns: [
              { key: 'id', header: 'Bot ID' },
              { key: 'state', header: 'Status', format: (v) => formatStatus(String(v)) },
            ],
          }
        ));

      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to split bot');
        process.exit(1);
      }
    });
}
