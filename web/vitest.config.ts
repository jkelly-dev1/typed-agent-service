import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// SEPARATE FROM THE SERVER CONFIG ON PURPOSE. The service's tests run in a
// node environment; these need a DOM. Two configs is clearer than one config
// that switches environment on a path glob.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['web/tests/**/*.test.tsx', 'web/tests/**/*.test.ts'],
    setupFiles: ['web/tests/setup.ts'],
    testTimeout: 10000,
  },
});
