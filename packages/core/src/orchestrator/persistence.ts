/**
 * OrbitMM Persistence
 * 
 * Write-ahead log (WAL) and snapshot management for crash recovery.
 * Following ARCHITECT_SPEC.md Section 4.3 specifications.
 */

import { createHash, randomUUID } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync, unlinkSync, renameSync } from 'fs';
import { dirname, join, basename } from 'path';
import {
  WALEntry,
  WALEntryType,
  OrchestratorSnapshot,
  BotSnapshot,
  OrchestratorStats,
} from './types.js';

// ============ Constants ============

const SNAPSHOT_VERSION = 1;
const WAL_FILE_EXTENSION = '.wal';
const SNAPSHOT_FILE_EXTENSION = '.snapshot.json';
const MAX_WAL_ENTRIES_BEFORE_SNAPSHOT = 1000;
const MAX_SNAPSHOTS_TO_KEEP = 10;

// ============ WAL Entry Helpers ============

/**
 * Create a new WAL entry with checksum.
 */
export function createWALEntry(type: WALEntryType, data: unknown): WALEntry {
  const entry: Omit<WALEntry, 'checksum'> = {
    id: randomUUID(),
    timestamp: Date.now(),
    type,
    data,
  };
  
  const checksum = calculateChecksum(entry);
  
  return { ...entry, checksum };
}

/**
 * Calculate SHA-256 checksum for a WAL entry.
 */
