# OrbitMM CLI Reference

Complete reference for all OrbitMM CLI commands.

## Global Options

These options can be used with any command:

| Option | Description |
|--------|-------------|
| `--rpc <url>` | Solana RPC endpoint URL |
| `--config <path>` | Path to config file |
| `--quiet` | Suppress non-essential output |
| `--json` | Output in JSON format (where applicable) |
| `-v, --version` | Display version |
| `-h, --help` | Display help |

## Wallet Commands

Manage trading wallets.

### `wallet generate [count]`

Generate new wallets.

```bash
orbitmm wallet generate [count]
```

**Arguments:**
- `count` - Number of wallets to generate (default: 1)

**Options:**
| Option | Description |
|--------|-------------|
| `--hd` | Use HD derivation from seed phrase |
| `--seed <mnemonic>` | BIP39 seed phrase for HD derivation |
| `--new-seed` | Generate a new seed phrase |
| `-o, --output <file>` | Output file path |
| `-p, --password <password>` | Encryption password |
| `--no-encrypt` | Skip encryption (not recommended) |

**Examples:**

```bash
# Generate 10 random wallets with encryption
orbitmm wallet generate 10

# Generate HD wallets with new seed
orbitmm wallet generate 10 --hd --new-seed

# Generate from existing mnemonic
orbitmm wallet generate 10 --hd --seed "word1 word2 ... word24"

# Generate without encryption (not recommended)
orbitmm wallet generate 5 --no-encrypt --output wallets.json
```

---

### `wallet fund <source> <amount>`

Fund wallets from a source wallet.

```bash
orbitmm wallet fund <source> <amount>
```

**Arguments:**
- `source` - Path to source wallet keypair JSON
- `amount` - Amount of SOL to send to each wallet

**Options:**
| Option | Description |
|--------|-------------|
| `-w, --wallets <addresses...>` | Specific wallet addresses to fund |
| `-f, --from-file <file>` | Load destinations from wallet file |
| `--priority-fee <lamports>` | Priority fee (default: 1000) |
| `--dry-run` | Show what would be funded without executing |

**Examples:**

```bash
# Fund all stored wallets with 0.1 SOL each
orbitmm wallet fund source.json 0.1

# Fund specific wallets
orbitmm wallet fund source.json 0.1 --wallets addr1 addr2 addr3

# Fund from wallet file
orbitmm wallet fund source.json 0.1 --from-file wallets.json

# Dry run to check costs
orbitmm wallet fund source.json 0.1 --dry-run
```

---

### `wallet export <file>`

Export wallets to a file.

```bash
orbitmm wallet export <file>
```

**Arguments:**
- `file` - Output file path

**Options:**
| Option | Description |
|--------|-------------|
| `-p, --password <password>` | Encryption password |
| `--no-encrypt` | Export without encryption (not recommended) |

**Examples:**

```bash
# Export with encryption
orbitmm wallet export backup.json

# Export without encryption
orbitmm wallet export backup.json --no-encrypt
```

---

### `wallet import <file>`

Import wallets from a file.

```bash
orbitmm wallet import <file>
```

**Arguments:**
- `file` - Input file path

**Options:**
| Option | Description |
|--------|-------------|
| `-p, --password <password>` | Decryption password |
| `--merge` | Merge with existing wallets |

**Examples:**

```bash
# Import and replace existing
orbitmm wallet import backup.json

# Import and merge
orbitmm wallet import backup.json --merge
```

---

### `wallet balance [wallets...]`

Check wallet balances.

```bash
orbitmm wallet balance [wallets...]
```

**Arguments:**
- `wallets...` - Wallet addresses to check (optional)

**Options:**
| Option | Description |
|--------|-------------|
| `-a, --all` | Show all stored wallets |
| `--json` | Output as JSON |

**Examples:**

```bash
# Check all stored wallets
orbitmm wallet balance --all

# Check specific wallets
orbitmm wallet balance addr1 addr2

# JSON output
orbitmm wallet balance --all --json
```

---

## Bot Commands

Manage trading bots.

### `bot create [count]`

Create new trading bots.

```bash
orbitmm bot create [count]
```

**Arguments:**
- `count` - Number of bots to create (default: 1)

