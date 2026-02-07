/**
 * OrbitMM CLI - Wallet Commands
 * 
 * wallet generate [count] --hd --seed
 * wallet fund <source> <amount> --wallets
 * wallet export <file> --password
 * wallet import <file> --password
 * wallet balance [wallets...]
 */

import { Command } from 'commander';
import { Keypair, PublicKey, Connection } from '@solana/web3.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as readline from 'readline';
import {
  generate,
  generateMnemonic,
  keypairsToWalletData,
  encrypt,
  decrypt,
  fundAll,
  estimateFundingCost,
  getBalances,
  walletDataToKeypair,
  type WalletData,
  type WalletExport,
} from '@orbitmm/core';
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
  formatSol,
  formatAddress,
  keyValue,
} from '../utils/display.js';

// ============ Helpers ============

async function promptPassword(prompt = 'Enter password: ', confirm = false): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve, reject) => {
    // Hide input
    const query = (q: string): Promise<string> =>
      new Promise((res) => {
        rl.question(q, (answer) => res(answer));
        // Hide characters as typed
        process.stdout.write('\x1B[?25l'); // Hide cursor
      });

    (async () => {
      try {
        const password = await query(prompt);
        process.stdout.write('\x1B[?25h'); // Show cursor
        console.log(); // New line after hidden input

        if (confirm) {
          const confirmed = await query('Confirm password: ');
          console.log();
          if (password !== confirmed) {
            rl.close();
            reject(new Error('Passwords do not match'));
            return;
          }
        }

        rl.close();
        resolve(password);
      } catch (err) {
        rl.close();
        reject(err);
      }
    })();
  });
}

function getConnection(): Connection {
  const rpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.mainnet-beta.solana.com';
  return new Connection(rpcUrl, 'confirmed');
}

function getWalletStorePath(): string {
  return process.env.ORBITMM_WALLET_PATH ?? path.join(process.env.HOME ?? '.', '.orbitmm', 'wallets.json');
}

async function loadStoredWallets(): Promise<WalletData[]> {
  const storePath = getWalletStorePath();
  try {
    const content = await fs.readFile(storePath, 'utf-8');
    const exported: WalletExport = JSON.parse(content);
    
    if (exported.encrypted) {
      warning('Wallet file is encrypted. Use "wallet import" to decrypt.');
      return [];
    }
    
    return exported.wallets as WalletData[];
  } catch {
    return [];
  }
}

// ============ Commands ============

