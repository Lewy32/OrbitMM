# Detecting Volume Manipulation

This guide helps you identify when volume boosting tools are being used on a token. Use this to protect yourself, your community, or to analyze market authenticity.

---

## Quick Checklist

When evaluating a token's trading activity, check for:

| Signal | Suspicion Level | What to Look For |
|--------|-----------------|------------------|
| 🔴 High | New wallets only | >80% of buys from wallets <24h old |
| 🔴 High | Regular intervals | Trades every 15-30 seconds consistently |
| 🟡 Medium | Clustered funding | Many wallets funded from same source |
| 🟡 Medium | Uniform sizes | All trades between 0.3-1.5 SOL |
| 🟡 Medium | No sells | 100% buy pressure with no profit-taking |
| 🟢 Low | Round numbers | Trades at exactly 1.0, 0.5 SOL |

**Multiple signals = higher confidence**

---

## Pattern 1: Wallet Clustering

### What It Looks Like
```
Source Wallet: ABC...123
  ├─ Funds → Wallet 1 (0.5 SOL)
  ├─ Funds → Wallet 2 (0.5 SOL)
  ├─ Funds → Wallet 3 (0.5 SOL)
  └─ ... (50+ wallets)

All wallets then buy TokenX within 1 hour
```

### How to Detect
1. Pick 10 random buyer wallets from recent trades
2. Check their transaction history
3. Look for common funding source
4. Check wallet age (creation time)

### Tools
- Solscan: Check "SOL Transfers" for each wallet
- Birdeye: "Top Traders" shows wallet distribution
- Custom script: Trace fund flows

### Red Flags
- >5 wallets funded from same source buying same token
- Wallets created within hours of each other
- No other activity besides the target token

---

## Pattern 2: Interval Regularity

### What It Looks Like
```
Time        Wallet      Action    Amount
10:00:00    Wallet A    BUY       0.8 SOL
10:00:15    Wallet B    BUY       0.6 SOL
10:00:31    Wallet C    BUY       0.9 SOL
10:00:45    Wallet D    BUY       0.7 SOL
10:01:01    Wallet E    BUY       0.5 SOL
```

Notice: ~15 second intervals (±2 seconds)

### How to Detect
Calculate time between consecutive buys:
```python
intervals = [tx[i+1].time - tx[i].time for i in range(len(tx)-1)]
avg = mean(intervals)
std = stdev(intervals)
cv = std / avg  # Coefficient of variation

if cv < 0.5:
    print("SUSPICIOUS: Too regular")
```

### Natural vs Bot
| Metric | Natural Trading | Bot Trading |
|--------|-----------------|-------------|
| CV (coefficient of variation) | >1.0 | <0.5 |
| Time distribution | Clustered (news events) | Uniform |
| Weekend activity | Lower | Same |

---

## Pattern 3: Size Distribution

### What It Looks Like
```
Natural Distribution:
[0.1, 0.1, 0.2, 0.3, 0.5, 0.5, 1.0, 2.0, 5.0, 10.0]
(Log-normal: many small, few large)

Bot Distribution:
[0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3]
(Uniform: random between min and max)
```

### How to Detect
Plot a histogram of trade sizes:
- **Natural**: Long tail (power law / log-normal)
- **Bots**: Flat distribution between bounds

### Orbitt's Signature
Default config: 0.3 SOL min, configurable max
Look for clustering at 0.3 SOL (the minimum)

---

## Pattern 4: Coordinated Timing

### What It Looks Like
```
Second 0:  Wallet A buys 0.5 SOL
Second 1:  Wallet B buys 0.7 SOL  
Second 2:  Wallet C buys 0.4 SOL
Second 3:  Wallet D buys 0.6 SOL
[5 second gap]
Second 8:  Wallet E buys 0.8 SOL
Second 9:  Wallet F buys 0.5 SOL
```

Multiple wallets trading within the same 5-second window, repeatedly.

### How to Detect
```python
def find_coordinated_windows(transactions, window_size=5):
    windows = defaultdict(list)
    for tx in transactions:
        window = tx.timestamp // window_size
        windows[window].append(tx)
    
    suspicious = []
    for window, txs in windows.items():
        unique_wallets = set(tx.wallet for tx in txs)
        if len(unique_wallets) >= 3:
            suspicious.append(window)
    
    return suspicious
```

### Red Flags
- 3+ different wallets in same 5-second window
- Pattern repeats multiple times
- No natural clustering (not following news/events)

---

## Pattern 5: New Wallet Spam

### What It Looks Like
```
Token launches at 12:00

12:05 - Wallet A (created 12:04) buys
12:06 - Wallet B (created 12:03) buys
12:07 - Wallet C (created 12:05) buys
...
100 wallets, all <1 hour old
```

