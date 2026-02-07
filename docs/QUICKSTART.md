# OrbitMM Quick Start Guide

Get up and running with OrbitMM in 5 minutes.

## Prerequisites

- Node.js 18+ 
- pnpm (or npm/yarn)
- Solana CLI (optional, for wallet management)

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/orbitmm
cd orbitmm

# Install dependencies
pnpm install

# Approve native module builds (argon2, etc.)
pnpm approve-builds

# Build all packages
pnpm build

# Link CLI globally (optional)
pnpm link --global
```

Verify installation:

```bash
orbitmm --version
# OrbitMM v0.1.0
```

## Step 1: Configure Environment

Create a `.env` file in the project root:

```bash
# Copy example configuration
cp .env.example .env
```

Edit `.env` with your settings:

```env
# Required: Solana RPC endpoint
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com

# Optional: Use a private RPC for better performance
# SOLANA_RPC_URL=https://your-private-rpc.com

# Optional: Allium API for enhanced detection
# ALLIUM_API_KEY=your-api-key
```

## Step 2: Generate Wallets

Generate trading wallets:

```bash
# Generate 5 encrypted wallets
orbitmm wallet generate 5
```

**Output:**
```
╔══════════════════════════════════════════════════════════════╗
║  🔑 Generating 5 Wallets                                     ║
╚══════════════════════════════════════════════════════════════╝

  #   Public Key
  1   7xKXt...Q3Yp
  2   9nMdR...K8Wr
  3   4pTxV...J2Nm
  4   2qRsN...L5Hp
  5   8mWkT...P9Xq

Enter encryption password: ********
Confirm password: ********

✓ Encrypted and saved to ~/.orbitmm/wallets.json

✅ Successfully generated 5 wallets
```

### View your wallets

```bash
orbitmm wallet balance --all
```

**Output:**
```
╔══════════════════════════════════════════════════════════════╗
║  💰 Wallet Balances                                          ║
╚══════════════════════════════════════════════════════════════╝

  Wallet                  Balance
  7xKXt...Q3Yp            0.000000 SOL
  9nMdR...K8Wr            0.000000 SOL
  4pTxV...J2Nm            0.000000 SOL
  2qRsN...L5Hp            0.000000 SOL
  8mWkT...P9Xq            0.000000 SOL

  Total wallets:    5
  Total balance:    0.000000 SOL
  Average balance:  0.000000 SOL
```

## Step 3: Fund Your Wallets

Fund from a source wallet:

```bash
# Fund each wallet with 0.1 SOL
orbitmm wallet fund source-wallet.json 0.1 --from-file ~/.orbitmm/wallets.json
```

Or fund manually using Solana CLI:

```bash
# Get wallet addresses
orbitmm wallet balance --all --json | jq -r 'keys[]'

# Send SOL to each wallet
solana transfer <wallet-address> 0.1 --fee-payer <your-keypair>
```

## Step 4: Your First Trade

Get a swap quote:

```bash
# Quote: Buy token with 0.1 SOL
orbitmm trade quote <TOKEN_MINT> 0.1 --direction buy
```

**Output:**
```
╔══════════════════════════════════════════════════════════════╗
║  🔄 Get Quote                                                ║
╚══════════════════════════════════════════════════════════════╝

  Direction: BUY
  Input:     So111...1112 (SOL)
  Output:    TokenMint...
  Amount:    0.100000 SOL
  Slippage:  0.5%

⏳ Fetching quote...
✓ Quote received

────────────────────────────────────────────────────────────────
  Quote Details
────────────────────────────────────────────────────────────────

  Input amount:  0.1
  Output amount: 1,234.56
  Min output:    1,228.38
  Price impact:  -0.15%
  Route:         jupiter (100%)
  Valid for:     30s
```

Execute the swap:

```bash
# Execute with a specific wallet
orbitmm trade buy <TOKEN_MINT> 0.1 --wallet wallet.json
```

## Step 5: Create and Run Bots

Create trading bots:

```bash
orbitmm bot create 5 \
  --token <TOKEN_MINT> \
  --direction both \
  --min-swap 0.01 \
  --max-swap 0.05 \
  --min-interval 30000 \
  --max-interval 90000
