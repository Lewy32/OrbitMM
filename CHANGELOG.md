# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-02-07

### 🎉 Initial MVP Release

First public release of OrbitMM - Solana Market Making Bot Platform.

### Added

#### Wallet Module (`@orbitmm/core/wallet`)
- **Generator**: Random and HD wallet generation
  - BIP39 mnemonic support
  - Phantom-compatible derivation paths (`m/44'/501'/{i}'/0'`)
  - Batch generation up to 1000 wallets
- **Encryptor**: Secure wallet encryption
  - AES-256-GCM encryption
  - Argon2id key derivation (memory-hard, time-hard)
  - Password verification without decryption
- **Funder**: Batch wallet funding
  - Transaction batching (up to 22 transfers per tx)
  - Automatic fee estimation
  - Retry logic with exponential backoff
- **Tracker**: Balance monitoring
  - Token and SOL balance queries
  - LRU caching with configurable TTL
  - Batch balance fetching

#### Trading Module (`@orbitmm/core/trading`)
- **Jupiter Integration**: Full Jupiter v6 API support
  - Quote fetching with route optimization
  - Swap execution with versioned transactions
  - Pool discovery and monitoring
- **Raydium Integration**: Raydium AMM support
  - Constant product swap calculations
  - Pool caching with auto-refresh
  - Legacy and versioned transaction support
- **Smart Router**: Multi-DEX routing
  - Best quote selection across DEXes
  - Pool migration detection (Raydium → Jupiter)
  - Parallel quote fetching
- **Transaction Executor**: Robust transaction handling
  - Priority fee estimation
  - Transaction simulation
  - Retry with stuck transaction replacement
  - Confirmation with timeout

#### Orchestrator Module (`@orbitmm/core/orchestrator`)
- **Bot State Machine**: Full lifecycle management
  - States: idle → running ↔ paused → stopped / error
  - Event-driven architecture
  - Configurable trading parameters
- **Manager**: Multi-bot orchestration
  - Support for 1000+ concurrent bots
  - Batch start/stop/pause/resume
  - Bot merging and splitting
- **Scheduler**: Rate limiting and concurrency
  - Semaphore for concurrent swap limits
  - Token bucket rate limiting
  - Circuit breaker pattern
  - RPC pool with health checks
- **Persistence**: Crash recovery
  - Write-ahead logging (WAL)
  - Periodic snapshots
  - Automatic state recovery on restart

#### Detection Module (`@orbitmm/core/detection`)
- **Allium Client**: Blockchain data queries
  - Token prices and history
  - Wallet transaction analysis
  - Balance history tracking
- **Pattern Detectors**:
  - Wallet clustering (shared funding sources)
  - Interval regularity (bot-like timing)
  - Size distribution (suspicious patterns)
  - Coordinated timing (pump/dump detection)
- **Analyzer**: Comprehensive analysis
  - Multi-pattern detection
  - Manipulation score calculation
  - Confidence levels and severity ratings
- **Monitor**: Real-time monitoring
  - Configurable alert thresholds
  - Polling-based with backoff
  - Dynamic configuration updates

#### CLI (`@orbitmm/cli`)
- **Wallet Commands**: generate, encrypt, decrypt, balance
- **Bot Commands**: create, start, stop, pause, resume, status
- **Trade Commands**: quote, swap, pools
- **Detect Commands**: analyze, monitor, stop

### Technical Details

- **Language**: TypeScript 5.x with strict mode
- **Build System**: Turborepo + tsup
- **Testing**: Vitest
- **Package Manager**: pnpm workspaces
- **Node.js**: 18+ (ESM)

### Known Issues

- Argon2 native module requires `pnpm approve-builds` after install
- HD derivation uses ed25519-hd-key (may differ from some wallet implementations)
- Bot tests have timer mocking issues with vitest fake timers

### Security Notes

- Private keys are encrypted at rest with AES-256-GCM
- Argon2id parameters: 64MB memory, 3 iterations, parallelism 4
- Never log or transmit unencrypted private keys
- RPC endpoints should use authenticated access in production

---

## Future Roadmap

### [0.2.0] - Planned
- PumpFun integration
- Meteora DLMM support
- Telegram bot interface
- WebSocket-based RPC subscriptions

### [0.3.0] - Planned
- Dashboard web UI
- Advanced analytics
- Multi-chain support
- Profit tracking and reporting
