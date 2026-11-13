import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Собираем расширение: отдельный бандл для content script и service worker.
// MV3 требует, чтобы в манифесте лежали реальные файлы и не было удалённого кода.
const root = process.cwd();
const outDir = resolve(root, 'dist');

export default defineConfig({
  resolve: {
    alias: { '@': resolve(root, 'src') },
  },
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      input: {
        content: resolve(root, 'src/content/index.ts'),
        background: resolve(root, 'src/background/index.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
  plugins: [
    {
      // Манифест копируем как есть: он не нужен в бандле и должен лежать в корне dist.
      name: 'kataoke-copy-manifest',
      closeBundle() {
        mkdirSync(outDir, { recursive: true });
        copyFileSync(resolve(root, 'manifest.json'), resolve(outDir, 'manifest.json'));
      },
    },
  ],
});
