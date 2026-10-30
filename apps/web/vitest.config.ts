import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    // Spinning up a jsdom environment per file is slow on Windows (one full run
    // can spend minutes in environment setup), and the 5s default makes
    // userEvent-heavy tests time out under that load even though each passes in
    // under a second on its own. A real hang still fails, just later.
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
