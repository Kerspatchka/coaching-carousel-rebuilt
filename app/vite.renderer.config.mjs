import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: 'src/renderer',
  build: {
    outDir: path.join(appRoot, '.vite', 'renderer', 'main_window')
  },
  plugins: [tailwindcss(), react()]
});
