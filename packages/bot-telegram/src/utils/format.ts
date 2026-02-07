/**
 * Message Formatting Utilities
 * 
 * Helpers for formatting bot responses with consistent styling.
 * Uses HTML parse mode for Telegram.
 */

import { VERSION } from '@orbitmm/core';

// ============ Text Formatting ============

/**
 * Escape HTML special characters for safe display.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Bold text.
 */
export function bold(text: string): string {
  return `<b>${escapeHtml(text)}</b>`;
}

/**
 * Italic text.
 */
export function italic(text: string): string {
  return `<i>${escapeHtml(text)}</i>`;
}

/**
 * Monospace/code text.
 */
export function code(text: string): string {
  return `<code>${escapeHtml(text)}</code>`;
}

/**
 * Preformatted code block.
 */
export function pre(text: string, language?: string): string {
  if (language) {
    return `<pre><code class="language-${language}">${escapeHtml(text)}</code></pre>`;
  }
  return `<pre>${escapeHtml(text)}</pre>`;
}

/**
 * Inline link.
 */
export function link(text: string, url: string): string {
  return `<a href="${url}">${escapeHtml(text)}</a>`;
}

// ============ Address Formatting ============

/**
 * Format a Solana address for display (truncated).
 */
export function formatAddress(address: string, chars = 6): string {
  if (address.length <= chars * 2 + 3) {
    return code(address);
  }
  return code(`${address.slice(0, chars)}...${address.slice(-chars)}`);
}

/**
 * Format address with Solscan link.
 */
export function formatAddressLink(address: string, type: 'account' | 'tx' = 'account'): string {
  const truncated = `${address.slice(0, 6)}...${address.slice(-4)}`;
  const url = type === 'tx' 
    ? `https://solscan.io/tx/${address}`
    : `https://solscan.io/account/${address}`;
  return link(truncated, url);
}

// ============ Number Formatting ============

/**
 * Format SOL amount with proper decimals.
 */
export function formatSol(lamports: number): string {
  const sol = lamports / 1_000_000_000;
  
  if (sol === 0) return '0 SOL';
  if (sol < 0.001) return `${sol.toFixed(9)} SOL`;
  if (sol < 1) return `${sol.toFixed(6)} SOL`;
  if (sol < 1000) return `${sol.toFixed(4)} SOL`;
  return `${sol.toLocaleString(undefined, { maximumFractionDigits: 2 })} SOL`;
}

/**
 * Format percentage.
 */
