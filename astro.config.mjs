// @ts-check
import { defineConfig, envField } from 'astro/config';
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
  env: {
    schema: {
      // Public Turnstile site key, baked into the prerendered landing page at
      // build time. Set PUBLIC_TURNSTILE_SITE_KEY in .env or the build
      // environment for production; the default is the documented test key
      // that always passes.
      PUBLIC_TURNSTILE_SITE_KEY: envField.string({ context: 'client', access: 'public', default: '1x00000000000000000000AA' }),
    },
  },
});
