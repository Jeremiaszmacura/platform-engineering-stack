import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Builds the static site into dist/, served by nginx in the container.
// `test` configures Vitest: component tests need a DOM, and the shared
// matchers (toBeInTheDocument, ...) are registered in src/setupTests.js.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/setupTests.js',
  },
});
