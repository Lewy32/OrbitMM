# OrbitMM Technical Architecture

## Overview

OrbitMM is a TypeScript/Node.js application built as a monorepo with modular packages. It's designed for self-hosting and extensibility.

---

## Technology Stack

| Layer | Technology | Rationale |
|-------|------------|-----------|
| Language | TypeScript | Type safety, tooling |
| Runtime | Node.js 20+ | Async performance, ecosystem |
| Solana SDK | @solana/web3.js | Official SDK |
| DEX SDKs | Jupiter, Raydium | Aggregation + direct access |
| Database | SQLite / PostgreSQL | Local or scaled |
| Queue | BullMQ (Redis) | Job scheduling |
| Interface | Commander.js, Telegraf, React | CLI, Bot, Web |

---

## Package Structure

```
packages/
├── core/                    # Shared business logic
│   ├── src/
│   │   ├── wallet/
│   │   │   ├── generator.ts      # Keypair generation
│   │   │   ├── funder.ts         # Batch funding
│   │   │   ├── tracker.ts        # Balance tracking
│   │   │   └── index.ts
│   │   ├── trading/
│   │   │   ├── jupiter.ts        # Jupiter integration
│   │   │   ├── raydium.ts        # Raydium AMM
│   │   │   ├── pumpfun.ts        # PumpFun/PumpSwap
│   │   │   ├── meteora.ts        # Meteora DLMM
│   │   │   ├── aggregator.ts     # Route selection
│   │   │   └── index.ts
│   │   ├── orchestrator/
│   │   │   ├── bot.ts            # Bot state machine
│   │   │   ├── scheduler.ts      # Execution timing
│   │   │   ├── manager.ts        # Bot lifecycle
│   │   │   └── index.ts
│   │   ├── detection/
│   │   │   ├── patterns.ts       # Pattern definitions
│   │   │   ├── analyzer.ts       # Transaction analysis
│   │   │   ├── monitor.ts        # Real-time monitoring
│   │   │   └── index.ts
│   │   └── index.ts
│   └── package.json
├── cli/
│   ├── src/
│   │   ├── commands/
│   │   │   ├── wallet.ts         # wallet generate, fund, export
│   │   │   ├── bot.ts            # bot create, start, stop
│   │   │   ├── trade.ts          # trade buy, sell
│   │   │   └── detect.ts         # detect analyze, monitor
│   │   └── index.ts
│   └── package.json
├── bot-telegram/
│   ├── src/
│   │   ├── handlers/
│   │   ├── middleware/
│   │   └── index.ts
│   └── package.json
└── web/
    ├── src/
    └── package.json
```

---

## Core Module Details

### Wallet Generator

```typescript
// packages/core/src/wallet/generator.ts

import { Keypair } from '@solana/web3.js';
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';

export interface GeneratorOptions {
  count: number;
  derivation?: 'random' | 'hd';  // HD for deterministic recovery
  hdSeed?: string;               // BIP39 mnemonic
}

export class WalletGenerator {
  /**
   * Generate wallets using random keypairs (default)
   * or HD derivation from a seed phrase
   */
  generate(options: GeneratorOptions): Keypair[] {
    if (options.derivation === 'hd') {
      return this.generateHD(options.count, options.hdSeed!);
    }
    return this.generateRandom(options.count);
  }

  private generateRandom(count: number): Keypair[] {
    return Array.from({ length: count }, () => Keypair.generate());
  }

  private generateHD(count: number, mnemonic: string): Keypair[] {
    const seed = bip39.mnemonicToSeedSync(mnemonic);
    const wallets: Keypair[] = [];
    
    for (let i = 0; i < count; i++) {
      const path = `m/44'/501'/${i}'/0'`;  // Solana derivation path
      const derived = derivePath(path, seed.toString('hex'));
      wallets.push(Keypair.fromSeed(derived.key));
    }
    
    return wallets;
  }
}
```

### Batch Funder

```typescript
// packages/core/src/wallet/funder.ts

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from '@solana/web3.js';

export interface FundingOptions {
  source: Keypair;
  destinations: PublicKey[];
  amountPerWallet: number;  // in SOL
  batchSize?: number;       // transactions per batch (default: 20)
}

export class BatchFunder {
  constructor(private connection: Connection) {}

  /**
   * Fund multiple wallets efficiently using batched transactions
   * Each transaction can include ~20 transfers before hitting size limits
   */
  async fundAll(options: FundingOptions): Promise<string[]> {
    const { source, destinations, amountPerWallet, batchSize = 20 } = options;
    const lamports = amountPerWallet * 1e9;
    const signatures: string[] = [];

    // Split into batches
    const batches = this.chunk(destinations, batchSize);

    for (const batch of batches) {
      const tx = new Transaction();
      
      for (const dest of batch) {
        tx.add(
          SystemProgram.transfer({
            fromPubkey: source.publicKey,
            toPubkey: dest,
            lamports,
          })
        );
      }

      const sig = await sendAndConfirmTransaction(this.connection, tx, [source]);
      signatures.push(sig);
    }

    return signatures;
  }

  private chunk<T>(arr: T[], size: number): T[][] {
    return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) =>
      arr.slice(i * size, i * size + size)
    );
  }
}
```

