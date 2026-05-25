// scripts/lint-orphan-bem.test.mjs
//
// Unit coverage for the orphan-BEM lint. Exercises each of the four
// resolver paths declared in ADR-0007 (colocated <style>, global.css,
// cva variant, colocated <script>) plus the unresolved/orphan path
// that gates CI. The fixtures are constructed in-memory and a
// tmpdir tree so the test does not depend on the live repo's state.
//
// Pyramid tier: unit. The lint script is pure (string in → findings
// out), so the tests exercise the exported helpers and `runLint`
// against a fixture tree rather than spawning the CLI binary.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import {
  collectColocatedStyleClasses,
  collectCvaClasses,
  collectGlobalCssClasses,
  collectScriptReferences,
  extractBemCandidates,
  extractClassAttributes,
  findOrphans,
  loadAllowlist,
  runLint,
  stripScriptAndStyle,
} from './lint-orphan-bem.mjs';

describe('extractClassAttributes', () => {
  it('captures every quoted class attribute and its line number', () => {
    const src = [
      '<section class="empty-state">',
      '  <h3 class="empty-state__title">Title</h3>',
      '  <p class="empty-state__body">Body</p>',
      '</section>',
    ].join('\n');
    const attrs = extractClassAttributes(src);
    assert.equal(attrs.length, 3);
    assert.deepEqual(attrs[0], { value: 'empty-state', line: 1 });
    assert.deepEqual(attrs[1], { value: 'empty-state__title', line: 2 });
    assert.deepEqual(attrs[2], { value: 'empty-state__body', line: 3 });
  });

  it('handles JSX className= and Astro class:list= forms', () => {
    const src = `<div className="a__b">x</div>\n<span class:list="c__d">y</span>`;
    const attrs = extractClassAttributes(src);
    assert.equal(attrs.length, 2);
    assert.equal(attrs[0].value, 'a__b');
    assert.equal(attrs[1].value, 'c__d');
  });
});

describe('extractBemCandidates', () => {
  it('emits block-element class names', () => {
    const out = extractBemCandidates([{ value: 'foo__bar baz', line: 1 }]);
    assert.deepEqual(out, [{ name: 'foo__bar', line: 1 }]);
  });

  it('emits modifier class names', () => {
    const out = extractBemCandidates([{ value: 'foo--active', line: 2 }]);
    assert.deepEqual(out, [{ name: 'foo--active', line: 2 }]);
  });

  it('does not match plain Tailwind utility classes', () => {
    const out = extractBemCandidates([
      { value: 'rounded-xl border border-border bg-surface-card p-6', line: 1 },
    ]);
    assert.equal(out.length, 0);
  });

  it('does not match Tailwind state/variant utilities with single dashes', () => {
    const out = extractBemCandidates([{ value: 'hover:bg-brand focus-visible:ring-2', line: 1 }]);
    assert.equal(out.length, 0);
  });

  it('de-duplicates repeats and keeps the lowest line number', () => {
    const out = extractBemCandidates([
      { value: 'foo__bar', line: 7 },
      { value: 'foo__bar', line: 3 },
    ]);
    assert.deepEqual(out, [{ name: 'foo__bar', line: 3 }]);
  });
});

describe('stripScriptAndStyle', () => {
  it('removes <style> blocks so their selectors are not class attributes', () => {
    const src = `<div class="real">x</div>\n<style>.fake__hook { color: red; }</style>`;
    const stripped = stripScriptAndStyle(src);
    assert.ok(stripped.includes('class="real"'));
    assert.ok(!stripped.includes('fake__hook'));
  });

  it('removes <script> blocks so their string literals are not class attributes', () => {
    const src = `<div class="real">x</div>\n<script>document.querySelector('.fake__hook')</script>`;
    const stripped = stripScriptAndStyle(src);
    assert.ok(stripped.includes('class="real"'));
    assert.ok(!stripped.includes('fake__hook'));
  });
});

describe('collectColocatedStyleClasses', () => {
  it('collects class names declared by a <style> block', () => {
    const src = `<style>\n.foo__bar { color: red; }\n.baz--active { font-weight: 700; }\n</style>`;
    const out = collectColocatedStyleClasses(src);
    assert.ok(out.has('foo__bar'));
    assert.ok(out.has('baz--active'));
  });
});

describe('collectScriptReferences', () => {
  it('collects BEM class names referenced as CSS selectors in <script>', () => {
    const src = `<script>const el = document.querySelector('.foo__bar');</script>`;
    const out = collectScriptReferences(src);
    assert.ok(out.has('foo__bar'));
  });

  it('collects BEM class names passed to classList helpers', () => {
    const src = `<script>el.classList.add('foo--open');</script>`;
    const out = collectScriptReferences(src);
    assert.ok(out.has('foo--open'));
  });
});

describe('collectGlobalCssClasses', () => {
  it('pulls class names out of arbitrary CSS', () => {
    const css = `.foo__bar { color: red } .nope, .baz--active { color: blue }`;
    const out = collectGlobalCssClasses(css);
    assert.ok(out.has('foo__bar'));
    assert.ok(out.has('baz--active'));
  });
});

