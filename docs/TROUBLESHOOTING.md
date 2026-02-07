# OrbitMM Troubleshooting Guide

Solutions for common issues when using OrbitMM.

## Table of Contents

- [Installation Issues](#installation-issues)
- [RPC & Network Issues](#rpc--network-issues)
- [Transaction Failures](#transaction-failures)
- [Wallet Issues](#wallet-issues)
- [Bot Issues](#bot-issues)
- [Detection Issues](#detection-issues)
- [Performance Issues](#performance-issues)

---

## Installation Issues

### Native module build failures

**Error:**
```
error: `cargo build` failed with exit code 101
npm ERR! node-pre-gyp WARN Pre-built binaries not found
```

**Solution:**

1. Install build tools:
   ```bash
   # macOS
   xcode-select --install
   
   # Ubuntu/Debian
   sudo apt-get install build-essential python3
   
   # Windows
   npm install -g windows-build-tools
   ```

2. Rebuild native modules:
   ```bash
   pnpm rebuild
   ```

3. If argon2 fails specifically:
   ```bash
   pnpm add argon2 --force
   ```

### pnpm: command not found

**Solution:**
```bash
# Install pnpm
npm install -g pnpm

# Or via corepack (Node 16+)
corepack enable
corepack prepare pnpm@latest --activate
```

### TypeScript compilation errors

**Error:**
```
error TS2307: Cannot find module '@orbitmm/core'
```

**Solution:**
```bash
# Rebuild all packages
pnpm build

# If still failing, clean and rebuild
pnpm clean
pnpm install
pnpm build
```

---

## RPC & Network Issues

### Connection timeout

**Error:**
```
Error: failed to get recent blockhash: FetchError: network timeout
```

**Solutions:**

1. **Use a faster RPC:**
   ```bash
   # Free RPCs (rate limited)
   export SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
   
   # Better: Use a private RPC
   export SOLANA_RPC_URL=https://your-rpc-provider.com
   ```

2. **Increase timeout:**
   ```bash
   orbitmm --rpc "https://api.mainnet-beta.solana.com" trade quote ...
   ```

### 429 Too Many Requests

**Error:**
```
Error: 429: Too Many Requests
```

**Solutions:**

1. **Rate limit your requests:**
   - Increase bot intervals
   - Reduce concurrent operations

2. **Use multiple RPCs:**
   ```env
   SOLANA_RPC_URL=https://rpc1.com,https://rpc2.com,https://rpc3.com
   ```

3. **Use a paid RPC service:**
   - Helius
   - QuickNode
   - Triton
   - Alchemy

### RPC node out of sync

**Error:**
```
Error: Transaction simulation failed: BlockhashNotFound
```

**Solution:**
```bash
# Try a different RPC
export SOLANA_RPC_URL=https://alternative-rpc.com

# Or use devnet for testing
export SOLANA_RPC_URL=https://api.devnet.solana.com
```

---

## Transaction Failures

### Insufficient funds

**Error:**
```
Error: Attempt to debit an account but found no record of a prior credit
```

**Solution:**
```bash
# Check wallet balance
orbitmm wallet balance --all

# Fund wallets
orbitmm wallet fund source.json 0.1 --from-file wallets.json
```

### Slippage exceeded

**Error:**
```
Error: Slippage tolerance exceeded
```

**Solutions:**

1. **Increase slippage:**
   ```bash
   orbitmm trade buy TOKEN 0.1 --slippage 200  # 2%
   ```

2. **Use smaller trade sizes:**
   ```bash
   orbitmm bot create 5 --token TOKEN --max-swap 0.05
   ```

3. **Trade during lower volatility periods**

### Transaction expired

**Error:**
```
Error: Transaction expired (blockhash not found)
```

**Solutions:**

1. **Use a faster RPC with lower latency**

2. **Increase priority fee:**
   ```bash
   orbitmm trade buy TOKEN 0.1 --priority-fee 10000
   ```

3. **Retry the transaction**

### Simulation failed

**Error:**
```
Error: Transaction simulation failed: Custom program error: 0x1
```

**Solutions:**

1. **Check token account:**
   - Ensure you have a token account for the output token
   - The CLI should create one automatically

2. **Check liquidity:**
   ```bash
   orbitmm trade quote TOKEN 0.1
   ```
   If price impact is high (>2%), reduce trade size.

3. **Check for frozen/pausable tokens:**
   Some tokens have transfer restrictions.

### Priority fee too low

**Error:**
```
Error: Transaction was not confirmed in 60 seconds
```

**Solutions:**

1. **Increase priority fee:**
   ```bash
   orbitmm trade buy TOKEN 0.1 --priority-fee 50000
   ```

2. **Use dynamic priority fees:**
   ```yaml
   # In config
   priorityFee:
     mode: dynamic
     minLamports: 5000
     maxLamports: 100000
   ```

---

## Wallet Issues

### Password incorrect

**Error:**
```
Error: Decryption failed - invalid password or corrupted file
```

**Solutions:**

1. **Double-check password** (watch for caps lock, special characters)

2. **If truly lost, generate new wallets:**
   ```bash
   orbitmm wallet generate 10 -o new-wallets.json
   ```

3. **Recover from backup** if you exported previously

### Wallet file not found

**Error:**
```
Error: Could not load wallets from: ~/.orbitmm/wallets.json
```

**Solution:**
```bash
# Generate wallets first
orbitmm wallet generate 10

# Or specify a different path
orbitmm wallet balance --from-file /path/to/wallets.json
```

### HD derivation mismatch

**Problem:** Generated different addresses from the same mnemonic

**Solution:**

HD wallets use derivation paths. Ensure you're using the same:
- Default: `m/44'/501'/0'/0'`
- Phantom: `m/44'/501'/0'/0'`
- Solflare: `m/44'/501'/0'`

```bash
# Generate with explicit derivation
orbitmm wallet generate 10 --hd --seed "your mnemonic" --path "m/44'/501'/0'/0'"
```

---

## Bot Issues

### Bots not executing trades

**Symptoms:**
- Bots show "running" but no swaps executed
- `lastSwapAt` remains null

**Solutions:**

1. **Check orchestrator is running:**
   ```bash
   orbitmm status
   ```

2. **Check wallet balances:**
   ```bash
   orbitmm wallet balance --all
   ```

3. **Check RPC connectivity:**
   ```bash
   orbitmm trade quote TOKEN 0.1
   ```

4. **Check bot configuration:**
   ```bash
   orbitmm bot status bot-id --verbose
   ```

### High failure rate

**Symptoms:**
- `swapsFailed` much higher than `swapsSuccessful`

**Solutions:**

1. **Check errors:**
   ```bash
   orbitmm bot status bot-id --verbose
   ```

2. **Common causes:**
   - Insufficient balance
   - High slippage (volatile token)
   - RPC issues
   - Low liquidity

3. **Adjust configuration:**
   - Increase slippage tolerance
   - Decrease trade size
   - Increase intervals
   - Use conservative config

### Bots stuck in "paused" state

**Solution:**
```bash
# Resume paused bots
orbitmm bot start --all

# Or if they need to be reset
orbitmm bot stop bot-id --force
orbitmm bot create 1 --token TOKEN
```

---

## Detection Issues

### No patterns detected

**Problem:** Analysis returns no patterns for a known suspicious token

**Solutions:**

1. **Increase lookback period:**
   ```bash
   orbitmm detect analyze TOKEN --hours 72
   ```

2. **Increase transaction limit:**
   ```bash
   orbitmm detect analyze TOKEN --limit 50000
   ```

3. **Lower sensitivity in monitor:**
   ```bash
   orbitmm detect monitor TOKEN --alert 0.5
   ```

### False positives

**Problem:** Too many alerts for legitimate tokens

**Solutions:**

1. **Increase alert threshold:**
   ```bash
   orbitmm detect monitor TOKEN --alert 0.85
   ```

2. **Review pattern evidence:**
   ```bash
   orbitmm detect analyze TOKEN --verbose
   ```

3. **Adjust pattern sensitivity** in config:
   ```yaml
   patterns:
     intervalRegularity:
       sensitivity: low
   ```

### Allium API errors

**Error:**
```
Error: Allium API request failed: 401 Unauthorized
```

**Solution:**
```bash
# Set valid API key
export ALLIUM_API_KEY=your-api-key

# Or use on-chain detection only
# (remove ALLIUM_API_KEY from environment)
```

---

## Performance Issues

### High memory usage

**Symptoms:**
- Process using >2GB RAM
- System slowing down

**Solutions:**

1. **Reduce concurrent bots:**
   ```yaml
   orchestrator:
     maxConcurrentSwaps: 10
   ```

2. **Reduce detection transaction limit:**
   ```bash
   orbitmm detect analyze TOKEN --limit 5000
   ```

3. **Clear old state:**
   ```bash
   rm -rf ~/.orbitmm/state/*.wal
   ```

### Slow bot startup

**Symptoms:**
- `bot start` takes >30 seconds

**Solutions:**

1. **Use faster RPC**

2. **Reduce number of bots:**
   Start in batches instead of all at once

3. **Check disk I/O:**
   State persistence may be slow on HDD

### High CPU usage

**Symptoms:**
- CLI using 100% CPU
- Fans running constantly

**Solutions:**

1. **Increase check intervals:**
   ```yaml
   detection:
     checkIntervalSeconds: 120
   ```

2. **Reduce bot count**

3. **Use release build:**
   ```bash
   pnpm build
   # Use the compiled JS, not ts-node
   ```

---

## Getting Help

If you can't solve your issue:

1. **Check logs:**
   ```bash
   cat ~/.orbitmm/logs/*.log
   ```

2. **Enable debug mode:**
   ```bash
   DEBUG=orbitmm:* orbitmm <command>
   ```

3. **Open an issue** on GitHub with:
   - Command you ran
   - Full error output
   - Node.js version (`node --version`)
   - OS and version
   - RPC being used (without API keys)

---

## Common Error Codes

| Error | Meaning | Solution |
|-------|---------|----------|
| `0x0` | Success | Not an error |
| `0x1` | Generic error | Check logs |
| `0x6` | Insufficient funds | Fund wallet |
| `0x7` | Invalid account | Check addresses |
| `0x1771` | Slippage exceeded | Increase slippage |
| `0x1772` | Stale quote | Retry |
| `0x1773` | Invalid route | Check liquidity |
