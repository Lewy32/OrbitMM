/**
 * OrbitMM CLI Display Utilities
 * 
 * Table formatting, progress bars, and color output for CLI.
 */

import chalk from 'chalk';
import ora, { Ora } from 'ora';

// ============ Colors ============

export const colors = {
  primary: chalk.cyan,
  success: chalk.green,
  error: chalk.red,
  warning: chalk.yellow,
  info: chalk.blue,
  muted: chalk.gray,
  highlight: chalk.bold.white,
  money: chalk.green.bold,
  address: chalk.magenta,
};

// ============ Icons ============

export const icons = {
  success: colors.success('✓'),
  error: colors.error('✗'),
  warning: colors.warning('⚠'),
  info: colors.info('ℹ'),
  bullet: colors.muted('•'),
  arrow: colors.primary('→'),
  wallet: '👛',
  bot: '🤖',
  trade: '💱',
  money: '💰',
  chart: '📊',
  lock: '🔒',
  unlock: '🔓',
  clock: '⏱',
  rocket: '🚀',
  alert: '🚨',
};

// ============ Table Formatting ============

export interface TableColumn {
  key: string;
  header: string;
  width?: number;
  align?: 'left' | 'right' | 'center';
  format?: (value: unknown) => string;
}

export interface TableOptions {
  columns: TableColumn[];
  border?: boolean;
  compact?: boolean;
}

/**
 * Format data as a table
 */
export function table<T extends Record<string, unknown>>(
  data: T[],
  options: TableOptions
): string {
  const { columns, border = true, compact = false } = options;

  if (data.length === 0) {
    return colors.muted('No data to display');
  }

  // Calculate column widths
  const widths = columns.map((col) => {
    const headerWidth = col.header.length;
    const maxDataWidth = Math.max(
      ...data.map((row) => {
        const value = row[col.key];
        const formatted = col.format ? col.format(value) : String(value ?? '');
        // Strip ANSI codes for width calculation
        return stripAnsi(formatted).length;
      })
    );
    return col.width ?? Math.max(headerWidth, maxDataWidth);
  });

  // Build table
  const lines: string[] = [];
  const separator = border ? colors.muted('─'.repeat(widths.reduce((a, b) => a + b, 0) + columns.length * 3 + 1)) : '';
  
  if (border && !compact) {
    lines.push(separator);
  }

  // Header row
  const headerCells = columns.map((col, i) => {
    return padCell(colors.highlight(col.header), widths[i], col.align ?? 'left');
  });
  lines.push(border ? `${colors.muted('│')} ${headerCells.join(` ${colors.muted('│')} `)} ${colors.muted('│')}` : headerCells.join('  '));

  if (border && !compact) {
    lines.push(separator);
  }

  // Data rows
  for (const row of data) {
    const cells = columns.map((col, i) => {
      const value = row[col.key];
      const formatted = col.format ? col.format(value) : String(value ?? '');
      return padCell(formatted, widths[i], col.align ?? 'left');
    });
    lines.push(border ? `${colors.muted('│')} ${cells.join(` ${colors.muted('│')} `)} ${colors.muted('│')}` : cells.join('  '));
  }

  if (border && !compact) {
    lines.push(separator);
  }

  return lines.join('\n');
}

/**
 * Simple key-value display
 */
export function keyValue(pairs: Record<string, unknown>, options?: { indent?: number }): string {
  const indent = ' '.repeat(options?.indent ?? 0);
  const maxKeyLength = Math.max(...Object.keys(pairs).map((k) => k.length));

  return Object.entries(pairs)
    .map(([key, value]) => {
      const paddedKey = key.padEnd(maxKeyLength);
      return `${indent}${colors.muted(paddedKey)}  ${formatValue(value)}`;
    })
    .join('\n');
}

// ============ Progress ============

/**
 * Create a spinner for long operations
 */
export function spinner(text: string): Ora {
  return ora({
    text,
    color: 'cyan',
    spinner: 'dots',
  });
}

/**
 * Progress bar for batch operations
 */
export class ProgressBar {
  private current = 0;
  private readonly width = 30;
  private ora: Ora;

  constructor(
    private total: number,
    private label: string = 'Progress'
  ) {
    this.ora = ora({
      text: this.render(),
      color: 'cyan',
    }).start();
  }