export function formatPercent(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

/**
 * Format large numbers with K/M/B suffixes.
 */
export function formatNumber(num: number): string {
  if (num >= 1_000_000_000) {
    return `${(num / 1_000_000_000).toFixed(2)}B`;
  }
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(2)}M`;
  }
  if (num >= 1_000) {
    return `${(num / 1_000).toFixed(2)}K`;
  }
  return num.toLocaleString();
}

// ============ Time Formatting ============

/**
 * Format duration in milliseconds to human readable.
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }
  
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) {
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }
  
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

/**
 * Format timestamp to local time string.
 */
export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

/**
 * Format relative time (e.g., "5 minutes ago").
 */
export function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  
  if (diff < 60_000) return 'just now';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
}

// ============ Status Formatting ============

/**
 * Format bot status with emoji indicator.
 */
export function formatStatus(status: string): string {
  const statusMap: Record<string, string> = {
    idle: '⏸️ Idle',
    starting: '🔄 Starting',
    running: '🟢 Running',
    paused: '⏸️ Paused',
    stopping: '🔄 Stopping',
    stopped: '🔴 Stopped',
    error: '❌ Error',
  };
  
  return statusMap[status] ?? status;
}

/**
 * Format confidence level.
 */
export function formatConfidence(confidence: number): string {
  if (confidence >= 0.8) return `🔴 ${(confidence * 100).toFixed(0)}%`;
  if (confidence >= 0.6) return `🟠 ${(confidence * 100).toFixed(0)}%`;
  if (confidence >= 0.4) return `🟡 ${(confidence * 100).toFixed(0)}%`;
  return `🟢 ${(confidence * 100).toFixed(0)}%`;
}

// ============ Table Formatting ============

/**
 * Format a simple key-value list.
 */
export function formatKeyValue(data: Record<string, string | number>): string {
  const lines = Object.entries(data).map(
    ([key, value]) => `<b>${escapeHtml(key)}:</b> ${typeof value === 'string' ? escapeHtml(value) : value}`
  );
  return lines.join('\n');
}

/**
 * Format as a simple table (aligned columns).
 */
export function formatTable(
  rows: Record<string, string | number>[],
  columns: { key: string; header: string; width?: number }[]
): string {
  const lines: string[] = [];
  
  // Header
  const headerLine = columns.map((col) => col.header.padEnd(col.width ?? 10)).join(' ');
  lines.push(code(headerLine));
  lines.push(code('─'.repeat(headerLine.length)));
  
  // Data rows
  for (const row of rows) {
    const rowLine = columns
      .map((col) => {
        const value = String(row[col.key] ?? '');
        return value.padEnd(col.width ?? 10);
      })
      .join(' ');
    lines.push(code(rowLine));
  }
  
  return lines.join('\n');
}

// ============ Message Templates ============

/**
 * Welcome message for /start command.
 */
export function formatWelcome(): string {
  return `
🤖 <b>Welcome to OrbitMM Bot!</b>

I'm your Solana market-making assistant. I can help you:

• 💼 <b>Manage wallets</b> - Generate, fund, and track
• 🤖 <b>Control bots</b> - Create, start, pause, stop
• 📊 <b>Trade</b> - Get quotes, execute swaps
• 📈 <b>Monitor stats</b> - View performance

<b>Quick Start:</b>
1️⃣ Generate wallets: <code>/wallet generate 10</code>
2️⃣ Create bot: <code>/bot create 5 &lt;token&gt;</code>
3️⃣ Start trading: <code>/bot start</code>

Type /help for all commands.

<i>Version ${VERSION}</i>
`.trim();
}

/**
 * Help message with all commands.
 */
export function formatHelp(): string {
  return `
📚 <b>OrbitMM Commands</b>

<b>💼 Wallet Commands</b>
<code>/wallet generate [count]</code> - Generate new wallets
<code>/wallet balance</code> - Check wallet balances

<b>🤖 Bot Commands</b>
<code>/bot create [count] &lt;token&gt;</code> - Create trading bots
<code>/bot start</code> - Start all idle bots
<code>/bot pause</code> - Pause running bots
<code>/bot stop</code> - Stop all bots
<code>/bot status</code> - View bot status

<b>📊 Trade Commands</b>
<code>/trade quote &lt;token&gt; [amount]</code> - Get swap quote

<b>📈 Stats</b>
<code>/stats</code> - View overall statistics

<b>ℹ️ General</b>
<code>/start</code> - Welcome message
<code>/help</code> - This help message
<code>/version</code> - Bot version

<i>Tip: Most commands support inline keyboards for confirmation.</i>
`.trim();
}

/**
 * Format an error message.
 */
export function formatError(message: string, details?: string): string {
  let output = `❌ <b>Error</b>\n\n${escapeHtml(message)}`;
  if (details) {
    output += `\n\n<i>${escapeHtml(details)}</i>`;
  }
  return output;
}

/**
 * Format a success message.
 */
export function formatSuccess(message: string, details?: string): string {
  let output = `✅ <b>Success</b>\n\n${escapeHtml(message)}`;
  if (details) {
    output += `\n\n${escapeHtml(details)}`;
  }
  return output;
}

/**
 * Format a warning message.
 */
export function formatWarning(message: string): string {
  return `⚠️ ${escapeHtml(message)}`;
}

/**
 * Format a loading/progress message.
 */
export function formatLoading(message: string): string {
  return `⏳ ${escapeHtml(message)}...`;
}