### Jupiter Trading Integration

```typescript
// packages/core/src/trading/jupiter.ts

import { Connection, Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';

export interface JupiterQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  priceImpactPct: number;
  routePlan: RoutePlan[];
}

export interface SwapParams {
  wallet: Keypair;
  inputMint: PublicKey;
  outputMint: PublicKey;
  amount: number;           // in base units
  slippageBps?: number;     // default: 50 (0.5%)
}

export class JupiterClient {
  private readonly API_URL = 'https://quote-api.jup.ag/v6';
  
  constructor(private connection: Connection) {}

  async getQuote(
    inputMint: PublicKey,
    outputMint: PublicKey,
    amount: number,
    slippageBps: number = 50
  ): Promise<JupiterQuote> {
    const url = new URL(`${this.API_URL}/quote`);
    url.searchParams.set('inputMint', inputMint.toString());
    url.searchParams.set('outputMint', outputMint.toString());
    url.searchParams.set('amount', amount.toString());
    url.searchParams.set('slippageBps', slippageBps.toString());

    const response = await fetch(url);
    return response.json();
  }

  async swap(params: SwapParams): Promise<string> {
    const { wallet, inputMint, outputMint, amount, slippageBps = 50 } = params;

    // 1. Get quote
    const quote = await this.getQuote(inputMint, outputMint, amount, slippageBps);

    // 2. Get swap transaction
    const swapResponse = await fetch(`${this.API_URL}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: wallet.publicKey.toString(),
        wrapAndUnwrapSol: true,
      }),
    });

    const { swapTransaction } = await swapResponse.json();

    // 3. Deserialize and sign
    const txBuf = Buffer.from(swapTransaction, 'base64');
    const tx = VersionedTransaction.deserialize(txBuf);
    tx.sign([wallet]);

    // 4. Send and confirm
    const signature = await this.connection.sendTransaction(tx);
    await this.connection.confirmTransaction(signature);

    return signature;
  }
}
```

### Bot State Machine

```typescript
// packages/core/src/orchestrator/bot.ts

import { Keypair, PublicKey } from '@solana/web3.js';
import { EventEmitter } from 'events';

export type BotState = 'idle' | 'running' | 'paused' | 'stopped' | 'error';

export interface BotConfig {
  targetToken: PublicKey;
  minSwapSol: number;
  maxSwapSol: number;
  minIntervalMs: number;
  maxIntervalMs: number;
  direction: 'buy' | 'sell' | 'both';
}

export interface BotStats {
  totalSwaps: number;
  totalVolumeSol: number;
  successRate: number;
  lastSwapAt: Date | null;
  errors: number;
}

export class Bot extends EventEmitter {
  public readonly id: string;
  public state: BotState = 'idle';
  public stats: BotStats = {
    totalSwaps: 0,
    totalVolumeSol: 0,
    successRate: 1,
    lastSwapAt: null,
    errors: 0,
  };

  private timer: NodeJS.Timeout | null = null;

  constructor(
    public readonly wallet: Keypair,
    public config: BotConfig
  ) {
    super();
    this.id = wallet.publicKey.toString().slice(0, 8);
  }

  start(): void {
    if (this.state === 'running') return;
    this.state = 'running';
    this.scheduleNext();
    this.emit('started', this.id);
  }

  pause(): void {
    if (this.state !== 'running') return;
    this.state = 'paused';
    if (this.timer) clearTimeout(this.timer);
    this.emit('paused', this.id);
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'running';
    this.scheduleNext();
    this.emit('resumed', this.id);
  }

  stop(): void {
    this.state = 'stopped';
    if (this.timer) clearTimeout(this.timer);
    this.emit('stopped', this.id);
  }

  private scheduleNext(): void {
    if (this.state !== 'running') return;

    const delay = this.randomInterval();
    this.timer = setTimeout(() => this.execute(), delay);
  }

  private async execute(): Promise<void> {
    if (this.state !== 'running') return;

    try {
      const amount = this.randomAmount();
      const direction = this.selectDirection();
      
      this.emit('swap:start', { id: this.id, amount, direction });
      
      // Actual swap logic delegated to orchestrator
      // This emits event for orchestrator to handle
      this.emit('swap:execute', {
        id: this.id,
        wallet: this.wallet,
        token: this.config.targetToken,
        amount,
        direction,
      });

    } catch (error) {
      this.stats.errors++;
      this.emit('error', { id: this.id, error });
    }

    this.scheduleNext();
  }

