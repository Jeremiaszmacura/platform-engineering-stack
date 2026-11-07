import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Builds into dist/. `test` configures Vitest (jsdom; matchers registered in src/setupTests.js).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.js',
  },
});
