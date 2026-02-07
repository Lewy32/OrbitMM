import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
  tsconfig: './tsconfig.json',
  external: [
    '@solana/web3.js',
    '@solana/spl-token',
    'argon2',
    'bip39',
    'ed25519-hd-key',
  ],
});
