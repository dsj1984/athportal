// scripts/migration-label-guard.test.mjs
//
// Unit tests for the destructive-migration guard logic extracted from
// .github/workflows/migration-label-guard.yml. Locks the predicate, the
// destructive-clause regex set, and the label-present / label-absent
// branches against regression.

import { describe, expect, it, vi } from 'vitest';
import guard, { destructivePatterns, isMigrationFile } from './migration-label-guard.mjs';

describe('isMigrationFile', () => {
  it('matches a .sql migration under apps/api/**/migrations/**', () => {
    expect(isMigrationFile('apps/api/migrations/0001_init.sql')).toBe(true);
  });

  it('matches a .ts migration under apps/api/**/migrations/**', () => {
    expect(isMigrationFile('apps/api/src/db/migrations/0002_add_users.ts')).toBe(true);
  });

  it('rejects files outside apps/api/', () => {
    expect(isMigrationFile('apps/web/migrations/0001_init.sql')).toBe(false);
    expect(isMigrationFile('packages/shared/src/db/migrations/0001.sql')).toBe(false);
  });

  it('rejects files inside apps/api/ but not under a migrations/ segment', () => {
    expect(isMigrationFile('apps/api/src/routes/v1/users.ts')).toBe(false);
    expect(isMigrationFile('apps/api/migration/0001.sql')).toBe(false);
  });

  it('rejects non-.sql / non-.ts extensions even under migrations/', () => {
    expect(isMigrationFile('apps/api/migrations/0001.md')).toBe(false);
    expect(isMigrationFile('apps/api/migrations/journal.json')).toBe(false);
  });
});

describe('destructivePatterns', () => {
  // Index by pattern name for clarity.
  const byName = Object.fromEntries(destructivePatterns.map((p) => [p.name, p.re]));

  it('declares exactly the DROP / RENAME / NOT NULL trio', () => {
    expect(destructivePatterns.map((p) => p.name)).toEqual(['DROP', 'RENAME', 'NOT NULL']);
  });

  describe('DROP pattern', () => {
    it.each([
      ['DROP TABLE users;', true],
      ['ALTER TABLE x DROP COLUMN y;', true],
      ['DROP INDEX idx_a;', true],
      ['ALTER TABLE x DROP CONSTRAINT fk_b;', true],
      ['DROP VIEW v_users;', true],
      ['drop table users;', true],
    ])('matches: %s', (line, expected) => {
      expect(byName.DROP.test(line)).toBe(expected);
    });

    it.each([
      ['CREATE TABLE users (id int);', false],
      ['-- dropped a feature flag', false],
      ['INSERT INTO drops VALUES (1);', false],
      ['DROP nothing here', false],
    ])('does not match: %s', (line, expected) => {
      expect(byName.DROP.test(line)).toBe(expected);
    });
  });

  describe('RENAME pattern', () => {
    it.each([
      ['ALTER TABLE x RENAME TO y;', true],
      ['ALTER TABLE x RENAME COLUMN a TO b;', true],
      ['RENAME TABLE x TO y;', true],
      ['rename column a to b;', true],
    ])('matches: %s', (line, expected) => {
      expect(byName.RENAME.test(line)).toBe(expected);
    });

    it.each([
      ['CREATE TABLE x (id int);', false],
      ['-- renamed the variable in code', false],
      ['INSERT INTO renames VALUES (1);', false],
      ['RENAME without an object', false],
    ])('does not match: %s', (line, expected) => {
      expect(byName.RENAME.test(line)).toBe(expected);
    });
  });

  describe('NOT NULL pattern', () => {
    it.each([
      ['ALTER TABLE x ADD COLUMN y text NOT NULL;', true],
      ['ALTER TABLE x ADD y integer NOT NULL DEFAULT 0;', true],
      ['alter table x add column y text not null;', true],
    ])('matches: %s', (line, expected) => {
      expect(byName['NOT NULL'].test(line)).toBe(expected);
    });

    it.each([
      ['ALTER TABLE x ADD COLUMN y text;', false],
      ['CREATE TABLE x (id int NOT NULL);', false], // CREATE TABLE NOT NULL is fine; the guard only flags ADD.
      ['-- adding a NOT NULL field via app code', false],
      ['ALTER TABLE x DROP COLUMN y;', false],
    ])('does not match: %s', (line, expected) => {
      expect(byName['NOT NULL'].test(line)).toBe(expected);
    });
  });
});

// Helpers for the integration-style branch tests below. The guard takes
// the octokit-shaped `github` object, the `context` payload, and the
// actions-core surface. We provide minimal fakes that record their
// interactions so we can assert the pass/fail branch was taken.

