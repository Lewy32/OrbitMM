# OrbitMM Master Implementation Plan

**Status:** PLANNING PHASE
**Architect:** Awaiting deep reasoning pass
**Last Updated:** 2026-02-07

---

## Executive Summary

Build an open-source market maker / volume boosting tool to democratize capabilities currently held by extractive actors. Include detection mechanisms to enable defense.

---

## Phase 0: Architecture Review (CURRENT)

### Objective
Create bulletproof technical specification before any code is written.

### Deliverables
- [ ] Finalized module boundaries
- [ ] API contracts between modules
- [ ] Data flow diagrams
- [ ] Error handling strategy
- [ ] Security threat model
- [ ] Testing strategy
- [ ] Deployment architecture

### Questions to Resolve

**Wallet Engine**
1. HD vs random generation — which default? Trade-offs?
2. Encryption at rest — what algorithm? Key derivation?
3. Batch size limits — Solana tx size constraints?
4. Recovery strategy — what if keys lost?

**Trading Engine**
1. Jupiter vs direct DEX — when to use which?
2. Priority fee strategy — how to auto-adjust?
3. Slippage protection — abort conditions?
4. Failed transaction handling — retry logic?

**Orchestrator**
1. State persistence — what if process crashes mid-run?
2. Concurrency limits — RPC rate limiting?
3. Memory management — 10k bots in memory?
4. Event ordering guarantees?

**Detection Module**
1. Real-time vs batch analysis?
2. False positive rate targets?
3. Data retention policy?
4. Alert delivery mechanisms?

**Infrastructure**
1. Single binary vs microservices?
2. Database choice — SQLite for local, Postgres for scale?
3. Queue system needed for this scale?
4. Monitoring/observability?

---

## Phase 1: Core Implementation

### 1.1 Wallet Engine
**Priority:** P0 (blocks everything)
**Estimate:** 2-3 days

```
packages/core/src/wallet/
├── generator.ts      # Keypair generation (random + HD)
├── funder.ts         # Batch funding with optimal batching
├── tracker.ts        # Balance tracking with caching
├── encryptor.ts      # At-rest encryption
├── exporter.ts       # Import/export (encrypted JSON)
└── index.ts          # Public API
```

**Acceptance Criteria:**
- Generate 1000 wallets in <1 second
- Fund 100 wallets in single transaction
- Encrypt/decrypt without data loss
- Export format compatible with Phantom/Solflare

### 1.2 Trading Engine
**Priority:** P0
**Estimate:** 3-4 days

```
packages/core/src/trading/
├── jupiter.ts        # Jupiter aggregator client
├── raydium.ts        # Direct Raydium AMM
├── pumpfun.ts        # PumpFun integration
├── meteora.ts        # Meteora DLMM
├── router.ts         # Route selection logic
├── executor.ts       # Transaction execution with retries
└── index.ts          # Public API
```

**Acceptance Criteria:**
- Get quote from Jupiter in <500ms
- Execute swap with <2s latency
- Handle slippage failures gracefully
- Support all major Solana DEXs

### 1.3 Bot Orchestrator
**Priority:** P0
**Estimate:** 4-5 days

```
packages/core/src/orchestrator/
├── bot.ts            # Bot state machine
├── scheduler.ts      # Timing and intervals
├── manager.ts        # Lifecycle management
├── pool.ts           # Concurrent execution pool
├── persistence.ts    # State recovery
└── index.ts          # Public API
```

**Acceptance Criteria:**
- Run 1000 concurrent bots
- Pause/resume without losing state
- Merge/split bots correctly
- Recover from crashes

---

## Phase 2: Interfaces

### 2.1 CLI
**Priority:** P1
**Estimate:** 2 days

```
packages/cli/
├── commands/
│   ├── wallet.ts     # wallet generate|fund|export|import
│   ├── bot.ts        # bot create|start|stop|pause|status
│   ├── trade.ts      # trade buy|sell|quote
│   └── detect.ts     # detect analyze|monitor
└── index.ts
```

