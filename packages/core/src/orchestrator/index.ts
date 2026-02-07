/**
 * OrbitMM Orchestrator Module
 * 
 * Bot orchestration system for coordinated trading operations.
 * Supports up to 1000+ concurrent bots with pause/resume and crash recovery.
 * 
 * @module orchestrator
 */

// ============ Types ============

export type {
  // Bot types
  BotState,
  BotConfig,
  BotStats,
  BotSnapshot,
  
  // Orchestrator types
  OrchestratorConfig,
  OrchestratorStats,
  
  // WAL types
  WALEntry,
  WALEntryType,
  OrchestratorSnapshot,
  
  // Event types
  OrchestratorEvent,
  SwapEventData,
  BotEventData,
  
  // RPC Pool types
  RPCEndpoint,
  RPCPoolConfig,
  RPCPoolStrategy,
} from './types.js';

// Helper functions (runtime exports)
export {
  createDefaultBotStats,
  createDefaultOrchestratorConfig,
  isValidStateTransition,
} from './types.js';

// ============ Bot ============

export type { BotOptions } from './bot.js';

export {
  Bot,
  createBot,
  BotAlreadyRunningError,
  BotNotRunningError,
  InvalidStateTransitionError,
} from './bot.js';

// ============ Manager ============

export type { BotManagerConfig } from './manager.js';

export {
  BotManager,
  createOrchestrator,
} from './manager.js';

// ============ Scheduler ============

export type { SchedulerConfig } from './scheduler.js';

export {
  Semaphore,
  RateLimiter,
  CircuitBreaker,
  CircuitBreakerOpenError,
  RPCPool,
  NoHealthyEndpointsError,
  SwapScheduler,
  calculateBackoff,
  retryWithBackoff,
} from './scheduler.js';

// ============ Persistence ============

export type {
  WALManagerConfig,
  SnapshotManagerConfig,
  PersistenceConfig,
  RecoveryResult,
} from './persistence.js';

export {
  WALManager,
  SnapshotManager,
  PersistenceManager,
  createWALEntry,
  verifyWALEntry,
} from './persistence.js';

// ============ Main Orchestrator Class ============

import { Keypair } from '@solana/web3.js';
import { BotManager, BotManagerConfig, createOrchestrator } from './manager.js';
import { BotConfig, OrchestratorStats, BotSnapshot, OrchestratorConfig } from './types.js';
import { Bot } from './bot.js';

/**
 * Main Orchestrator class - high-level API for bot orchestration.
 * 
 * @example
 * ```typescript
 * const orchestrator = await Orchestrator.create({
 *   maxConcurrentSwaps: 50,
 *   rpcEndpoints: ['https://api.mainnet-beta.solana.com'],
 * });
 * 
 * // Create bots
 * const bots = orchestrator.createBots(wallets, {
 *   targetToken: 'So11111111111111111111111111111111111111112',
 *   direction: 'both',
 *   minSwapSol: 0.01,
 *   maxSwapSol: 0.1,
 *   minIntervalMs: 30000,
 *   maxIntervalMs: 120000,
 * });
 * 
 * // Start all bots
 * orchestrator.startAll();
 * 
 * // Monitor events
 * orchestrator.on('swap:completed', (data) => {
 *   console.log(`Bot ${data.botId} completed swap: ${data.signature}`);
 * });
 * 
 * // Graceful shutdown
 * await orchestrator.shutdown();
 * ```
 */
export class Orchestrator {
  private manager: BotManager;

  private constructor(manager: BotManager) {
    this.manager = manager;
  }

  /**
   * Create a new Orchestrator instance.
   * Automatically recovers state if persistence is enabled.
   */
  static async create(config?: Partial<OrchestratorConfig>): Promise<Orchestrator> {
    const manager = await createOrchestrator(config);
    manager.start();
    return new Orchestrator(manager);
  }

  // ============ Bot Management ============

  /**
   * Create new bots with given wallets and config.
   */
  createBots(wallets: Keypair[], config: BotConfig): Bot[] {
    return this.manager.createBots(wallets, config);
  }

  /**
   * Create a single bot.
   */
  createBot(wallet: Keypair, config: BotConfig): Bot {
    return this.manager.createBot(wallet, config);
  }

  /**
   * Get a bot by ID.
   */
  getBot(botId: string): Bot | undefined {
    return this.manager.getBot(botId);
  }

  /**
   * Get all bots.
   */
  getAllBots(): Bot[] {
    return this.manager.getAllBots();
  }

  /**
   * Get all bot snapshots.
   */
  getBotSnapshots(): BotSnapshot[] {
    return this.manager.getBots();
  }

  // ============ Bot Control ============

  /**
   * Start bots by ID.
   */
  startBots(botIds: string[]): void {
    this.manager.startBots(botIds);
  }

  /**
   * Start all idle/error bots.
   */
  startAll(): void {
    this.manager.startAll();
  }

  /**
   * Pause bots by ID.
   */
  pauseBots(botIds: string[]): void {
    this.manager.pauseBots(botIds);
  }

  /**
   * Pause all running bots.
   */
  pauseAll(): void {
    this.manager.pauseAll();
  }

  /**
   * Resume paused bots by ID.
   */
  resumeBots(botIds: string[]): void {
    this.manager.resumeBots(botIds);
  }

  /**
   * Resume all paused bots.
   */
  resumeAll(): void {
    this.manager.resumeAll();
  }

  /**
   * Stop bots by ID. Stopped bots cannot be restarted.
   */
  stopBots(botIds: string[]): void {
    this.manager.stopBots(botIds);
  }

  /**
   * Stop all bots.
   */
  stopAll(): void {
    this.manager.stopAll();
  }

  // ============ Advanced Operations ============

  /**
   * Merge multiple bots into one.
   */
  mergeBots(botIds: string[]): Bot | null {
    return this.manager.mergeBots(botIds);
  }

  /**
   * Split a bot into two.
   */
  splitBot(botId: string): [Bot, Bot] | null {
    return this.manager.splitBot(botId);
  }

  /**
   * Remove a stopped bot.
   */
  removeBot(botId: string): boolean {
    return this.manager.removeBot(botId);
  }

  // ============ Statistics ============

  /**
   * Get orchestrator statistics.
   */
  getStats(): OrchestratorStats {
    return this.manager.getStats();
  }

  /**
   * Get scheduler statistics.
   */
  getSchedulerStats(): ReturnType<BotManager['getSchedulerStats']> {
    return this.manager.getSchedulerStats();
  }

  // ============ Events ============

  /**
   * Subscribe to orchestrator events.
   */
  on(event: string, handler: (...args: unknown[]) => void): this {
    this.manager.on(event, handler);
    return this;
  }

  /**
   * Unsubscribe from orchestrator events.
   */
  off(event: string, handler: (...args: unknown[]) => void): this {
    this.manager.off(event, handler);
    return this;
  }

  /**
   * Subscribe to event once.
   */
  once(event: string, handler: (...args: unknown[]) => void): this {
    this.manager.once(event, handler);
    return this;
  }

  // ============ Persistence ============

  /**
   * Create a manual snapshot.
   */
  createSnapshot(): void {
    this.manager.createSnapshot();
  }

  // ============ Lifecycle ============

  /**
   * Shutdown the orchestrator gracefully.
   */
  async shutdown(): Promise<void> {
    await this.manager.shutdown();
  }
}
