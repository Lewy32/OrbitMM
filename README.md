# OrbitMM

[![Build Status](https://img.shields.io/github/actions/workflow/status/yourusername/orbitmm/ci.yml?branch=main)](https://github.com/yourusername/orbitmm/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![Solana](https://img.shields.io/badge/Solana-Mainnet-purple.svg)](https://solana.com/)

**Solana Market Making Bot Platform**

A professional-grade TypeScript monorepo for automated market making on Solana DEXes. Supports wallet generation, multi-DEX trading (Jupiter, Raydium), bot orchestration with 1000+ concurrent bots, and on-chain manipulation detection powered by Allium.

---

## 📚 Table of Contents

- [Features](#-features)
- [Quick Start](#-quick-start)
- [Installation](#installation)
- [Documentation](#-documentation)
- [Examples](#-examples)
- [Package Structure](#-package-structure)
- [Configuration](#-configuration)
- [API Usage](#-api-usage)
- [Development](#-development)
- [Security](#-security)
- [License](#-license)

---

## ✨ Features

- 🔑 **Wallet Management**: HD wallet generation, AES-256-GCM encryption, batch funding
- 💱 **Multi-DEX Trading**: Jupiter, Raydium integration with smart routing
- 🤖 **Bot Orchestration**: Pause/resume, crash recovery, WAL persistence
- 🔍 **Manipulation Detection**: Pattern analysis powered by Allium
- 📊 **Real-time Monitoring**: Live detection alerts with webhook support
- 🛡️ **Enterprise Security**: Encrypted storage, secure key management

---

## 🚀 Quick Start

```bash
# Clone and install
git clone https://github.com/yourusername/orbitmm
cd orbitmm
pnpm install && pnpm approve-builds && pnpm build

# Generate wallets
orbitmm wallet generate 5

# Get a quote
orbitmm trade quote <TOKEN_MINT> 0.1

# Create and start bots
orbitmm bot create 5 --token <TOKEN_MINT> --direction both
orbitmm bot start --all
```

📖 **[Full Quick Start Guide →](./docs/QUICKSTART.md)**

---

## Installation

### Prerequisites

- Node.js 18+
- pnpm (recommended) or npm

### Steps

```bash
# Clone repository
git clone https://github.com/yourusername/orbitmm
cd orbitmm

# Install dependencies
pnpm install

# Build native modules (argon2, etc.)
pnpm approve-builds

# Build all packages
pnpm build

# (Optional) Link CLI globally
pnpm link --global
```

### Verify Installation

```bash
orbitmm --version
# OrbitMM v0.1.0

orbitmm status
```

---

## 📖 Documentation

| Document | Description |
|----------|-------------|
| [**Quick Start**](./docs/QUICKSTART.md) | 5-minute setup guide |
| [**CLI Reference**](./docs/CLI_REFERENCE.md) | Complete command documentation |
| [**Troubleshooting**](./docs/TROUBLESHOOTING.md) | Common issues and solutions |
| [**Architecture**](./docs/ARCHITECTURE.md) | System design overview |
| [**Detection**](./docs/DETECTION.md) | Manipulation detection details |
| [**Ethics**](./docs/ETHICS.md) | Responsible use guidelines |

---

## 💡 Examples

Ready-to-run examples in the [`examples/`](./examples/) directory:

| Example | Description |
|---------|-------------|
| [`basic-volume-boost.ts`](./examples/basic-volume-boost.ts) | Simple volume boosting setup |
| [`detection-monitor.ts`](./examples/detection-monitor.ts) | Monitor a token for manipulation |
| [`multi-wallet-trade.ts`](./examples/multi-wallet-trade.ts) | Coordinated trading across wallets |

### Configuration Templates

Pre-configured YAML templates in [`examples/config-templates/`](./examples/config-templates/):

| Template | Use Case |
|----------|----------|
| [`aggressive.yaml`](./examples/config-templates/aggressive.yaml) | High frequency, max volume |
| [`conservative.yaml`](./examples/config-templates/conservative.yaml) | Low frequency, safer |
| [`detection-only.yaml`](./examples/config-templates/detection-only.yaml) | Monitoring, no trading |

### Run Examples

```bash
# Set required environment variables
export TARGET_TOKEN=YourTokenMintAddress
export SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# Run with ts-node
npx ts-node examples/basic-volume-boost.ts
npx ts-node examples/detection-monitor.ts
npx ts-node examples/multi-wallet-trade.ts
```

---

## 📦 Package Structure

```
packages/
├── core/           # Core library (@orbitmm/core)
│   ├── wallet/     # Wallet generation, encryption, tracking
│   ├── trading/    # Jupiter, Raydium, smart routing
│   ├── orchestrator/ # Bot state machine, scheduling
│   └── detection/  # Manipulation detection
├── cli/            # CLI application (@orbitmm/cli)
└── bot-telegram/   # Telegram bot interface
```

---

## ⚙️ Configuration

### Environment Variables

Create a `.env` file from the example:

```bash
cp .env.example .env
```

Key variables:

```bash
# RPC Endpoints
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# Allium API (for detection features)
ALLIUM_API_KEY=your-api-key

# Optional: Custom DEX APIs
JUPITER_API_URL=https://quote-api.jup.ag/v6
RAYDIUM_API_URL=https://api.raydium.io/v2
```

📖 **[See .env.example for all options](./.env.example)**

### Bot Configuration

```typescript
const config: BotConfig = {
  // Target token to trade
  targetToken: 'TokenMintAddress',
  
  // Trading direction
  direction: 'both', // 'buy' | 'sell' | 'both'
  
  // Trade size range (in SOL)
  minSwapSol: 0.01,
  maxSwapSol: 0.1,
  
  // Time between trades (milliseconds)
  minIntervalMs: 30_000,
  maxIntervalMs: 120_000,
  
  // Priority fee strategy
  priorityFee: 'auto', // 'auto' | number (microlamports)
  
  // Slippage tolerance
  slippageBps: 50, // 0.5%
  
  // Optional limits
  stopAfterSwaps: 100,
  stopAfterSol: 10,
  stopAfterDurationMs: 3600_000,
};
```

---

## 🔧 API Usage

### Wallet Module

```typescript
import { generate, encrypt, decrypt, getBalances } from '@orbitmm/core';

// Generate wallets
const wallets = await generate(10, { type: 'random' });

// Encrypt for storage
const encrypted = await encrypt(wallets, 'password');

// Check balances
const balances = await getBalances(connection, wallets.map(w => w.publicKey));
```

### Trading Module

```typescript
import { TradingRouter, JupiterClient } from '@orbitmm/core';

// Create router
const router = new TradingRouter(connection);

// Get best quote across DEXes
const quote = await router.getBestQuote({
  inputMint: SOL_MINT,
  outputMint: USDC_MINT,
  amount: 1_000_000_000n,
  slippageBps: 50,
});

// Execute swap
const result = await router.executeSwap(wallet, quote);
```

### Orchestrator

```typescript
import { Orchestrator } from '@orbitmm/core';

// Create orchestrator
const orchestrator = await Orchestrator.create({
  maxConcurrentSwaps: 50,
  rpcEndpoints: ['https://api.mainnet-beta.solana.com'],
});

// Create bots
const bots = orchestrator.createBots(wallets, config);

// Start all
orchestrator.startAll();

// Monitor events
orchestrator.on('swap:completed', console.log);
orchestrator.on('bot:error', console.error);

// Graceful shutdown
await orchestrator.shutdown();
```

### Detection Engine

```typescript
import { DetectionEngine } from '@orbitmm/core';

const engine = new DetectionEngine({
  allium: { apiKey: process.env.ALLIUM_API_KEY },
});

// Analyze token
const report = await engine.analyzeToken('TokenMint', 'solana');
console.log(`Manipulation score: ${report.manipulationScore}`);

// Start monitoring
const handle = engine.monitor({
  tokenMint: 'TokenMint',
  alertThreshold: 0.7,
  checkIntervalMs: 30_000,
}, (alert) => {
  console.log('Alert:', alert);
});

// Stop monitoring
handle.stop();
```

---

## 🛠️ Development

```bash
# Build all packages
pnpm build

# Run tests
pnpm test

# Type check
pnpm typecheck

# Lint
pnpm lint

# Development mode (watch)
pnpm dev

# Run specific example
npx ts-node examples/basic-volume-boost.ts
```

---

## 🔒 Security

- **Wallet Encryption**: AES-256-GCM with Argon2id key derivation
- **Private Keys**: Never logged or transmitted
- **RPC Security**: Support for authenticated endpoints
- **Rate Limiting**: Built-in circuit breakers and backoff

### Security Best Practices

1. **Never commit** `.env` or wallet files
2. **Use encrypted wallets** (`--no-encrypt` only for testing)
3. **Use private RPCs** in production
4. **Set reasonable limits** on bots to prevent runaway spending
5. **Monitor bot activity** regularly

---

## 📄 License

MIT

---

## 🙏 Credits

- Detection features powered by [Allium](https://allium.so)
- DEX integrations: [Jupiter](https://jup.ag), [Raydium](https://raydium.io)
- Built with [TypeScript](https://www.typescriptlang.org/), [Solana Web3.js](https://solana-labs.github.io/solana-web3.js/)

---

## 📞 Support

- 📖 [Documentation](./docs/)
- 🐛 [Issue Tracker](https://github.com/yourusername/orbitmm/issues)
- 💬 [Discussions](https://github.com/yourusername/orbitmm/discussions)