**Options:**
| Option | Description |
|--------|-------------|
| `-t, --token <mint>` | Target token mint address (required) |
| `-c, --config <json>` | Bot configuration as JSON |
| `--min-swap <sol>` | Minimum swap size in SOL (default: 0.01) |
| `--max-swap <sol>` | Maximum swap size in SOL (default: 0.1) |
| `--min-interval <ms>` | Minimum interval in ms (default: 30000) |
| `--max-interval <ms>` | Maximum interval in ms (default: 120000) |
| `-d, --direction <dir>` | Direction: buy, sell, both (default: both) |
| `--max-swaps-per-hour <n>` | Maximum swaps per hour |
| `--max-volume <sol>` | Maximum total volume in SOL |
| `--stop-after <n>` | Stop after N swaps |

**Examples:**

```bash
# Create 5 bots with default settings
orbitmm bot create 5 --token <TOKEN_MINT>

# Create aggressive bots
orbitmm bot create 10 \
  --token <TOKEN_MINT> \
  --min-swap 0.02 \
  --max-swap 0.15 \
  --min-interval 15000 \
  --max-interval 45000

# Create buy-only bots with limits
orbitmm bot create 3 \
  --token <TOKEN_MINT> \
  --direction buy \
  --max-swaps-per-hour 20 \
  --stop-after 100

# Create from JSON config
orbitmm bot create 5 --config '{"targetToken":"...","direction":"both"}'
```

---

### `bot start [ids...]`

Start trading bots.

```bash
orbitmm bot start [ids...]
```

**Arguments:**
- `ids...` - Bot IDs to start (optional)

**Options:**
| Option | Description |
|--------|-------------|
| `-a, --all` | Start all idle/paused bots |

**Examples:**

```bash
# Start all bots
orbitmm bot start --all

# Start specific bots
orbitmm bot start bot-abc123 bot-def456
```

---

### `bot pause [ids...]`

Pause running bots.

```bash
orbitmm bot pause [ids...]
```

**Arguments:**
- `ids...` - Bot IDs to pause

**Options:**
| Option | Description |
|--------|-------------|
| `-a, --all` | Pause all running bots |

**Examples:**

```bash
# Pause all running bots
orbitmm bot pause --all

# Pause specific bots
orbitmm bot pause bot-abc123
```

---

### `bot stop [ids...]`

Stop bots permanently.

```bash
orbitmm bot stop [ids...]
```

**Arguments:**
- `ids...` - Bot IDs to stop

**Options:**
| Option | Description |
|--------|-------------|
| `-a, --all` | Stop all bots |
| `-f, --force` | Skip confirmation |

**Examples:**

```bash
# Stop all bots
orbitmm bot stop --all --force

# Stop specific bots
orbitmm bot stop bot-abc123
```

---

### `bot status [ids...]`

Show bot status.

```bash
orbitmm bot status [ids...]
```

**Arguments:**
- `ids...` - Bot IDs to show (optional)

**Options:**
| Option | Description |
|--------|-------------|
| `-a, --all` | Show all bots |
| `--json` | Output as JSON |
| `-v, --verbose` | Show detailed stats |

**Examples:**

```bash
# Show running/paused bots
orbitmm bot status

# Show all bots
orbitmm bot status --all

# Detailed view of one bot
orbitmm bot status bot-abc123 --verbose

# JSON output
orbitmm bot status --all --json
```

---

### `bot merge <ids...>`

Merge multiple bots into one.

```bash
orbitmm bot merge <ids...>
```

**Arguments:**
- `ids...` - Bot IDs to merge (minimum 2)

**Examples:**

```bash
orbitmm bot merge bot-abc123 bot-def456 bot-ghi789
```

---

### `bot split <id>`

Split a bot into two.

```bash
orbitmm bot split <id>
```

**Arguments:**
- `id` - Bot ID to split

**Examples:**

```bash
orbitmm bot split bot-abc123
```

---

## Trade Commands

Execute individual trades.

### `trade quote <token> <amount>`

Get a swap quote.

```bash
orbitmm trade quote <token> <amount>
```

**Arguments:**
- `token` - Token mint address or shortcut (sol, usdc)
- `amount` - Amount to swap

**Options:**
| Option | Description |
|--------|-------------|
| `-d, --direction <dir>` | buy or sell (default: buy) |
| `--base <mint>` | Base token (default: SOL) |
| `-s, --slippage <bps>` | Slippage in basis points (default: 50) |
| `--json` | Output as JSON |

**Examples:**

```bash
# Get buy quote
orbitmm trade quote <TOKEN_MINT> 0.1

# Get sell quote
orbitmm trade quote <TOKEN_MINT> 1000 --direction sell

# With custom slippage
orbitmm trade quote <TOKEN_MINT> 0.1 --slippage 100
```

---

