/**
 * Authentication Middleware
 * 
 * Restricts bot access to authorized Telegram user IDs only.
 * Owner ID(s) are set via OWNER_ID environment variable.
 */

import type { NextFunction } from 'grammy';
import type { BotContext } from '../index.js';

// Parse owner IDs from environment (comma-separated)
function getOwnerIds(): Set<number> {
  const ownerIdEnv = process.env.OWNER_ID ?? process.env.TELEGRAM_OWNER_ID ?? '';
  
  if (!ownerIdEnv) {
    console.warn('⚠️ No OWNER_ID set - bot will reject all users');
    return new Set();
  }

  const ids = ownerIdEnv
    .split(',')
    .map((id) => parseInt(id.trim(), 10))
    .filter((id) => !isNaN(id));

  if (ids.length === 0) {
    console.warn('⚠️ Invalid OWNER_ID format - expected numeric Telegram user ID(s)');
  }

  return new Set(ids);
}

const ownerIds = getOwnerIds();

/**
 * Authentication middleware that only allows owner(s) to interact with the bot.
 */
export async function authMiddleware(
  ctx: BotContext,
  next: NextFunction
): Promise<void> {
  const userId = ctx.from?.id;

  // Skip if no user (shouldn't happen for messages)
  if (!userId) {
    console.log('⚠️ Received update without user ID');
    return;
  }

  // Check if user is authorized
  if (!ownerIds.has(userId)) {
    console.log(`🚫 Unauthorized access attempt from user ${userId}`);
    
    // Silently ignore or send denial message based on config
    const silentDeny = process.env.SILENT_DENY === 'true';
    
    if (!silentDeny) {
      await ctx.reply(
        '🔒 <b>Access Denied</b>\n\n' +
        'This bot is private and only accessible by the owner.\n\n' +
        `Your User ID: <code>${userId}</code>`,
        { parse_mode: 'HTML' }
      );
    }
    
    return; // Don't call next() - stop processing
  }

  // User is authorized, proceed
  await next();
}

/**
 * Check if a user ID is an owner.
 */
export function isOwner(userId: number): boolean {
  return ownerIds.has(userId);
}

/**
 * Get the set of owner IDs.
 */
export function getOwners(): Set<number> {
  return new Set(ownerIds);
}
