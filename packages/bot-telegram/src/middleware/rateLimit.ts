/**
 * Rate Limiting Middleware
 * 
 * Prevents spam and abuse by limiting the number of commands
 * a user can execute within a time window.
 */

import type { NextFunction } from 'grammy';
import type { BotContext } from '../index.js';

// Rate limit configuration
interface RateLimitConfig {
  windowMs: number;      // Time window in milliseconds
  maxRequests: number;   // Max requests per window
  burstLimit: number;    // Max requests in 1 second burst
}

const DEFAULT_CONFIG: RateLimitConfig = {
  windowMs: 60_000,      // 1 minute
  maxRequests: 30,       // 30 commands per minute
  burstLimit: 5,         // 5 commands per second burst
};

// Track request counts per user
interface UserTracker {
  requests: number[];    // Timestamps of recent requests
  warned: boolean;       // Already warned this window
}

const userTrackers = new Map<number, UserTracker>();

// Clean up old entries periodically
const CLEANUP_INTERVAL = 300_000; // 5 minutes
setInterval(() => {
  const now = Date.now();
  const cutoff = now - DEFAULT_CONFIG.windowMs * 2;
  
  for (const [userId, tracker] of userTrackers) {
    tracker.requests = tracker.requests.filter((ts) => ts > cutoff);
    if (tracker.requests.length === 0) {
      userTrackers.delete(userId);
    }
  }
}, CLEANUP_INTERVAL);

/**
 * Get or create tracker for a user.
 */
function getTracker(userId: number): UserTracker {
  let tracker = userTrackers.get(userId);
  
  if (!tracker) {
    tracker = { requests: [], warned: false };
    userTrackers.set(userId, tracker);
  }
  
  return tracker;
}

/**
 * Check if user is rate limited.
 */
function isRateLimited(tracker: UserTracker, config: RateLimitConfig): { limited: boolean; reason?: string } {
  const now = Date.now();
  
  // Clean old requests
  tracker.requests = tracker.requests.filter((ts) => ts > now - config.windowMs);
  
  // Check window limit
  if (tracker.requests.length >= config.maxRequests) {
    return { limited: true, reason: 'Too many requests. Please wait a minute.' };
  }
  
  // Check burst limit (requests in last second)
  const recentRequests = tracker.requests.filter((ts) => ts > now - 1000);
  if (recentRequests.length >= config.burstLimit) {
    return { limited: true, reason: 'Slow down! Too many requests at once.' };
  }
  
  return { limited: false };
}

/**
 * Rate limiting middleware.
 */
export async function rateLimitMiddleware(
  ctx: BotContext,
  next: NextFunction
): Promise<void> {
  const userId = ctx.from?.id;
  
  // Skip rate limiting if no user (shouldn't happen after auth middleware)
  if (!userId) {
    await next();
    return;
  }

  // Skip rate limiting for callback queries (they're part of ongoing interactions)
  if (ctx.callbackQuery) {
    await next();
    return;
  }

  const tracker = getTracker(userId);
  const { limited, reason } = isRateLimited(tracker, DEFAULT_CONFIG);

  if (limited) {
    // Only warn once per window to avoid spam
    if (!tracker.warned) {
      tracker.warned = true;
      await ctx.reply(`⏱️ ${reason}`, { parse_mode: 'HTML' });
    }
    return; // Don't process the request
  }

  // Record this request
  tracker.requests.push(Date.now());
  
  // Reset warning flag if under half the limit
  if (tracker.requests.length < DEFAULT_CONFIG.maxRequests / 2) {
    tracker.warned = false;
  }

  await next();
}

/**
 * Get rate limit stats for a user.
 */
export function getRateLimitStats(userId: number): {
  requests: number;
  remaining: number;
  resetIn: number;
} {
  const tracker = getTracker(userId);
  const now = Date.now();
  
  // Clean old requests
  tracker.requests = tracker.requests.filter((ts) => ts > now - DEFAULT_CONFIG.windowMs);
  
  const oldestRequest = tracker.requests[0];
  const resetIn = oldestRequest 
    ? Math.max(0, DEFAULT_CONFIG.windowMs - (now - oldestRequest))
    : 0;

  return {
    requests: tracker.requests.length,
    remaining: DEFAULT_CONFIG.maxRequests - tracker.requests.length,
    resetIn,
  };
}