describe('findOrphans (resolver paths)', () => {
  const baseContext = {
    globalCssClasses: new Set(['from-global__hook']),
    cvaClasses: new Set(['from-cva__variant']),
  };

  it('resolves a class via a colocated <style> block', () => {
    const source = `<div class="comp__title">x</div>\n<style>.comp__title { color: red }</style>`;
    const out = findOrphans({
      source,
      context: baseContext,
      allowedForFile: new Set(),
    });
    assert.equal(out.length, 0);
  });

  it('resolves a class via a cva variant in an imported primitive', () => {
    const source = `<div class="from-cva__variant">x</div>`;
    const out = findOrphans({
      source,
      context: baseContext,
      allowedForFile: new Set(),
    });
    assert.equal(out.length, 0);
  });

  it('resolves a class via global.css', () => {
    const source = `<div class="from-global__hook">x</div>`;
    const out = findOrphans({
      source,
      context: baseContext,
      allowedForFile: new Set(),
    });
    assert.equal(out.length, 0);
  });

  it('resolves a class via a colocated <script> JS hook', () => {
    const source = `<ul class="list__rows"></ul>\n<script>document.querySelector('.list__rows');</script>`;
    const out = findOrphans({
      source,
      context: baseContext,
      allowedForFile: new Set(),
    });
    assert.equal(out.length, 0);
  });

  it('reports an unresolved class as orphan with file line number', () => {
    const source = ['<div>', '  <span class="orphan__hook">x</span>', '</div>'].join('\n');
    const out = findOrphans({
      source,
      context: baseContext,
      allowedForFile: new Set(),
    });
    assert.deepEqual(out, [{ class: 'orphan__hook', line: 2 }]);
  });

  it('honors a per-file allowlist entry', () => {
    const source = `<div class="legacy__hook">x</div>`;
    const out = findOrphans({
      source,
      context: baseContext,
      allowedForFile: new Set(['legacy__hook']),
    });
    assert.equal(out.length, 0);
  });
});

describe('runLint (integration against tmpdir fixture)', () => {
  let dir;
  let webSrcRoot;
  let globalCssPath;
  let primitivesRoot;
  let allowlistPath;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lint-orphan-bem-'));
    webSrcRoot = join(dir, 'apps', 'web', 'src');
    primitivesRoot = join(webSrcRoot, 'components', 'ui');
    mkdirSync(primitivesRoot, { recursive: true });
    mkdirSync(join(webSrcRoot, 'pages'), { recursive: true });
    mkdirSync(join(webSrcRoot, 'styles'), { recursive: true });
    globalCssPath = join(webSrcRoot, 'styles', 'global.css');
    allowlistPath = join(dir, '.lint-orphan-bem-allowlist.json');
    writeFileSync(globalCssPath, '.token-from__global { color: red; }', 'utf8');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('exits clean when every BEM class resolves', () => {
    writeFileSync(
      join(webSrcRoot, 'pages', 'ok.astro'),
      `<div class="token-from__global">x</div>`,
      'utf8',
    );
    const findings = runLint({
      webSrcRoot,
      globalCssPath,
      primitivesRoot,
      allowlistPath,
      repoRoot: dir,
    });
    assert.deepEqual(findings, []);
  });

  it('reports orphan BEM classes with path, line, and class', () => {
    writeFileSync(
      join(webSrcRoot, 'pages', 'orphan.astro'),
      [
        '---',
        'const x = 1;',
        '---',
        '<div class="legit-utility">',
        '  <span class="surprise__hook">x</span>',
        '</div>',
      ].join('\n'),
      'utf8',
    );
    const findings = runLint({
      webSrcRoot,
      globalCssPath,
      primitivesRoot,
      allowlistPath,
      repoRoot: dir,
    });
    assert.equal(findings.length, 1);
    assert.equal(findings[0].class, 'surprise__hook');
    assert.equal(findings[0].line, 5);
    assert.equal(findings[0].path, 'apps/web/src/pages/orphan.astro');
  });

  it('skips .test.ts(x) files', () => {
    writeFileSync(
      join(webSrcRoot, 'pages', 'noise.test.tsx'),
      `export const x = '<div className="surprise__hook"/>'`,
      'utf8',
    );
    const findings = runLint({
      webSrcRoot,
      globalCssPath,
      primitivesRoot,
      allowlistPath,
      repoRoot: dir,
    });
    assert.deepEqual(findings, []);
  });

  it('uses the allowlist when present', () => {
    writeFileSync(
      join(webSrcRoot, 'pages', 'legacy.astro'),
      `<div class="legacy__hook">x</div>`,
      'utf8',
    );
    writeFileSync(
      allowlistPath,
      JSON.stringify(
        {
          entries: [
            {
              path: 'apps/web/src/pages/legacy.astro',
              classes: ['legacy__hook'],
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );
    const findings = runLint({
      webSrcRoot,
      globalCssPath,
      primitivesRoot,
      allowlistPath,
      repoRoot: dir,
    });
    assert.deepEqual(findings, []);
  });
});

describe('loadAllowlist', () => {
  it('returns an empty entries map when the file does not exist', () => {
    const out = loadAllowlist(join(tmpdir(), 'does-not-exist.json'));
    assert.equal(out.entries.size, 0);
  });
});

describe('collectCvaClasses', () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'lint-cva-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns an empty set when the primitives root does not exist', () => {
    const out = collectCvaClasses(join(dir, 'does-not-exist'));
    assert.equal(out.size, 0);
  });

  it('pulls BEM-shaped string literals out of .ts builders', () => {
    writeFileSync(
      join(dir, 'Foo.ts'),
      `export const cls = cva('base', { variants: { kind: { primary: 'foo__variant' } } });`,
      'utf8',
    );
    const out = collectCvaClasses(dir);
    assert.ok(out.has('foo__variant'));
  });

  it('does not scan .test.ts siblings', () => {
    writeFileSync(join(dir, 'Bar.test.ts'), `expect(x).toBe('bar__only-in-test');`, 'utf8');
    const out = collectCvaClasses(dir);
    assert.ok(!out.has('bar__only-in-test'));
  });
});
