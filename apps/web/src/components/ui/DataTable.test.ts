// apps/web/src/components/ui/DataTable.test.ts
//
// Unit tests for the shared DataTable primitive. Targets the pure
// `buildDataTable` builder that the `.astro` sibling renders; the web
// workspace's Vitest project runs in a node environment with no
// JSX/Astro renderer, so the builder is the testable surface that
// describes the rendered DOM shape (column→header projection, the
// empty-state branch, and the pagination-slot wiring).
//
// Story #843 / Task #853 — Epic #828 admin-surface restyle.
import { describe, expect, it } from 'vitest';
import {
  DATA_TABLE_TEST_IDS,
  type DataTableProps,
  buildDataTable,
} from './DataTable';

const baseColumns: DataTableProps['columns'] = [
  { key: 'name', label: 'Name' },
  { key: 'team', label: 'Team' },
  { key: 'count', label: 'Verified', align: 'end' },
];

describe('buildDataTable — columns → header projection', () => {
  it('projects every column into a header cell in the declared order', () => {
    const view = buildDataTable({ columns: baseColumns });
    expect(view.headers).toHaveLength(3);
    expect(view.headers[0]!.key).toBe('name');
    expect(view.headers[1]!.key).toBe('team');
    expect(view.headers[2]!.key).toBe('count');
  });

  it('returns each column label verbatim', () => {
    const view = buildDataTable({ columns: baseColumns });
    expect(view.headers.map((h) => h.label)).toEqual(['Name', 'Team', 'Verified']);
  });

  it('defaults the column alignment to start when not specified', () => {
    const view = buildDataTable({ columns: baseColumns });
    expect(view.headers[0]!.align).toBe('start');
    expect(view.headers[0]!.thClass).toContain('text-left');
  });

  it('honors an explicit end alignment on a numeric column', () => {
    const view = buildDataTable({ columns: baseColumns });
    expect(view.headers[2]!.align).toBe('end');
    expect(view.headers[2]!.thClass).toContain('text-right');
  });

  it('honors an explicit center alignment when supplied', () => {
    const view = buildDataTable({
      columns: [{ key: 'status', label: 'Status', align: 'center' }],
    });
    expect(view.headers[0]!.align).toBe('center');
    expect(view.headers[0]!.thClass).toContain('text-center');
  });

  it('trims label whitespace defensively', () => {
    const view = buildDataTable({
      columns: [{ key: 'name', label: '  Name  ' }],
    });
    expect(view.headers[0]!.label).toBe('Name');
  });

  it('throws TypeError when columns is empty', () => {
    expect(() => buildDataTable({ columns: [] })).toThrow(TypeError);
  });

  it('throws TypeError when a column key is empty', () => {
    expect(() =>
      buildDataTable({ columns: [{ key: '   ', label: 'Name' }] }),
    ).toThrow(TypeError);
  });

  it('throws TypeError when a column label is empty', () => {
    expect(() =>
      buildDataTable({ columns: [{ key: 'name', label: '   ' }] }),
    ).toThrow(TypeError);
  });

  it('throws TypeError when two columns share the same key', () => {
    expect(() =>
      buildDataTable({
        columns: [
          { key: 'name', label: 'Name' },
          { key: 'name', label: 'Other' },
        ],
      }),
    ).toThrow(TypeError);
  });

  it('exposes the canonical data-testids for root, table, header, and pagination', () => {
    const view = buildDataTable({ columns: baseColumns });
    expect(view.testIds.root).toBe(DATA_TABLE_TEST_IDS.root);
    expect(view.testIds.table).toBe(DATA_TABLE_TEST_IDS.table);
    expect(view.testIds.header).toBe(DATA_TABLE_TEST_IDS.header);
    expect(view.testIds.pagination).toBe(DATA_TABLE_TEST_IDS.pagination);
  });

  it('honors a caller-supplied testId override on the root', () => {
    const view = buildDataTable({ columns: baseColumns, testId: 'admin-roster-table' });
    expect(view.testIds.root).toBe('admin-roster-table');
  });

  it('defaults the tbody testid to null when no override is provided', () => {
    const view = buildDataTable({ columns: baseColumns });
    expect(view.testIds.tbody).toBeNull();
  });

  it('honors a caller-supplied tbodyTestId override', () => {
    const view = buildDataTable({
      columns: baseColumns,
      tbodyTestId: 'admin-roster-tbody',
    });
    expect(view.testIds.tbody).toBe('admin-roster-tbody');
  });
});

