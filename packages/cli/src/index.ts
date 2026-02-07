#!/usr/bin/env node

/**
 * OrbitMM CLI
 * 
 * Command-line interface for the OrbitMM market making platform.
 * 
 * Commands:
 *   wallet    - Wallet management (generate, fund, export, import, balance)
 *   bot       - Bot lifecycle (create, start, pause, stop, status, merge, split)
 *   trade     - Trading operations (quote, buy, sell)
 *   detect    - Detection tools (analyze, monitor)
 */

import { Command } from 'commander';
import { registerWalletCommands } from './commands/wallet.js';
import { registerBotCommands } from './commands/bot.js';
import { registerTradeCommands } from './commands/trade.js';
import { registerDetectCommands } from './commands/detect.js';
import { colors, icons, error as displayError, header, newline } from './utils/display.js';

// ============ Version & Metadata ============

const VERSION = '0.1.0';
const DESCRIPTION = `
${colors.primary('OrbitMM')} — Solana Market Making Platform

A comprehensive toolkit for automated market making, wallet management,
and market manipulation detection on the Solana blockchain.

${colors.muted('For more information: https://github.com/orbitmm/orbitmm')}
`;

// ============ Main Program ============

const program = new Command()
  .name('orbitmm')
  .version(VERSION, '-v, --version', 'Display version')
  .description(DESCRIPTION)
  .configureHelp({
    sortSubcommands: true,
    sortOptions: true,
  })
  .option('--rpc <url>', 'Solana RPC endpoint URL')
  .option('--config <path>', 'Path to config file')
  .option('--quiet', 'Suppress non-essential output')
  .option('--json', 'Output in JSON format where applicable');

// ============ Global Options Processing ============

program.hook('preAction', (thisCommand) => {
  const opts = thisCommand.opts();
  
  // Set RPC URL if provided
  if (opts.rpc) {
    process.env.SOLANA_RPC_URL = opts.rpc;
  }
  
  // Set config path if provided
  if (opts.config) {
    process.env.ORBITMM_CONFIG_PATH = opts.config;
  }
});

// ============ Register Commands ============

registerWalletCommands(program);
registerBotCommands(program);
registerTradeCommands(program);
registerDetectCommands(program);

// ============ Additional Commands ============

// Status command
program
  .command('status')
  .description('Show OrbitMM system status')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    header(`${icons.chart} OrbitMM Status`);
    
    const status = {
      version: VERSION,
      rpcUrl: process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com',
      configPath: process.env.ORBITMM_CONFIG_PATH ?? '~/.orbitmm',
      walletPath: process.env.ORBITMM_WALLET_PATH ?? '~/.orbitmm/wallets.json',
      orchestrator: 'not running', // TODO: Check actual status
      uptime: null,
    };
    
    if (options.json) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }
    
    console.log();
    console.log(`  ${colors.muted('Version:')}        ${colors.highlight(status.version)}`);
    console.log(`  ${colors.muted('RPC URL:')}        ${status.rpcUrl}`);
    console.log(`  ${colors.muted('Config:')}         ${status.configPath}`);
    console.log(`  ${colors.muted('Wallets:')}        ${status.walletPath}`);
    console.log(`  ${colors.muted('Orchestrator:')}   ${colors.warning(status.orchestrator)}`);
    newline();
  });

// Config command (placeholder)
program
  .command('config')
  .description('Manage OrbitMM configuration')
  .argument('[action]', 'Action: show, set, reset')
  .argument('[key]', 'Configuration key')
  .argument('[value]', 'Configuration value')
  .action((action, key, value) => {
    if (!action || action === 'show') {
      header('Configuration');
      console.log();
      console.log(colors.muted('Configuration management coming soon.'));
      console.log();
      console.log('Environment variables:');
      console.log(`  SOLANA_RPC_URL       ${process.env.SOLANA_RPC_URL ?? colors.muted('(not set)')}`);
      console.log(`  ORBITMM_CONFIG_PATH  ${process.env.ORBITMM_CONFIG_PATH ?? colors.muted('(not set)')}`);
      console.log(`  ORBITMM_WALLET_PATH  ${process.env.ORBITMM_WALLET_PATH ?? colors.muted('(not set)')}`);
      newline();
    } else {
      console.log(colors.muted('Configuration management coming soon.'));
    }
  });

// ============ Error Handling ============

program.exitOverride((err) => {
  if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version') {
    process.exit(0);
  }
  throw err;
});

// Catch unhandled errors
process.on('uncaughtException', (err) => {
  displayError(`Unexpected error: ${err.message}`);
  if (process.env.DEBUG) {
    console.error(err.stack);
  }
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  displayError(`Unhandled rejection: ${reason}`);
  process.exit(1);
});

// ============ Parse & Execute ============

async function main() {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    if (err instanceof Error) {
      displayError(err.message);
    }
    process.exit(1);
  }
}

main();