export function registerWalletCommands(program: Command): void {
  const wallet = program
    .command('wallet')
    .description('Wallet management commands');

  // ---- wallet generate ----
  wallet
    .command('generate [count]')
    .description('Generate new wallets')
    .option('--hd', 'Use HD derivation from seed phrase')
    .option('--seed <mnemonic>', 'BIP39 seed phrase for HD derivation')
    .option('--new-seed', 'Generate a new seed phrase for HD derivation')
    .option('-o, --output <file>', 'Output file for wallet export')
    .option('-p, --password <password>', 'Password for encryption (or prompts if not provided)')
    .option('--no-encrypt', 'Skip encryption (not recommended)')
    .action(async (countArg: string | undefined, options) => {
      try {
        const count = parseInt(countArg ?? '1', 10);
        
        if (isNaN(count) || count < 1) {
          error('Invalid count. Must be a positive integer.');
          process.exit(1);
        }

        if (count > 10000) {
          error('Maximum 10,000 wallets per generation.');
          process.exit(1);
        }

        header(`${icons.wallet} Generating ${count} Wallet${count > 1 ? 's' : ''}`);

        let seed: string | undefined;
        let isHD = options.hd || options.seed || options.newSeed;

        if (options.newSeed) {
          seed = generateMnemonic(256);
          console.log();
          warning('IMPORTANT: Save this seed phrase securely!');
          console.log();
          console.log(colors.highlight(seed));
          console.log();
        } else if (options.seed) {
          seed = options.seed;
        }

        const spin = spinner('Generating wallets...');
        spin.start();

        const keypairs = generate({
          count,
          derivation: isHD ? 'hd' : 'random',
          hdSeed: seed,
        });

        spin.succeed(`Generated ${count} wallet${count > 1 ? 's' : ''}`);

        // Display first few wallets
        const displayCount = Math.min(5, keypairs.length);
        console.log();
        console.log(table(
          keypairs.slice(0, displayCount).map((kp, i) => ({
            index: i + 1,
            publicKey: kp.publicKey.toString(),
          })),
          {
            columns: [
              { key: 'index', header: '#', width: 4, align: 'right' },
              { key: 'publicKey', header: 'Public Key', format: (v) => formatAddress(String(v), 12) },
            ],
          }
        ));

        if (keypairs.length > displayCount) {
          console.log(colors.muted(`  ... and ${keypairs.length - displayCount} more`));
        }

        // Export wallets
        const walletData = keypairsToWalletData(keypairs);
        
        if (options.output || options.encrypt !== false) {
          const outputPath = options.output ?? getWalletStorePath();
          
          // Ensure directory exists
          await fs.mkdir(path.dirname(outputPath), { recursive: true });

          if (options.encrypt !== false) {
            const password = options.password ?? await promptPassword('Enter encryption password: ', true);
            
            const spin2 = spinner('Encrypting wallets...');
            spin2.start();
            
            const exported = await encrypt(walletData, password);
            await fs.writeFile(outputPath, JSON.stringify(exported, null, 2));
            
            spin2.succeed(`Encrypted and saved to ${colors.highlight(outputPath)}`);
          } else {
            warning('Saving wallets WITHOUT encryption. This is not recommended!');
            const exported: WalletExport = {
              version: 1,
              created: new Date().toISOString(),
              encrypted: false,
              wallets: walletData,
            };
            await fs.writeFile(outputPath, JSON.stringify(exported, null, 2));
            info(`Saved to ${colors.highlight(outputPath)}`);
          }
        }

        newline();
        success(`Successfully generated ${count} wallet${count > 1 ? 's' : ''}`);

      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to generate wallets');
        process.exit(1);
      }
    });

  // ---- wallet fund ----
  wallet
    .command('fund <source> <amount>')
    .description('Fund wallets from a source wallet')
    .option('-w, --wallets <addresses...>', 'Specific wallet addresses to fund')
    .option('-f, --from-file <file>', 'Load destination wallets from file')
    .option('--priority-fee <lamports>', 'Priority fee in lamports', '1000')
    .option('--dry-run', 'Show what would be funded without executing')
    .action(async (source: string, amountStr: string, options) => {
      try {
        const amount = parseFloat(amountStr);
        
        if (isNaN(amount) || amount <= 0) {
          error('Invalid amount. Must be a positive number.');
          process.exit(1);
        }

        header(`${icons.money} Fund Wallets`);

        // Load source keypair
        let sourceKeypair: Keypair;
        try {
          const sourceData = JSON.parse(await fs.readFile(source, 'utf-8'));
          sourceKeypair = Keypair.fromSecretKey(new Uint8Array(sourceData));
        } catch {
          error(`Could not load source wallet from: ${source}`);
          info('Expected a JSON file containing the secret key array.');
          process.exit(1);
        }

        // Determine destinations
        let destinations: PublicKey[] = [];

        if (options.wallets) {
          destinations = options.wallets.map((addr: string) => new PublicKey(addr));
        } else if (options.fromFile) {
          const wallets = await loadStoredWallets();
          destinations = wallets.map((w) => new PublicKey(w.publicKey));
        } else {
          // Default: load from stored wallets
          const wallets = await loadStoredWallets();
          if (wallets.length === 0) {
            error('No wallets found. Generate wallets first or specify --wallets.');
            process.exit(1);
          }
          destinations = wallets.map((w) => new PublicKey(w.publicKey));
        }

        if (destinations.length === 0) {
          error('No destination wallets specified.');
          process.exit(1);
        }

        // Calculate costs
        const priorityFee = parseInt(options.priorityFee, 10);
        const estimate = estimateFundingCost(destinations.length, amount, priorityFee);

        console.log();
        console.log(keyValue({
          'Source wallet': formatAddress(sourceKeypair.publicKey.toString()),
          'Destinations': destinations.length,
          'Amount per wallet': `${amount} SOL`,
          'Estimated fees': `${estimate.fees.toFixed(6)} SOL`,
          'Total required': `${estimate.total.toFixed(6)} SOL`,
        }));
        console.log();

        if (options.dryRun) {
          warning('Dry run mode - no transactions will be sent.');
          return;
        }

        // Execute funding
        const connection = getConnection();
        
        const progress = new ProgressBar(destinations.length, 'Funding');
        
        const result = await fundAll(connection, {
          source: sourceKeypair,
          destinations,
          amountPerWallet: amount,
          priorityFee,
        });

        progress.succeed();

        // Show results
        newline();
        console.log(keyValue({
          'Successful': colors.success(String(result.successful.length)),
          'Failed': result.failed.length > 0 ? colors.error(String(result.failed.length)) : colors.muted('0'),
          'Total funded': formatSol(result.totalFunded * 1e9),
          'Fees paid': formatSol(result.feePaid * 1e9),
          'Transactions': result.signatures.length,
        }));

        if (result.failed.length > 0) {
          newline();
          warning('Failed wallets:');
          for (const f of result.failed.slice(0, 5)) {
            console.log(`  ${icons.error} ${formatAddress(f.wallet.toString())}: ${f.error}`);
          }
          if (result.failed.length > 5) {
            console.log(colors.muted(`  ... and ${result.failed.length - 5} more`));
          }
        }

        newline();
        success(`Funded ${result.successful.length} wallet${result.successful.length !== 1 ? 's' : ''}`);

      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to fund wallets');
        process.exit(1);
      }
    });

  // ---- wallet export ----
  wallet
    .command('export <file>')
    .description('Export wallets to an encrypted file')
    .option('-p, --password <password>', 'Password for encryption')
    .option('--no-encrypt', 'Export without encryption (not recommended)')
    .action(async (file: string, options) => {
      try {
        header(`${icons.lock} Export Wallets`);

        const wallets = await loadStoredWallets();
        
        if (wallets.length === 0) {
          error('No wallets found to export.');
          process.exit(1);
        }

        info(`Found ${wallets.length} wallet${wallets.length !== 1 ? 's' : ''} to export`);
        console.log();

        const outputPath = path.resolve(file);
        await fs.mkdir(path.dirname(outputPath), { recursive: true });

        if (options.encrypt !== false) {
          const password = options.password ?? await promptPassword('Enter encryption password: ', true);
          
          const spin = spinner('Encrypting wallets...');
          spin.start();
          
          const exported = await encrypt(wallets, password);
          await fs.writeFile(outputPath, JSON.stringify(exported, null, 2));
          
          spin.succeed(`Exported to ${colors.highlight(outputPath)}`);
        } else {
          warning('Exporting WITHOUT encryption. This is not recommended!');
          const exported: WalletExport = {
            version: 1,
            created: new Date().toISOString(),
            encrypted: false,
            wallets,
          };
          await fs.writeFile(outputPath, JSON.stringify(exported, null, 2));
          info(`Exported to ${colors.highlight(outputPath)}`);
        }

        newline();
        success(`Exported ${wallets.length} wallet${wallets.length !== 1 ? 's' : ''}`);

      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to export wallets');
        process.exit(1);
      }
    });

  // ---- wallet import ----
  wallet
    .command('import <file>')
    .description('Import wallets from an encrypted file')
    .option('-p, --password <password>', 'Password for decryption')
    .option('--merge', 'Merge with existing wallets instead of replacing')
    .action(async (file: string, options) => {
      try {
        header(`${icons.unlock} Import Wallets`);

        const inputPath = path.resolve(file);
        
        let content: string;
        try {
          content = await fs.readFile(inputPath, 'utf-8');
        } catch {
          error(`Could not read file: ${inputPath}`);
          process.exit(1);
        }

        const exported: WalletExport = JSON.parse(content);
        
        let wallets: WalletData[];
        
        if (exported.encrypted) {
          const password = options.password ?? await promptPassword('Enter decryption password: ');
          
          const spin = spinner('Decrypting wallets...');
          spin.start();
          
          try {
            wallets = await decrypt(exported, password);
            spin.succeed(`Decrypted ${wallets.length} wallet${wallets.length !== 1 ? 's' : ''}`);
          } catch {
            spin.fail('Decryption failed');
            error('Invalid password or corrupted file.');
            process.exit(1);
          }
        } else {
          wallets = exported.wallets as WalletData[];
          info(`Loaded ${wallets.length} wallet${wallets.length !== 1 ? 's' : ''} (unencrypted)`);
        }

        // Handle merge
        const storePath = getWalletStorePath();
        let finalWallets = wallets;

        if (options.merge) {
          const existing = await loadStoredWallets();
          const existingKeys = new Set(existing.map((w) => w.publicKey));
          const newWallets = wallets.filter((w) => !existingKeys.has(w.publicKey));
          finalWallets = [...existing, ...newWallets];
          info(`Merged: ${existing.length} existing + ${newWallets.length} new = ${finalWallets.length} total`);
        }

        // Save
        await fs.mkdir(path.dirname(storePath), { recursive: true });
        
        const password = options.password ?? await promptPassword('Enter password to save: ', true);
        const savedExport = await encrypt(finalWallets, password);
        await fs.writeFile(storePath, JSON.stringify(savedExport, null, 2));

        newline();
        success(`Imported ${wallets.length} wallet${wallets.length !== 1 ? 's' : ''}`);

      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to import wallets');
        process.exit(1);
      }
    });

  // ---- wallet balance ----
  wallet
    .command('balance [wallets...]')
    .description('Check wallet balances')
    .option('-a, --all', 'Show all stored wallets')
    .option('--json', 'Output as JSON')
    .action(async (walletAddrs: string[], options) => {
      try {
        header(`${icons.money} Wallet Balances`);

        let addresses: PublicKey[] = [];

        if (walletAddrs.length > 0) {
          addresses = walletAddrs.map((addr) => new PublicKey(addr));
        } else if (options.all) {
          const wallets = await loadStoredWallets();
          if (wallets.length === 0) {
            error('No stored wallets found.');
            process.exit(1);
          }
          addresses = wallets.map((w) => new PublicKey(w.publicKey));
        } else {
          error('Specify wallet addresses or use --all to show all stored wallets.');
          process.exit(1);
        }

        const spin = spinner(`Fetching balances for ${addresses.length} wallet${addresses.length !== 1 ? 's' : ''}...`);
        spin.start();

        const connection = getConnection();
        const balances = await getBalances(connection, addresses);

        spin.stop();
        console.log();

        if (options.json) {
          const result: Record<string, number> = {};
          for (const [key, value] of balances) {
            result[key] = value;
          }
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        // Calculate totals
        let totalBalance = 0;
        const rows = Array.from(balances.entries()).map(([pubkey, balance]) => {
          totalBalance += balance;
          return {
            wallet: pubkey,
            balance,
          };
        });

        console.log(table(rows, {
          columns: [
            { key: 'wallet', header: 'Wallet', format: (v) => formatAddress(String(v)) },
            { key: 'balance', header: 'Balance', align: 'right', format: (v) => formatSol(Number(v) * 1e9) },
          ],
        }));

        console.log();
        console.log(keyValue({
          'Total wallets': addresses.length,
          'Total balance': formatSol(totalBalance * 1e9),
          'Average balance': formatSol((totalBalance / addresses.length) * 1e9),
        }));

      } catch (err) {
        error(err instanceof Error ? err.message : 'Failed to get balances');
        process.exit(1);
      }
    });
}