describe('buildDataTable — empty-state branch', () => {
  it('does not flag the empty branch when rows are slotted in', () => {
    const view = buildDataTable(
      { columns: baseColumns, empty: { title: 'Nothing yet' } },
      { hasRows: true },
    );
    expect(view.showEmptyBranch).toBe(false);
    expect(view.hasRows).toBe(true);
  });

  it('flags the empty branch when no rows are slotted in and empty is supplied', () => {
    const view = buildDataTable(
      { columns: baseColumns, empty: { title: 'Nothing yet' } },
      { hasRows: false },
    );
    expect(view.showEmptyBranch).toBe(true);
  });

  it('does not flag the empty branch when no rows are slotted in and empty is omitted', () => {
    const view = buildDataTable({ columns: baseColumns }, { hasRows: false });
    expect(view.showEmptyBranch).toBe(false);
    expect(view.empty).toBeNull();
  });

  it('exposes the empty title verbatim', () => {
    const view = buildDataTable({
      columns: baseColumns,
      empty: { title: 'No athletes to show.' },
    });
    expect(view.empty?.title).toBe('No athletes to show.');
  });

  it('exposes the empty body when supplied', () => {
    const view = buildDataTable({
      columns: baseColumns,
      empty: { title: 'No athletes to show.', body: 'Adjust the filters above.' },
    });
    expect(view.empty?.body).toBe('Adjust the filters above.');
  });

  it('collapses a whitespace-only body back to undefined', () => {
    const view = buildDataTable({
      columns: baseColumns,
      empty: { title: 'No athletes to show.', body: '   ' },
    });
    expect(view.empty?.body).toBeUndefined();
  });

  it('throws TypeError when empty.title is empty or whitespace-only', () => {
    expect(() =>
      buildDataTable({ columns: baseColumns, empty: { title: '   ' } }),
    ).toThrow(TypeError);
  });
});

describe('buildDataTable — pagination-slot wiring', () => {
  it('flags hasPagination true when the caller signals the pagination slot is present', () => {
    const view = buildDataTable({ columns: baseColumns }, { hasPagination: true });
    expect(view.hasPagination).toBe(true);
  });

  it('keeps hasPagination false when the option flag is omitted', () => {
    const view = buildDataTable({ columns: baseColumns }, {});
    expect(view.hasPagination).toBe(false);
  });

  it('emits a pagination class that right-aligns content on desktop', () => {
    const view = buildDataTable({ columns: baseColumns }, { hasPagination: true });
    expect(view.paginationClass).toContain('sm:justify-end');
    expect(view.paginationClass).toContain('flex');
  });

  it('exposes pagination-slot wiring independently of the empty branch', () => {
    // A surface can offer pagination AND a row-empty fallback in the
    // same render — for example the admin roster fires both when a
    // filter returns no rows but the cursor is still active.
    const view = buildDataTable(
      { columns: baseColumns, empty: { title: 'No athletes to show.' } },
      { hasRows: false, hasPagination: true },
    );
    expect(view.showEmptyBranch).toBe(true);
    expect(view.hasPagination).toBe(true);
  });
});

describe('buildDataTable — class composition', () => {
  it('merges author-supplied extra classes through cn on the wrapper', () => {
    const view = buildDataTable({ columns: baseColumns, class: 'mt-6' });
    expect(view.rootClass).toContain('mt-6');
  });

  it('keeps the canonical wrapper layout classes (rounded border on surface-card)', () => {
    const view = buildDataTable({ columns: baseColumns });
    expect(view.rootClass).toContain('rounded-xl');
    expect(view.rootClass).toContain('border');
    expect(view.rootClass).toContain('border-border');
    expect(view.rootClass).toContain('bg-surface-card');
  });
});