function calculateChecksum(entry: Omit<WALEntry, 'checksum'>): string {
  const content = JSON.stringify({
    id: entry.id,
    timestamp: entry.timestamp,
    type: entry.type,
    data: entry.data,
  });
  
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Verify WAL entry checksum.
 */
export function verifyWALEntry(entry: WALEntry): boolean {
  const { checksum, ...rest } = entry;
  const calculated = calculateChecksum(rest);
  return calculated === checksum;
}

// ============ WAL Manager ============

export interface WALManagerConfig {
  /** Path to WAL file */
  walPath: string;
  /** Maximum entries before triggering snapshot */
  maxEntriesBeforeSnapshot?: number;
}

/**
 * Write-ahead log manager for crash recovery.
 */
export class WALManager {
  private walPath: string;
  private entriesWritten: number = 0;
  private readonly maxEntriesBeforeSnapshot: number;

  constructor(config: WALManagerConfig) {
    this.walPath = config.walPath;
    this.maxEntriesBeforeSnapshot = config.maxEntriesBeforeSnapshot ?? MAX_WAL_ENTRIES_BEFORE_SNAPSHOT;
    
    // Ensure directory exists
    const dir = dirname(this.walPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Append entry to WAL.
   */
  append(type: WALEntryType, data: unknown): WALEntry {
    const entry = createWALEntry(type, data);
    const line = JSON.stringify(entry) + '\n';
    
    appendFileSync(this.walPath, line, 'utf-8');
    this.entriesWritten++;
    
    return entry;
  }

  /**
   * Read all WAL entries.
   */
  readAll(): WALEntry[] {
    if (!existsSync(this.walPath)) {
      return [];
    }
    
    const content = readFileSync(this.walPath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.length > 0);
    
    const entries: WALEntry[] = [];
    
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as WALEntry;
        
        if (verifyWALEntry(entry)) {
          entries.push(entry);
        } else {
          console.warn(`WAL entry ${entry.id} failed checksum verification`);
        }
      } catch (error) {
        console.warn(`Failed to parse WAL entry: ${line}`);
      }
    }
    
    return entries;
  }

  /**
   * Read WAL entries after a given timestamp.
   */
  readAfter(timestamp: number): WALEntry[] {
    return this.readAll().filter(entry => entry.timestamp > timestamp);
  }

  /**
   * Clear the WAL file.
   */
  clear(): void {
    if (existsSync(this.walPath)) {
      writeFileSync(this.walPath, '', 'utf-8');
    }
    this.entriesWritten = 0;
  }

  /**
   * Rotate WAL file (rename current, start fresh).
   */
  rotate(): string {
    if (!existsSync(this.walPath)) {
      return this.walPath;
    }
    
    const timestamp = Date.now();
    const rotatedPath = `${this.walPath}.${timestamp}`;
    
    renameSync(this.walPath, rotatedPath);
    this.entriesWritten = 0;
    
    return rotatedPath;
  }

  /**
   * Check if snapshot should be triggered.
   */
  shouldSnapshot(): boolean {
    return this.entriesWritten >= this.maxEntriesBeforeSnapshot;
  }

  /**
   * Get current entry count.
   */
  get entryCount(): number {
    return this.entriesWritten;
  }
}

// ============ Snapshot Manager ============

export interface SnapshotManagerConfig {
  /** Directory for snapshots */
  snapshotDir: string;
  /** Maximum snapshots to keep */
  maxSnapshots?: number;
}

/**
 * Snapshot manager for periodic state persistence.
 */
export class SnapshotManager {
  private snapshotDir: string;
  private readonly maxSnapshots: number;

  constructor(config: SnapshotManagerConfig) {
    this.snapshotDir = config.snapshotDir;
    this.maxSnapshots = config.maxSnapshots ?? MAX_SNAPSHOTS_TO_KEEP;
    
    // Ensure directory exists
    if (!existsSync(this.snapshotDir)) {
      mkdirSync(this.snapshotDir, { recursive: true });
    }
  }

  /**
   * Create a snapshot.
   */
  createSnapshot(
    bots: BotSnapshot[],
    stats: OrchestratorStats
  ): OrchestratorSnapshot {
    const snapshot: OrchestratorSnapshot = {
      version: SNAPSHOT_VERSION,
      timestamp: Date.now(),
      bots,
      stats,
    };
    
    const filename = `${snapshot.timestamp}${SNAPSHOT_FILE_EXTENSION}`;
    const filepath = join(this.snapshotDir, filename);
    
    // Write atomically (temp file + rename)
    const tempPath = `${filepath}.tmp`;
    writeFileSync(tempPath, JSON.stringify(snapshot, null, 2), 'utf-8');
    renameSync(tempPath, filepath);
    
    // Cleanup old snapshots
    this.cleanup();
    
    return snapshot;
  }

  /**
   * Load the latest snapshot.
   */
  loadLatest(): OrchestratorSnapshot | null {
    const files = this.listSnapshots();
    
    if (files.length === 0) {
      return null;
    }
    
    // Sort by timestamp (descending)
    files.sort((a, b) => {
      const tsA = parseInt(basename(a).split('.')[0], 10);
      const tsB = parseInt(basename(b).split('.')[0], 10);
      return tsB - tsA;
    });
    
    const latestPath = join(this.snapshotDir, files[0]);
    
    try {
      const content = readFileSync(latestPath, 'utf-8');
      const snapshot = JSON.parse(content) as OrchestratorSnapshot;
      
      // Version check
      if (snapshot.version !== SNAPSHOT_VERSION) {
        console.warn(`Snapshot version mismatch: ${snapshot.version} vs ${SNAPSHOT_VERSION}`);
        // Could add migration logic here
      }
      
      return snapshot;
    } catch (error) {
      console.error(`Failed to load snapshot: ${latestPath}`, error);
      return null;
    }
  }

  /**
   * Load a specific snapshot.
   */
  load(timestamp: number): OrchestratorSnapshot | null {
    const filename = `${timestamp}${SNAPSHOT_FILE_EXTENSION}`;
    const filepath = join(this.snapshotDir, filename);
    
    if (!existsSync(filepath)) {
      return null;
    }
    
    try {
      const content = readFileSync(filepath, 'utf-8');
      return JSON.parse(content) as OrchestratorSnapshot;
    } catch (error) {
      console.error(`Failed to load snapshot: ${filepath}`, error);
      return null;
    }
  }

  /**
   * List all snapshot files.
   */
  private listSnapshots(): string[] {
    if (!existsSync(this.snapshotDir)) {
      return [];
    }
    
    return readdirSync(this.snapshotDir)
      .filter(file => file.endsWith(SNAPSHOT_FILE_EXTENSION));
  }

  /**
   * Cleanup old snapshots beyond max limit.
   */
  private cleanup(): void {
    const files = this.listSnapshots();
    
    if (files.length <= this.maxSnapshots) {
      return;
    }
    
    // Sort by timestamp (descending)
    files.sort((a, b) => {
      const tsA = parseInt(basename(a).split('.')[0], 10);
      const tsB = parseInt(basename(b).split('.')[0], 10);
      return tsB - tsA;
    });
    
    // Remove old snapshots
    const toRemove = files.slice(this.maxSnapshots);
    for (const file of toRemove) {
      const filepath = join(this.snapshotDir, file);
      try {
        unlinkSync(filepath);
      } catch (error) {
        console.warn(`Failed to remove old snapshot: ${filepath}`);
      }
    }
  }
}

// ============ Persistence Manager ============

export interface PersistenceConfig {
  /** Enable persistence */
  enabled: boolean;
  /** Path to WAL file */
  walPath: string;
  /** Directory for snapshots */
  snapshotDir: string;
  /** Snapshot interval in milliseconds */
  snapshotIntervalMs: number;
}

export interface RecoveryResult {
  /** Recovered bot snapshots */
  bots: BotSnapshot[];
  /** Recovered stats */
  stats: OrchestratorStats | null;
  /** Whether recovery was from snapshot */
  fromSnapshot: boolean;
  /** Number of WAL entries replayed */
  walEntriesReplayed: number;
  /** Bots that were running before crash (now paused) */
  pausedForReview: string[];
}

/**
 * Combined persistence manager for WAL and snapshots.
 */
export class PersistenceManager {
  private walManager: WALManager | null = null;
  private snapshotManager: SnapshotManager | null = null;
  private snapshotInterval: NodeJS.Timeout | null = null;
  private enabled: boolean;
  private config: PersistenceConfig;

  constructor(config: PersistenceConfig) {
    this.config = config;
    this.enabled = config.enabled;
    
    if (this.enabled) {
      this.walManager = new WALManager({ walPath: config.walPath });
      this.snapshotManager = new SnapshotManager({
        snapshotDir: config.snapshotDir,
      });
    }
  }

  /**
   * Start periodic snapshots.
   */
  startPeriodicSnapshots(getState: () => { bots: BotSnapshot[]; stats: OrchestratorStats }): void {
    if (!this.enabled) return;
    
    this.snapshotInterval = setInterval(() => {
      const { bots, stats } = getState();
      this.createSnapshot(bots, stats);
      
      // Clear WAL after successful snapshot
      this.walManager?.clear();
    }, this.config.snapshotIntervalMs);
  }

  /**
   * Stop periodic snapshots.
   */
  stopPeriodicSnapshots(): void {
    if (this.snapshotInterval) {
      clearInterval(this.snapshotInterval);
      this.snapshotInterval = null;
    }
  }

  /**
   * Log an event to WAL.
   */
  logEvent(type: WALEntryType, data: unknown): WALEntry | null {
    if (!this.enabled || !this.walManager) {
      return null;
    }
    
    return this.walManager.append(type, data);
  }

  /**
   * Create a snapshot.
   */
  createSnapshot(bots: BotSnapshot[], stats: OrchestratorStats): OrchestratorSnapshot | null {
    if (!this.enabled || !this.snapshotManager) {
      return null;
    }
    
    return this.snapshotManager.createSnapshot(bots, stats);
  }

  /**
   * Recover state from persistence.
   */
  recover(): RecoveryResult {
    const result: RecoveryResult = {
      bots: [],
      stats: null,
      fromSnapshot: false,
      walEntriesReplayed: 0,
      pausedForReview: [],
    };
    
    if (!this.enabled) {
      return result;
    }
    
    // 1. Load latest snapshot
    const snapshot = this.snapshotManager?.loadLatest();
    
    if (snapshot) {
      result.bots = snapshot.bots;
      result.stats = snapshot.stats;
      result.fromSnapshot = true;
      
      // 2. Replay WAL entries after snapshot
      const walEntries = this.walManager?.readAfter(snapshot.timestamp) ?? [];
      result.walEntriesReplayed = walEntries.length;
      
      // Apply WAL entries to state
      for (const entry of walEntries) {
        this.applyWALEntry(result.bots, entry);
      }
    } else {
      // No snapshot, try to recover from WAL only
      const walEntries = this.walManager?.readAll() ?? [];
      result.walEntriesReplayed = walEntries.length;
      
      for (const entry of walEntries) {
        this.applyWALEntry(result.bots, entry);
      }
    }
    
    // 3. Pause bots that were running (for review after crash)
    for (const bot of result.bots) {
      if (bot.state === 'running') {
        result.pausedForReview.push(bot.id);
        bot.state = 'paused';
      }
    }
    
    return result;
  }

  /**
   * Apply a WAL entry to bot state.
   */
  private applyWALEntry(bots: BotSnapshot[], entry: WALEntry): void {
    const data = entry.data as Record<string, unknown>;
    
    switch (entry.type) {
      case 'bot_created': {
        const botData = data as unknown as BotSnapshot;
        const existing = bots.findIndex(b => b.id === botData.id);
        if (existing === -1) {
          bots.push(botData);
        }
        break;
      }
      
      case 'bot_started':
      case 'bot_paused':
      case 'bot_resumed':
      case 'bot_stopped':
      case 'bot_error': {
        const botId = data.botId as string;
        const bot = bots.find(b => b.id === botId);
        if (bot) {
          bot.state = data.state as BotSnapshot['state'];
          bot.updatedAt = entry.timestamp;
        }
        break;
      }
      
      case 'swap_completed': {
        const botId = data.botId as string;
        const bot = bots.find(b => b.id === botId);
        if (bot) {
          bot.stats.swapsSuccessful++;
          bot.stats.swapsAttempted++;
          bot.stats.totalVolumeSol += (data.amountSol as number) ?? 0;
          bot.stats.lastSwapAt = entry.timestamp;
          bot.updatedAt = entry.timestamp;
        }
        break;
      }
      
      case 'swap_failed': {
        const botId = data.botId as string;
        const bot = bots.find(b => b.id === botId);
        if (bot) {
          bot.stats.swapsFailed++;
          bot.stats.swapsAttempted++;
          if (data.error) {
            bot.stats.errors.push(data.error as string);
            if (bot.stats.errors.length > 10) {
              bot.stats.errors = bot.stats.errors.slice(-10);
            }
          }
          bot.updatedAt = entry.timestamp;
        }
        break;
      }
      
      case 'config_updated': {
        const botId = data.botId as string;
        const bot = bots.find(b => b.id === botId);
        if (bot && data.config) {
          bot.config = data.config as BotSnapshot['config'];
          bot.updatedAt = entry.timestamp;
        }
        break;
      }
    }
  }

  /**
   * Check if snapshot should be triggered based on WAL size.
   */
  shouldSnapshot(): boolean {
    return this.walManager?.shouldSnapshot() ?? false;
  }

  /**
   * Shutdown persistence.
   */
  shutdown(): void {
    this.stopPeriodicSnapshots();
  }
}