function makeCore() {
  const events = [];
  return {
    events,
    info: vi.fn((msg) => events.push({ kind: 'info', msg })),
    startGroup: vi.fn((name) => events.push({ kind: 'startGroup', name })),
    endGroup: vi.fn(() => events.push({ kind: 'endGroup' })),
    setFailed: vi.fn((msg) => events.push({ kind: 'setFailed', msg })),
  };
}

function makeContext({ labels = [] } = {}) {
  return {
    repo: { owner: 'acme', repo: 'athportal' },
    payload: {
      pull_request: {
        number: 42,
        labels,
      },
    },
  };
}

function makeGithub(files) {
  return {
    rest: { pulls: { listFiles: 'listFiles-fn' } },
    paginate: vi.fn(async () => files),
  };
}

describe('guard (default export) — label branches', () => {
  it('passes trivially when no migration files are touched', async () => {
    const github = makeGithub([{ filename: 'apps/web/src/index.ts', patch: '+const a = 1;\n' }]);
    const core = makeCore();
    await guard(github, makeContext(), core);

    expect(github.paginate).toHaveBeenCalledOnce();
    expect(core.setFailed).not.toHaveBeenCalled();
    expect(core.info).toHaveBeenCalledWith(
      'No migration files touched in this PR — guard passes trivially.',
    );
  });

  it('passes when migration files are touched but no destructive clauses are added', async () => {
    const github = makeGithub([
      {
        filename: 'apps/api/migrations/0001_init.sql',
        patch: '+CREATE TABLE users (id integer);\n+INSERT INTO users VALUES (1);\n',
      },
    ]);
    const core = makeCore();
    await guard(github, makeContext(), core);

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(core.info).toHaveBeenCalledWith(
      'Migration files touched but no destructive clauses added — guard passes.',
    );
  });

  it('fails when destructive clauses are added and the label is absent', async () => {
    const github = makeGithub([
      {
        filename: 'apps/api/migrations/0002_drop.sql',
        patch: '+ALTER TABLE users DROP COLUMN legacy_id;\n',
      },
    ]);
    const core = makeCore();
    await guard(github, makeContext({ labels: [{ name: 'enhancement' }] }), core);

    expect(core.setFailed).toHaveBeenCalledOnce();
    const msg = core.setFailed.mock.calls[0][0];
    expect(msg).toContain('migration::destructive');
    expect(core.startGroup).toHaveBeenCalledWith('Destructive migration findings');
  });

  it('passes when destructive clauses are added but the migration::destructive label is present', async () => {
    const github = makeGithub([
      {
        filename: 'apps/api/migrations/0002_drop.sql',
        patch: '+ALTER TABLE users DROP COLUMN legacy_id;\n',
      },
    ]);
    const core = makeCore();
    await guard(github, makeContext({ labels: [{ name: 'migration::destructive' }] }), core);

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(core.info).toHaveBeenCalledWith(
      'migration::destructive label is present — guard passes.',
    );
  });

  it('treats a missing patch as a conservative finding (binary / oversized diff)', async () => {
    const github = makeGithub([
      { filename: 'apps/api/migrations/0003_blob.sql', patch: undefined },
    ]);
    const core = makeCore();
    await guard(github, makeContext({ labels: [] }), core);

    expect(core.setFailed).toHaveBeenCalledOnce();
    // The finding should record the UNKNOWN clause name.
    const groupedInfo = core.info.mock.calls.map((c) => c[0]).join('\n');
    expect(groupedInfo).toContain('UNKNOWN (no patch returned by API)');
  });

  it('ignores removed and context lines (only added lines participate)', async () => {
    const github = makeGithub([
      {
        filename: 'apps/api/migrations/0004_safe.sql',
        // The DROP appears on a removed line; the guard must not flag it.
        patch:
          '-ALTER TABLE users DROP COLUMN legacy_id;\n CONTEXT LINE WITH DROP TABLE\n+SELECT 1;\n',
      },
    ]);
    const core = makeCore();
    await guard(github, makeContext(), core);

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(core.info).toHaveBeenCalledWith(
      'Migration files touched but no destructive clauses added — guard passes.',
    );
  });

  it('ignores the +++ diff header even though it starts with "+"', async () => {
    const github = makeGithub([
      {
        filename: 'apps/api/migrations/0005_header.sql',
        patch: '+++ b/apps/api/migrations/0005_header.sql\n+SELECT 1;\n',
      },
    ]);
    const core = makeCore();
    await guard(github, makeContext(), core);

    expect(core.setFailed).not.toHaveBeenCalled();
  });
});