  update(current: number, message?: string): void {
    this.current = current;
    this.ora.text = this.render(message);
  }

  increment(message?: string): void {
    this.update(this.current + 1, message);
  }

  succeed(message?: string): void {
    this.ora.succeed(message ?? `${this.label}: ${colors.success('Complete')}`);
  }

  fail(message?: string): void {
    this.ora.fail(message ?? `${this.label}: ${colors.error('Failed')}`);
  }

  private render(message?: string): string {
    const percent = Math.min(100, Math.round((this.current / this.total) * 100));
    const filled = Math.round((this.current / this.total) * this.width);
    const empty = this.width - filled;
    
    const bar = colors.primary('█'.repeat(filled)) + colors.muted('░'.repeat(empty));
    const stats = colors.muted(`${this.current}/${this.total}`);
    const percentStr = colors.highlight(`${percent}%`);
    
    let text = `${this.label} ${bar} ${percentStr} ${stats}`;
    if (message) {
      text += ` ${colors.muted(message)}`;
    }
    return text;
  }
}

// ============ Messages ============

/**
 * Print a success message
 */
export function success(message: string): void {
  console.log(`${icons.success} ${message}`);
}

/**
 * Print an error message
 */
export function error(message: string): void {
  console.error(`${icons.error} ${colors.error(message)}`);
}

/**
 * Print a warning message
 */
export function warning(message: string): void {
  console.log(`${icons.warning} ${colors.warning(message)}`);
}

/**
 * Print an info message
 */
export function info(message: string): void {
  console.log(`${icons.info} ${message}`);
}

/**
 * Print a header/title
 */
export function header(title: string): void {
  console.log();
  console.log(colors.highlight(title));
  console.log(colors.muted('─'.repeat(stripAnsi(title).length)));
}

/**
 * Print an empty line
 */
export function newline(): void {
  console.log();
}

// ============ Formatting Helpers ============

/**
 * Format SOL amount
 */
export function formatSol(lamports: number | bigint | string): string {
  const sol = Number(lamports) / 1e9;
  return colors.money(`${sol.toFixed(4)} SOL`);
}

/**
 * Format address (truncated)
 */
export function formatAddress(address: string, length = 8): string {
  if (address.length <= length * 2) {
    return colors.address(address);
  }
  return colors.address(`${address.slice(0, length)}...${address.slice(-length)}`);
}

/**
 * Format timestamp
 */
export function formatTime(timestamp: number | Date): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  return colors.muted(date.toLocaleString());
}

/**
 * Format duration in ms
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

/**
 * Format status badge
 */
export function formatStatus(status: string): string {
  const statusColors: Record<string, typeof chalk> = {
    running: chalk.green,
    active: chalk.green,
    success: chalk.green,
    idle: chalk.gray,
    paused: chalk.yellow,
    pending: chalk.yellow,
    stopped: chalk.red,
    error: chalk.red,
    failed: chalk.red,
  };
  const colorFn = statusColors[status.toLowerCase()] ?? chalk.white;
  return colorFn(`[${status.toUpperCase()}]`);
}

/**
 * Format percentage
 */
export function formatPercent(value: number): string {
  const color = value >= 0 ? colors.success : colors.error;
  const sign = value >= 0 ? '+' : '';
  return color(`${sign}${value.toFixed(2)}%`);
}

// ============ Helpers ============

function padCell(text: string, width: number, align: 'left' | 'right' | 'center'): string {
  const textWidth = stripAnsi(text).length;
  const padding = Math.max(0, width - textWidth);

  switch (align) {
    case 'right':
      return ' '.repeat(padding) + text;
    case 'center':
      const left = Math.floor(padding / 2);
      const right = padding - left;
      return ' '.repeat(left) + text + ' '.repeat(right);
    default:
      return text + ' '.repeat(padding);
  }
}

function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1B\[[0-9;]*m/g, '');
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return colors.muted('—');
  }
  if (typeof value === 'boolean') {
    return value ? colors.success('Yes') : colors.muted('No');
  }
  if (typeof value === 'number') {
    return colors.highlight(value.toLocaleString());
  }
  return String(value);
}
