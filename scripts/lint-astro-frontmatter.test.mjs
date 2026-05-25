// scripts/lint-astro-frontmatter.test.mjs
//
// Unit coverage for the Astro-frontmatter `<script` lint. Exercises
// the rejection path (frontmatter contains the literal `<script`
// token in a comment) and the acceptance path (frontmatter mentions
// the word `script` without angle brackets), plus the no-frontmatter
// edge case and the end-to-end CLI envelope.
//
// Pyramid tier: unit. The lint is pure (string in → findings out), so
// the tests exercise the exported helpers and `runLint` against a
// fixture tree rather than spawning the CLI binary.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  extractFrontmatter,
  findOffendingLines,
  lintSource,
  runLint,
  walkAstroFiles,
} from './lint-astro-frontmatter.mjs';

describe('extractFrontmatter', () => {
  it('returns the body and start line when fences exist', () => {
    const src = ['---', '// hello', '// world', '---', '<section />'].join('\n');
    const fm = extractFrontmatter(src);
    assert.deepEqual(fm, { text: '// hello\n// world', startLine: 2 });
  });

  it('returns null when the opening fence is missing', () => {
    const src = ['<section />', '---', 'body', '---'].join('\n');
    assert.equal(extractFrontmatter(src), null);
  });

  it('returns null when the closing fence is missing', () => {
    const src = ['---', '// hello', '<section />'].join('\n');
    assert.equal(extractFrontmatter(src), null);
  });

  it('handles CRLF line endings', () => {
    const src = ['---', '// hello', '---', '<section />'].join('\r\n');
    const fm = extractFrontmatter(src);
    assert.deepEqual(fm, { text: '// hello', startLine: 2 });
  });
});

describe('findOffendingLines', () => {
  it('flags a literal <script> token in a comment', () => {
    const fm = {
      text: ['// foo', '// inline <script> drives the form', '// bar'].join('\n'),
      startLine: 2,
    };
    const findings = findOffendingLines(fm);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].line, 3);
    assert.equal(findings[0].snippet, '// inline <script> drives the form');
  });

  it('flags <script lang="ts"> opener', () => {
    const fm = { text: '// `<script lang="ts">` is the convention', startLine: 2 };
    const findings = findOffendingLines(fm);
    assert.equal(findings.length, 1);
  });

  it('flags self-closing <script/>', () => {
    const fm = { text: '// foo `<script/>` bar', startLine: 2 };
    const findings = findOffendingLines(fm);
    assert.equal(findings.length, 1);
  });

  it('accepts the word "script" without angle brackets', () => {
    const fm = {
      text: ['// the inline script reads from the form', '// script tag below'].join('\n'),
      startLine: 2,
    };
    assert.deepEqual(findOffendingLines(fm), []);
  });

  it('accepts script-adjacent words like Astro.script', () => {
    const fm = { text: '// Astro.script is unrelated', startLine: 2 };
    assert.deepEqual(findOffendingLines(fm), []);
  });

  it('flags every offending line, not just the first', () => {
    const fm = {
      text: ['// hands over to <script>', '// then the <script lang="ts"> block'].join('\n'),
      startLine: 5,
    };
    const findings = findOffendingLines(fm);
    assert.equal(findings.length, 2);
    assert.equal(findings[0].line, 5);
    assert.equal(findings[1].line, 6);
  });
});

describe('lintSource', () => {
  it('returns empty for a file with no frontmatter', () => {
    const src = '<section>no frontmatter, but the body has <script>foo</script></section>';
    assert.deepEqual(lintSource(src), []);
  });

  it('returns empty for clean frontmatter', () => {
    const src = ['---', '// just a comment about the inline script', '---', '<section />'].join(
      '\n',
    );
    assert.deepEqual(lintSource(src), []);
  });

  it('returns the absolute line numbers of offending tokens', () => {
    const src = [
      '---',
      '// component header',
      '// inline <script> drives submit',
      '---',
      '<section />',
    ].join('\n');
    const findings = lintSource(src);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].line, 3);
  });

  it('ignores literal <script> inside the component body (outside frontmatter)', () => {
    const src = ['---', '// clean comment', '---', '<script>', 'console.log("hi");', '</script>'].join(
      '\n',
    );
    assert.deepEqual(lintSource(src), []);
  });
});

describe('walkAstroFiles', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lint-astro-frontmatter-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('yields every .astro file under the root, sorted', () => {
    mkdirSync(join(root, 'sub'), { recursive: true });
    writeFileSync(join(root, 'a.astro'), '---\n---\n');
    writeFileSync(join(root, 'sub', 'b.astro'), '---\n---\n');
    writeFileSync(join(root, 'sub', 'c.tsx'), 'export {}');
    const files = walkAstroFiles(root);
    assert.equal(files.length, 2);
    assert.ok(files[0].endsWith('a.astro'));
    assert.ok(files[1].endsWith('b.astro'));
  });

  it('skips node_modules', () => {
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'evil.astro'), '---\n---\n');
    writeFileSync(join(root, 'real.astro'), '---\n---\n');
    const files = walkAstroFiles(root);
    assert.equal(files.length, 1);
    assert.ok(files[0].endsWith('real.astro'));
  });
});

describe('runLint', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'lint-astro-frontmatter-runlint-'));
    mkdirSync(join(root, 'apps', 'web', 'src', 'components'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns empty findings on a clean tree', () => {
    writeFileSync(
      join(root, 'apps', 'web', 'src', 'components', 'Clean.astro'),
      ['---', '// just a comment', '---', '<section />'].join('\n'),
    );
    const result = runLint(root);
    assert.equal(result.filesScanned, 1);
    assert.deepEqual(result.findings, []);
  });

  it('reports findings with relative paths in POSIX form', () => {
    writeFileSync(
      join(root, 'apps', 'web', 'src', 'components', 'Dirty.astro'),
      ['---', '// inline <script> drives submit', '---', '<section />'].join('\n'),
    );
    const result = runLint(root);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].path, 'apps/web/src/components/Dirty.astro');
    assert.equal(result.findings[0].line, 2);
  });

  it('returns empty when apps/web/src is absent', () => {
    rmSync(join(root, 'apps'), { recursive: true, force: true });
    const result = runLint(root);
    assert.equal(result.filesScanned, 0);
    assert.deepEqual(result.findings, []);
  });
});
