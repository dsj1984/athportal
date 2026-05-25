// apps/web/src/components/ui/DataTable.ts
//
// Pure-TS view-shape builder for the shared DataTable primitive. The
// `.astro` sibling renders the `<table>` chrome (header row built from
// `columns`, default slot for `<tr>` rows, `pagination` slot for the
// trailing button row), and falls back to the EmptyState primitive
// when the rows slot is empty and an `empty` prop is supplied.
//
// Why split? The web workspace's Vitest project runs in a `node`
// environment with no JSX/Astro renderer, so the testable surface is
// the pure-TS builder that shapes the columns and class strings the
// `.astro` consumes. Mirrors the EmptyState / FormField / PageHeader
// convention (ADR-0007: docs/decisions/0007-ui-styling-convention.md).
//
// Story #843 / Task #853 — Epic #828 admin-surface restyle.

import { cn } from './_lib/cn';

/** Alignment for a column header / cell. */
export type DataTableColumnAlign = 'start' | 'end' | 'center';

/** One column descriptor. `key` is also the row's slot-data identity. */
export interface DataTableColumn {
  readonly key: string;
  readonly label: string;
  readonly align?: DataTableColumnAlign;
}

/** Optional empty-state branch shown when no rows are slotted in. */
export interface DataTableEmpty {
  readonly title: string;
  readonly body?: string;
}

/** Public props for the DataTable primitive. */
export interface DataTableProps {
  readonly columns: ReadonlyArray<DataTableColumn>;
  readonly empty?: DataTableEmpty;
  /** Optional override for the root data-testid. */
  readonly testId?: string;
  /**
   * Optional override for the `<tbody>` data-testid. Surfaces a stable
   * selector for client-side row renderers (the admin roster and the
   * verified-achievement report each populate rows from a fetch and
   * target a per-section tbody testid).
   */
  readonly tbodyTestId?: string;
  /** Optional extra classes for the outer wrapper, merged through `cn`. */
  readonly class?: string;
}

/** Canonical data-testid values exposed by the primitive. */
export const DATA_TABLE_TEST_IDS = {
  root: 'data-table',
  table: 'data-table-table',
  header: 'data-table-header',
  pagination: 'data-table-pagination',
} as const;

/** Rendered header cell, shaped for the `.astro` `<th>` map. */
export interface DataTableHeaderCell {
  readonly key: string;
  readonly label: string;
  readonly align: DataTableColumnAlign;
  readonly thClass: string;
}

/**
 * Render-time view of a DataTable. Mirrors the markup `DataTable.astro`
 * emits so the unit tier asserts against the same surface shape the
 * page renders.
 */
export interface DataTableView {
  readonly headers: ReadonlyArray<DataTableHeaderCell>;
  readonly empty: DataTableEmpty | null;
  readonly hasRows: boolean;
  readonly hasPagination: boolean;
  readonly showEmptyBranch: boolean;
  readonly rootClass: string;
  readonly tableClass: string;
  readonly theadClass: string;
  readonly tbodyClass: string;
  readonly paginationClass: string;
  readonly testIds: {
    readonly root: string;
    readonly table: string;
    readonly header: string;
    readonly tbody: string | null;
    readonly pagination: string;
  };
}

const ALIGN_CLASS: Record<DataTableColumnAlign, string> = {
  start: 'text-left',
  end: 'text-right',
  center: 'text-center',
};

/**
 * Shape DataTable's props into the render-ready view. Validates that
 * `columns` is non-empty, that every `key` is non-empty and unique, and
 * that every `label` is non-empty. Empty-state copy is trimmed
 * defensively; an empty body is collapsed to `undefined`. The caller
 * supplies `hasRows` (the default slot renders rows? — detected via
 * `Astro.slots.has('default')`) and `hasPagination` (the `pagination`
 * slot is present?) so the empty-state branch and pagination row can
 * be exercised in unit tests without a renderer.
 *
 * Throws a `TypeError` on invalid input so authoring mistakes fail
 * loudly at the call site rather than rendering a malformed table.
 */
export function buildDataTable(
  props: DataTableProps,
  options: { hasRows?: boolean; hasPagination?: boolean } = {},
): DataTableView {
  if (!Array.isArray(props.columns) || props.columns.length === 0) {
    throw new TypeError('DataTable: `columns` must be a non-empty array.');
  }

  const seenKeys = new Set<string>();
  const headers: DataTableHeaderCell[] = props.columns.map((column, index) => {
    const key = column.key?.trim() ?? '';
    if (key.length === 0) {
      throw new TypeError(
        `DataTable: column at index ${index} has an empty \`key\`; every column must declare a non-empty key.`,
      );
    }
    if (seenKeys.has(key)) {
      throw new TypeError(
        `DataTable: duplicate column key "${key}"; every column key must be unique.`,
      );
    }
    seenKeys.add(key);

    const label = column.label?.trim() ?? '';
    if (label.length === 0) {
      throw new TypeError(
        `DataTable: column "${key}" has an empty \`label\`; every column must declare a non-empty label.`,
      );
    }
    const align: DataTableColumnAlign = column.align ?? 'start';
    return {
      key,
      label,
      align,
      thClass: cn(
        'px-3 py-2 font-display text-xs font-semibold uppercase tracking-wide text-text-secondary',
        ALIGN_CLASS[align],
      ),
    };
  });

  const empty = normalizeEmpty(props.empty);
  const hasRows = options.hasRows === true;
  const hasPagination = options.hasPagination === true;
  const showEmptyBranch = !hasRows && empty !== null;

  const rootClass = cn(
    'flex flex-col gap-3 rounded-xl border border-border bg-surface-card',
    props.class,
  );
  const tableClass = cn('w-full table-auto border-collapse text-sm text-text-primary');
  const theadClass = cn('border-b border-border bg-surface-subtle');
  const tbodyClass = cn('divide-y divide-border');
  const paginationClass = cn(
    'flex flex-col gap-2 border-t border-border px-3 py-3 sm:flex-row sm:items-center sm:justify-end sm:gap-3',
  );

  const rootTestId = props.testId?.trim() || DATA_TABLE_TEST_IDS.root;
  const tbodyTestIdRaw = props.tbodyTestId?.trim() ?? '';
  const tbodyTestId = tbodyTestIdRaw.length > 0 ? tbodyTestIdRaw : null;

  return {
    headers,
    empty,
    hasRows,
    hasPagination,
    showEmptyBranch,
    rootClass,
    tableClass,
    theadClass,
    tbodyClass,
    paginationClass,
    testIds: {
      root: rootTestId,
      table: DATA_TABLE_TEST_IDS.table,
      header: DATA_TABLE_TEST_IDS.header,
      tbody: tbodyTestId,
      pagination: DATA_TABLE_TEST_IDS.pagination,
    },
  };
}

function normalizeEmpty(empty: DataTableEmpty | undefined): DataTableEmpty | null {
  if (!empty) return null;
  const title = empty.title?.trim() ?? '';
  if (title.length === 0) {
    throw new TypeError(
      'DataTable: `empty.title` must be a non-empty string when `empty` is provided.',
    );
  }
  const bodyRaw = empty.body?.trim() ?? '';
  return bodyRaw.length > 0 ? { title, body: bodyRaw } : { title };
}