### 2.2 Telegram Bot
**Priority:** P1
**Estimate:** 3 days

```
packages/bot-telegram/
├── handlers/
│   ├── wallet.ts
│   ├── bot.ts
│   ├── trade.ts
│   └── stats.ts
├── middleware/
│   ├── auth.ts       # Owner-only
│   └── rateLimit.ts
└── index.ts
```

### 2.3 Web Dashboard
**Priority:** P2
**Estimate:** 5 days

```
packages/web/
├── src/
│   ├── components/
│   ├── pages/
│   ├── hooks/
│   └── api/
└── package.json
```

---

## Phase 3: Defense Tools

### 3.1 Detection Module
**Priority:** P1
**Estimate:** 4 days

```
packages/core/src/detection/
├── patterns/
│   ├── clustering.ts
│   ├── intervals.ts
│   ├── sizing.ts
│   └── timing.ts
├── analyzer.ts
├── monitor.ts
├── reporter.ts
└── index.ts
```

### 3.2 Transparency Module
**Priority:** P2
**Estimate:** 1 day

```
packages/core/src/transparency/
├── marker.ts         # Add memo to transactions
├── verifier.ts       # Check if tx is marked
└── index.ts
```

---

## Phase 4: Hardening

### 4.1 Security Audit
- Key management review
- Input validation
- RPC security
- Dependency audit

### 4.2 Performance Optimization
- Memory profiling
- RPC batching
- Connection pooling
- Caching strategy

### 4.3 Documentation
- API documentation
- User guides
- Video tutorials
- Example configurations

---

## Technical Decisions (To Be Finalized)

| Decision | Options | Leaning | Rationale |
|----------|---------|---------|-----------|
| Package manager | npm / pnpm / bun | pnpm | Fast, disk efficient |
| Build tool | tsc / esbuild / tsup | tsup | Fast, simple |
| Testing | Jest / Vitest | Vitest | Faster, modern |
| Database | SQLite / Postgres | SQLite default | Zero config for local |
| Queue | None / BullMQ | None initially | KISS |
| Monorepo tool | Turborepo / Nx / none | Turborepo | Simple, fast |

---

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| RPC rate limits | High | High | Multiple RPCs, backoff |
| Key theft | Critical | Low | Encryption, secure storage |
| Bot detection by DEXs | Medium | Medium | Randomization, limits |
| Legal issues | High | Low | Clear disclaimers, ethics |
| Scope creep | Medium | High | Strict MVP definition |

---

## Success Metrics

### MVP (Phase 1+2.1)
- [ ] Generate and fund 100 wallets
- [ ] Run 10 bots for 1 hour without crash
- [ ] Execute 100 successful swaps
- [ ] CLI fully functional

### Full Release
- [ ] Run 1000 bots stable
- [ ] Detection catches 80% of manipulation
- [ ] <1% transaction failure rate
- [ ] Documentation complete

---

## Agent Assignment

| Agent | Role | Model | Status |
|-------|------|-------|--------|
| Architect | Deep planning, spec review | Kimi K2 / Claude thinking | PENDING |
| Wallet Worker | Implement wallet module | Claude Sonnet | PENDING |
| Trading Worker | Implement trading module | Claude Sonnet | PENDING |
| Orchestrator Worker | Implement bot system | Claude Sonnet | PENDING |
| CLI Worker | Implement CLI | Claude Sonnet | PENDING |
| Test Worker | Write tests | Claude Sonnet | PENDING |

---

## Next Action

**SPAWN ARCHITECT AGENT** with extended thinking to:
1. Review this plan
2. Answer all open questions
3. Finalize technical decisions
4. Create detailed implementation specs for each module
5. Identify any gaps or risks

Only after architect approval → spawn worker agents.

---

*"Measure twice, cut once."*
