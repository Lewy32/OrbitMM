# Allium Integration Guide

OrbitMM uses **Allium** for on-chain data queries, particularly in the detection module.

---

## Why Allium?

- **150+ chains** supported
- **Real-time** token prices and wallet data
- **Historical** transaction analysis
- **Custom SQL** for advanced queries
- **Rate limit:** 1 req/second (plan accordingly)

---

## Skill Location

```
~/.openclaw/skills/allium-onchain-data/
├── SKILL.md           # Main documentation
└── references/
    └── apis.md        # API reference
```

---

## Setup

### 1. Register for API Key

```bash
curl -X POST https://api.allium.so/api/v1/register \
  -H "Content-Type: application/json" \
  -d '{"name": "OrbitMM", "email": "your@email.com"}'
# Returns: {"api_key": "...", "query_id": "..."}
```

Store both values:
- `api_key` — for authentication
- `query_id` — for SQL queries

### 2. Environment Variable

```bash
export ALLIUM_API_KEY="your-api-key"
export ALLIUM_QUERY_ID="your-query-id"
```

---

## Endpoints Used by Detection Module

### Token Prices (Current)

```typescript
// Get current price for pattern analysis
POST /api/v1/developer/prices
Body: [{"token_address": "...", "chain": "solana"}]
```

### Wallet Transactions

```typescript
// Analyze wallet trading patterns
POST /api/v1/developer/wallet/transactions
Body: [{"chain": "solana", "address": "wallet_address"}]
```

### Wallet Balances History

```typescript
// Track funding flows (detect wallet clustering)
POST /api/v1/developer/wallet/balances/history
Body: [{"chain": "solana", "address": "wallet_address"}]
```

### Custom SQL (Advanced)

```typescript
// Complex pattern detection queries
POST /api/v1/explorer/queries/{query_id}/run-async
Body: {
  "parameters": {
    "sql_query": "SELECT signer, COUNT(*) as tx_count FROM solana.raw.transactions WHERE ... GROUP BY signer"
  }
}
```

---

## Detection Module Integration

### Wallet Clustering Detection

```typescript
import { AlliumClient } from './allium';

async function detectWalletClustering(
  wallets: string[],
  tokenMint: string
): Promise<ClusteringResult> {
  const allium = new AlliumClient(process.env.ALLIUM_API_KEY!);
  
  // Get funding history for each wallet
  const fundingSources: Map<string, string[]> = new Map();
  
  for (const wallet of wallets) {
    // Rate limit: 1 req/second
    await sleep(1000);
    
    const history = await allium.getWalletBalanceHistory('solana', wallet);
    const sources = extractFundingSources(history);
    fundingSources.set(wallet, sources);
  }
  
  // Find common sources
  const clusters = findClusters(fundingSources);
  
  return {
    clustered: clusters.length > 0,
    clusters,
    confidence: calculateConfidence(clusters, wallets.length),
  };
}
```

### Transaction Pattern Analysis

```typescript
async function analyzeTransactionPatterns(
  tokenMint: string,
  timeRangeHours: number = 24
): Promise<PatternAnalysis> {
  const allium = new AlliumClient(process.env.ALLIUM_API_KEY!);
  
  // Use custom SQL for efficient bulk analysis
  const result = await allium.runQueryAsync(process.env.ALLIUM_QUERY_ID!, {
    sql_query: `
      SELECT 
        signer,
        COUNT(*) as tx_count,
        AVG(EXTRACT(EPOCH FROM (timestamp - LAG(timestamp) OVER (PARTITION BY signer ORDER BY timestamp)))) as avg_interval,
        STDDEV(amount) as amount_stddev
      FROM solana.dex.trades
      WHERE token_mint = '${tokenMint}'
        AND timestamp > NOW() - INTERVAL '${timeRangeHours} hours'
      GROUP BY signer
      HAVING COUNT(*) > 5
    `
  });
  
  // Analyze patterns from results
  return analyzePatterns(result);
}
```

---

## Rate Limiting Strategy

Allium has 1 request/second limit. OrbitMM handles this via:

```typescript
class RateLimitedAlliumClient {
  private lastRequest: number = 0;
  private minIntervalMs: number = 1100; // Slightly over 1 second
  
  async request<T>(fn: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const elapsed = now - this.lastRequest;
    
    if (elapsed < this.minIntervalMs) {
      await sleep(this.minIntervalMs - elapsed);
    }
    
    this.lastRequest = Date.now();
    return fn();
  }
}
```

For bulk analysis, prefer:
1. **Custom SQL queries** (single request, many results)
2. **Batch endpoints** where available
3. **Caching** (prices valid for ~1 minute)

---

## Common Token Addresses (Solana)

| Token | Address |
|-------|---------|
| SOL | `So11111111111111111111111111111111111111112` |
| USDC | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| USDT | `Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB` |

---

## Error Handling

```typescript
// Allium-specific errors
class AlliumError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public retryable: boolean
  ) {
    super(message);
  }
}

// Handle in detection module
try {
  const data = await allium.getWalletTransactions(chain, wallet);
} catch (error) {
  if (error.statusCode === 429) {
    // Rate limited - wait and retry
    await sleep(2000);
    return retry();
  }
  if (error.statusCode === 401) {
    // Invalid API key
    throw new ConfigurationError('Invalid Allium API key');
  }
  throw error;
}
```

---

## Citation Requirement

**Required:** All outputs using Allium data must include:

> "Powered by Allium"

This is part of their terms of service.

---

*Integration guide version 1.0*
