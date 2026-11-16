import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin, UserConfig } from 'vite';

// Собираем расширение: отдельные самодостаточные бандлы для content script и
// service worker. MV3 требует, чтобы в манифесте лежали реальные файлы и не было
// удалённого кода.
const root = process.cwd();
const outDir = resolve(root, 'dist');

/**
 * Копирование манифеста в `dist`.
 *
 * Манифест не участвует в бандле, но обязан лежать рядом с ним.
 */
function copyManifest(): Plugin {
  return {
    name: 'kataoke-copy-manifest',
    closeBundle() {
      mkdirSync(outDir, { recursive: true });
      copyFileSync(resolve(root, 'manifest.json'), resolve(outDir, 'manifest.json'));
    },
  };
}

/**
 * Проверка, что content script остался классическим скриптом.
 *
 * MV3 грузит `content_scripts.js` как обычный скрипт: наличие `import` в нём —
 * это расширение, которое не запустится, причём без внятной ошибки. Лучше
 * уронить сборку, чем отдать такой файл.
 */
function assertClassicScript(): Plugin {
  return {
    name: 'kataoke-assert-classic-script',
    closeBundle() {
      const code = readFileSync(resolve(outDir, 'content.js'), 'utf8');
      if (/^\s*(import|export)\s/m.test(code)) {
        throw new Error(
          'content.js содержит import/export: content script в MV3 должен быть классическим скриптом',
        );
      }
    },
  };
}

/**
 * Два независимых прогона сборки: `--mode content` и `--mode background`.
 *
 * Собирать оба входа за один прогон нельзя: Rollup выносит общий код в
 * `chunks/`, а content script в MV3 — **классический скрипт**, он не умеет
 * `import` и молча не запускается. Отдельный прогон инлайнит весь код в файл.
 */
export default function config({ mode }: { mode: string }): UserConfig {
  const isBackground = mode === 'background';

  return {
    resolve: {
      alias: { '@': resolve(root, 'src') },
    },
    build: {
      outDir,
      // `dist` очищает только первый прогон, иначе второй снесёт результат первого.
      emptyOutDir: !isBackground,
      target: 'es2022',
      sourcemap: true,
      rollupOptions: {
        input: {
          [isBackground ? 'background' : 'content']: resolve(
            root,
            isBackground ? 'src/background/index.ts' : 'src/content/index.ts',
          ),
        },
        output: {
          entryFileNames: '[name].js',
          assetFileNames: 'assets/[name][extname]',
          // Общий код обязан попасть в сам файл: чанк сломает content script.
          inlineDynamicImports: true,
        },
      },
    },
    plugins: isBackground ? [copyManifest(), assertClassicScript()] : [],
  };
}
