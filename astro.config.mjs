// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// Static by default. The two on-demand routes (/api/scan and /r/[id]) opt in
// with `export const prerender = false`. Image optimisation is passthrough so
// no Images binding is needed. Sessions are off so the adapter does not
// require a SESSION KV namespace.
export default defineConfig({
  site: 'https://axcheck.theoverstorygroup.com',
  session: false,
  adapter: cloudflare({
    imageService: 'passthrough',
  }),
});
