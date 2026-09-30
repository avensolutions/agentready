import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The token file is the only place the parent site's palette is written
// down. This guards the core values against drift and typos.
const css = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');

/** @param {string} name */
function token(name) {
  const match = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  return match ? match[1].trim() : undefined;
}

describe('design tokens', () => {
  it.each([
    ['parchment', '#F4F1EA'],
    ['ink', '#28362A'],
    ['ink-muted', '#5A6350'],
    ['olive', '#5C6B4B'],
    ['sage', '#9FB299'],
    ['navy', '#1E2530'],
    ['periwinkle', '#AEBEE8'],
    ['olive-deep', '#63652E'],
    ['terracotta', '#C15A2E'],
  ])('defines --%s as the parent site value', (name, value) => {
    expect(token(name)).toBe(value);
  });

  it('does not reintroduce retired colours', () => {
    for (const retired of ['#1A2318', '#344A34', '#D1FE9F', '#B8AFCB']) {
      expect(css.toUpperCase()).not.toContain(retired);
    }
  });

  it('names the three parent site typefaces', () => {
    expect(token('font-display')).toContain('Schibsted Grotesk');
    expect(token('font-body')).toContain('Inter');
    expect(token('font-cond')).toContain('Barlow Condensed');
  });
});
