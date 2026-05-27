// apps/web/src/components/admin/CsvMappingTool.test.ts
//
// Unit tests for the pure helpers behind the admin CSV import page
// (Epic #10 / Story #663 / Task #689). The .astro shell is exercised
// end-to-end by the acceptance scenario (Task #686) — here we pin the
// build-payload + mapping-complete invariants in isolation so a typo
// in the gating logic surfaces at the unit tier rather than the
// browser tier.

import { describe, expect, it } from 'vitest';
import {
  buildErrorReportCsv,
  emptyState,
  escapeCsvCell,
  formatStatus,
  isMappingComplete,
  tryBuildCommitPayload,
} from './CsvMappingTool';

describe('isMappingComplete', () => {
  it('returns false on the empty mapping', () => {
    expect(isMappingComplete({})).toBe(false);
  });

  it('returns false when a required target is missing', () => {
    expect(isMappingComplete({ a: 'email', b: 'firstName' })).toBe(false);
  });

  it('returns true when every required target is mapped', () => {
    expect(isMappingComplete({ a: 'email', b: 'firstName', c: 'lastName' })).toBe(true);
  });

  it('ignores headers explicitly mapped to null', () => {
    expect(
      isMappingComplete({
        a: 'email',
        b: 'firstName',
        c: 'lastName',
        d: null,
      }),
    ).toBe(true);
  });
});

describe('tryBuildCommitPayload', () => {
  it('returns null when no file has been parsed', () => {
    expect(tryBuildCommitPayload(emptyState())).toBeNull();
  });

  it('returns null when the mapping is incomplete', () => {
    const state = {
      ...emptyState(),
      parse: { headers: ['a'], previewRows: [] },
      fileBase64: 'AA==',
      fileName: 'roster.csv',
      mapping: { a: 'email' as const },
    };
    expect(tryBuildCommitPayload(state)).toBeNull();
  });

  it('returns null when the filename has not been captured', () => {
    const state = {
      ...emptyState(),
      parse: { headers: ['a', 'b', 'c'], previewRows: [] },
      fileBase64: 'AA==',
      mapping: {
        a: 'email' as const,
        b: 'firstName' as const,
        c: 'lastName' as const,
      },
    };
    expect(tryBuildCommitPayload(state)).toBeNull();
  });

  it('returns the JSON payload when state is ready', () => {
    const state = {
      ...emptyState(),
      parse: { headers: ['a', 'b', 'c'], previewRows: [] },
      fileBase64: 'AA==',
      fileName: 'roster.csv',
      mapping: {
        a: 'email' as const,
        b: 'firstName' as const,
        c: 'lastName' as const,
      },
    };
    expect(tryBuildCommitPayload(state)).toEqual({
      fileBase64: 'AA==',
      fileName: 'roster.csv',
      mapping: { a: 'email', b: 'firstName', c: 'lastName' },
    });
  });
});

describe('escapeCsvCell', () => {
  it('returns the input unchanged when no special characters are present', () => {
    expect(escapeCsvCell('hello')).toBe('hello');
  });

  it('quotes and escapes embedded quotes', () => {
    expect(escapeCsvCell('a"b')).toBe('"a""b"');
  });

  it('quotes cells containing commas', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
  });

  it('quotes cells containing newlines', () => {
    expect(escapeCsvCell('a\nb')).toBe('"a\nb"');
  });
});

describe('buildErrorReportCsv', () => {
  it('emits only the header row when the error list is empty', () => {
    expect(buildErrorReportCsv([])).toBe('row,field,code,cellValue\n');
  });

  it('renders one CSV line per row error, 1-based row numbering', () => {
    const csv = buildErrorReportCsv([
      { rowIndex: 0, code: 'EMAIL_INVALID', field: 'email', cellValue: 'not-an-email' },
      { rowIndex: 1, code: 'MISSING_REQUIRED_VALUE', field: 'firstName', cellValue: '' },
    ]);
    expect(csv).toBe(
      'row,field,code,cellValue\n' +
        '1,email,EMAIL_INVALID,not-an-email\n' +
        '2,firstName,MISSING_REQUIRED_VALUE,\n',
    );
  });

  it('blanks the row column for mapping-level errors (rowIndex < 0)', () => {
    const csv = buildErrorReportCsv([
      { rowIndex: -1, code: 'MISSING_REQUIRED_COLUMN', field: 'lastName' },
    ]);
    expect(csv).toBe('row,field,code,cellValue\n,lastName,MISSING_REQUIRED_COLUMN,\n');
  });

  it('escapes cell values that contain commas or quotes', () => {
    const csv = buildErrorReportCsv([
      { rowIndex: 0, code: 'EMAIL_INVALID', field: 'email', cellValue: 'a,"b' },
    ]);
    expect(csv).toBe('row,field,code,cellValue\n1,email,EMAIL_INVALID,"a,""b"\n');
  });
});

describe('formatStatus', () => {
  it('summarises imported / reused / failed counts', () => {
    expect(formatStatus({ rowCount: 5, successCount: 5, reusedCount: 2, errorCount: 0 })).toBe(
      'Imported 5 of 5 rows. Reused 2 existing accounts. 0 errors.',
    );
  });
});
