import { readFileSync } from 'node:fs';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

// Two projects:
// - node: pure modules (URL safety, rubric parsing, scoring) run in Node
// - workers: anything that needs the Workers runtime (HTMLRewriter, Response
//   streams, KV) runs inside workerd via the Cloudflare pool, with the
//   compatibility settings and bindings read from wrangler.jsonc
const wrangler = JSON.parse(readFileSync(new URL('./wrangler.jsonc', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, ''));

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          include: ['test/**/*.test.js'],
          exclude: ['test/workers/**'],
        },
      },
      {
        plugins: [
          cloudflareTest({
            miniflare: {
              compatibilityDate: wrangler.compatibility_date,
              compatibilityFlags: wrangler.compatibility_flags,
              kvNamespaces: wrangler.kv_namespaces.map((/** @type {{ binding: string }} */ ns) => ns.binding),
            },
          }),
        ],
        test: {
          name: 'workers',
          include: ['test/workers/**/*.test.js'],
        },
      },
    ],
  },
});
