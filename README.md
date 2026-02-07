# OrbitMM

**Solana Market Making Bot Platform**

A professional-grade TypeScript monorepo for automated market making on Solana DEXes. Supports wallet generation, multi-DEX trading (Jupiter, Raydium), bot orchestration with 1000+ concurrent bots, and on-chain manipulation detection powered by Allium.

## Features

- 🔑 **Wallet Management**: HD wallet generation, AES-256-GCM encryption, batch funding
- 💱 **Multi-DEX Trading**: Jupiter, Raydium integration with smart routing
- 🤖 **Bot Orchestration**: Pause/resume, crash recovery, WAL persistence
- 🔍 **Manipulation Detection**: Pattern analysis powered by Allium

## Quick Start

### Installation

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
```

### Generate Wallets

```bash
# Generate 10 random wallets
orbitmm wallet generate 10

# Generate HD wallets from mnemonic
orbitmm wallet generate 10 --hd --mnemonic "your mnemonic phrase"

# Encrypt wallet file
orbitmm wallet encrypt wallets.json --password "your-secure-password"

# Decrypt wallet file
orbitmm wallet decrypt wallets.enc.json --password "your-secure-password"

# Check balances
orbitmm wallet balance wallets.json
```

### Create and Run Bots

```bash
# Create bot configuration
orbitmm bot create \
  --wallets wallets.json \
  --token TokenMintAddress \
  --direction both \
  --min-swap 0.01 \
  --max-swap 0.1 \
  --min-interval 30000 \
  --max-interval 120000

# Start bots
orbitmm bot start

# Check status
orbitmm bot status

# Pause all bots
orbitmm bot pause

# Resume bots
orbitmm bot resume

# Stop bots
orbitmm bot stop
```

### Trade Commands

```bash
# Get quote
orbitmm trade quote \
  --input So11111111111111111111111111111111111111112 \
  --output EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v \
  --amount 1

# Execute swap
orbitmm trade swap \
  --input So11111111111111111111111111111111111111112 \
  --output EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v \
  --amount 1 \
  --wallet wallet.json

# Check pools
orbitmm trade pools --token TokenMintAddress
```

### Detection Commands

```bash
# Analyze token for manipulation
orbitmm detect analyze TokenMintAddress

# Start monitoring
orbitmm detect monitor TokenMintAddress --threshold 0.7

# Stop monitoring
orbitmm detect stop TokenMintAddress
```

## Package Structure

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

## Configuration

### Environment Variables

```bash
# RPC Endpoints (comma-separated)
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# Allium API (for detection features)
ALLIUM_API_KEY=your-api-key

# Optional: Custom Jupiter API
JUPITER_API_URL=https://quote-api.jup.ag/v6

# Optional: Custom Raydium API
RAYDIUM_API_URL=https://api.raydium.io/v2
```

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

## Development

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
```

## API Usage

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

## Security

- **Wallet Encryption**: AES-256-GCM with Argon2id key derivation
- **Private Keys**: Never logged or transmitted
- **RPC Security**: Support for authenticated endpoints
- **Rate Limiting**: Built-in circuit breakers and backoff

## License

MIT

## Credits

- Detection features powered by [Allium](https://allium.com)
- DEX integrations: Jupiter, Raydium
