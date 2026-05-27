// scripts/lint-astro-script-modules.test.mjs
//
// Unit coverage for the Astro `<script>`-bundling regression lint.
// Exercises:
//   - the rejection path (`<script lang="ts">` flagged)
//   - the acceptance path (plain `<script>` and Astro directives ignored)
//   - multi-script files and the line/column resolution
//   - the end-to-end runLint envelope against a fixture tree
//
// Pyramid tier: unit. The lint is pure (string in → findings out), so
// these tests exercise the exported helpers and `runLint` against a
// fixture tree rather than spawning the CLI binary.

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

import { lintSource, runLint, walkAstroFiles } from './lint-astro-script-modules.mjs';

describe('lintSource', () => {
  it('flags a <script lang="ts"> opening tag', () => {
    const src = ['<div />', '<script lang="ts">', '  import { x } from "./y";', '</script>'].join(
      '\n',
    );
    const findings = lintSource(src);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].line, 2);
    assert.match(findings[0].snippet, /<script lang="ts">/);
    assert.match(findings[0].attribute, /lang/);
  });

  it('flags lang="js" as well (any lang= opts out)', () => {
    const findings = lintSource('<script lang="js">\n</script>');
    assert.equal(findings.length, 1);
  });

  it('accepts a plain <script> tag', () => {
    const src = ['<script>', '  import { x } from "./y";', '</script>'].join('\n');
    assert.deepEqual(lintSource(src), []);
  });

  it('accepts Astro directives (is:inline, define:vars, is:raw)', () => {
    const srcs = [
      '<script is:inline>\nconsole.log(1)\n</script>',
      '<script define:vars={{x:1}}>\nconsole.log(x)\n</script>',
      '<script is:raw>\n// raw\n</script>',
    ];
    for (const src of srcs) {
      assert.deepEqual(lintSource(src), [], `should accept: ${src}`);
    }
  });

  it('finds multiple offenders in one file with correct line numbers', () => {
    const src = [
      '<script lang="ts">',
      'const a = 1;',
      '</script>',
      '<div />',
      '<script lang="ts">',
      'const b = 2;',
      '</script>',
    ].join('\n');
    const findings = lintSource(src);
    assert.equal(findings.length, 2);
    assert.equal(findings[0].line, 1);
    assert.equal(findings[1].line, 5);
  });

  it('ignores closing </script> tags and inline <script> mentions in strings', () => {
    const src = '<p>see &lt;script&gt; tag</p>\n<script>\nimport x from "y";\n</script>';
    assert.deepEqual(lintSource(src), []);
  });

  it('returns 1-indexed column for tags not at the line start', () => {
    const src = '  <script lang="ts">\n</script>';
    const findings = lintSource(src);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].line, 1);
    assert.equal(findings[0].column, 3);
  });
});

describe('runLint integration (fixture tree)', () => {
  let tmpRoot;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'lint-astro-script-modules-'));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  /** Write a fixture file under `apps/web/src/...` inside the tmp root. */
  function writeFixture(rel, body) {
    const full = join(tmpRoot, 'apps', 'web', 'src', rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, body);
  }

  it('returns an empty findings list on a clean fixture tree', () => {
    writeFixture('pages/clean.astro', '<script>\nimport x from "y";\n</script>');
    writeFixture('pages/inline.astro', '<script is:inline>\nconsole.log(1)\n</script>');
    const result = runLint(tmpRoot);
    assert.deepEqual(result.findings, []);
    assert.equal(result.filesScanned, 2);
  });

  it('reports findings with stable, repo-relative paths', () => {
    writeFixture('pages/bad.astro', '<script lang="ts">\nimport x from "y";\n</script>');
    const result = runLint(tmpRoot);
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].path, 'apps/web/src/pages/bad.astro');
    assert.equal(result.findings[0].line, 1);
  });

  it('handles a missing apps/web/src/ directory by returning zero findings', () => {
    const result = runLint(tmpRoot);
    assert.deepEqual(result, { findings: [], filesScanned: 0 });
  });
});

describe('walkAstroFiles', () => {
  let tmpRoot;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'walk-astro-files-'));
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('skips node_modules and .git subtrees', () => {
    mkdirSync(join(tmpRoot, 'node_modules', 'pkg'), { recursive: true });
    mkdirSync(join(tmpRoot, '.git'), { recursive: true });
    mkdirSync(join(tmpRoot, 'src'), { recursive: true });
    writeFileSync(join(tmpRoot, 'node_modules', 'pkg', 'a.astro'), '');
    writeFileSync(join(tmpRoot, '.git', 'b.astro'), '');
    writeFileSync(join(tmpRoot, 'src', 'c.astro'), '');
    const files = walkAstroFiles(tmpRoot);
    assert.equal(files.length, 1);
    assert.match(files[0], /[\\/]src[\\/]c\.astro$/);
  });
});