  private randomInterval(): number {
    const { minIntervalMs, maxIntervalMs } = this.config;
    return Math.floor(Math.random() * (maxIntervalMs - minIntervalMs) + minIntervalMs);
  }

  private randomAmount(): number {
    const { minSwapSol, maxSwapSol } = this.config;
    return Math.random() * (maxSwapSol - minSwapSol) + minSwapSol;
  }

  private selectDirection(): 'buy' | 'sell' {
    if (this.config.direction !== 'both') return this.config.direction;
    return Math.random() > 0.5 ? 'buy' : 'sell';
  }
}
```

### Detection Patterns

```typescript
// packages/core/src/detection/patterns.ts

import { PublicKey } from '@solana/web3.js';

export interface Transaction {
  signature: string;
  timestamp: number;
  signer: PublicKey;
  amount: number;
  direction: 'buy' | 'sell';
}

export interface Pattern {
  type: PatternType;
  confidence: number;
  evidence: Evidence[];
}

export type PatternType =
  | 'wallet_clustering'      // Wallets funded from same source
  | 'interval_regularity'    // Suspiciously consistent timing
  | 'size_distribution'      // Non-natural trade sizes
  | 'coordinated_timing'     // Multiple wallets trading simultaneously
  | 'new_wallet_spam';       // Many new wallets appearing

export interface Evidence {
  description: string;
  data: any;
}

export class PatternDetector {
  /**
   * Analyze transactions for manipulation patterns
   */
  detect(transactions: Transaction[]): Pattern[] {
    const patterns: Pattern[] = [];

    patterns.push(...this.detectIntervalRegularity(transactions));
    patterns.push(...this.detectSizeDistribution(transactions));
    patterns.push(...this.detectCoordinatedTiming(transactions));
    patterns.push(...this.detectNewWalletSpam(transactions));

    return patterns.filter(p => p.confidence > 0.5);
  }

  private detectIntervalRegularity(txs: Transaction[]): Pattern[] {
    if (txs.length < 10) return [];

    // Calculate intervals between consecutive transactions
    const intervals: number[] = [];
    for (let i = 1; i < txs.length; i++) {
      intervals.push(txs[i].timestamp - txs[i - 1].timestamp);
    }

    // Check for suspiciously low variance
    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const variance = intervals.reduce((sum, i) => sum + Math.pow(i - mean, 2), 0) / intervals.length;
    const cv = Math.sqrt(variance) / mean;  // Coefficient of variation

    // Natural trading has CV > 1.0, bots often < 0.5
    if (cv < 0.5) {
      return [{
        type: 'interval_regularity',
        confidence: Math.min(1, (0.5 - cv) * 2),
        evidence: [{
          description: `Transaction intervals have low variance (CV=${cv.toFixed(2)})`,
          data: { cv, mean, variance },
        }],
      }];
    }

    return [];
  }

  private detectSizeDistribution(txs: Transaction[]): Pattern[] {
    if (txs.length < 20) return [];

    const amounts = txs.map(t => t.amount);
    
    // Check for uniform distribution (bots) vs log-normal (natural)
    // Natural trading follows power law / log-normal
    // Bot trading often has bounds (min..max uniform)

    const sorted = [...amounts].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const range = max - min;

    // Check if amounts cluster near min (0.3 SOL typical bot minimum)
    const nearMin = amounts.filter(a => a < min + range * 0.2).length;
    const nearMinRatio = nearMin / amounts.length;

    if (nearMinRatio < 0.1 && range > 0) {
      // Suspiciously uniform distribution
      return [{
        type: 'size_distribution',
        confidence: 0.6,
        evidence: [{
          description: 'Trade sizes show uniform distribution (not natural)',
          data: { min, max, nearMinRatio },
        }],
      }];
    }

    return [];
  }

  private detectCoordinatedTiming(txs: Transaction[]): Pattern[] {
    // Group transactions by 5-second windows
    const windows = new Map<number, Transaction[]>();
    
    for (const tx of txs) {
      const window = Math.floor(tx.timestamp / 5000) * 5000;
      if (!windows.has(window)) windows.set(window, []);
      windows.get(window)!.push(tx);
    }

    // Check for windows with many different wallets
    const suspiciousWindows = [...windows.entries()]
      .filter(([_, txs]) => {
        const uniqueWallets = new Set(txs.map(t => t.signer.toString()));
        return uniqueWallets.size >= 3;  // 3+ wallets in 5 seconds
      });

    if (suspiciousWindows.length > 0) {
      return [{
        type: 'coordinated_timing',
        confidence: Math.min(1, suspiciousWindows.length * 0.2),
        evidence: [{
          description: `${suspiciousWindows.length} time windows with coordinated multi-wallet activity`,
          data: { windowCount: suspiciousWindows.length },
        }],
      }];
    }

    return [];
  }

