import { describe, expect, it } from 'vitest';
import { FrontmatterError, parseFrontmatter, splitFrontmatter } from '../../src/lib/rubric/frontmatter.js';

describe('splitFrontmatter', () => {
  it('separates the block from the body', () => {
    const { frontmatter, body } = splitFrontmatter('---\nid: a\n---\nBody text\n');
    expect(frontmatter).toBe('id: a');
    expect(body).toBe('Body text\n');
  });

  it('accepts CRLF line endings', () => {
    const { frontmatter, body } = splitFrontmatter('---\r\nid: a\r\n---\r\nBody\r\n');
    expect(frontmatter).toBe('id: a');
    expect(body).toBe('Body\n');
  });

  it('rejects a document without an opening fence', () => {
    expect(() => splitFrontmatter('id: a\n---\n')).toThrow(FrontmatterError);
  });

  it('rejects an unclosed block', () => {
    expect(() => splitFrontmatter('---\nid: a\nBody')).toThrow(/not closed/);
  });
});

describe('parseFrontmatter', () => {
  it('parses scalars and flow lists', () => {
    const { data } = parseFrontmatter(
      ['---', 'id: llms-txt', 'weight: 3', 'ratio: 0.5', 'flag: true', "title: 'quoted: value'", 'evidence: [a, b, 2]', '# a comment', '', '---', 'x'].join('\n'),
    );
    expect(data).toEqual({ id: 'llms-txt', weight: 3, ratio: 0.5, flag: true, title: 'quoted: value', evidence: ['a', 'b', 2] });
  });

  it('keeps a bare string with colons after the key', () => {
    const { data } = parseFrontmatter('---\nprogress: Checking for llms.txt...\n---\n');
    expect(data.progress).toBe('Checking for llms.txt...');
  });

  it('rejects duplicate keys', () => {
    expect(() => parseFrontmatter('---\nid: a\nid: b\n---\n')).toThrow(/duplicate key "id"/);
  });

  it('rejects block lists and nested structures', () => {
    expect(() => parseFrontmatter('---\nevidence:\n  - a\n---\n')).toThrow(FrontmatterError);
    expect(() => parseFrontmatter('---\nevidence: [[a]]\n---\n')).toThrow(/nested/);
    expect(() => parseFrontmatter('---\nmeta: {a: 1}\n---\n')).toThrow(/unsupported/);
  });

  it('rejects empty values and unclosed lists', () => {
    expect(() => parseFrontmatter('---\nid:\n---\n')).toThrow(/no value/);
    expect(() => parseFrontmatter('---\nevidence: [a, ]\n---\n')).toThrow(/empty list item/);
    expect(() => parseFrontmatter('---\nevidence: [a, b\n---\n')).toThrow(/not closed/);
  });

  it('rejects lines that are not key-value pairs', () => {
    expect(() => parseFrontmatter('---\njust text\n---\n')).toThrow(/expected "key: value"/);
  });
});