### `trade buy <token> <amount>`

Buy tokens with SOL.

```bash
orbitmm trade buy <token> <amount>
```

**Arguments:**
- `token` - Token mint address
- `amount` - Amount of SOL to spend

**Options:**
| Option | Description |
|--------|-------------|
| `-w, --wallet <path>` | Wallet keypair file (required) |
| `-s, --slippage <bps>` | Slippage in basis points (default: 50) |
| `--priority-fee <lamports>` | Priority fee (default: 1000) |
| `--dry-run` | Simulate without executing |

**Examples:**

```bash
# Buy with 0.1 SOL
orbitmm trade buy <TOKEN_MINT> 0.1 --wallet wallet.json

# Dry run
orbitmm trade buy <TOKEN_MINT> 0.1 --wallet wallet.json --dry-run
```

---

### `trade sell <token> <amount>`

Sell tokens for SOL.

```bash
orbitmm trade sell <token> <amount>
```

**Arguments:**
- `token` - Token mint address
- `amount` - Amount of tokens to sell

**Options:**
| Option | Description |
|--------|-------------|
| `-w, --wallet <path>` | Wallet keypair file (required) |
| `-s, --slippage <bps>` | Slippage in basis points (default: 50) |
| `--priority-fee <lamports>` | Priority fee (default: 1000) |
| `--dry-run` | Simulate without executing |

**Examples:**

```bash
# Sell 1000 tokens
orbitmm trade sell <TOKEN_MINT> 1000 --wallet wallet.json
```

---

## Detection Commands

Market manipulation detection.

### `detect analyze <token>`

Analyze token for manipulation patterns.

```bash
orbitmm detect analyze <token>
```

**Arguments:**
- `token` - Token mint address

**Options:**
| Option | Description |
|--------|-------------|
| `-h, --hours <n>` | Hours of history to analyze (default: 24) |
| `--limit <n>` | Max transactions to analyze (default: 10000) |
| `--json` | Output as JSON |
| `-v, --verbose` | Show detailed evidence |

**Examples:**

```bash
# Analyze last 24 hours
orbitmm detect analyze <TOKEN_MINT>

# Analyze last 72 hours with verbose output
orbitmm detect analyze <TOKEN_MINT> --hours 72 --verbose

# JSON output for parsing
orbitmm detect analyze <TOKEN_MINT> --json
```

---

### `detect monitor <token>`

Monitor token for manipulation in real-time.

```bash
orbitmm detect monitor <token>
```

**Arguments:**
- `token` - Token mint address

**Options:**
| Option | Description |
|--------|-------------|
| `-a, --alert <threshold>` | Alert threshold 0.0-1.0 (default: 0.7) |
| `-i, --interval <seconds>` | Check interval (default: 60) |
| `--lookback <minutes>` | Lookback window (default: 30) |
| `--webhook <url>` | Webhook URL for alerts |
| `--quiet` | Only output alerts |

**Examples:**

```bash
# Basic monitoring
orbitmm detect monitor <TOKEN_MINT>

# Sensitive monitoring with webhook
orbitmm detect monitor <TOKEN_MINT> \
  --alert 0.5 \
  --interval 30 \
  --webhook https://discord.com/webhook/...

# Quiet mode (alerts only)
orbitmm detect monitor <TOKEN_MINT> --quiet
```

---

## Utility Commands

### `status`

Show OrbitMM system status.

```bash
orbitmm status
```

**Options:**
| Option | Description |
|--------|-------------|
| `--json` | Output as JSON |

---

### `config [action] [key] [value]`

Manage configuration.

```bash
orbitmm config [action] [key] [value]
```

**Arguments:**
- `action` - show, set, reset
- `key` - Configuration key
- `value` - Configuration value

**Examples:**

```bash
# Show current config
orbitmm config

# Show specific key
orbitmm config show rpcUrl

# Set value
orbitmm config set rpcUrl https://my-rpc.com
```

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SOLANA_RPC_URL` | Solana RPC endpoint | mainnet-beta |
| `ORBITMM_CONFIG_PATH` | Config directory | `~/.orbitmm` |
| `ORBITMM_WALLET_PATH` | Wallet file path | `~/.orbitmm/wallets.json` |
| `ALLIUM_API_KEY` | Allium API key | none |
| `JUPITER_API_URL` | Jupiter API URL | default |
| `RAYDIUM_API_URL` | Raydium API URL | default |

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Invalid arguments |
| 3 | Configuration error |
| 4 | Network error |
| 5 | Transaction failed |
