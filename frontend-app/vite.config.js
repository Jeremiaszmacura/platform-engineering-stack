import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Builds the static site into dist/, served by nginx in the container
export default defineConfig({
  plugins: [react()],
});
