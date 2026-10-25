import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (pkg: string): string =>
  fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    // Unit tests run against the TypeScript sources; the stdio end-to-end test uses the build.
    alias: {
      '@folioflux/transaction-schema': src('transaction-schema'),
      '@folioflux/ledger-core': src('ledger-core'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    testTimeout: 30_000,
  },
});
