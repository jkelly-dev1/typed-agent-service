import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Everything is offline and deterministic; a hang is a bug, not slowness.
    testTimeout: 10000,
  },
});