### How to Detect
For each buying wallet, check:
1. When was it created? (first SOL transfer in)
2. How many transactions total?
3. What else has it traded?

### Quick Heuristic
```python
def wallet_age_score(wallet, current_time):
    first_tx = get_first_transaction(wallet)
    age_hours = (current_time - first_tx.time) / 3600
    
    if age_hours < 1:
        return 0.9  # Very suspicious
    elif age_hours < 24:
        return 0.6  # Suspicious
    elif age_hours < 168:  # 1 week
        return 0.3  # Slightly suspicious
    else:
        return 0.1  # Probably fine
```

---

## DexScreener Trending Gaming

### How It Works
DexScreener ranks by:
- Volume (easy to fake)
- Transactions (easy to fake)
- Unique wallets (easy to fake)
- Price movement (follows from above)

### Detection
Compare metrics over time:
```
Hour 1: 50 wallets, 100 txs, $10k volume
Hour 2: 150 wallets, 300 txs, $30k volume (organic growth?)
Hour 3: 400 wallets, 800 txs, $80k volume (🚨 geometric growth)
```

Organic growth is typically logarithmic (fast then slowing).
Bot growth is often linear or geometric (constant rate).

---

## Building a Detection Pipeline

### Step 1: Data Collection
```typescript
// Collect recent transactions for a token
const transactions = await connection.getSignaturesForAddress(
  tokenMint,
  { limit: 1000 }
);

// Parse each transaction for:
// - Signer (buyer wallet)
// - Amount
// - Timestamp
// - Direction (buy/sell)
```

### Step 2: Feature Extraction
```typescript
interface TokenMetrics {
  // Wallet features
  uniqueWallets: number;
  avgWalletAge: number;
  walletClusterScore: number;
  
  // Timing features
  intervalCV: number;
  coordinatedWindowCount: number;
  
  // Size features
  sizeDistributionType: 'natural' | 'uniform';
  avgTradeSize: number;
  
  // Ratio features
  buyRatio: number;
  newWalletRatio: number;
}
```

### Step 3: Scoring
```typescript
function calculateManipulationScore(metrics: TokenMetrics): number {
  let score = 0;
  
  // Each factor contributes 0-0.2 to final score
  if (metrics.intervalCV < 0.5) score += 0.2;
  if (metrics.newWalletRatio > 0.8) score += 0.2;
  if (metrics.walletClusterScore > 0.7) score += 0.2;
  if (metrics.sizeDistributionType === 'uniform') score += 0.2;
  if (metrics.coordinatedWindowCount > 5) score += 0.2;
  
  return score;  // 0-1, higher = more suspicious
}
```

### Step 4: Alerting
```typescript
if (score > 0.6) {
  alert({
    token: tokenMint,
    score,
    evidence: generateReport(metrics),
    recommendation: 'HIGH RISK - Likely manipulated volume',
  });
}
```

---

## Tools for Detection

### Free
- **Solscan** — Transaction history, wallet analysis
- **Birdeye** — Top traders, holder distribution
- **DEX Screener** — Basic charts and volume
- **Step Finance** — Portfolio tracking

### Paid / Advanced
- **Nansen** — Wallet labeling, smart money tracking
- **Arkham** — Entity identification
- **Allium** — SQL queries on-chain data

### DIY
- **Helius** — RPC with enhanced transaction parsing
- **QuickNode** — Fast RPC access
- **Custom scripts** — This guide + web3.js

---

## What To Do When You Find Manipulation

### For Yourself
1. Don't buy / reduce exposure
2. Set stop losses if already in
3. Watch for exit liquidity events

### For Your Community
1. Share findings (with evidence)
2. Warn without creating panic
3. Focus on the data, not accusations

### For the Ecosystem
1. Report to relevant platforms
2. Document patterns for others
3. Contribute to detection tools

---

## False Positives

Not every signal means manipulation:

- **Launchpad momentum** — Real hype can look coordinated
- **Whale games** — Single actors aren't necessarily bots
- **Airdrop claims** — Many wallets acting simultaneously
- **Arbitrage** — Bots that provide legitimate market function

Always look for **multiple signals** before concluding manipulation.

---

## Staying Ahead

Bot operators read guides like this too. They adapt:
- Randomizing intervals more
- Using older wallets
- Varying trade sizes more naturally
- Adding fake sells

The detection game is ongoing. The best defense is understanding the fundamentals:

> **Real projects have real communities.**
> **Real volume comes from real interest.**
> **Numbers on a chart aren't the same as value.**

---

*Stay safe out there. 🎖️*