```

**Output:**
```
╔══════════════════════════════════════════════════════════════╗
║  🤖 Create 5 Bots                                            ║
╚══════════════════════════════════════════════════════════════╝

  Target token:    TokenM...
  Direction:       both
  Swap range:      0.01 - 0.05 SOL
  Interval range:  30s - 1m 30s

⏳ Creating 5 bots...
✓ Created 5 bots

  Bot ID                        Status    Created
  bot-m8kq2-x3np                idle      just now
  bot-m8kq3-y4mq                idle      just now
  bot-m8kq4-z5lr                idle      just now
  bot-m8kq5-a6ks                idle      just now
  bot-m8kq6-b7jt                idle      just now

✅ Created 5 bots. Use "bot start" to begin trading.
```

Start the bots:

```bash
# Start all idle bots
orbitmm bot start --all
```

Check status:

```bash
orbitmm bot status
```

**Output:**
```
╔══════════════════════════════════════════════════════════════╗
║  📊 Bot Status                                               ║
╚══════════════════════════════════════════════════════════════╝

  Total bots:  5
  Running:     5
  Paused:      0
  Idle:        0
  Stopped:     0
  Error:       0

  Bot ID              Status     Swaps     Volume        Last Swap
  bot-m8kq2-x3np      running    12/12     0.42 SOL      2m ago
  bot-m8kq3-y4mq      running    10/11     0.35 SOL      1m ago
  bot-m8kq4-z5lr      running    11/11     0.38 SOL      30s ago
  bot-m8kq5-a6ks      running    9/10      0.31 SOL      3m ago
  bot-m8kq6-b7jt      running    8/8       0.28 SOL      1m ago
```

## Step 6: Monitor for Manipulation

Analyze a token:

```bash
orbitmm detect analyze <TOKEN_MINT> --hours 24
```

**Output:**
```
╔══════════════════════════════════════════════════════════════╗
║  📊 Analyze Token                                            ║
╚══════════════════════════════════════════════════════════════╝

  Token:            TokenMint...
  Time range:       Last 24 hours
  Max transactions: 10,000

⏳ Fetching and analyzing transactions...
✓ Analyzed 1,247 transactions

────────────────────────────────────────────────────────────────
  Analysis Results
────────────────────────────────────────────────────────────────

  Transactions analyzed: 1,247
  Time range:            Feb 6, 10:00 — Feb 7, 10:00
  Patterns detected:     3
  Overall confidence:    72%

────────────────────────────────────────────────────────────────
  Detected Patterns
────────────────────────────────────────────────────────────────

  Pattern                 Confidence    Severity
  Interval Regularity     72%           HIGH
  Coordinated Timing      58%           MEDIUM
  Wallet Clustering       45%           LOW

⚠️ High likelihood of market manipulation. Exercise extreme caution.
```

Start real-time monitoring:

```bash
orbitmm detect monitor <TOKEN_MINT> --alert 0.7 --interval 60
```

## Common Workflows

### Daily Trading Setup

```bash
# 1. Check wallet balances
orbitmm wallet balance --all

# 2. Create bots for a token
orbitmm bot create 10 --token <MINT> --direction both

# 3. Start trading
orbitmm bot start --all

# 4. Monitor throughout the day
orbitmm bot status
```

### Due Diligence on a Token

```bash
# 1. Analyze historical patterns
orbitmm detect analyze <MINT> --hours 72 --verbose

# 2. Start monitoring
orbitmm detect monitor <MINT> --alert 0.6
```

### End of Day

```bash
# 1. Pause all bots
orbitmm bot pause --all

# 2. Check final status
orbitmm bot status --all

# 3. Check balances
orbitmm wallet balance --all
```

## Next Steps

- 📖 Read the [CLI Reference](./CLI_REFERENCE.md) for all commands
- 🔧 Check [Troubleshooting](./TROUBLESHOOTING.md) if you hit issues
- ⚙️ Explore [config templates](../examples/config-templates/) for different strategies
- 🏗️ Read [ARCHITECTURE.md](./ARCHITECTURE.md) to understand the system

## Getting Help

```bash
# General help
orbitmm --help

# Command-specific help
orbitmm wallet --help
orbitmm bot --help
orbitmm trade --help
orbitmm detect --help
```
