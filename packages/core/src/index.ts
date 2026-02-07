/**
 * @orbitmm/core
 *
 * Core library for OrbitMM - Solana Market Making Bot Platform
 *
 * Modules:
 * - wallet: Keypair generation, funding, encryption, tracking
 * - trading: Jupiter, Raydium, PumpFun, Meteora integrations
 * - orchestrator: Bot state machine, scheduling, management
 * - detection: Pattern detection for market manipulation
 */

// Export version for runtime checks
export const VERSION = '0.1.0';

// ============ Module Exports ============
export * from './wallet/index.js';
export * from './trading/index.js';
export * from './orchestrator/index.js';
export * from './detection/index.js';
