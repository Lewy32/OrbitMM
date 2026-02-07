#!/usr/bin/env npx ts-node
/**
 * OrbitMM Quick Start Demo
 * 
 * This script demonstrates the core functionality of OrbitMM:
 * 1. Generating test wallets
 * 2. Creating bot configurations
 * 3. Analyzing tokens for manipulation
 */

import { 
  // Wallet module
  generate,
  generateRandom,
  generateHD,
  encrypt,
  decrypt,
  WalletData,
  
  // Trading types
  DEX,
  
  // Orchestrator
  Orchestrator,
  BotConfig,
  
  // Detection
  DetectionEngine,
} from '@orbitmm/core';

// ============ DEMO: Generate Wallets ============

async function demoWalletGeneration() {
  console.log('\n🔑 === Wallet Generation Demo ===\n');

  // Generate 5 random wallets
  console.log('Generating 5 random wallets...');
  const randomWallets = await generateRandom(5);
  
  randomWallets.forEach((wallet, i) => {
    console.log(`  Wallet ${i + 1}: ${wallet.publicKey.toBase58()}`);
  });

  // Generate HD wallets from mnemonic
  console.log('\nGenerating 3 HD wallets from mnemonic...');
  const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
  const hdWallets = await generateHD(3, mnemonic);
  
  hdWallets.forEach((wallet, i) => {
    console.log(`  HD Wallet ${i}: ${wallet.publicKey.toBase58()}`);
  });

  return randomWallets;
}

// ============ DEMO: Bot Configuration ============

function demoBotConfig() {
  console.log('\n🤖 === Bot Configuration Demo ===\n');

  // Example configuration for a market making bot
  const config: BotConfig = {
    // Target token to trade
    targetToken: 'So11111111111111111111111111111111111111112', // Wrapped SOL
    
    // Trading direction: 'buy', 'sell', or 'both'
    direction: 'both',
    
    // Trade size range (in SOL)
    minSwapSol: 0.01,
    maxSwapSol: 0.1,
    
    // Time between trades (in milliseconds)
    minIntervalMs: 30_000,  // 30 seconds
    maxIntervalMs: 120_000, // 2 minutes
    
    // Priority fee strategy
    priorityFee: 'auto',
    
    // Slippage tolerance (0.5%)
    slippageBps: 50,
    
    // Optional limits
    stopAfterSwaps: 100,      // Stop after 100 swaps
    stopAfterSol: 10,         // Stop after spending 10 SOL
    stopAfterDurationMs: 3600_000, // Stop after 1 hour
  };

  console.log('Bot Configuration:');
  console.log(JSON.stringify(config, null, 2));

  return config;
}

// ============ DEMO: Token Analysis ============

async function demoTokenAnalysis() {
  console.log('\n🔍 === Token Analysis Demo ===\n');

  // Note: This requires an Allium API key
  const alliumApiKey = process.env.ALLIUM_API_KEY;
  
  if (!alliumApiKey) {
    console.log('⚠️  ALLIUM_API_KEY not set. Skipping live analysis demo.');
    console.log('   Set ALLIUM_API_KEY env var to enable detection features.\n');
    
    // Show example output format
    console.log('Example analysis output:');
    const exampleReport = {
      tokenMint: 'ExampleTokenMint...',
      chain: 'solana',
      manipulationScore: 0.42,
      patterns: [
        {
          type: 'WALLET_CLUSTERING',
          confidence: 0.8,
          severity: 'medium',
          evidence: ['5 wallets share same funding source'],
        },
        {
          type: 'REGULAR_INTERVALS',
          confidence: 0.6,
          severity: 'low',
          evidence: ['Trading every ~60 seconds'],
        },
      ],
      alerts: [],
    };
    console.log(JSON.stringify(exampleReport, null, 2));
    return;
  }

  const engine = new DetectionEngine({
    allium: { apiKey: alliumApiKey },
  });

  console.log('Analyzing token for manipulation patterns...');
  console.log('(This may take a few seconds)\n');

  try {
    const report = await engine.analyzeToken(
      'So11111111111111111111111111111111111111112', // Example: Wrapped SOL
      'solana',
      { timeRangeMs: 3600_000, limit: 100 }
    );

    console.log('Analysis Report:');
    console.log(`  Manipulation Score: ${(report.manipulationScore * 100).toFixed(1)}%`);
    console.log(`  Patterns Detected: ${report.patterns.length}`);
    
    report.patterns.forEach(pattern => {
      console.log(`    - ${pattern.type} (${pattern.severity}): ${pattern.confidence * 100}% confidence`);
    });

    if (report.alerts.length > 0) {
      console.log(`  Alerts: ${report.alerts.length}`);
    }
  } catch (error) {
    console.error('Analysis failed:', error);
  }
}

// ============ DEMO: Full Orchestrator Usage ============

async function demoOrchestrator() {
  console.log('\n🚀 === Orchestrator Demo (Dry Run) ===\n');

  console.log('Note: This is a dry run - no actual trades will execute.');
  console.log('In production, you would:');
  console.log(`
  // 1. Create orchestrator
  const orchestrator = await Orchestrator.create({
    maxConcurrentSwaps: 50,
    rpcEndpoints: ['https://api.mainnet-beta.solana.com'],
  });

  // 2. Create bots with wallets
  const bots = orchestrator.createBots(wallets, config);

  // 3. Start all bots
  orchestrator.startAll();

  // 4. Monitor events
  orchestrator.on('swap:completed', (data) => {
    console.log(\`Bot \${data.botId} completed swap: \${data.signature}\`);
  });

  // 5. Graceful shutdown
  await orchestrator.shutdown();
`);
}

// ============ RUN ALL DEMOS ============

async function main() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║        OrbitMM Quick Start Demo        ║');
  console.log('║     Solana Market Making Bot Suite     ║');
  console.log('╚════════════════════════════════════════╝');

  try {
    await demoWalletGeneration();
    demoBotConfig();
    await demoTokenAnalysis();
    await demoOrchestrator();

    console.log('\n✅ Demo complete!\n');
    console.log('Next steps:');
    console.log('  1. Run `orbitmm wallet generate 10` to create wallets');
    console.log('  2. Run `orbitmm bot create` to configure bots');
    console.log('  3. Run `orbitmm detect analyze <token>` to check for manipulation');
    console.log('  4. Read the README.md for full documentation');
    console.log();
  } catch (error) {
    console.error('Demo failed:', error);
    process.exit(1);
  }
}

main();