  private detectNewWalletSpam(txs: Transaction[]): Pattern[] {
    // This requires wallet age data - simplified version
    // In production, query on-chain for wallet creation time
    
    const uniqueWallets = new Set(txs.map(t => t.signer.toString()));
    const txsPerWallet = txs.length / uniqueWallets.size;

    // Many wallets with few txs each = suspicious
    if (uniqueWallets.size > 10 && txsPerWallet < 3) {
      return [{
        type: 'new_wallet_spam',
        confidence: 0.7,
        evidence: [{
          description: `High wallet count (${uniqueWallets.size}) with low tx per wallet (${txsPerWallet.toFixed(1)})`,
          data: { walletCount: uniqueWallets.size, txsPerWallet },
        }],
      }];
    }

    return [];
  }
}
```

---

## Data Flow

```
User Command
     │
     ▼
┌─────────────┐
│  Interface  │  (CLI / Telegram / Web)
└──────┬──────┘
       │
       ▼
┌─────────────────────────────────────┐
│          Orchestrator               │
│  ┌─────────┐  ┌─────────────────┐  │
│  │ Bots[]  │  │ Event Loop      │  │
│  │         │  │ - Schedule swaps│  │
│  │ Bot 1   │  │ - Handle results│  │
│  │ Bot 2   │  │ - Update stats  │  │
│  │ ...     │  │                 │  │
│  └─────────┘  └─────────────────┘  │
└──────┬──────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────┐
│          Trading Engine             │
│  ┌─────────┐  ┌─────────┐          │
│  │ Jupiter │  │ Raydium │  ...     │
│  └────┬────┘  └────┬────┘          │
│       └─────┬──────┘               │
│             ▼                       │
│      Route Selection                │
└──────┬──────────────────────────────┘
       │
       ▼
┌─────────────┐
│   Solana    │
│   RPC       │
└─────────────┘
```

---

## Configuration Schema

```typescript
// packages/core/src/config/schema.ts

export interface Config {
  // Network
  rpc: {
    url: string;
    wsUrl?: string;
    commitment: 'processed' | 'confirmed' | 'finalized';
  };

  // Wallet management
  wallet: {
    encryption: boolean;
    encryptionKey?: string;  // env var name
    backupPath?: string;
  };

  // Trading defaults
  trading: {
    defaultSlippageBps: number;
    priorityFee: 'auto' | number;  // lamports or auto-adjust
    maxRetries: number;
    retryDelayMs: number;
  };

  // Bot defaults
  orchestrator: {
    maxConcurrent: number;
    defaultConfig: {
      minSwapSol: number;
      maxSwapSol: number;
      minIntervalMs: number;
      maxIntervalMs: number;
    };
  };

  // Detection
  detection: {
    enabled: boolean;
    alertThreshold: number;  // 0-1 confidence
    webhookUrl?: string;     // alert destination
  };

  // Transparency
  transparency: {
    enabled: boolean;
    marker: string;  // memo prefix
  };

  // Database
  database: {
    type: 'sqlite' | 'postgres';
    url: string;
  };
}
```

---

## Security Considerations

### Wallet Security
- All private keys encrypted at rest (AES-256-GCM)
- Keys never logged or transmitted
- Optional HSM integration for production

### RPC Security
- Rate limiting to avoid IP bans
- Multiple RPC endpoints for failover
- Private RPC recommended for production

### Access Control
- Owner-only by default (Telegram user ID / API key)
- Role-based access for web interface
- Audit logging for all operations

---

## Performance Targets

| Metric | Target |
|--------|--------|
| Wallet generation | 1000/second |
| Concurrent bots | 1000+ |
| Swap latency | <2 seconds |
| Detection analysis | <1 second for 1000 txs |

---

## Testing Strategy

```
tests/
├── unit/
│   ├── wallet/
│   ├── trading/
│   └── detection/
├── integration/
│   ├── jupiter.test.ts
│   └── orchestrator.test.ts
└── e2e/
    └── full-flow.test.ts
```

- Unit tests: Jest with mocked Solana
- Integration tests: Devnet
- E2E tests: Full flow on devnet

---

## Deployment Options

### Local (Development)
```bash
npm install
npm run dev
```

### Docker
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY . .
RUN npm ci && npm run build
CMD ["npm", "start"]
```

### Cloud (Production)
- Railway / Render / Fly.io
- PostgreSQL for persistence
- Redis for job queue
- Dedicated RPC endpoint

---

*Architecture version: 1.0*
*Last updated: 2026-02-07*
