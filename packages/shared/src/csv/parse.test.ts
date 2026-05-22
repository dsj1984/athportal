/**
 * @repo/shared/csv/parse — unit tests.
 *
 * Epic #10 / Story #663 / Task #690. Pins the four scenarios called
 * out in the Task ACs:
 *
 *   1. Empty file → empty headers / empty preview (parseCsv) and
 *      `EMPTY_FILE` error (resolveRows).
 *   2. Missing required column in mapping → `MISSING_REQUIRED_COLUMN`.
 *   3. Unmappable row (cell count < header count) → `UNMAPPABLE_ROW`.
 *   4. Happy path of 5 data rows with a 4-column mapping →
 *      `rows.length === 5`, `errors.length === 0`.
 *
 * Plus a handful of pin-tests for the parser's edge behaviour:
 * UTF-8 BOM, CRLF line endings, quoted commas, escaped quotes.
 */

import { describe, expect, it } from 'vitest';
import { PREVIEW_ROW_COUNT, parseCsv, resolveRows } from './parse';

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe('parseCsv', () => {
  it('returns empty headers and preview for an empty file', () => {
    const result = parseCsv(bytes(''));
    expect(result.headers).toEqual([]);
    expect(result.previewRows).toEqual([]);
  });

  it('returns empty headers for a whitespace-only file', () => {
    const result = parseCsv(bytes('   \n\n  '));
    expect(result.headers).toEqual([]);
    expect(result.previewRows).toEqual([]);
  });

  it('returns headers and trimmed preview rows', () => {
    const csv = ['email,firstName,lastName', 'a@x.com,Ada,Lovelace', 'b@x.com,Bob,Smith'].join(
      '\n',
    );
    const result = parseCsv(bytes(csv));
    expect(result.headers).toEqual(['email', 'firstName', 'lastName']);
    expect(result.previewRows).toEqual([
      ['a@x.com', 'Ada', 'Lovelace'],
      ['b@x.com', 'Bob', 'Smith'],
    ]);
  });

  it('caps the preview at PREVIEW_ROW_COUNT rows', () => {
    const rows = Array.from({ length: PREVIEW_ROW_COUNT + 5 }, (_, i) => `e${i}@x.com,F${i},L${i}`);
    const csv = ['email,firstName,lastName', ...rows].join('\n');
    const result = parseCsv(bytes(csv));
    expect(result.previewRows.length).toBe(PREVIEW_ROW_COUNT);
  });

  it('handles CRLF line endings', () => {
    const csv = 'email,firstName,lastName\r\na@x.com,Ada,Lovelace\r\n';
    const result = parseCsv(bytes(csv));
    expect(result.headers).toEqual(['email', 'firstName', 'lastName']);
    expect(result.previewRows).toEqual([['a@x.com', 'Ada', 'Lovelace']]);
  });

  it('strips a UTF-8 BOM from the header row', () => {
    const csv = '﻿email,firstName,lastName\na@x.com,Ada,Lovelace';
    const result = parseCsv(bytes(csv));
    expect(result.headers[0]).toBe('email');
  });

  it('parses quoted fields containing commas', () => {
    const csv = ['email,fullName', 'a@x.com,"Lovelace, Ada"'].join('\n');
    const result = parseCsv(bytes(csv));
    expect(result.previewRows).toEqual([['a@x.com', 'Lovelace, Ada']]);
  });

  it('parses escaped double-quotes inside quoted fields', () => {
    const csv = ['email,note', 'a@x.com,"She said ""hi"""'].join('\n');
    const result = parseCsv(bytes(csv));
    expect(result.previewRows).toEqual([['a@x.com', 'She said "hi"']]);
  });
});

describe('resolveRows', () => {
  it('returns EMPTY_FILE for an empty buffer', () => {
    const result = resolveRows(bytes(''), { email: 'email' });
    expect(result.rows).toEqual([]);
    expect(result.errors).toEqual([{ rowIndex: -1, code: 'EMPTY_FILE' }]);
  });

  it('returns MISSING_REQUIRED_COLUMN when mapping omits a required target', () => {
    const csv = ['email,firstName', 'a@x.com,Ada'].join('\n');
    // mapping omits lastName
    const mapping = { email: 'email', firstName: 'firstName' };
    const result = resolveRows(bytes(csv), mapping);
    expect(result.rows).toEqual([]);
    expect(result.errors).toContainEqual({
      rowIndex: -1,
      code: 'MISSING_REQUIRED_COLUMN',
      field: 'lastName',
    });
  });

  it('returns UNMAPPABLE_ROW when a data row is shorter than the header row', () => {
    // 3-column header, second row only has 2 cells.
    const csv = ['email,firstName,lastName', 'a@x.com,Ada,Lovelace', 'b@x.com,Bob'].join('\n');
    const mapping = { email: 'email', firstName: 'firstName', lastName: 'lastName' };
    const result = resolveRows(bytes(csv), mapping);
    expect(result.rows.length).toBe(1);
    expect(result.errors).toContainEqual({ rowIndex: 1, code: 'UNMAPPABLE_ROW' });
  });

  it('returns MISSING_REQUIRED_VALUE when a required cell is blank', () => {
    const csv = ['email,firstName,lastName', 'a@x.com,,Lovelace'].join('\n');
    const mapping = { email: 'email', firstName: 'firstName', lastName: 'lastName' };
    const result = resolveRows(bytes(csv), mapping);
    expect(result.rows).toEqual([]);
    expect(result.errors).toContainEqual({
      rowIndex: 0,
      code: 'MISSING_REQUIRED_VALUE',
      field: 'firstName',
    });
  });

  it('happy path: 5 rows with a 4-column mapping resolves to 5 rows, 0 errors', () => {
    const rows = Array.from({ length: 5 }, (_, i) => `e${i}@x.com,F${i},L${i},Team ${i % 2}`);
    const csv = ['email_col,first_col,last_col,team_col', ...rows].join('\n');
    const mapping = {
      email_col: 'email',
      first_col: 'firstName',
      last_col: 'lastName',
      team_col: 'teamName',
    };
    const result = resolveRows(bytes(csv), mapping);
    expect(result.errors).toEqual([]);
    expect(result.rows.length).toBe(5);
    expect(result.rows[0]).toEqual({
      email: 'e0@x.com',
      firstName: 'F0',
      lastName: 'L0',
      teamName: 'Team 0',
    });
  });

  it('ignores headers mapped to null', () => {
    const csv = ['email,firstName,lastName,ignored', 'a@x.com,Ada,Lovelace,junk'].join('\n');
    const mapping = {
      email: 'email',
      firstName: 'firstName',
      lastName: 'lastName',
      ignored: null,
    };
    const result = resolveRows(bytes(csv), mapping);
    expect(result.errors).toEqual([]);
    expect(result.rows[0]).not.toHaveProperty('ignored');
  });
});
