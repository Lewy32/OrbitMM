# OrbitMM Architect Specification

**Version:** 1.0  
**Date:** 2026-02-07  
**Status:** APPROVED FOR IMPLEMENTATION  
**Architect:** Deep Reasoning Pass Complete

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Open Questions Resolved](#open-questions-resolved)
3. [Technical Decisions Finalized](#technical-decisions-finalized)
4. [Module Specifications](#module-specifications)
5. [Gap Analysis](#gap-analysis)
6. [Implementation Order](#implementation-order)
7. [Security Threat Model](#security-threat-model)
8. [Appendices](#appendices)

---

## Executive Summary

This document provides definitive answers to all architectural questions and detailed specifications for implementing OrbitMM. Every worker agent should treat this as the single source of truth.

### External Data Integration: Allium

**IMPORTANT:** The detection module MUST use the Allium skill for on-chain data queries.

Allium provides:
- Real-time token prices across 150+ chains
- Wallet balances and transaction history
- Historical OHLCV data
- Custom SQL queries for advanced analytics

**Skill location:** `~/.openclaw/skills/allium-onchain-data/SKILL.md`

**Usage in detection module:**
```typescript
// Example: Get wallet transaction history for pattern analysis
const walletTxs = await allium.getWalletTransactions(chain, walletAddress);

// Example: Check if wallets were funded from same source
const fundingHistory = await allium.getWalletBalanceHistory(chain, wallets);

// Example: Custom SQL for clustering analysis
const clusterData = await allium.runQuery(queryId, {
  sql_query: `SELECT * FROM solana.raw.transactions WHERE ...`
});
```

All detection workers should read the Allium skill documentation before implementation.

**Core Principles:**
1. **Fail-safe over fail-fast** — Protect user funds above all else
2. **Simple until proven insufficient** — Start minimal, scale only when needed
3. **Recoverable state** — Every operation must be resumable after crash
4. **Defense-first design** — Detection module is as important as the trading engine

---

## Open Questions Resolved

### Wallet Engine Questions

#### Q1: HD vs Random Generation — Which Default?

**Decision: Random generation is DEFAULT. HD is opt-in.**

**Rationale:**
- **Security**: Random keypairs have no mathematical relationship. If one is compromised, others remain safe. HD wallets have a single point of failure (the seed).
- **Plausible deniability**: Random wallets appear unrelated on-chain, matching the operational goal.
- **Performance**: Random generation is marginally faster (no derivation computation).
- **HD use case**: Only beneficial when user explicitly needs recovery from a single seed. This is advanced usage.

**Implementation:**
```typescript
// Default behavior
generator.generate({ count: 100 }); // Random

// Opt-in HD
generator.generate({ 
  count: 100, 
  derivation: 'hd', 
  hdSeed: 'mnemonic words...' 
});
```

**Trade-offs accepted:**
- Random wallets require explicit backup (encrypted export file)
- Lost export = lost wallets (mitigated by mandatory export on generation)

---

#### Q2: Encryption at Rest — Algorithm and Key Derivation?

**Decision: AES-256-GCM with Argon2id key derivation**

**Rationale:**
- **AES-256-GCM**: Authenticated encryption. Tamper-evident. Industry standard. Native Node.js crypto support.
- **Argon2id**: Winner of Password Hashing Competition. Memory-hard (resists GPU attacks). Argon2id variant is hybrid (resists side-channel AND GPU attacks).

**Parameters:**
```typescript
// Argon2id parameters (OWASP recommended)
const keyDerivationConfig = {
  algorithm: 'argon2id',
  memoryCost: 65536,    // 64 MB
  timeCost: 3,          // 3 iterations
  parallelism: 4,       // 4 threads
  hashLength: 32,       // 256 bits for AES-256
};

// AES-256-GCM parameters
const encryptionConfig = {
  algorithm: 'aes-256-gcm',
  ivLength: 12,         // 96 bits (GCM standard)
  tagLength: 16,        // 128 bits auth tag
};
```

**Key sources (in order of preference):**
1. Environment variable (`ORBITMM_ENCRYPTION_KEY`)
2. Interactive password prompt (for CLI)
3. File-based key (`~/.orbitmm/keyfile` — permissions 0600)

**Never**: Hardcoded keys, unencrypted storage, or keys in config files.

---

#### Q3: Batch Size Limits — Solana TX Size Constraints?

**Decision: 20 transfers per transaction (conservative limit)**

**Rationale:**
- Solana transaction size limit: **1232 bytes**
- Each `SystemProgram.transfer` instruction: ~45 bytes (varies slightly)
- Transaction overhead (signatures, headers): ~200 bytes
- Safe payload: ~1000 bytes → **~22 transfers max**
- We use 20 to leave headroom for priority fees and other instructions

**Dynamic adjustment:**
```typescript
const BATCH_SIZE_CONFIG = {
  default: 20,
  withPriorityFee: 18,      // Priority fee adds compute budget instruction
  withMemo: 15,             // Transparency marker adds memo
  minimum: 10,              // Never go below for efficiency
  maximum: 22,              // Hard limit from tx size
};
```

**Failure handling:**
- If transaction fails with "too large" error, halve batch size and retry
- Log the failure for adjustment of defaults

---

#### Q4: Recovery Strategy — What If Keys Lost?

**Decision: Multi-layer backup with mandatory export**

**Recovery Layers:**

1. **Mandatory Export on Generation**
   - System refuses to generate wallets without specifying export path
   - Encrypted JSON file created atomically (write to temp, then rename)
   
2. **Automatic Backups**
   - Every 1 hour (configurable), export current wallet state
   - Rotate backups: keep last 24 hourly, last 7 daily
   - Location: `~/.orbitmm/backups/`

3. **Export Format**
   ```json
   {
     "version": 1,
     "created": "2026-02-07T01:00:00Z",
     "encrypted": true,
     "kdf": "argon2id",
     "kdfParams": { ... },
     "iv": "base64...",
     "tag": "base64...",
     "data": "base64-encrypted-keypairs..."
   }
   ```

4. **HD Recovery (opt-in)**
   - If HD derivation was used, seed phrase alone recovers all wallets
   - Store derivation index count in metadata

**What we cannot recover:**
- Random wallets with lost export AND lost password = unrecoverable
- This is a feature, not a bug (same as any crypto wallet)

---

### Trading Engine Questions

#### Q1: Jupiter vs Direct DEX — When to Use Which?

**Decision: Jupiter PRIMARY, direct DEX for specific scenarios**

**Default routing:**
```
User Request → Jupiter Quote API → Best Route → Execute
```

**Direct DEX fallback triggers:**

| Scenario | Use Direct DEX | Reason |
|----------|----------------|--------|
| Jupiter API timeout (>3s) | Raydium | Availability |
| PumpFun bonding curve | PumpFun | Not in Jupiter |
| Jupiter returns no route | Try all DEXs | Edge case tokens |
| User explicitly requests | Specified DEX | User knows best |
| Meteora DLMM-specific strategy | Meteora | Concentrated liquidity |

**Implementation:**
```typescript
async function getQuote(params: QuoteParams): Promise<Quote> {
  // 1. Try Jupiter first (aggregator = best price)
  try {
    const jupiterQuote = await jupiter.getQuote(params, { timeout: 3000 });
    if (jupiterQuote) return jupiterQuote;
  } catch (e) {
    log.warn('Jupiter failed, falling back to direct DEX');
  }
  
  // 2. Parallel query direct DEXs
  const quotes = await Promise.allSettled([
    raydium.getQuote(params),
    meteora.getQuote(params),
    pumpfun.getQuote(params),
  ]);
  
  // 3. Return best available
  return selectBestQuote(quotes);
}
```

---

#### Q2: Priority Fee Strategy — How to Auto-Adjust?

**Decision: Percentile-based dynamic fees with caps**

**Algorithm:**
```typescript
interface PriorityFeeConfig {
  mode: 'auto' | 'fixed';
  fixedLamports?: number;
  
  // Auto mode settings
  percentile: number;        // Default: 50 (median)
  minLamports: number;       // Default: 1000 (0.000001 SOL)
  maxLamports: number;       // Default: 1000000 (0.001 SOL)
  refreshIntervalMs: number; // Default: 10000 (10s)
}

async function getPriorityFee(): Promise<number> {
  // Query recent priority fees from RPC
  const recentFees = await connection.getRecentPrioritizationFees({
    lockedWritableAccounts: [targetAccount],
  });
  
  // Sort and get percentile
  const sorted = recentFees.map(f => f.prioritizationFee).sort((a, b) => a - b);
  const index = Math.floor(sorted.length * (config.percentile / 100));
  const fee = sorted[index] || config.minLamports;
  
  // Apply bounds
  return Math.max(config.minLamports, Math.min(config.maxLamports, fee));
}
```

**Urgency multipliers:**
- Normal: 1.0x (50th percentile)
- High: 1.5x (for time-sensitive operations)
- Critical: 2.0x (for stuck transaction resolution)

---

#### Q3: Slippage Protection — Abort Conditions?

**Decision: Multi-level protection with configurable thresholds**

**Abort conditions:**

| Condition | Default Threshold | Action |
|-----------|-------------------|--------|
| Price impact too high | >5% | Abort, log, alert |
| Slippage exceeded | >configured (default 1%) | Transaction auto-reverts on-chain |
| Quote stale | >10 seconds old | Re-fetch quote |
| Output below minimum | <0.5 * expected | Abort pre-flight |
| Pool liquidity insufficient | <2x trade size | Abort, suggest smaller size |

**Pre-flight checks (before signing):**
```typescript
function validateTrade(quote: Quote, params: SwapParams): ValidationResult {
  const checks = [
    { 
      name: 'priceImpact', 
      pass: quote.priceImpactPct < config.maxPriceImpactPct,
      message: `Price impact ${quote.priceImpactPct}% exceeds max ${config.maxPriceImpactPct}%`
    },
    { 
      name: 'minimumOutput', 
      pass: quote.outAmount >= params.amount * (1 - params.slippagePct / 100) * 0.5,
      message: 'Output suspiciously low, possible scam token or liquidity issue'
    },
    {
      name: 'quoteAge',
      pass: Date.now() - quote.timestamp < 10000,
      message: 'Quote is stale, will re-fetch'
    },
  ];
  
  return { valid: checks.every(c => c.pass), checks };
}
```

---

#### Q4: Failed Transaction Handling — Retry Logic?

**Decision: Exponential backoff with transaction replacement**

**Retry strategy:**
```typescript
const RETRY_CONFIG = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  
  // Errors that should NOT retry
  nonRetryableErrors: [
    'insufficient funds',
    'slippage tolerance exceeded',
    'token account not found',
    'invalid signature',
  ],
  
  // Errors that SHOULD retry
  retryableErrors: [
    'block height exceeded',      // Re-fetch blockhash
    'transaction simulation failed',  // May be transient
    'node behind',
    'timeout',
  ],
};

async function executeWithRetry(buildTx: () => Promise<Transaction>): Promise<string> {
  let lastError: Error;
  let delay = RETRY_CONFIG.initialDelayMs;
  
  for (let attempt = 1; attempt <= RETRY_CONFIG.maxRetries; attempt++) {
    try {
      // Rebuild transaction each attempt (fresh blockhash)
      const tx = await buildTx();
      return await sendAndConfirm(tx);
    } catch (error) {
      lastError = error;
      
      if (isNonRetryable(error)) {
        throw error; // Don't retry
      }
      
      log.warn(`Attempt ${attempt} failed: ${error.message}. Retrying in ${delay}ms`);
      await sleep(delay);
      delay = Math.min(delay * RETRY_CONFIG.backoffMultiplier, RETRY_CONFIG.maxDelayMs);
    }
  }
  
  throw new Error(`Failed after ${RETRY_CONFIG.maxRetries} attempts: ${lastError.message}`);
}
```

**Transaction replacement (for stuck transactions):**
- If transaction not confirmed after 30s, send with higher priority fee
- Old transaction will fail (same nonce logic via durable nonces if needed)

---

### Orchestrator Questions

#### Q1: State Persistence — What If Process Crashes Mid-Run?

**Decision: Write-ahead log (WAL) + periodic snapshots**

**Architecture:**
```
State Management
├── WAL (write-ahead log) — every state change
├── Snapshots — full state every 5 minutes
└── Recovery — replay WAL from last snapshot
```

**WAL entries:**
```typescript
interface WALEntry {
  id: string;           // UUID
  timestamp: number;
  type: 'bot_created' | 'bot_started' | 'bot_paused' | 'swap_initiated' | 
        'swap_completed' | 'swap_failed' | 'bot_stopped';
  data: any;            // Type-specific payload
  checksum: string;     // SHA-256 for integrity
}
```

**Recovery procedure:**
```typescript
async function recover(): Promise<OrchestratorState> {
  // 1. Load latest snapshot
  const snapshot = await loadLatestSnapshot();
  
  // 2. Find WAL entries after snapshot
  const walEntries = await loadWALAfter(snapshot.timestamp);
  
  // 3. Replay entries
  let state = snapshot.state;
  for (const entry of walEntries) {
    state = applyWALEntry(state, entry);
  }
  
  // 4. Resume bots that were running
  for (const bot of state.bots) {
    if (bot.state === 'running') {
      // Don't immediately resume - may have pending swaps
      bot.state = 'paused';
      log.info(`Bot ${bot.id} paused for review after recovery`);
    }
  }
  
  return state;
}
```

**Crash safety guarantees:**
- No swap can be executed twice (idempotency via transaction signature tracking)
- No wallet funds lost (only transaction is atomic)
- State consistent within one WAL entry

---

#### Q2: Concurrency Limits — RPC Rate Limiting?

**Decision: Tiered rate limiting with RPC pooling**

**Default limits (conservative, for public RPCs):**
```typescript
const RPC_LIMITS = {
  // Per-endpoint limits
  maxRequestsPerSecond: 40,    // Most public RPCs limit at 50
  maxConcurrentRequests: 10,   // Connection pool size
  
  // Backoff on 429 responses
  backoffBaseMs: 1000,
  backoffMaxMs: 30000,
  
  // Circuit breaker
  failureThreshold: 5,         // Consecutive failures
  resetTimeMs: 60000,          // Time before retry
};
```

**RPC pooling:**
```typescript
interface RPCPool {
  endpoints: RPCEndpoint[];
  strategy: 'round-robin' | 'least-loaded' | 'random';
}

// Recommended setup for production
const rpcPool = {
  endpoints: [
    { url: 'https://api.mainnet-beta.solana.com', weight: 1, rateLimit: 40 },
    { url: process.env.HELIUS_RPC, weight: 3, rateLimit: 100 },
    { url: process.env.QUICKNODE_RPC, weight: 3, rateLimit: 100 },
  ],
  strategy: 'least-loaded',
};
```

**Bot-to-RPC mapping:**
- With 1000 bots at 1 swap/minute each = ~17 RPC calls/second (quote + swap + confirm)
- Safely within limits for single premium RPC
- For 10k bots: Need RPC pool with 3+ premium endpoints

---

#### Q3: Memory Management — 10k Bots in Memory?

**Decision: Lazy loading with LRU cache for bot state**

**Memory calculation:**
```
Per bot (estimated):
- Keypair: 64 bytes (secret key)
- Config: ~200 bytes
- Stats: ~100 bytes
- Timer reference: 8 bytes
- Event emitter overhead: ~500 bytes
- Total: ~872 bytes per bot

10,000 bots = ~8.5 MB (acceptable)
100,000 bots = ~85 MB (still acceptable)
```

**Optimization for extreme scale (>100k bots):**
```typescript
// Tiered storage
interface BotStorage {
  // Hot: Currently running, in memory
  active: Map<string, Bot>;           // Max 10k
  
  // Warm: Recently used, in memory with eviction
  cached: LRUCache<string, Bot>;      // Max 50k, evicts to cold
  
  // Cold: Persisted, loaded on demand
  persisted: Database;                // Unlimited
}
```

**For MVP: Keep all bots in memory.** 10k bots is ~8.5 MB. Modern servers have 1GB+ RAM. Optimize only if we hit actual memory issues.

---

#### Q4: Event Ordering Guarantees?

**Decision: Per-bot ordering, no global ordering**

**Guarantees:**
- Events for a single bot are strictly ordered
- Events across bots have no ordering guarantee
- Timestamps are monotonic within a bot's event stream

**Why no global ordering:**
- Global ordering requires single-threaded execution (performance bottleneck)
- Each bot is independent; cross-bot ordering is not semantically meaningful
- WAL provides causal ordering for recovery

**Implementation:**
```typescript
class Bot {
  private eventSequence = 0;
  
  emit(event: string, data: any) {
    super.emit(event, {
      ...data,
      _seq: this.eventSequence++,
      _ts: Date.now(),
      _botId: this.id,
    });
  }
}
```

---

### Detection Module Questions

#### Q1: Real-time vs Batch Analysis?

**Decision: Hybrid — streaming for alerts, batch for deep analysis**

**Architecture:**
```
Incoming Transactions
        │
        ▼
┌───────────────────┐
│  Stream Processor │ ◄── Real-time pattern matching
│  (lightweight)    │     - Interval regularity
└────────┬──────────┘     - Coordinated timing
         │                 - Basic clustering
         │ Alert if confidence > 0.7
         ▼
┌───────────────────┐
│  Batch Analyzer   │ ◄── Deep analysis (every 5 min)
│  (heavyweight)    │     - Graph analysis
└───────────────────┘     - Wallet age lookup
                          - Cross-token correlation
```

**Real-time patterns (must complete in <100ms):**
- Interval regularity (simple statistics)
- Size distribution anomalies
- Coordinated timing (time windowing)

**Batch patterns (can take seconds):**
- Wallet clustering via funding sources (requires RPC calls)
- Graph-based relationship discovery
- Historical pattern comparison

---

#### Q2: False Positive Rate Targets?

**Decision: Tiered confidence with 5% false positive tolerance at alert threshold**

**Confidence tiers:**

| Confidence | Label | False Positive Rate | Action |
|------------|-------|---------------------|--------|
| 0.0 - 0.3 | Low | N/A | Log only |
| 0.3 - 0.5 | Medium | ~20% | Include in report |
| 0.5 - 0.7 | High | ~10% | Highlight in UI |
| 0.7 - 1.0 | Very High | <5% | Alert user |

**Calibration strategy:**
- Build labeled dataset from known manipulation cases
- Cross-validate detection thresholds
- Expose confidence scores to users (transparency)
- Allow user to adjust alert threshold

**Trade-off accepted:**
- Missing some manipulation (false negatives) is acceptable
- Alerting on legitimate trading (false positives) damages trust
- Better to under-alert than over-alert

---

#### Q3: Data Retention Policy?

**Decision: Tiered retention with user control**

**Default retention:**

| Data Type | Retention | Rationale |
|-----------|-----------|-----------|
| Transaction logs | 7 days | Recent context for analysis |
| Alert history | 30 days | Audit trail |
| Aggregated stats | Indefinite | Low storage, useful trends |
| Raw analysis data | 24 hours | Only needed for active monitoring |

**Storage estimates:**
- 1 monitored token @ 1000 tx/day = ~1 MB/day
- 100 tokens = 100 MB/day = 3 GB/month
- SQLite handles this fine; Postgres for >100 tokens

**User control:**
```yaml
detection:
  retention:
    transactions: 7d
    alerts: 30d
    stats: forever
  storage:
    maxSizeMb: 1000      # Prune oldest when exceeded
```

---

#### Q4: Alert Delivery Mechanisms?

**Decision: Multi-channel with priority routing**

**Channels (in order of urgency):**

| Priority | Channel | Use Case |
|----------|---------|----------|
| Critical | Push notification (if mobile node) | Immediate user attention |
| High | Telegram message | Default for bot users |
| Medium | Webhook POST | Integration with external systems |
| Low | Log file | Audit trail |

**Alert schema:**
```typescript
interface Alert {
  id: string;
  timestamp: number;
  priority: 'critical' | 'high' | 'medium' | 'low';
  
  token: {
    mint: string;
    symbol?: string;
  };
  
  patterns: Pattern[];        // What was detected
  confidence: number;         // Aggregate confidence
  
  recommendation: string;     // Human-readable advice
  rawData?: any;              // For debugging
}
```

**Delivery logic:**
```typescript
async function deliverAlert(alert: Alert) {
  // Always log
  logger.alert(alert);
  
  // Route based on priority and config
  if (alert.priority === 'critical' || alert.priority === 'high') {
    await telegramBot.sendAlert(alert);
  }
  
  if (config.detection.webhookUrl) {
    await fetch(config.detection.webhookUrl, {
      method: 'POST',
      body: JSON.stringify(alert),
    });
  }
}
```

---

### Infrastructure Questions

#### Q1: Single Binary vs Microservices?

**Decision: Single process, multiple modules (modular monolith)**

**Rationale:**
- **Microservices overkill**: This isn't a 10-team enterprise project
- **Latency**: Inter-process communication adds latency for trading
- **Complexity**: Deployment, debugging, and monitoring are simpler with one process
- **Resource efficiency**: No container/VM overhead

**Structure:**
```
Single Process
├── Core Module (in-process)
│   ├── Wallet Engine
│   ├── Trading Engine
│   ├── Orchestrator
│   └── Detection
├── Interface Layer (separate entry points)
│   ├── CLI (one-shot commands)
│   ├── Telegram Bot (long-running)
│   └── Web Server (long-running)
└── Shared State
    ├── SQLite (local)
    └── In-memory caches
```

**Future microservices trigger:**
- If we need horizontal scaling (multiple machines)
- If we need separate deployment cycles for components
- If memory/CPU isolation becomes necessary

---

#### Q2: Database Choice?

**Decision: SQLite default, Postgres for multi-user/cloud deployments**

**SQLite (default for self-hosted):**
```yaml
database:
  type: sqlite
  path: ~/.orbitmm/data.db
```
- Zero configuration
- Single file = easy backup
- Handles 10k+ bots easily
- WAL mode for concurrent reads

**Postgres (for scale):**
```yaml
database:
  type: postgres
  url: postgresql://user:pass@host:5432/orbitmm
```
- Multi-machine deployments
- Cloud hosting (Railway, Render)
- Better observability tools
- Required if >100k transactions/day

**Migration path:**
- Use query builder (Drizzle/Prisma) that abstracts dialect
- Export/import tools for migration

---

#### Q3: Queue System Needed?

**Decision: No queue for MVP. BullMQ when needed.**

**Why no queue initially:**
- Adds Redis dependency
- Adds operational complexity
- In-process async/await is sufficient for 1000 bots
- JavaScript's event loop handles concurrency well

**Queue trigger conditions:**
- If single machine can't handle load
- If we need job persistence across restarts (beyond WAL)
- If we need distributed workers

**If/when adding queue:**
```typescript
// BullMQ setup
import { Queue, Worker } from 'bullmq';

const swapQueue = new Queue('swaps', { connection: redisConnection });

// Producer (orchestrator)
await swapQueue.add('execute-swap', { botId, params });

// Consumer (worker)
const worker = new Worker('swaps', async (job) => {
  await tradingEngine.swap(job.data.params);
});
```

---

#### Q4: Monitoring/Observability?

**Decision: Structured logging + Prometheus metrics + optional Grafana**

**Logging:**
```typescript
// Structured JSON logs (pino)
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => ({ level: label }),
  },
});

// Usage
logger.info({ botId, txSignature, amount }, 'Swap executed');
```

**Metrics (Prometheus):**
```typescript
// Key metrics to expose
const metrics = {
  // Counters
  swaps_total: new Counter({ name: 'orbitmm_swaps_total', help: '...', labelNames: ['status'] }),
  wallets_generated: new Counter({ name: 'orbitmm_wallets_generated', help: '...' }),
  
  // Gauges
  active_bots: new Gauge({ name: 'orbitmm_active_bots', help: '...' }),
  wallet_balance_sol: new Gauge({ name: 'orbitmm_wallet_balance_sol', help: '...', labelNames: ['wallet'] }),
  
  // Histograms
  swap_latency_seconds: new Histogram({ name: 'orbitmm_swap_latency_seconds', help: '...' }),
  rpc_request_duration: new Histogram({ name: 'orbitmm_rpc_request_duration', help: '...' }),
};
```

**Dashboard (optional Grafana):**
- Docker compose includes Prometheus + Grafana
- Pre-built dashboard JSON in `monitoring/dashboards/`

---

## Technical Decisions Finalized

| Decision | Final Choice | Rationale |
|----------|--------------|-----------|
| Package manager | **pnpm** | Fast, disk efficient, strict dependency resolution |
| Build tool | **tsup** | Simple config, fast (esbuild), outputs ESM+CJS |
| Testing | **Vitest** | Fast, native ESM, Jest-compatible API |
| Database | **SQLite** (default) | Zero-config, portable, sufficient for 99% of users |
| Queue | **None** (initially) | KISS, add when bottleneck proven |
| Monorepo tool | **Turborepo** | Minimal config, fast caching, good pnpm integration |
| Linting | **ESLint + Prettier** | Industry standard |
| Schema validation | **Zod** | TypeScript-first, great DX, runtime validation |
| HTTP client | **Native fetch** | No dependencies, Node 18+ has it built-in |
| CLI framework | **Commander.js** | Battle-tested, good for complex CLIs |
| Telegram bot | **grammY** | Modern, TypeScript-native, good middleware |
| Encryption | **Node crypto (AES-256-GCM)** | Native, fast, no dependencies |
| Key derivation | **argon2** (npm package) | Best-in-class password hashing |

---

## Module Specifications

### 4.1 Wallet Module Specification

#### File: `packages/core/src/wallet/types.ts`

```typescript
import { Keypair, PublicKey } from '@solana/web3.js';

// ============ Core Types ============

export interface WalletData {
  publicKey: string;
  secretKey: Uint8Array;  // 64 bytes
  createdAt: number;
  derivationPath?: string; // Only for HD wallets
}

export interface WalletExport {
  version: 1;
  created: string;         // ISO 8601
  encrypted: boolean;
  wallets: WalletData[] | string;  // string if encrypted
  
  // Encryption metadata (only if encrypted: true)
  kdf?: 'argon2id';
  kdfParams?: {
    memoryCost: number;
    timeCost: number;
    parallelism: number;
  };
  iv?: string;             // base64
  tag?: string;            // base64
}

export interface GenerateOptions {
  count: number;
  derivation?: 'random' | 'hd';
  hdSeed?: string;         // BIP39 mnemonic
  startIndex?: number;     // For HD, start at this derivation index
}

export interface FundOptions {
  source: Keypair;
  destinations: PublicKey[];
  amountPerWallet: number; // SOL
  priorityFee?: number;    // lamports, or 'auto'
}

export interface FundResult {
  successful: PublicKey[];
  failed: Array<{ wallet: PublicKey; error: string }>;
  signatures: string[];
  totalFunded: number;     // SOL
  feePaid: number;         // SOL
}

export interface ConsolidateOptions {
  wallets: Keypair[];
  destination: PublicKey;
  leaveRentExempt?: boolean; // Keep minimum for rent (default: false)
}

export interface ConsolidateResult {
  totalCollected: number;  // SOL
  signatures: string[];
  walletsProcessed: number;
}
```

#### File: `packages/core/src/wallet/generator.ts`

```typescript
// Function Signatures

/**
 * Generate wallets using random keypairs or HD derivation.
 * 
 * @throws {InvalidMnemonicError} If HD derivation with invalid mnemonic
 * @throws {InvalidCountError} If count <= 0 or count > 10000
 */
export function generate(options: GenerateOptions): Keypair[];

/**
 * Validate a BIP39 mnemonic.
 */
export function validateMnemonic(mnemonic: string): boolean;

/**
 * Generate a new random BIP39 mnemonic.
 * 
 * @param strength - 128 (12 words) or 256 (24 words)
 */
export function generateMnemonic(strength?: 128 | 256): string;
```

**Error Handling:**
| Error | Condition | Recovery |
|-------|-----------|----------|
| `InvalidMnemonicError` | HD mode with bad mnemonic | User provides valid mnemonic |
| `InvalidCountError` | count <= 0 or > 10000 | User provides valid count |
| `DerivationError` | HD path derivation fails | Internal error, log and abort |

**Edge Cases:**
- Zero count: Return empty array (no error)
- HD without seed: Throw `InvalidMnemonicError`
- Very large count (>10000): Throw `InvalidCountError` (prevents accidental resource exhaustion)

**Performance Requirements:**
- Generate 1000 random wallets: <500ms
- Generate 1000 HD wallets: <2000ms (derivation is slower)

**Testing Requirements:**
- Unit test: Random generation produces unique keys
- Unit test: HD generation is deterministic (same seed = same keys)
- Unit test: HD wallets match Phantom derivation paths
- Unit test: Invalid mnemonic throws appropriate error
- Benchmark: 1000 wallet generation time

---

#### File: `packages/core/src/wallet/funder.ts`

```typescript
// Function Signatures

/**
 * Fund multiple wallets in batched transactions.
 * 
 * @throws {InsufficientFundsError} If source doesn't have enough SOL
 * @throws {TransactionError} If any batch fails after retries
 */
export async function fundAll(
  connection: Connection,
  options: FundOptions
): Promise<FundResult>;

/**
 * Calculate total cost to fund wallets (including fees).
 */
export function estimateFundingCost(
  count: number,
  amountPerWallet: number,
  priorityFee?: number
): { total: number; fees: number; principal: number };
```

**Error Handling:**
| Error | Condition | Recovery |
|-------|-----------|----------|
| `InsufficientFundsError` | source balance < total needed | User adds funds to source |
| `TransactionError` | Batch fails after 3 retries | Return partial success, failed wallets in result |
| `RPCError` | RPC unavailable | Retry with backoff, then throw |

**Edge Cases:**
- Source and destination same: Skip that destination silently
- Zero destinations: Return empty success result
- Amount is 0: Throw `InvalidAmountError`
- Some wallets already funded: Still send (idempotent)

**Performance Requirements:**
- Fund 100 wallets: <10 seconds
- Fund 1000 wallets: <100 seconds
- Each batch confirmation: Timeout at 60s

**Testing Requirements:**
- Unit test: Batching logic (20 per batch)
- Integration test: Fund 10 wallets on devnet
- Unit test: Insufficient funds detection
- Unit test: Partial success handling

---

#### File: `packages/core/src/wallet/encryptor.ts`

```typescript
// Function Signatures

/**
 * Encrypt wallet data with password.
 * 
 * @throws {InvalidPasswordError} If password is empty or too weak
 */
export async function encrypt(
  wallets: WalletData[],
  password: string
): Promise<WalletExport>;

/**
 * Decrypt wallet export with password.
 * 
 * @throws {DecryptionError} If password is wrong or data is corrupted
 * @throws {InvalidFormatError} If export format is invalid
 */
export async function decrypt(
  exported: WalletExport,
  password: string
): Promise<WalletData[]>;

/**
 * Verify password without full decryption.
 * Uses first 32 bytes of ciphertext as verification block.
 */
export async function verifyPassword(
  exported: WalletExport,
  password: string
): Promise<boolean>;
```

**Error Handling:**
| Error | Condition | Recovery |
|-------|-----------|----------|
| `InvalidPasswordError` | Empty password or <8 characters | User provides stronger password |
| `DecryptionError` | Wrong password or corrupted data | User retries with correct password |
| `InvalidFormatError` | Malformed export JSON | User provides valid export file |

**Edge Cases:**
- Empty wallet array: Encrypt successfully (empty encrypted data)
- Password with unicode: Hash as UTF-8 bytes
- Very long password (>1000 chars): Truncate to 1000 (prevent DoS)
- Export version mismatch: Throw `InvalidFormatError` with migration hint

**Security Requirements:**
- Key derivation: Argon2id, 64MB memory, 3 iterations
- Encryption: AES-256-GCM
- IV: Random 12 bytes per encryption
- Auth tag: 16 bytes, verified before decryption
- Password in memory: Zero after use (where possible in JS)

**Testing Requirements:**
- Unit test: Encrypt-decrypt roundtrip
- Unit test: Wrong password throws DecryptionError
- Unit test: Tampered ciphertext detected
- Unit test: Different encryptions produce different ciphertext (random IV)

---

#### File: `packages/core/src/wallet/tracker.ts`

```typescript
// Function Signatures

/**
 * Get SOL balances for multiple wallets efficiently.
 * Uses getMultipleAccountsInfo for batching.
 */
export async function getBalances(
  connection: Connection,
  wallets: PublicKey[]
): Promise<Map<string, number>>;  // pubkey string -> SOL balance

/**
 * Get token balance for a specific SPL token.
 */
export async function getTokenBalance(
  connection: Connection,
  wallet: PublicKey,
  tokenMint: PublicKey
): Promise<number>;  // Token amount (UI units, not raw)

/**
 * Watch wallet for balance changes.
 * Returns unsubscribe function.
 */
export function watchBalance(
  connection: Connection,
  wallet: PublicKey,
  callback: (balance: number) => void
): () => void;
```

**Error Handling:**
| Error | Condition | Recovery |
|-------|-----------|----------|
| `RPCError` | RPC unavailable | Retry with backoff |
| `AccountNotFoundError` | Wallet doesn't exist on-chain | Return 0 balance |

**Performance Requirements:**
- Get 1000 balances: <5 seconds (using batched RPC)
- Watch subscription: <100ms latency for updates

---

### 4.2 Trading Module Specification

#### File: `packages/core/src/trading/types.ts`

```typescript
import { Keypair, PublicKey } from '@solana/web3.js';

export type DEX = 'jupiter' | 'raydium' | 'pumpfun' | 'meteora';

export interface QuoteParams {
  inputMint: PublicKey;
  outputMint: PublicKey;
  amount: number;           // In input token's smallest unit
  slippageBps: number;      // Basis points (100 = 1%)
  dex?: DEX;                // Specific DEX, or undefined for aggregator
}

export interface Quote {
  inputMint: string;
  outputMint: string;
  inAmount: string;         // String for precision
  outAmount: string;
  minOutAmount: string;     // After slippage
  priceImpactPct: number;
  route: RouteStep[];
  dex: DEX;
  timestamp: number;
  expiresAt: number;        // Quote validity
}

export interface RouteStep {
  dex: DEX;
  inputMint: string;
  outputMint: string;
  poolId: string;
  percent: number;          // Percentage of total if split route
}

export interface SwapParams {
  wallet: Keypair;
  quote: Quote;             // Pre-fetched quote
  priorityFee?: number | 'auto';
}

export interface SwapResult {
  signature: string;
  inputAmount: number;
  outputAmount: number;
  fee: number;              // SOL paid for transaction
  slot: number;
  timestamp: number;
}

export interface Pool {
  id: string;
  dex: DEX;
  tokenA: { mint: string; symbol?: string };
  tokenB: { mint: string; symbol?: string };
  liquidity: number;        // In USD
  volume24h: number;        // In USD
}
```

#### File: `packages/core/src/trading/jupiter.ts`

```typescript
// Function Signatures

/**
 * Get swap quote from Jupiter aggregator.
 * 
 * @throws {NoRouteError} If no route found
 * @throws {APIError} If Jupiter API fails
 */
export async function getQuote(
  params: QuoteParams,
  options?: { timeout?: number }
): Promise<Quote>;

/**
 * Execute swap from quote.
 * 
 * @throws {QuoteExpiredError} If quote is stale
 * @throws {SlippageExceededError} If price moved too much
 * @throws {TransactionError} If transaction fails
 */
export async function swap(
  connection: Connection,
  params: SwapParams
): Promise<SwapResult>;

/**
 * Get available pools for a token.
 */
export async function getPools(
  tokenMint: PublicKey
): Promise<Pool[]>;
```

**Error Handling:**
| Error | Condition | Recovery |
|-------|-----------|----------|
| `NoRouteError` | Jupiter can't find any route | Try direct DEX or smaller amount |
| `APIError` | Jupiter API down or error | Fallback to direct DEX |
| `QuoteExpiredError` | Quote older than 30s | Re-fetch quote |
| `SlippageExceededError` | Price moved beyond tolerance | Abort or retry with new quote |
| `InsufficientBalanceError` | Wallet lacks input tokens | Abort, user must fund |

**Edge Cases:**
- Token not on Jupiter: Return `NoRouteError`
- Very small amount: May get `NoRouteError` (below DEX minimums)
- Native SOL swap: Handle WSOL wrapping internally
- Quote during high volatility: Short validity window

**Performance Requirements:**
- Quote fetch: <1000ms (timeout at 3000ms)
- Swap execution: <5000ms to confirmation
- Retry on transient failure: Max 3 attempts

---

#### File: `packages/core/src/trading/router.ts`

```typescript
// Function Signatures

/**
 * Get best quote across all available DEXs.
 * Jupiter first, then parallel query to direct DEXs on fallback.
 */
export async function getBestQuote(
  connection: Connection,
  params: QuoteParams
): Promise<Quote>;

/**
 * Execute swap with automatic DEX selection.
 */
export async function executeSwap(
  connection: Connection,
  params: Omit<SwapParams, 'quote'> & { quoteParams: QuoteParams }
): Promise<SwapResult>;

/**
 * Detect if token has migrated pools (PumpFun → Raydium).
 */
export async function detectPoolMigration(
  connection: Connection,
  tokenMint: PublicKey
): Promise<{ migrated: boolean; from?: DEX; to?: DEX }>;
```

**Routing Logic:**
```
1. Try Jupiter (aggregator, best prices)
   ├── Success → Use Jupiter quote
   └── Fail (timeout/error) → 
       2. Parallel query: Raydium, Meteora, PumpFun
          ├── Compare quotes by output amount
          └── Use best available
```

---

### 4.3 Orchestrator Module Specification

#### File: `packages/core/src/orchestrator/types.ts`

```typescript
export type BotState = 'idle' | 'starting' | 'running' | 'paused' | 'stopping' | 'stopped' | 'error';

export interface BotConfig {
  targetToken: string;      // Token mint address
  direction: 'buy' | 'sell' | 'both';
  
  // Swap sizing
  minSwapSol: number;       // Minimum swap in SOL
  maxSwapSol: number;       // Maximum swap in SOL
  
  // Timing
  minIntervalMs: number;    // Minimum delay between swaps
  maxIntervalMs: number;    // Maximum delay between swaps
  
  // Limits (optional)
  maxSwapsPerHour?: number;
  maxTotalVolumeSol?: number;
  stopAfterSwaps?: number;
}

export interface BotStats {
  swapsAttempted: number;
  swapsSuccessful: number;
  swapsFailed: number;
  totalVolumeSol: number;
  totalTokensBought: number;
  totalTokensSold: number;
  errors: string[];         // Last 10 errors
  startedAt: number | null;
  lastSwapAt: number | null;
}

export interface BotSnapshot {
  id: string;
  walletPublicKey: string;
  state: BotState;
  config: BotConfig;
  stats: BotStats;
  createdAt: number;
  updatedAt: number;
}

export interface OrchestratorConfig {
  maxConcurrentSwaps: number;  // Default: 50
  rpcEndpoints: string[];
  defaultBotConfig: Partial<BotConfig>;
  persistence: {
    enabled: boolean;
    walPath: string;
    snapshotIntervalMs: number;
  };
}

export interface OrchestratorStats {
  totalBots: number;
  activeBots: number;
  pausedBots: number;
  stoppedBots: number;
  errorBots: number;
  totalSwapsExecuted: number;
  totalVolumeSol: number;
  uptime: number;           // Seconds
}
```

#### File: `packages/core/src/orchestrator/bot.ts`

```typescript
// Bot class - see ARCHITECTURE.md for full implementation

/**
 * Create a new bot instance.
 * Does NOT start execution - call start() separately.
 */
export function createBot(wallet: Keypair, config: BotConfig): Bot;

// Bot methods:
// - start(): void - Begin swap loop
// - pause(): void - Pause without losing state
// - resume(): void - Resume from pause
// - stop(): void - Stop permanently
// - updateConfig(config: Partial<BotConfig>): void - Hot update config
// - getSnapshot(): BotSnapshot - Current state
```

**State Machine:**
```
         ┌─────────────┐
         │    idle     │ ◄── Initial state
         └──────┬──────┘
                │ start()
                ▼
         ┌─────────────┐
    ┌───►│   running   │◄───┐
    │    └──────┬──────┘    │
    │           │           │
    │   pause() │   │resume()
    │           ▼   │
    │    ┌─────────────┐
    │    │   paused    │
    │    └─────────────┘
    │
    │ error (auto)      stop() (any state)
    ▼                         │
┌─────────────┐              │
│    error    │              │
└─────────────┘              ▼
                      ┌─────────────┐
                      │   stopped   │
                      └─────────────┘
```

**Error Handling:**
| Error | Condition | Recovery |
|-------|-----------|----------|
| `BotAlreadyRunningError` | start() on running bot | Ignore |
| `BotNotRunningError` | pause() on non-running bot | Ignore |
| Swap failure (transient) | RPC error, timeout | Log, continue to next swap |
| Swap failure (permanent) | Insufficient funds | Transition to error state |
| 5 consecutive failures | Possible systematic issue | Transition to error, emit alert |

---

#### File: `packages/core/src/orchestrator/manager.ts`

```typescript
// Function Signatures

/**
 * Create orchestrator instance.
 * Automatically recovers state if persistence enabled.
 */
export async function createOrchestrator(
  config: OrchestratorConfig
): Promise<Orchestrator>;

// Orchestrator methods:

/**
 * Create new bots with given wallets and config.
 */
createBots(wallets: Keypair[], config: BotConfig): Bot[];

/**
 * Start bots by ID.
 * Respects maxConcurrentSwaps limit.
 */
startBots(botIds: string[]): void;

/**
 * Pause bots by ID.
 */
pauseBots(botIds: string[]): void;

/**
 * Stop bots by ID.
 * Stopped bots cannot be restarted.
 */
stopBots(botIds: string[]): void;

/**
 * Merge multiple bots into one.
 * Combines wallets into a single multi-wallet bot.
 */
mergeBots(botIds: string[]): Bot;

/**
 * Split bot into two with equal config.
 */
splitBot(botId: string): [Bot, Bot];

/**
 * Get orchestrator statistics.
 */
getStats(): OrchestratorStats;

/**
 * Get all bot snapshots.
 */
getBots(): BotSnapshot[];

/**
 * Subscribe to events.
 */
on(event: OrchestratorEvent, handler: EventHandler): void;
```

**Events:**
```typescript
type OrchestratorEvent = 
  | 'bot:created'
  | 'bot:started'
  | 'bot:paused'
  | 'bot:stopped'
  | 'bot:error'
  | 'swap:initiated'
  | 'swap:completed'
  | 'swap:failed';
```

**Concurrency Control:**
```typescript
// Semaphore for limiting concurrent swaps
class SwapSemaphore {
  private active = 0;
  private waiting: Array<() => void> = [];
  
  constructor(private max: number) {}
  
  async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    await new Promise<void>(resolve => this.waiting.push(resolve));
    this.active++;
  }
  
  release(): void {
    this.active--;
    const next = this.waiting.shift();
    if (next) next();
  }
}
```

---

### 4.4 Detection Module Specification

#### File: `packages/core/src/detection/types.ts`

```typescript
export type PatternType = 
  | 'wallet_clustering'
  | 'interval_regularity'  
  | 'size_distribution'
  | 'coordinated_timing'
  | 'new_wallet_spam'
  | 'circular_trading'
  | 'wash_trading';

export interface Pattern {
  type: PatternType;
  confidence: number;       // 0.0 - 1.0
  severity: 'low' | 'medium' | 'high';
  evidence: Evidence[];
  detectedAt: number;
}

export interface Evidence {
  type: string;
  description: string;
  data: Record<string, unknown>;
}

export interface AnalysisResult {
  tokenMint: string;
  analyzedAt: number;
  transactionCount: number;
  timeRange: { start: number; end: number };
  patterns: Pattern[];
  overallConfidence: number;
  recommendation: string;
}

export interface MonitorConfig {
  tokenMint: string;
  alertThreshold: number;   // 0.0 - 1.0
  checkIntervalMs: number;
  lookbackMs: number;       // How far back to analyze
}

export interface Alert {
  id: string;
  timestamp: number;
  priority: 'low' | 'medium' | 'high' | 'critical';
  token: { mint: string; symbol?: string };
  patterns: Pattern[];
  confidence: number;
  recommendation: string;
}
```

#### File: `packages/core/src/detection/analyzer.ts`

```typescript
// Function Signatures

/**
 * Analyze transactions for manipulation patterns.
 * Runs all pattern detectors and aggregates results.
 */
export function analyzeTransactions(
  transactions: TransactionData[]
): AnalysisResult;

/**
 * Fetch and analyze recent transactions for a token.
 */
export async function analyzeToken(
  connection: Connection,
  tokenMint: PublicKey,
  options?: { timeRangeMs?: number; limit?: number }
): Promise<AnalysisResult>;

// Individual pattern detectors (internal, but testable):

export function detectIntervalRegularity(txs: TransactionData[]): Pattern | null;
export function detectSizeDistribution(txs: TransactionData[]): Pattern | null;
export function detectCoordinatedTiming(txs: TransactionData[]): Pattern | null;
export function detectNewWalletSpam(txs: TransactionData[]): Pattern | null;
export function detectWalletClustering(txs: TransactionData[], fundingData: Map<string, string>): Pattern | null;
```

**Pattern Detection Thresholds:**

| Pattern | Threshold | Confidence Calculation |
|---------|-----------|------------------------|
| Interval regularity | CV < 0.5 | `(0.5 - cv) * 2` |
| Size distribution | Uniform (non-power-law) | KS test statistic |
| Coordinated timing | 3+ wallets in 5s window | `min(1, windowCount * 0.2)` |
| New wallet spam | >10 unique wallets, <3 tx each | `0.7` fixed |
| Wallet clustering | Common funding source | `min(1, clusterSize * 0.1)` |

**Performance Requirements:**
- Analyze 1000 transactions: <500ms
- Pattern detection (each): <100ms
- Real-time monitoring lag: <5s

---

#### File: `packages/core/src/detection/monitor.ts`

```typescript
// Function Signatures

/**
 * Start monitoring a token for manipulation.
 * Returns handle to stop monitoring.
 */
export async function startMonitor(
  connection: Connection,
  config: MonitorConfig,
  onAlert: (alert: Alert) => void
): Promise<MonitorHandle>;

interface MonitorHandle {
  stop(): void;
  getStats(): MonitorStats;
  updateConfig(config: Partial<MonitorConfig>): void;
}

interface MonitorStats {
  running: boolean;
  startedAt: number;
  transactionsAnalyzed: number;
  alertsGenerated: number;
  lastAnalysis: number;
}
```

**Monitoring Loop:**
```
Every checkIntervalMs:
  1. Fetch new transactions since last check
  2. Add to sliding window buffer
  3. Run pattern detection on buffer
  4. If confidence > alertThreshold, emit alert
  5. Prune old transactions from buffer
```

---

## Gap Analysis

### What's Missing From Current Plan

#### 1. **Transaction Simulation Before Execution**
**Problem:** We're executing swaps without pre-flight simulation.  
**Risk:** Failed transactions still cost fees.  
**Solution:** Add simulation step before sendTransaction.
```typescript
// Add to trading/executor.ts
async function simulateTransaction(tx: Transaction): Promise<SimulationResult> {
  const result = await connection.simulateTransaction(tx);
  if (result.value.err) {
    throw new SimulationError(result.value.err);
  }
  return { success: true, logs: result.value.logs };
}
```

#### 2. **Token Account Management**
**Problem:** Assuming token accounts exist.  
**Risk:** Swaps fail if wallet doesn't have token account.  
**Solution:** Check/create associated token accounts before swap.
```typescript
// Add to trading/accounts.ts
async function ensureTokenAccount(
  connection: Connection,
  wallet: Keypair,
  tokenMint: PublicKey
): Promise<PublicKey>;
```

#### 3. **Rent-Exempt Balance Handling**
**Problem:** Consolidating all SOL can close accounts.  
**Risk:** 0 balance = account deleted, need to recreate.  
**Solution:** Keep minimum rent-exempt balance (0.00203928 SOL).

#### 4. **Versioned Transaction Support**
**Problem:** Current code mixes legacy and versioned transactions.  
**Risk:** Some DEXs return versioned transactions.  
**Solution:** Standardize on versioned transactions throughout.

#### 5. **Lookup Table Support**
**Problem:** Large transactions may need address lookup tables.  
**Risk:** Complex routes from Jupiter may fail.  
**Solution:** Add ALT resolution in transaction building.

#### 6. **Graceful Shutdown**
**Problem:** No SIGTERM/SIGINT handling.  
**Risk:** Abrupt shutdown = inconsistent state.  
**Solution:** Trap signals, stop accepting new swaps, wait for in-flight to complete.

#### 7. **Health Checks**
**Problem:** No liveness/readiness probes.  
**Risk:** Hard to monitor in production.  
**Solution:** `/health` endpoint for web, periodic self-test for bots.

#### 8. **Configuration Validation**
**Problem:** No schema validation on config.  
**Risk:** Runtime errors from bad config.  
**Solution:** Zod schema with strict validation at startup.

#### 9. **Dry Run Mode**
**Problem:** No way to test without real transactions.  
**Risk:** Mistakes cost real money.  
**Solution:** `--dry-run` flag that simulates but doesn't send.

#### 10. **Token Metadata Resolution**
**Problem:** We only have mint addresses, not symbols/names.  
**Risk:** Poor UX in logs and alerts.  
**Solution:** Cache token metadata from Solana token registry.

---

### What Could Go Wrong

#### Operational Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| RPC provider bans IP | High | Total outage | Use multiple providers, rotate |
| Jupiter API changes | Medium | Swap failures | Pin API version, monitor changes |
| Solana congestion | High | High fees, failures | Dynamic priority fees, queue |
| Memory leak from 10k bots | Medium | Process crash | Periodic restart, profiling |
| Database corruption | Low | State loss | WAL + backups |
| Timezone/clock skew | Low | Incorrect intervals | Use monotonic time, NTP |

#### Security Risks
(See full threat model below)

#### Economic Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Slippage during volatility | High | Loss per trade | Tight slippage limits |
| Front-running by MEV | Medium | Worse prices | Use private RPCs, Jito |
| Token rug pull | Medium | Total loss | Limit per-token exposure |
| Exchange rate calculation | Low | Over/under buying | Use quote amounts, not calculations |

---

## Implementation Order

### Dependency Graph

```
                    ┌─────────────────┐
                    │  Project Setup  │
                    │  (pnpm, turbo,  │
                    │   tsconfig)     │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │   Core Types    │
                    │  (errors, util) │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
┌───────▼───────┐   ┌───────▼───────┐   ┌───────▼───────┐
│    Wallet     │   │    Trading    │   │   Detection   │
│   Generator   │   │    Jupiter    │   │   Patterns    │
└───────┬───────┘   └───────┬───────┘   └───────┬───────┘
        │                   │                   │
┌───────▼───────┐   ┌───────▼───────┐   ┌───────▼───────┐
│    Wallet     │   │    Trading    │   │   Detection   │
│    Funder     │   │    Router     │   │   Analyzer    │
└───────┬───────┘   └───────┬───────┘   └───────┬───────┘
        │                   │                   │
┌───────▼───────┐           │           ┌───────▼───────┐
│    Wallet     │           │           │   Detection   │
│   Encryptor   │           │           │   Monitor     │
└───────┬───────┘           │           └───────────────┘
        │                   │
        └─────────┬─────────┘
                  │
         ┌───────▼───────┐
         │  Orchestrator │
         │     Bot       │
         └───────┬───────┘
                 │
         ┌───────▼───────┐
         │  Orchestrator │
         │    Manager    │
         └───────┬───────┘
                 │
         ┌───────▼───────┐
         │      CLI      │
         └───────┬───────┘
                 │
    ┌────────────┼────────────┐
    │            │            │
┌───▼───┐   ┌───▼───┐   ┌───▼───┐
│Telegram│   │  Web  │   │ Tests │
└────────┘   └───────┘   └───────┘
```

### Exact File Order

#### Phase 0: Project Setup (Day 1)
```
01. package.json (root)
02. pnpm-workspace.yaml
03. turbo.json
04. tsconfig.json (root)
05. .eslintrc.js
06. .prettierrc
07. packages/core/package.json
08. packages/core/tsconfig.json
09. packages/core/src/index.ts (barrel export)
```

#### Phase 1: Core Types & Utils (Day 1-2)
```
10. packages/core/src/types/index.ts
11. packages/core/src/types/wallet.ts
12. packages/core/src/types/trading.ts
13. packages/core/src/types/orchestrator.ts
14. packages/core/src/types/detection.ts
15. packages/core/src/errors/index.ts (custom error classes)
16. packages/core/src/utils/index.ts
17. packages/core/src/utils/retry.ts
18. packages/core/src/utils/validation.ts (Zod schemas)
19. packages/core/src/config/schema.ts
20. packages/core/src/config/loader.ts
```

#### Phase 2: Wallet Module (Day 2-3)
```
21. packages/core/src/wallet/index.ts
22. packages/core/src/wallet/generator.ts
23. packages/core/src/wallet/generator.test.ts
24. packages/core/src/wallet/funder.ts
25. packages/core/src/wallet/funder.test.ts
26. packages/core/src/wallet/encryptor.ts
27. packages/core/src/wallet/encryptor.test.ts
28. packages/core/src/wallet/tracker.ts
29. packages/core/src/wallet/exporter.ts
```

#### Phase 3: Trading Module (Day 3-5)
```
30. packages/core/src/trading/index.ts
31. packages/core/src/trading/jupiter.ts
32. packages/core/src/trading/jupiter.test.ts
33. packages/core/src/trading/raydium.ts
34. packages/core/src/trading/pumpfun.ts
35. packages/core/src/trading/meteora.ts
36. packages/core/src/trading/router.ts
37. packages/core/src/trading/router.test.ts
38. packages/core/src/trading/executor.ts
39. packages/core/src/trading/accounts.ts (token account management)
```

#### Phase 4: Orchestrator Module (Day 5-7)
```
40. packages/core/src/orchestrator/index.ts
41. packages/core/src/orchestrator/bot.ts
42. packages/core/src/orchestrator/bot.test.ts
43. packages/core/src/orchestrator/scheduler.ts
44. packages/core/src/orchestrator/pool.ts (execution pool)
45. packages/core/src/orchestrator/manager.ts
46. packages/core/src/orchestrator/manager.test.ts
47. packages/core/src/orchestrator/persistence.ts (WAL)
48. packages/core/src/orchestrator/persistence.test.ts
```

#### Phase 5: Detection Module (Day 7-8)
```
49. packages/core/src/detection/index.ts
50. packages/core/src/detection/patterns/interval.ts
51. packages/core/src/detection/patterns/sizing.ts
52. packages/core/src/detection/patterns/timing.ts
53. packages/core/src/detection/patterns/clustering.ts
54. packages/core/src/detection/analyzer.ts
55. packages/core/src/detection/analyzer.test.ts
56. packages/core/src/detection/monitor.ts
57. packages/core/src/detection/reporter.ts
```

#### Phase 6: CLI (Day 8-9)
```
58. packages/cli/package.json
59. packages/cli/tsconfig.json
60. packages/cli/src/index.ts
61. packages/cli/src/commands/wallet.ts
62. packages/cli/src/commands/bot.ts
63. packages/cli/src/commands/trade.ts
64. packages/cli/src/commands/detect.ts
65. packages/cli/src/commands/config.ts
66. packages/cli/src/utils/display.ts (tables, colors)
67. packages/cli/src/utils/prompts.ts (interactive)
```

#### Phase 7: Integration Tests (Day 9-10)
```
68. tests/integration/wallet.test.ts
69. tests/integration/trading.test.ts
70. tests/integration/orchestrator.test.ts
71. tests/e2e/full-flow.test.ts
```

#### Phase 8: Telegram Bot (Day 10-12)
```
72. packages/bot-telegram/package.json
73. packages/bot-telegram/src/index.ts
74. packages/bot-telegram/src/bot.ts
75. packages/bot-telegram/src/handlers/wallet.ts
76. packages/bot-telegram/src/handlers/bot.ts
77. packages/bot-telegram/src/handlers/trade.ts
78. packages/bot-telegram/src/handlers/stats.ts
79. packages/bot-telegram/src/middleware/auth.ts
80. packages/bot-telegram/src/middleware/rateLimit.ts
```

---

## Security Threat Model

### Threat Categories

#### T1: Key Theft

| Attack Vector | Likelihood | Impact | Mitigation |
|---------------|------------|--------|------------|
| Memory dump attack | Low | Critical | Don't hold keys longer than needed |
| Log exposure | Medium | Critical | Never log secret keys, scrub logs |
| Export file theft | Medium | Critical | AES-256-GCM encryption |
| Weak password | Medium | Critical | Enforce minimum complexity |
| Shoulder surfing | Low | High | Don't display keys in CLI |
| Process injection | Low | Critical | Run as isolated user |
| Supply chain (npm) | Low | Critical | Lock dependencies, audit |

**Mitigations implemented:**
```typescript
// 1. Key scrubbing in logs
const logger = pino({
  redact: ['secretKey', 'privateKey', 'mnemonic', 'password'],
});

// 2. Memory clearing (best effort in JS)
function clearSensitive(buffer: Uint8Array) {
  buffer.fill(0);
}

// 3. Password complexity
function validatePassword(password: string): boolean {
  return password.length >= 12 && 
         /[A-Z]/.test(password) && 
         /[a-z]/.test(password) && 
         /[0-9]/.test(password);
}
```

---

#### T2: RPC Attacks

| Attack Vector | Likelihood | Impact | Mitigation |
|---------------|------------|--------|------------|
| Man-in-the-middle | Low | High | HTTPS only, pin certificates |
| Malicious RPC response | Low | Critical | Validate signatures on-chain |
| RPC DoS | Medium | Medium | Multiple providers, backoff |
| Rate limit bypass detection | Medium | Medium | Stay within limits |

**Mitigations implemented:**
```typescript
// 1. HTTPS validation
const connection = new Connection(rpcUrl, {
  commitment: 'confirmed',
  httpHeaders: { 'User-Agent': 'OrbitMM/1.0' },
});

// 2. Response validation
async function verifyTransaction(sig: string): Promise<boolean> {
  const tx = await connection.getTransaction(sig, { commitment: 'confirmed' });
  return tx !== null && tx.meta?.err === null;
}
```

---

#### T3: Configuration Attacks

| Attack Vector | Likelihood | Impact | Mitigation |
|---------------|------------|--------|------------|
| Config file injection | Low | High | Validate with Zod schema |
| Environment variable leak | Medium | High | Don't log env vars |
| Default credentials | Medium | High | No default passwords |

---

#### T4: Logic Attacks

| Attack Vector | Likelihood | Impact | Mitigation |
|---------------|------------|--------|------------|
| Integer overflow in amounts | Low | High | Use BigInt, validate bounds |
| Race condition in swaps | Medium | Medium | Semaphore, idempotency |
| Replay attack | Low | Medium | Nonce/blockhash validity |

---

#### T5: Denial of Service

| Attack Vector | Likelihood | Impact | Mitigation |
|---------------|------------|--------|------------|
| Resource exhaustion | Medium | Medium | Limit bot count, memory caps |
| Disk fill | Low | Medium | Prune logs, limit DB size |
| Fork bomb via config | Low | High | Validate max concurrency |

---

#### T6: Information Disclosure

| Attack Vector | Likelihood | Impact | Mitigation |
|---------------|------------|--------|------------|
| Error message leakage | Medium | Low | Sanitize error messages |
| Timing attacks | Low | Low | Constant-time password compare |
| Stack trace in production | Medium | Low | Disable in production |

---

### Security Checklist for Implementation

#### Before writing code:
- [ ] Threat model reviewed for the module
- [ ] Input validation defined

#### During implementation:
- [ ] All inputs validated against Zod schema
- [ ] No secrets in logs
- [ ] Error messages don't leak internal details
- [ ] BigInt used for token amounts
- [ ] Retry logic has maximum attempts

#### Before merge:
- [ ] Unit tests for error cases
- [ ] Integration test on devnet
- [ ] No `any` types without justification
- [ ] Dependencies audited (`pnpm audit`)

---

## Appendices

### A. Solana Devnet Configuration

```yaml
# config/devnet.yaml
rpc:
  url: https://api.devnet.solana.com
  commitment: confirmed

wallet:
  encryption: false  # OK for devnet

trading:
  defaultSlippageBps: 100  # 1% for devnet volatility
  priorityFee: 1000

orchestrator:
  maxConcurrent: 10  # Low for testing
```

### B. Error Code Reference

| Code | Name | Description |
|------|------|-------------|
| E001 | InsufficientFunds | Wallet lacks required SOL/tokens |
| E002 | TransactionFailed | Transaction failed after retries |
| E003 | InvalidConfig | Configuration validation failed |
| E004 | RPCError | RPC endpoint unavailable |
| E005 | QuoteExpired | Trading quote is stale |
| E006 | SlippageExceeded | Price moved beyond tolerance |
| E007 | NoRoute | No swap route available |
| E008 | EncryptionError | Encryption/decryption failed |
| E009 | BotStateError | Invalid bot state transition |
| E010 | RateLimited | RPC rate limit hit |

### C. Monitoring Dashboard Metrics

```prometheus
# Bot metrics
orbitmm_bots_total{state="running|paused|stopped|error"}
orbitmm_swaps_total{status="success|failed",direction="buy|sell"}
orbitmm_swap_volume_sol_total{direction="buy|sell"}
orbitmm_swap_latency_seconds{quantile="0.5|0.9|0.99"}

# System metrics
orbitmm_rpc_requests_total{endpoint="...",status="success|error"}
orbitmm_rpc_latency_seconds{endpoint="..."}
orbitmm_memory_bytes
orbitmm_wallets_total
orbitmm_wallet_balance_sol{wallet="..."}

# Detection metrics
orbitmm_detection_alerts_total{severity="low|medium|high|critical"}
orbitmm_detection_patterns_total{type="..."}
orbitmm_monitored_tokens_total
```

### D. CLI Command Reference

```bash
# Wallet commands
orbitmm wallet generate --count 100 --output wallets.enc
orbitmm wallet fund --source funding.key --wallets wallets.enc --amount 0.1
orbitmm wallet balance --wallets wallets.enc
orbitmm wallet export --wallets wallets.enc --format phantom
orbitmm wallet consolidate --wallets wallets.enc --destination DEST_PUBKEY

# Bot commands
orbitmm bot create --wallets wallets.enc --token TOKEN_MINT --config bot.yaml
orbitmm bot start --ids bot1,bot2,bot3
orbitmm bot pause --ids bot1
orbitmm bot resume --ids bot1
orbitmm bot stop --all
orbitmm bot status
orbitmm bot stats --id bot1

# Trading commands
orbitmm trade quote --input SOL --output TOKEN --amount 1
orbitmm trade swap --wallet wallet.key --input SOL --output TOKEN --amount 1
orbitmm trade pools --token TOKEN_MINT

# Detection commands
orbitmm detect analyze --token TOKEN_MINT --timerange 24h
orbitmm detect monitor --token TOKEN_MINT --threshold 0.7
orbitmm detect report --token TOKEN_MINT --output report.json

# Config commands
orbitmm config init
orbitmm config validate
orbitmm config show
```

---

## Sign-Off

This specification has been reviewed for completeness and correctness. All worker agents should follow this document as the authoritative reference.

**Architect Notes:**
- Start with Phase 0-2 (setup + wallet). This unblocks everything.
- Trading and Detection can be parallelized after wallet is done.
- Orchestrator depends on both wallet and trading.
- CLI should be built incrementally as each module completes.
- Test on devnet before any mainnet consideration.

**Open for future phases:**
- Web dashboard (Phase 4)
- Transparency module (after core is stable)
- Advanced detection (ML-based pattern recognition)

---

*"The goal is not to write code. The goal is to write the right code, once."*

---

**Document Status:** APPROVED FOR IMPLEMENTATION  
**Next Step:** Spawn worker agents starting with project setup and wallet module.
