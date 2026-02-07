/**
 * Bot Orchestrator Tests
 * 
 * Unit tests for the Bot class and orchestrator components.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Keypair } from '@solana/web3.js';
import {
  Bot,
  createBot,
  BotConfig,
  BotState,
  createDefaultBotStats,
  isValidStateTransition,
  Semaphore,
  RateLimiter,
  CircuitBreaker,
  CircuitBreakerOpenError,
  WALManager,
  SnapshotManager,
  createWALEntry,
  verifyWALEntry,
} from '../index.js';

// ============ Test Helpers ============

function createTestConfig(overrides: Partial<BotConfig> = {}): BotConfig {
  return {
    targetToken: 'So11111111111111111111111111111111111111112',
    direction: 'both',
    minSwapSol: 0.01,
    maxSwapSol: 0.1,
    minIntervalMs: 100, // Fast for testing
    maxIntervalMs: 200,
    ...overrides,
  };
}

function createTestBot(configOverrides: Partial<BotConfig> = {}): Bot {
  const wallet = Keypair.generate();
  const config = createTestConfig(configOverrides);
  return createBot(wallet, config);
}

// ============ Types Tests ============

describe('Types', () => {
  describe('createDefaultBotStats', () => {
    it('should create default stats with zero values', () => {
      const stats = createDefaultBotStats();
      
      expect(stats.swapsAttempted).toBe(0);
      expect(stats.swapsSuccessful).toBe(0);
      expect(stats.swapsFailed).toBe(0);
      expect(stats.totalVolumeSol).toBe(0);
      expect(stats.totalTokensBought).toBe(0);
      expect(stats.totalTokensSold).toBe(0);
      expect(stats.errors).toEqual([]);
      expect(stats.startedAt).toBeNull();
      expect(stats.lastSwapAt).toBeNull();
    });
  });

  describe('isValidStateTransition', () => {
    it('should allow idle → starting', () => {
      expect(isValidStateTransition('idle', 'starting')).toBe(true);
    });

    it('should allow running → paused', () => {
      expect(isValidStateTransition('running', 'paused')).toBe(true);
    });

    it('should allow paused → running', () => {
      expect(isValidStateTransition('paused', 'running')).toBe(true);
    });

    it('should allow running → stopping', () => {
      expect(isValidStateTransition('running', 'stopping')).toBe(true);
    });

    it('should not allow stopped → running', () => {
      expect(isValidStateTransition('stopped', 'running')).toBe(false);
    });

    it('should not allow idle → running (skip starting)', () => {
      expect(isValidStateTransition('idle', 'running')).toBe(false);
    });
  });
});

// ============ Bot Tests ============

describe('Bot', () => {
  let bot: Bot;

  beforeEach(() => {
    vi.useFakeTimers();
    bot = createTestBot();
  });

  afterEach(() => {
    bot.destroy();
    vi.useRealTimers();
  });

  describe('creation', () => {
    it('should create a bot with idle state', () => {
      expect(bot.state).toBe('idle');
    });

    it('should have a unique ID based on wallet', () => {
      expect(bot.id).toBeDefined();
      expect(bot.id.length).toBeGreaterThan(0);
    });

    it('should store the wallet', () => {
      expect(bot.wallet).toBeDefined();
      expect(bot.publicKey).toBeDefined();
    });

    it('should have initial stats', () => {
      const stats = bot.stats;
      expect(stats.swapsAttempted).toBe(0);
      expect(stats.swapsSuccessful).toBe(0);
    });
  });

  describe('start()', () => {
    it('should transition to running state', async () => {
      bot.start();
      // The transition uses setImmediate, so advance timers to flush it
      await vi.advanceTimersToNextTimerAsync();
      
      expect(bot.state).toBe('running');
    });

    it('should emit bot:started event', async () => {
      const handler = vi.fn();
      bot.on('bot:started', handler);
      
      bot.start();
      await vi.advanceTimersToNextTimerAsync();
      
      expect(handler).toHaveBeenCalled();
    });

    it('should set startedAt timestamp', () => {
      bot.start();
      
      expect(bot.stats.startedAt).not.toBeNull();
    });

    it('should be idempotent (no error on double start)', async () => {
      bot.start();
      await vi.advanceTimersToNextTimerAsync();
      
      // Now it's running, calling start again should not throw
      expect(() => bot.start()).not.toThrow();
    });
  });

  describe('pause()', () => {
    it('should transition from running to paused', async () => {
      bot.start();
      await vi.advanceTimersToNextTimerAsync();
      
      bot.pause();
      
      expect(bot.state).toBe('paused');
    });

    it('should emit bot:paused event', async () => {
      bot.start();
      await vi.advanceTimersToNextTimerAsync();
      
      const handler = vi.fn();
      bot.on('bot:paused', handler);
      
      bot.pause();
      
      expect(handler).toHaveBeenCalled();
    });

    it('should be idempotent when not running', () => {
      expect(() => bot.pause()).not.toThrow();
      expect(bot.state).toBe('idle');
    });
  });

  describe('resume()', () => {
    it('should transition from paused to running', async () => {
      bot.start();
      await vi.advanceTimersToNextTimerAsync();
      bot.pause();
      
      bot.resume();
      
      expect(bot.state).toBe('running');
    });

    it('should emit bot:resumed event', async () => {
      bot.start();
      await vi.advanceTimersToNextTimerAsync();
      bot.pause();
      
      const handler = vi.fn();
      bot.on('bot:resumed', handler);
      
      bot.resume();
      
      expect(handler).toHaveBeenCalled();
    });

    it('should be idempotent when not paused', () => {
      expect(() => bot.resume()).not.toThrow();
    });
  });

  describe('stop()', () => {
    it('should transition to stopped state', async () => {
      bot.start();
      await vi.advanceTimersToNextTimerAsync();
      
      bot.stop();
      
      expect(bot.state).toBe('stopped');
    });

    it('should emit bot:stopped event', async () => {
      bot.start();
      await vi.advanceTimersToNextTimerAsync();
      
      const handler = vi.fn();
      bot.on('bot:stopped', handler);
      
      bot.stop();
      
      expect(handler).toHaveBeenCalled();
    });

    it('should be idempotent', () => {
      bot.stop();
      expect(() => bot.stop()).not.toThrow();
    });

    it('should work from any state', async () => {
      bot.start();
      await vi.advanceTimersToNextTimerAsync();
      bot.pause();
      
      bot.stop();
      
      expect(bot.state).toBe('stopped');
    });
  });

  describe('updateConfig()', () => {
    it('should update configuration', () => {
      bot.updateConfig({ minSwapSol: 0.05 });
      
      expect(bot.config.minSwapSol).toBe(0.05);
    });

    it('should preserve other config values', () => {
      const originalMax = bot.config.maxSwapSol;
      
      bot.updateConfig({ minSwapSol: 0.05 });
      
      expect(bot.config.maxSwapSol).toBe(originalMax);
    });
  });

  describe('getSnapshot()', () => {
    it('should return current bot state', () => {
      const snapshot = bot.getSnapshot();
      
      expect(snapshot.id).toBe(bot.id);
      expect(snapshot.state).toBe(bot.state);
      expect(snapshot.config).toEqual(bot.config);
      expect(snapshot.stats).toEqual(bot.stats);
    });

    it('should return a copy (not reference)', () => {
      const snapshot = bot.getSnapshot();
      snapshot.stats.swapsAttempted = 999;
      
      expect(bot.stats.swapsAttempted).toBe(0);
    });
  });

  describe('recordSwapSuccess()', () => {
    it('should update stats', () => {
      bot.recordSwapSuccess(0.05, 'buy', 'sig123', 1000);
      
      expect(bot.stats.swapsSuccessful).toBe(1);
      expect(bot.stats.totalVolumeSol).toBe(0.05);
      expect(bot.stats.totalTokensBought).toBe(1000);
      expect(bot.stats.lastSwapAt).not.toBeNull();
    });
  });

  describe('recordSwapFailure()', () => {
    it('should update stats', () => {
      const error = new Error('Test error');
      bot.recordSwapFailure(0.05, 'buy', error);
      
      expect(bot.stats.swapsFailed).toBe(1);
      expect(bot.stats.errors).toContain('Test error');
    });

    it('should transition to error after consecutive failures', () => {
      const error = new Error('Test error');
      
      for (let i = 0; i < 5; i++) {
        bot.recordSwapFailure(0.05, 'buy', error);
      }
      
      expect(bot.state).toBe('error');
    });
  });

  describe('limits', () => {
    it('should respect stopAfterSwaps', async () => {
      const limitedBot = createTestBot({ stopAfterSwaps: 2 });
      limitedBot.start();
      await vi.advanceTimersToNextTimerAsync(); // Transition to running
      
      // Simulate successful swaps
      limitedBot.recordSwapSuccess(0.05, 'buy', 'sig1', 100);
      limitedBot.recordSwapSuccess(0.05, 'buy', 'sig2', 100);
      
      // After reaching limit, advance time to trigger the check
      vi.advanceTimersByTime(300);
      
      expect(limitedBot.state).toBe('stopped');
      limitedBot.destroy();
    });
  });
});

// ============ Semaphore Tests ============

describe('Semaphore', () => {
  it('should allow up to max concurrent acquires', async () => {
    const sem = new Semaphore(2);
    
    await sem.acquire();
    await sem.acquire();
    
    expect(sem.activeCount).toBe(2);
    expect(sem.availablePermits).toBe(0);
  });

  it('should block when at capacity', async () => {
    const sem = new Semaphore(1);
    await sem.acquire();
    
    let acquired = false;
    const acquirePromise = sem.acquire().then(() => {
      acquired = true;
    });
    
    // Give it a tick
    await new Promise(r => setTimeout(r, 10));
    expect(acquired).toBe(false);
    
    sem.release();
    await acquirePromise;
    expect(acquired).toBe(true);
  });

  it('tryAcquire should return false when at capacity', async () => {
    const sem = new Semaphore(1);
    await sem.acquire();
    
    expect(sem.tryAcquire()).toBe(false);
  });

  it('withPermit should release even on error', async () => {
    const sem = new Semaphore(1);
    
    try {
      await sem.withPermit(async () => {
        throw new Error('Test');
      });
    } catch {
      // Expected
    }
    
    expect(sem.activeCount).toBe(0);
  });
});

// ============ RateLimiter Tests ============

describe('RateLimiter', () => {
  it('should allow requests up to rate', () => {
    const limiter = new RateLimiter(10, 10); // 10 per second, bucket of 10
    
    for (let i = 0; i < 10; i++) {
      expect(limiter.tryConsume()).toBe(true);
    }
    
    expect(limiter.tryConsume()).toBe(false);
  });

  it('should refill over time', async () => {
    const limiter = new RateLimiter(100); // 100 per second
    
    // Drain the bucket
    while (limiter.tryConsume()) {}
    
    // Wait for refill
    await new Promise(r => setTimeout(r, 100));
    
    expect(limiter.tryConsume()).toBe(true);
  });
});

// ============ CircuitBreaker Tests ============

describe('CircuitBreaker', () => {
  it('should start closed', () => {
    const cb = new CircuitBreaker();
    expect(cb.isAllowed()).toBe(true);
    expect(cb.currentState).toBe('closed');
  });

  it('should open after threshold failures', () => {
    const cb = new CircuitBreaker(3);
    
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    
    expect(cb.currentState).toBe('open');
    expect(cb.isAllowed()).toBe(false);
  });

  it('should reset on success', () => {
    const cb = new CircuitBreaker(3);
    
    cb.recordFailure();
    cb.recordFailure();
    cb.recordSuccess();
    
    expect(cb.currentState).toBe('closed');
  });

  it('should execute and record success/failure', async () => {
    const cb = new CircuitBreaker(2);
    
    await cb.execute(async () => 'success');
    expect(cb.currentState).toBe('closed');
    
    try {
      await cb.execute(async () => {
        throw new Error('fail');
      });
    } catch {}
    
    try {
      await cb.execute(async () => {
        throw new Error('fail');
      });
    } catch {}
    
    expect(cb.currentState).toBe('open');
    
    await expect(cb.execute(async () => 'test')).rejects.toThrow(CircuitBreakerOpenError);
  });
});

// ============ WAL Tests ============

describe('WAL', () => {
  describe('createWALEntry', () => {
    it('should create entry with checksum', () => {
      const entry = createWALEntry('bot_created', { botId: 'test' });
      
      expect(entry.id).toBeDefined();
      expect(entry.timestamp).toBeDefined();
      expect(entry.type).toBe('bot_created');
      expect(entry.data).toEqual({ botId: 'test' });
      expect(entry.checksum).toBeDefined();
    });
  });

  describe('verifyWALEntry', () => {
    it('should verify valid entry', () => {
      const entry = createWALEntry('bot_started', { botId: 'test' });
      expect(verifyWALEntry(entry)).toBe(true);
    });

    it('should reject tampered entry', () => {
      const entry = createWALEntry('bot_started', { botId: 'test' });
      entry.data = { botId: 'tampered' };
      
      expect(verifyWALEntry(entry)).toBe(false);
    });
  });
});

// ============ Integration Tests ============

describe('Bot Integration', () => {
  it('should handle full lifecycle', async () => {
    vi.useFakeTimers();
    
    const bot = createTestBot();
    const events: string[] = [];
    
    bot.on('bot:started', () => events.push('started'));
    bot.on('bot:paused', () => events.push('paused'));
    bot.on('bot:resumed', () => events.push('resumed'));
    bot.on('bot:stopped', () => events.push('stopped'));
    
    // Start - wait for setImmediate to transition to running
    bot.start();
    await vi.advanceTimersToNextTimerAsync();
    expect(bot.state).toBe('running');
    
    // Pause
    bot.pause();
    expect(bot.state).toBe('paused');
    
    // Resume
    bot.resume();
    expect(bot.state).toBe('running');
    
    // Stop
    bot.stop();
    expect(bot.state).toBe('stopped');
    
    expect(events).toEqual(['started', 'paused', 'resumed', 'stopped']);
    
    bot.destroy();
    vi.useRealTimers();
  });

  it('should emit swap events', async () => {
    vi.useFakeTimers();
    
    const bot = createTestBot();
    const swapEvents: unknown[] = [];
    
    bot.on('swap:initiated', (data) => swapEvents.push(data));
    bot.on('swap:execute', (data) => {
      // Simulate successful execution - stop bot to prevent infinite timer loop
      bot.recordSwapSuccess(data.amountSol, data.direction, 'sig123', 1000);
      bot.stop(); // Stop after first swap to prevent infinite timers
    });
    bot.on('swap:completed', (data) => swapEvents.push(data));
    
    bot.start();
    await vi.advanceTimersToNextTimerAsync(); // Transition to running
    
    // Advance time to trigger first swap (max interval is 200ms)
    vi.advanceTimersByTime(250);
    
    expect(swapEvents.length).toBeGreaterThan(0);
    
    bot.destroy();
    vi.useRealTimers();
  });
});
