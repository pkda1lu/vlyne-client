import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri drives the dev server; it must be predictable and never obscure Rust errors.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: 'chrome110',
    sourcemap: false,
    minify: 'esbuild',
  },
});
