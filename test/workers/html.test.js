import { describe, expect, it } from 'vitest';
import { extractPage } from '../../src/lib/collectors/html.js';

const PAGE = `<!doctype html>
<html lang="en-AU">
<head>
  <meta charset="utf-8">
  <title>Acme Widgets &amp; Co | Home</title>
  <meta name="description" content="Widgets for small &quot;teams&quot;.">
  <meta name="robots" content="index, follow">
  <meta property="og:title" content="Acme Widgets">
  <meta property="og:image" content="/og.png">
  <meta name="twitter:card" content="summary">
  <link rel="canonical" href="https://acme.example.com/">
  <link rel="alternate" type="text/markdown" href="/index.md">
  <link rel="alternate" hreflang="fr" href="/fr/">
  <base href="https://acme.example.com/base/">
  <style>body { color: red }</style>
  <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Acme"}</script>
  <script src="/app.js"></script>
  <script>window.dataLayer = [1,2,3];</script>
</head>
<body>
  <header><nav><a href="/about">About us</a><a href="pricing">Pricing</a><a href="/about#team">Team</a></nav></header>
  <main>
    <h1>Widgets for teams</h1>
    <p>We make <strong>widgets</strong> that fit&nbsp;together.</p>
    <h2>Why Acme?</h2>
    <ul><li>Fast</li><li>Cheap</li></ul>
    <div itemscope itemtype="https://schema.org/Product"><span itemprop="name">Widget</span></div>
    <a href="mailto:hello@acme.example.com?subject=hi">Email us</a>
    <a href="tel:+61312345678">Call</a>
    <a href="javascript:void(0)">Nope</a>
    <a href="https://other.example.org/x">Elsewhere</a>
    <form action="/contact" method="post" id="contact">
      <input type="text" name="name"><input type="email" name="email"><textarea name="message"></textarea>
      <button type="submit">Send</button>
    </form>
    <div class="hs-form-frame" data-form-id="abc" data-portal-id="123"></div>
    <iframe src="https://calendly.com/acme/30min"></iframe>
  </main>
  <footer><p>Footer text</p></footer>
  <noscript>Please enable JavaScript</noscript>
  <template><p>hidden template</p></template>
  <svg><text>svg text</text></svg>
</body>
</html>`;

describe('extractPage', () => {
  it('extracts metadata, structure, text, links, forms and embeds in one pass', async () => {
    const page = await extractPage(PAGE, 'https://acme.example.com/');

    expect(page.lang).toBe('en-AU');
    expect(page.title).toBe('Acme Widgets & Co | Home');
    expect(page.description).toBe('Widgets for small "teams".');
    expect(page.metaRobots).toBe('index, follow');
    expect(page.canonical).toBe('https://acme.example.com/');
    // og values are kept as written so a check can see whether og:image is absolute
    expect(page.og).toEqual({ title: 'Acme Widgets', image: '/og.png' });
    expect(page.twitter).toEqual({ card: 'summary' });
    expect(page.alternates).toEqual([
      { type: 'text/markdown', href: 'https://acme.example.com/index.md', hreflang: '' },
      { type: '', href: 'https://acme.example.com/fr/', hreflang: 'fr' },
    ]);

    expect(page.headings).toEqual([
      { level: 1, text: 'Widgets for teams' },
      { level: 2, text: 'Why Acme?' },
    ]);
    expect(page.landmarks).toMatchObject({ header: 1, nav: 1, main: 1, footer: 1, article: 0, aside: 0 });

    expect(page.text).toContain('Widgets for teams');
    expect(page.text).toContain('We make widgets that fit together.');
    expect(page.text).toContain('Footer text');
    expect(page.text).not.toContain('dataLayer');
    expect(page.text).not.toContain('color: red');
    expect(page.text).not.toContain('enable JavaScript');
    expect(page.text).not.toContain('hidden template');
    expect(page.text).not.toContain('svg text');
    expect(page.text.split('\n')).toContain('Fast');
    expect(page.words).toBeGreaterThan(10);
    expect(page.mainWords).toBeGreaterThan(5);
    expect(page.mainWords).toBeLessThan(page.words);
    expect(page.noscript).toBe('Please enable JavaScript');

    // links resolve against <base>, drop fragments, dedupe, skip javascript:
    expect(page.links).toEqual([
      { href: 'https://acme.example.com/about', text: 'About us' },
      { href: 'https://acme.example.com/base/pricing', text: 'Pricing' },
      { href: 'https://other.example.org/x', text: 'Elsewhere' },
    ]);
    expect(page.linkCount).toBe(4);
    expect(page.mailto).toEqual(['hello@acme.example.com']);
    expect(page.tel).toEqual(['+61312345678']);

    expect(page.jsonLd).toEqual(['{"@context":"https://schema.org","@type":"Organization","name":"Acme"}']);
    expect(page.microdataItems).toBe(1);
    expect(page.scripts).toBe(3);
    expect(page.externalScripts).toBe(1);
    expect(page.scriptChars).toBe('window.dataLayer = [1,2,3];'.length);
    expect(page.styleChars).toBeGreaterThan(0);

    expect(page.forms).toEqual([
      {
        action: 'https://acme.example.com/contact',
        method: 'POST',
        id: 'contact',
        fields: [
          { tag: 'input', type: 'text', name: 'name' },
          { tag: 'input', type: 'email', name: 'email' },
          { tag: 'textarea', type: 'textarea', name: 'message' },
          { tag: 'button', type: 'submit', name: '' },
        ],
        hasSubmit: true,
      },
    ]);
    expect(page.embeds.map((e) => e.kind)).toEqual(['hs-form', 'calendly']);
  });

  it('caps the visible text and reports truncation while still counting words', async () => {
    const long = `<html><body><main>${'<p>word word word word word</p>'.repeat(500)}</main></body></html>`;
    const page = await extractPage(long, 'https://example.com/', { textChars: 300 });
    expect(page.textTruncated).toBe(true);
    expect(page.text.length).toBeLessThanOrEqual(300);
    expect(page.words).toBe(2500);
  });

  it('handles an empty application shell', async () => {
    const shell = '<!doctype html><html><head><title>App</title></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>';
    const page = await extractPage(shell, 'https://example.com/');
    expect(page.title).toBe('App');
    expect(page.text).toBe('');
    expect(page.words).toBe(0);
    expect(page.externalScripts).toBe(1);
    expect(page.headings).toEqual([]);
  });
});
